import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

// BullMQ producer for `pdf-intake`. Matches the queue name + connection
// in apps/ingestion/src/pdf-intake/pipeline/queue.ts.
//
// The api service enqueues jobs after:
//   - a successful /pdfs/upload
//   - an admin clicking Re-extract in /admin/pdf-review
//
// It does NOT consume (that's apps/ingestion's worker). If api and
// ingestion ever run as one process, the dual-registration is harmless
// (BullMQ merges queue handles pointing at the same Redis).

export const PDF_INTAKE_QUEUE_NAME = 'pdf-intake';

export interface PdfIntakeJobData {
  pdfDocumentId: string;
  trigger: 'MANUAL' | 'UPLOAD' | 'CONNECTOR';
}

@Injectable()
export class PdfIntakeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfIntakeQueueService.name);
  private queue?: Queue<PdfIntakeJobData>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const parsed = new URL(redisUrl);
    this.queue = new Queue<PdfIntakeJobData>(PDF_INTAKE_QUEUE_NAME, {
      connection: {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        password: parsed.password || undefined,
      },
    });
    this.logger.log(`pdf-intake queue producer ready at ${parsed.hostname}:${parsed.port || 6379}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  async enqueue(pdfDocumentId: string, trigger: PdfIntakeJobData['trigger']): Promise<string> {
    if (!this.queue) throw new Error('PdfIntakeQueueService not initialised');
    const job = await this.queue.add(
      `${trigger.toLowerCase()}:${pdfDocumentId}`,
      { pdfDocumentId, trigger },
      { attempts: trigger === 'MANUAL' ? 1 : 2 },
    );
    return job.id ?? '';
  }
}
