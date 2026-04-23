import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue, QueueEvents, Worker } from 'bullmq';

import { ConnectorRunner, buildRegistry } from './connectors';
import {
  IngestionScheduler,
  createIngestionQueue,
  createIngestionWorker,
  createQueueEventsListener,
  type IngestionJobData,
  type IngestionJobResult,
} from './queue';

// The single NestJS provider that owns:
//   - the connector registry (slug → Connector instance)
//   - the ConnectorRunner
//   - the BullMQ queue, worker, events listener
//   - the scheduler (registers repeat jobs from DB at boot)
//
// Called from main.ts: boot the module, let IngestionService.onModuleInit
// run (which wires everything and reads DataSource rows), and keep the
// process alive. Graceful shutdown drains the worker.

@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private queue?: Queue<IngestionJobData, IngestionJobResult>;
  private worker?: Worker<IngestionJobData, IngestionJobResult>;
  private events?: QueueEvents;
  private scheduler?: IngestionScheduler;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const queueConfig = {
      redisUrl,
      maxAttempts: Number(this.config.get('INGESTION_MAX_ATTEMPTS') ?? 3),
      backoffBaseMs: Number(this.config.get('INGESTION_BACKOFF_BASE_MS') ?? 5_000),
    };

    const registry = buildRegistry();
    const runner = new ConnectorRunner(registry);

    this.queue = createIngestionQueue(queueConfig);
    this.worker = createIngestionWorker(queueConfig, runner);
    this.events = createQueueEventsListener(queueConfig);
    this.scheduler = new IngestionScheduler(this.queue);

    const { registered, skipped } = await this.scheduler.registerSchedules();
    this.logger.log(
      `ingestion worker online — ${registry.size} connectors registered, ${registered} scheduled (${skipped} skipped, manual-only)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // BullMQ's close() drains in-flight jobs on worker; queue and events
    // close their underlying ioredis connections. Order: worker first so
    // it finishes active jobs, then queue/events.
    await this.worker?.close();
    await this.queue?.close();
    await this.events?.close();
  }

  // Exposed for tests — the NestJS HTTP API in apps/api doesn't call
  // this directly; it enqueues via its own Queue handle pointed at the
  // same Redis.
  scheduleNow(slug: string, userId: string): Promise<string> {
    if (!this.scheduler) throw new Error('IngestionService not initialised');
    return this.scheduler.enqueueManual(slug, userId);
  }
}
