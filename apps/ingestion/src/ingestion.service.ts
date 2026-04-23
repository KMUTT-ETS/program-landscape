import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue, QueueEvents, Worker } from 'bullmq';
import { PipelineConfigSchema, S3Storage } from '@kku/shared';

import { ConnectorRunner, buildRegistry } from './connectors';
import {
  IngestionScheduler,
  createIngestionQueue,
  createIngestionWorker,
  createQueueEventsListener,
  type IngestionJobData,
  type IngestionJobResult,
} from './queue';
import {
  PdfIntakePipeline,
  createPdfIntakeQueue,
  createPdfIntakeWorker,
  createPdfIntakeEvents,
  type PdfIntakeJobData,
} from './pdf-intake/pipeline';
import { StubClassifier } from './pdf-intake/extractors';

// The single NestJS provider that owns:
//   - the connector registry (slug → Connector instance)
//   - the ConnectorRunner
//   - TWO BullMQ queues + their workers:
//       `ingestion`  — connector runs (scheduled + manual)
//       `pdf-intake` — PDF parsing + classification + extraction
//   - the scheduler (registers repeat jobs from DB at boot)
//
// Graceful shutdown drains both workers.

@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private connectorQueue?: Queue<IngestionJobData, IngestionJobResult>;
  private connectorWorker?: Worker<IngestionJobData, IngestionJobResult>;
  private connectorEvents?: QueueEvents;
  private pdfIntakeQueue?: Queue<PdfIntakeJobData>;
  private pdfIntakeWorker?: Worker<PdfIntakeJobData>;
  private pdfIntakeEvents?: QueueEvents;
  private scheduler?: IngestionScheduler;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';

    // ── Connector queue ────────────────────────────────────────────────
    const connectorQueueConfig = {
      redisUrl,
      maxAttempts: Number(this.config.get('INGESTION_MAX_ATTEMPTS') ?? 3),
      backoffBaseMs: Number(this.config.get('INGESTION_BACKOFF_BASE_MS') ?? 5_000),
    };
    const registry = buildRegistry();
    const runner = new ConnectorRunner(registry);

    this.connectorQueue = createIngestionQueue(connectorQueueConfig);
    this.connectorWorker = createIngestionWorker(connectorQueueConfig, runner);
    this.connectorEvents = createQueueEventsListener(connectorQueueConfig);
    this.scheduler = new IngestionScheduler(this.connectorQueue);
    const { registered, skipped } = await this.scheduler.registerSchedules();

    // ── PDF intake queue ──────────────────────────────────────────────
    const pdfIntakeQueueConfig = {
      redisUrl,
      maxAttempts: Number(this.config.get('PDF_INTAKE_MAX_ATTEMPTS') ?? 2),
      backoffBaseMs: Number(this.config.get('PDF_INTAKE_BACKOFF_BASE_MS') ?? 10_000),
      concurrency: Number(this.config.get('PDF_INTAKE_CONCURRENCY') ?? 2),
    };
    const pipeline = new PdfIntakePipeline({
      classifier: new StubClassifier(),
      storage: new S3Storage({
        endpoint: this.required('MINIO_ENDPOINT'),
        region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
        accessKeyId: this.required('MINIO_ACCESS_KEY'),
        secretAccessKey: this.required('MINIO_SECRET_KEY'),
        publicEndpoint: this.config.get<string>('MINIO_PUBLIC_ENDPOINT') || undefined,
      }),
      rawBucket: this.required('MINIO_BUCKET_PDF_RAW'),
      config: PipelineConfigSchema.parse({
        classifierAutoApproveThreshold: Number(
          this.config.get('PDF_INTAKE_CLASSIFIER_THRESHOLD') ?? 0.7,
        ),
        extractorAutoApproveThreshold: Number(
          this.config.get('PDF_INTAKE_EXTRACTOR_THRESHOLD') ?? 0.8,
        ),
      }),
    });

    this.pdfIntakeQueue = createPdfIntakeQueue(pdfIntakeQueueConfig);
    this.pdfIntakeWorker = createPdfIntakeWorker(pdfIntakeQueueConfig, pipeline);
    this.pdfIntakeEvents = createPdfIntakeEvents(pdfIntakeQueueConfig);

    this.logger.log(
      `ingestion worker online — ${registry.size} connectors (${registered} scheduled, ${skipped} manual-only); ` +
        `pdf-intake worker concurrency=${pdfIntakeQueueConfig.concurrency}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.connectorWorker?.close();
    await this.pdfIntakeWorker?.close();
    await this.connectorQueue?.close();
    await this.pdfIntakeQueue?.close();
    await this.connectorEvents?.close();
    await this.pdfIntakeEvents?.close();
  }

  scheduleNow(slug: string, userId: string): Promise<string> {
    if (!this.scheduler) throw new Error('IngestionService not initialised');
    return this.scheduler.enqueueManual(slug, userId);
  }

  private required(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new Error(`Missing required env var: ${key}`);
    return v;
  }
}
