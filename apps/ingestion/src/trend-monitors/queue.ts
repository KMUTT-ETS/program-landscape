import { Logger } from '@nestjs/common';
import { Queue, Worker, QueueEvents, type ConnectionOptions } from 'bullmq';
import {
  MONITOR_CADENCE,
  runJobMarketMonitor,
  runPatentsMonitor,
  runPeerProgramsMonitor,
  runPolicyMonitor,
  runResearchMonitor,
  runTechSignalsMonitor,
  type MonitorKind,
} from './monitors';

export const TREND_MONITORS_QUEUE_NAME = 'trend-monitors';

export interface TrendMonitorJobData {
  kind: MonitorKind;
  trigger: 'SCHEDULED' | 'MANUAL';
}

export interface TrendMonitorsConfig {
  redisUrl: string;
}

function redisConnection(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}

export function createTrendMonitorsQueue(config: TrendMonitorsConfig): Queue<TrendMonitorJobData> {
  return new Queue<TrendMonitorJobData>(TREND_MONITORS_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  });
}

export function createTrendMonitorsWorker(config: TrendMonitorsConfig): Worker<TrendMonitorJobData> {
  const logger = new Logger('TrendMonitorsWorker');
  return new Worker<TrendMonitorJobData>(
    TREND_MONITORS_QUEUE_NAME,
    async (job) => {
      const { kind, trigger } = job.data;
      logger.log(`Running ${kind} monitor (trigger=${trigger})`);
      switch (kind) {
        case 'policy':
          return runPolicyMonitor();
        case 'job-market':
          return runJobMarketMonitor();
        case 'research':
          return runResearchMonitor();
        case 'peer-programs':
          return runPeerProgramsMonitor();
        case 'tech-signals':
          return runTechSignalsMonitor();
        case 'patents':
          return runPatentsMonitor();
      }
    },
    {
      connection: redisConnection(config.redisUrl),
      concurrency: 1,  // monitors are cheap but ordering keeps logs tidy
    },
  );
}

export function createTrendMonitorsEvents(config: TrendMonitorsConfig): QueueEvents {
  const logger = new Logger('TrendMonitorsQueueEvents');
  const events = new QueueEvents(TREND_MONITORS_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
  });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.error(`Monitor job ${jobId} failed: ${failedReason}`);
  });
  return events;
}

// Registers one repeatable job per monitor kind. Called from
// IngestionService at boot. Uses the MONITOR_CADENCE map so the cadence
// is changeable in one place.
export async function scheduleMonitors(
  queue: Queue<TrendMonitorJobData>,
): Promise<{ registered: number }> {
  // Wipe prior repeats so cadence edits flow through on bounce.
  const existing = await queue.getRepeatableJobs();
  for (const r of existing) {
    await queue.removeRepeatableByKey(r.key);
  }
  let n = 0;
  for (const [kind, pattern] of Object.entries(MONITOR_CADENCE)) {
    await queue.add(
      `monitor:${kind}`,
      { kind: kind as MonitorKind, trigger: 'SCHEDULED' },
      { repeat: { pattern } },
    );
    n++;
  }
  return { registered: n };
}
