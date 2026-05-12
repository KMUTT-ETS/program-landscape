import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue, QueueEvents, Worker } from 'bullmq';
import {
  PipelineConfigSchema,
  S3Storage,
  createAiService,
  type AiProviderId,
  type AiService,
} from '@kku/shared';
import { PrismaAiInferenceRecorder, getAiModelOverrideStore } from '@kku/db';

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
import {
  buildHandlers as buildAiJobHandlers,
  createAiJobsQueue,
  createAiJobsWorker,
  createAiJobsEvents,
  type AiJobData,
} from './ai-jobs';
import {
  createTrendMonitorsQueue,
  createTrendMonitorsWorker,
  createTrendMonitorsEvents,
  scheduleMonitors,
  type TrendMonitorJobData,
} from './trend-monitors';
import {
  createExternalAiSourcesQueue,
  createExternalAiSourcesWorker,
  createExternalAiSourcesEvents,
  reconcileExternalAiRepeatables,
  type ExternalAiSourceJobData,
} from './external-ai';

// Owns FIVE runtime components:
//   - connector registry + ConnectorRunner
//   - `ingestion` queue/worker/events (connector runs)
//   - `pdf-intake` queue/worker/events (PDF parsing + classification)
//   - `ai-jobs` queue/worker/events (LLM extraction + embedding)
//   - scheduler (registers connector cron repeats)
//
// Graceful shutdown drains all three workers in order so in-flight AI
// calls (often slow) are allowed to finish before the DB connection
// closes.

@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private connectorQueue?: Queue<IngestionJobData, IngestionJobResult>;
  private connectorWorker?: Worker<IngestionJobData, IngestionJobResult>;
  private connectorEvents?: QueueEvents;
  private pdfIntakeQueue?: Queue<PdfIntakeJobData>;
  private pdfIntakeWorker?: Worker<PdfIntakeJobData>;
  private pdfIntakeEvents?: QueueEvents;
  private aiJobsQueue?: Queue<AiJobData>;
  private aiJobsWorker?: Worker<AiJobData>;
  private aiJobsEvents?: QueueEvents;
  private trendMonitorsQueue?: Queue<TrendMonitorJobData>;
  private trendMonitorsWorker?: Worker<TrendMonitorJobData>;
  private trendMonitorsEvents?: QueueEvents;
  private externalAiQueue?: Queue<ExternalAiSourceJobData>;
  private externalAiWorker?: Worker<ExternalAiSourceJobData>;
  private externalAiEvents?: QueueEvents;
  private externalAiReconciler?: NodeJS.Timeout;
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

    // Build AI first — both the PDF-intake pipeline (for curriculum
    // extraction) and the ai-jobs workers consume it.
    const ai = this.buildAiService();

    // ── PDF intake queue ──────────────────────────────────────────────
    const pdfIntakeQueueConfig = {
      redisUrl,
      maxAttempts: Number(this.config.get('PDF_INTAKE_MAX_ATTEMPTS') ?? 2),
      backoffBaseMs: Number(this.config.get('PDF_INTAKE_BACKOFF_BASE_MS') ?? 10_000),
      concurrency: Number(this.config.get('PDF_INTAKE_CONCURRENCY') ?? 2),
    };
    const storage = new S3Storage({
      endpoint: this.required('MINIO_ENDPOINT'),
      region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
      accessKeyId: this.required('MINIO_ACCESS_KEY'),
      secretAccessKey: this.required('MINIO_SECRET_KEY'),
      publicEndpoint: this.config.get<string>('MINIO_PUBLIC_ENDPOINT') || undefined,
    });
    const pipeline = new PdfIntakePipeline({
      classifier: new StubClassifier(),
      storage,
      rawBucket: this.required('MINIO_BUCKET_PDF_RAW'),
      config: PipelineConfigSchema.parse({
        classifierAutoApproveThreshold: Number(
          this.config.get('PDF_INTAKE_CLASSIFIER_THRESHOLD') ?? 0.7,
        ),
        extractorAutoApproveThreshold: Number(
          this.config.get('PDF_INTAKE_EXTRACTOR_THRESHOLD') ?? 0.8,
        ),
      }),
      ai,
    });

    this.pdfIntakeQueue = createPdfIntakeQueue(pdfIntakeQueueConfig);
    this.pdfIntakeWorker = createPdfIntakeWorker(pdfIntakeQueueConfig, pipeline);
    this.pdfIntakeEvents = createPdfIntakeEvents(pdfIntakeQueueConfig);

    // ── AI-jobs queue ──────────────────────────────────────────────────
    const aiJobsQueueConfig = {
      redisUrl,
      maxAttempts: Number(this.config.get('AI_JOBS_MAX_ATTEMPTS') ?? 2),
      backoffBaseMs: Number(this.config.get('AI_JOBS_BACKOFF_BASE_MS') ?? 15_000),
      concurrency: Number(this.config.get('AI_JOBS_CONCURRENCY') ?? 2),
    };

    const aiHandlers = buildAiJobHandlers({
      ai,
      autoApproveThreshold: Number(this.config.get('AI_AUTO_APPROVE_THRESHOLD') ?? 0.85),
      storage,
    });

    this.aiJobsQueue = createAiJobsQueue(aiJobsQueueConfig);
    this.aiJobsWorker = createAiJobsWorker(aiJobsQueueConfig, aiHandlers);
    this.aiJobsEvents = createAiJobsEvents(aiJobsQueueConfig);

    // ── Trend monitors (prompt 07) ────────────────────────────────────
    this.trendMonitorsQueue = createTrendMonitorsQueue({ redisUrl });
    this.trendMonitorsWorker = createTrendMonitorsWorker({ redisUrl });
    this.trendMonitorsEvents = createTrendMonitorsEvents({ redisUrl });
    const { registered: monitorsRegistered } = await scheduleMonitors(this.trendMonitorsQueue);

    // ── External AI sources (Phase 5 cron) ────────────────────────────
    // Queue + worker that execute the fetch+summarise runner on cron.
    // Reconciler converges the BullMQ repeatable set against the DB
    // on boot AND every 5 min — handles status flips / cadence edits
    // that didn't make it through the API's hot-flip path.
    const externalAiConfig = {
      redisUrl,
      ai,
      googleCseApiKey: this.config.get<string>('GOOGLE_CSE_API_KEY') || undefined,
      googleCseCx: this.config.get<string>('GOOGLE_CSE_CX') || undefined,
      concurrency: Number(this.config.get('EXTERNAL_AI_CONCURRENCY') ?? 1),
    };
    this.externalAiQueue = createExternalAiSourcesQueue(externalAiConfig);
    this.externalAiWorker = createExternalAiSourcesWorker(externalAiConfig);
    this.externalAiEvents = createExternalAiSourcesEvents(externalAiConfig);
    const initialReconcile = await reconcileExternalAiRepeatables(this.externalAiQueue);
    this.logger.log(
      `external-ai reconcile (boot): added=${initialReconcile.added} ` +
        `removed=${initialReconcile.removed} active=${initialReconcile.active}/${initialReconcile.total}`,
    );
    this.externalAiReconciler = setInterval(() => {
      reconcileExternalAiRepeatables(this.externalAiQueue!).catch((err) => {
        this.logger.warn(`external-ai reconcile failed: ${(err as Error).message}`);
      });
    }, 5 * 60_000);
    // Unref so the timer doesn't keep the event loop alive during shutdown.
    this.externalAiReconciler.unref();

    this.logger.log(
      `ingestion worker online — ${registry.size} connectors (${registered} scheduled, ${skipped} manual-only); ` +
        `pdf-intake concurrency=${pdfIntakeQueueConfig.concurrency}; ` +
        `ai-jobs provider=${ai.providerId} concurrency=${aiJobsQueueConfig.concurrency}; ` +
        `trend-monitors registered=${monitorsRegistered}; ` +
        `external-ai active=${initialReconcile.active}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.externalAiReconciler) clearInterval(this.externalAiReconciler);
    // Order: workers first (drain in-flight), then queues + events.
    await this.connectorWorker?.close();
    await this.pdfIntakeWorker?.close();
    await this.aiJobsWorker?.close();
    await this.trendMonitorsWorker?.close();
    await this.externalAiWorker?.close();
    await this.connectorQueue?.close();
    await this.pdfIntakeQueue?.close();
    await this.aiJobsQueue?.close();
    await this.trendMonitorsQueue?.close();
    await this.externalAiQueue?.close();
    await this.connectorEvents?.close();
    await this.pdfIntakeEvents?.close();
    await this.aiJobsEvents?.close();
    await this.trendMonitorsEvents?.close();
    await this.externalAiEvents?.close();
  }

  scheduleNow(slug: string, userId: string): Promise<string> {
    if (!this.scheduler) throw new Error('IngestionService not initialised');
    return this.scheduler.enqueueManual(slug, userId);
  }

  private buildAiService(): AiService {
    const recorder = new PrismaAiInferenceRecorder();
    const providerId = (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId;
    const intelSphereUrl = this.config.get<string>('KKU_INTELSPHERE_URL');
    const intelSphereKey = this.config.get<string>('KKU_INTELSPHERE_API_KEY');
    return createAiService({
      recorder,
      providerId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
        intelSphere:
          intelSphereUrl && intelSphereKey
            ? { url: intelSphereUrl, apiKey: intelSphereKey }
            : undefined,
      },
      models: {
        google: {
          completion: this.config.get<string>('AI_GOOGLE_COMPLETION_MODEL'),
          embedding: this.config.get<string>('AI_GOOGLE_EMBEDDING_MODEL'),
        },
        anthropic: {
          completion: this.config.get<string>('AI_ANTHROPIC_COMPLETION_MODEL'),
        },
      },
      modelOverrideResolver: getAiModelOverrideStore(),
    });
  }

  private required(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new Error(`Missing required env var: ${key}`);
    return v;
  }
}
