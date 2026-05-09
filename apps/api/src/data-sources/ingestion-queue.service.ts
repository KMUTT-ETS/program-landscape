import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

// NestJS-side producer for the `ingestion` BullMQ queue.
//
// The api service doesn't run the BullMQ worker (apps/ingestion does),
// but it DOES push "Run now" jobs onto the same queue so the worker
// picks them up. Queue name + Redis connection MUST match the ones in
// apps/ingestion/src/queue/queue.ts (INGESTION_QUEUE_NAME = 'ingestion').
//
// If you change the queue name there, change it here.

export const INGESTION_QUEUE_NAME = 'ingestion';

export interface IngestionJobData {
  dataSourceSlug: string;
  trigger: 'SCHEDULED' | 'MANUAL' | 'BACKFILL';
  triggeredByUserId?: string | null;
  /** X-Request-Id of the HTTP call that enqueued this job. Workers
   * log it as `traceId` for cross-tier correlation. Omit for cron. */
  parentTraceId?: string;
}

@Injectable()
export class IngestionQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionQueueService.name);
  private queue?: Queue<IngestionJobData>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const parsed = new URL(redisUrl);
    this.queue = new Queue<IngestionJobData>(INGESTION_QUEUE_NAME, {
      connection: {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        password: parsed.password || undefined,
      },
    });
    this.logger.log(`ingestion queue producer ready at ${parsed.hostname}:${parsed.port || 6379}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  async enqueueManual(
    dataSourceSlug: string,
    triggeredByUserId: string,
    parentTraceId?: string,
  ): Promise<string> {
    if (!this.queue) throw new Error('IngestionQueueService not initialised');
    const job = await this.queue.add(
      `manual:${dataSourceSlug}`,
      { dataSourceSlug, trigger: 'MANUAL', triggeredByUserId, parentTraceId },
      { attempts: 1 },
    );
    return job.id ?? '';
  }
}
