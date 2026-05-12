import { Logger } from '@nestjs/common';
import { Queue, Worker, QueueEvents, type ConnectionOptions } from 'bullmq';
import { prisma, runExternalAiSource } from '@kku/db';
import type { AiService } from '@kku/shared';

// Queue name must match apps/api/src/admin/external-ai/external-ai.service.ts
export const EXTERNAL_AI_SOURCES_QUEUE_NAME = 'external-ai-sources';

export interface ExternalAiSourceJobData {
  sourceId: string;
  /** Why we ran. Reserved for future audit; currently informational. */
  trigger?: 'SCHEDULED' | 'MANUAL' | 'RECONCILE';
}

export interface ExternalAiSourcesConfig {
  redisUrl: string;
  ai: AiService;
  googleCseApiKey?: string;
  googleCseCx?: string;
  /** Soft concurrency — fetching is HTTP-bound, summarising hits the
   *  AI rate limits. Keep modest. */
  concurrency?: number;
}

function redisConnection(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}

export function createExternalAiSourcesQueue(
  config: ExternalAiSourcesConfig,
): Queue<ExternalAiSourceJobData> {
  return new Queue<ExternalAiSourceJobData>(EXTERNAL_AI_SOURCES_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  });
}

export function createExternalAiSourcesWorker(
  config: ExternalAiSourcesConfig,
): Worker<ExternalAiSourceJobData> {
  const logger = new Logger('ExternalAiSourcesWorker');
  return new Worker<ExternalAiSourceJobData>(
    EXTERNAL_AI_SOURCES_QUEUE_NAME,
    async (job) => {
      const sourceId = job.data.sourceId;
      // Guard against an admin pausing/disabling the source between
      // the cron firing and the worker picking it up. The repeatable
      // SHOULD be removed on status flip, but Redis pubsub isn't
      // instant; defensive check costs one Postgres roundtrip.
      const source = await prisma.externalAiSource.findUnique({
        where: { id: sourceId },
        select: { status: true, slug: true },
      });
      if (!source) {
        logger.warn(`source ${sourceId} not found; skipping`);
        return { skipped: 'missing' };
      }
      if (source.status !== 'ACTIVE') {
        logger.log(`source ${source.slug} is ${source.status}; skipping`);
        return { skipped: 'inactive' };
      }
      logger.log(`running external-ai source ${source.slug}`);
      const result = await runExternalAiSource({
        sourceId,
        ai: config.ai,
        googleCseApiKey: config.googleCseApiKey,
        googleCseCx: config.googleCseCx,
        logger,
      });
      logger.log(
        `external-ai source ${source.slug} done — fetched=${result.fetched} ` +
          `summarised=${result.summarised} skipped=${result.skipped} failed=${result.failures}`,
      );
      return result;
    },
    {
      connection: redisConnection(config.redisUrl),
      concurrency: config.concurrency ?? 1,
    },
  );
}

export function createExternalAiSourcesEvents(
  config: ExternalAiSourcesConfig,
): QueueEvents {
  const logger = new Logger('ExternalAiSourcesQueueEvents');
  const events = new QueueEvents(EXTERNAL_AI_SOURCES_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
  });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.error(`external-ai job ${jobId} failed: ${failedReason}`);
  });
  return events;
}

// ── Reconciler ────────────────────────────────────────────────────────
// Reads every ExternalAiSource row and converges the BullMQ repeatable
// set to match. Called on worker boot and every 5 minutes thereafter
// as a safety net for admin status/cadence changes that didn't make it
// through the API's hot-flip path (Redis flap, api restart, etc.).
export async function reconcileExternalAiRepeatables(
  queue: Queue<ExternalAiSourceJobData>,
): Promise<{ added: number; removed: number; active: number; total: number }> {
  const sources = await prisma.externalAiSource.findMany({
    select: { id: true, slug: true, status: true, cadenceCron: true },
  });
  const want = new Map<string, { sourceId: string; pattern: string }>();
  for (const s of sources) {
    if (s.status === 'ACTIVE' && s.cadenceCron) {
      want.set(`external-ai:${s.slug}`, { sourceId: s.id, pattern: s.cadenceCron });
    }
  }
  const existing = await queue.getRepeatableJobs();
  let removed = 0;
  let added = 0;
  // Remove repeatables we no longer want, or whose pattern changed.
  for (const r of existing) {
    const w = want.get(r.name);
    if (!w || w.pattern !== r.pattern) {
      await queue.removeRepeatableByKey(r.key);
      removed += 1;
    } else {
      // Already correct — drop from `want` so we don't re-add.
      want.delete(r.name);
    }
  }
  // Add any still-wanted repeatables (new or pattern-changed).
  for (const [name, w] of want.entries()) {
    await queue.add(
      name,
      { sourceId: w.sourceId, trigger: 'SCHEDULED' },
      { repeat: { pattern: w.pattern } },
    );
    added += 1;
  }
  return {
    added,
    removed,
    active: sources.filter((s) => s.status === 'ACTIVE').length,
    total: sources.length,
  };
}
