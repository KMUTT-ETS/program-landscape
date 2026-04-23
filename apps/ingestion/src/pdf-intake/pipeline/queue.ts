import { Logger } from '@nestjs/common';
import { Queue, Worker, QueueEvents, type ConnectionOptions } from 'bullmq';
import type { PdfIntakePipeline } from './runner';

// Dedicated BullMQ queue for the PDF intake pipeline. Kept separate from
// the `ingestion` queue so:
//   - PDF intake can have its own concurrency + rate-limit without
//     throttling the regular ingestion runs (and vice versa)
//   - Failure retries can be tuned per-domain (PDF parse failures are
//     different from API fetch failures)
//
// The api service (apps/api) also produces to this queue — the upload
// endpoint enqueues a job per successful upload. The queue name +
// connection must match there.

export const PDF_INTAKE_QUEUE_NAME = 'pdf-intake';

export interface PdfIntakeJobData {
  pdfDocumentId: string;
  // MANUAL — an admin clicked Re-extract in /admin/pdf-review
  // UPLOAD   — api queued after a successful PUT
  // CONNECTOR — the ingestion framework queued after a PDF connector ran
  trigger: 'MANUAL' | 'UPLOAD' | 'CONNECTOR';
}

export interface PdfIntakeQueueConfig {
  redisUrl: string;
  maxAttempts: number;
  backoffBaseMs: number;
  concurrency: number;
}

function redisConnection(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}

export function createPdfIntakeQueue(config: PdfIntakeQueueConfig): Queue<PdfIntakeJobData> {
  return new Queue<PdfIntakeJobData>(PDF_INTAKE_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
    defaultJobOptions: {
      attempts: config.maxAttempts,
      backoff: { type: 'exponential', delay: config.backoffBaseMs },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  });
}

export function createPdfIntakeWorker(
  config: PdfIntakeQueueConfig,
  pipeline: PdfIntakePipeline,
): Worker<PdfIntakeJobData> {
  const logger = new Logger('PdfIntakeWorker');
  return new Worker<PdfIntakeJobData>(
    PDF_INTAKE_QUEUE_NAME,
    async (job) => {
      const { pdfDocumentId, trigger } = job.data;
      logger.log(`Processing ${pdfDocumentId} (trigger=${trigger}, attempt=${job.attemptsMade + 1})`);
      const outcome = await pipeline.process(pdfDocumentId);
      logger.log(
        `Done ${pdfDocumentId}: ${outcome.extractionCount} extractions (` +
          `${outcome.autoApproved} auto-approved, ${outcome.pendingReview} pending review)`,
      );
      return outcome;
    },
    {
      connection: redisConnection(config.redisUrl),
      concurrency: config.concurrency,
    },
  );
}

export function createPdfIntakeEvents(config: PdfIntakeQueueConfig): QueueEvents {
  const logger = new Logger('PdfIntakeQueueEvents');
  const events = new QueueEvents(PDF_INTAKE_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
  });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.error(`PDF intake job ${jobId} failed: ${failedReason}`);
  });
  return events;
}
