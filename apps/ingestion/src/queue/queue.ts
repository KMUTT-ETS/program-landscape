import { Queue, Worker, QueueEvents, type ConnectionOptions } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConnectorRunner } from '../connectors';
import type { IngestionRunTrigger } from '@kku/shared';

// BullMQ plumbing for the ingestion service. One queue + one worker +
// one events listener; all three share the same Redis connection. The
// scheduler (scheduler.ts) uses BullMQ's `add` with `repeat` options to
// enqueue scheduled jobs; the /data-sources/:id/run admin endpoint
// (apps/api) enqueues manual jobs directly to this queue.

export const INGESTION_QUEUE_NAME = 'ingestion';

export interface IngestionJobData {
  dataSourceSlug: string;
  trigger: IngestionRunTrigger;
  triggeredByUserId?: string | null;
}

// BullMQ exports this type but doesn't re-export it cleanly under all
// resolver configs — keep our own alias for clarity.
export type IngestionJobResult =
  | { runId: string; status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' };

export interface IngestionQueueConfig {
  redisUrl: string;
  maxAttempts: number;        // BullMQ's retry count, inc. first attempt
  backoffBaseMs: number;      // e.g. 5_000 — exponential: 5s, 10s, 20s...
}

function redisConnection(redisUrl: string): ConnectionOptions {
  // BullMQ accepts a URL string via `connection` options when used with
  // `new IORedis(url)`, but the direct-config form is easier to log.
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}

export function createIngestionQueue(config: IngestionQueueConfig): Queue<IngestionJobData, IngestionJobResult> {
  return new Queue<IngestionJobData, IngestionJobResult>(INGESTION_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
    defaultJobOptions: {
      attempts: config.maxAttempts,
      backoff: { type: 'exponential', delay: config.backoffBaseMs },
      removeOnComplete: { count: 500 },  // keep recent successes for the admin dashboard
      removeOnFail: { count: 500 },      // keep recent failures for the error log
    },
  });
}

export function createIngestionWorker(
  config: IngestionQueueConfig,
  runner: ConnectorRunner,
): Worker<IngestionJobData, IngestionJobResult> {
  const logger = new Logger('IngestionWorker');
  return new Worker<IngestionJobData, IngestionJobResult>(
    INGESTION_QUEUE_NAME,
    async (job) => {
      const { dataSourceSlug, trigger, triggeredByUserId } = job.data;
      logger.log(`Running ${dataSourceSlug} (trigger=${trigger}, attempt=${job.attemptsMade + 1})`);
      const outcome = await runner.run({
        dataSourceSlug,
        trigger,
        triggeredByUserId: triggeredByUserId ?? null,
        attempt: job.attemptsMade + 1,
      });
      // Emit "completed" to BullMQ with a minimal result; the full
      // record lives in pdf_generations / ingestion_runs tables for the
      // admin page to query.
      return { runId: outcome.runId, status: outcome.status };
    },
    {
      connection: redisConnection(config.redisUrl),
      // Rate-limits for real connectors (JobsDB API limits, Scopus
      // quotas) will land at per-queue level in prompt 14.
      concurrency: 4,
    },
  );
}

export function createQueueEventsListener(config: IngestionQueueConfig): QueueEvents {
  const logger = new Logger('IngestionQueueEvents');
  const events = new QueueEvents(INGESTION_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
  });
  events.on('failed', ({ jobId, failedReason }) => {
    // prompt 13 will replace this with a real alerting pipeline.
    logger.error(`Job ${jobId} failed: ${failedReason}`);
  });
  return events;
}
