import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kku/db';
import { S3Storage, ApiError } from '@kku/shared';
import { createHash } from 'node:crypto';
import { AiJobsQueueService } from '../ai-jobs/ai-jobs-queue.service';

// Service backing /admin/trend-documents. Owns the MinIO client for storing
// uploaded PDFs, creates TrendDocument rows, and enqueues the
// ANALYZE_TREND_DOCUMENT ai-job (consumed by the ingestion worker, which
// extracts text → drafts the signal → publishes → enriches).
//
// Mirrors PdfIntakeService's storage setup, but writes to its own
// `trend-documents/` key prefix and its own table.

type SignalTypeHint = 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';

export interface TrendDocumentRow {
  id: string;
  sourceType: 'FILE' | 'URL';
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  originalFilename: string | null;
  sourceUrl: string | null;
  signalTypeHint: string | null;
  trendSignalId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TrendDocumentsService implements OnModuleInit {
  private readonly logger = new Logger(TrendDocumentsService.name);
  private storage!: S3Storage;
  private rawBucket!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly aiJobs: AiJobsQueueService,
  ) {}

  onModuleInit(): void {
    this.storage = new S3Storage({
      endpoint: this.required('MINIO_ENDPOINT'),
      region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
      accessKeyId: this.required('MINIO_ACCESS_KEY'),
      secretAccessKey: this.required('MINIO_SECRET_KEY'),
      publicEndpoint: this.config.get<string>('MINIO_PUBLIC_ENDPOINT') || undefined,
    });
    this.rawBucket = this.required('MINIO_BUCKET_PDF_RAW');
  }

  // Upload a PDF file. Content-hash dedup against prior trend documents so the
  // same PDF isn't re-analysed; a fresh upload of a new PDF always enqueues.
  async ingestFile(input: {
    originalFilename: string;
    bytes: Buffer;
    signalTypeHint?: SignalTypeHint;
    uploadedByUserId: string | null;
  }): Promise<{ trendDocumentId: string; deduplicated: boolean }> {
    const { bytes } = input;
    if (
      bytes.length < 5 ||
      bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d
    ) {
      throw new ApiError('VALIDATION_FAILED', 'Uploaded file is not a PDF (missing %PDF- header signature).');
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const existing = await prisma.trendDocument.findFirst({
      where: { contentHash, status: { in: ['SUCCEEDED', 'PROCESSING', 'PENDING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { trendDocumentId: existing.id, deduplicated: true };

    const key = `trend-documents/${contentHash}.pdf`;
    await this.storage.putObject({
      bucket: this.rawBucket,
      key,
      body: bytes,
      contentType: 'application/pdf',
      metadata: { originalFilename: input.originalFilename, uploader: input.uploadedByUserId ?? 'anonymous' },
    });

    const doc = await prisma.trendDocument.create({
      data: {
        sourceType: 'FILE',
        status: 'PENDING',
        originalFilename: input.originalFilename,
        storageUrl: `s3://${this.rawBucket}/${key}`,
        contentHash,
        fileSize: bytes.byteLength,
        signalTypeHint: input.signalTypeHint ?? null,
        uploadedByUserId: input.uploadedByUserId,
      },
    });
    await this.enqueue(doc.id, input.uploadedByUserId);
    return { trendDocumentId: doc.id, deduplicated: false };
  }

  // Ingest from a URL — the ingestion worker fetches + extracts (PDF or HTML).
  async ingestUrl(input: {
    url: string;
    signalTypeHint?: SignalTypeHint;
    uploadedByUserId: string | null;
  }): Promise<{ trendDocumentId: string }> {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new ApiError('VALIDATION_FAILED', 'Not a valid URL.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ApiError('VALIDATION_FAILED', 'URL must be http(s).');
    }
    const doc = await prisma.trendDocument.create({
      data: {
        sourceType: 'URL',
        status: 'PENDING',
        sourceUrl: parsed.toString(),
        signalTypeHint: input.signalTypeHint ?? null,
        uploadedByUserId: input.uploadedByUserId,
      },
    });
    await this.enqueue(doc.id, input.uploadedByUserId);
    return { trendDocumentId: doc.id };
  }

  async list(limit: number): Promise<TrendDocumentRow[]> {
    const rows = await prisma.trendDocument.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(serialize);
  }

  async getOne(id: string): Promise<TrendDocumentRow> {
    const row = await prisma.trendDocument.findUnique({ where: { id } });
    if (!row) throw new ApiError('NOT_FOUND', 'Trend document not found');
    return serialize(row);
  }

  private async enqueue(trendDocumentId: string, userId: string | null): Promise<void> {
    await this.aiJobs.enqueue({
      kind: 'ANALYZE_TREND_DOCUMENT',
      entityId: trendDocumentId,
      triggeredByUserId: userId,
      trigger: 'MANUAL',
    });
    this.logger.log(`enqueued ANALYZE_TREND_DOCUMENT for ${trendDocumentId}`);
  }

  private required(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new Error(`Missing required config: ${key}`);
    return v;
  }
}

function serialize(row: {
  id: string;
  sourceType: 'FILE' | 'URL';
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  originalFilename: string | null;
  sourceUrl: string | null;
  signalTypeHint: string | null;
  trendSignalId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TrendDocumentRow {
  return {
    id: row.id,
    sourceType: row.sourceType,
    status: row.status,
    originalFilename: row.originalFilename,
    sourceUrl: row.sourceUrl,
    signalTypeHint: row.signalTypeHint,
    trendSignalId: row.trendSignalId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
