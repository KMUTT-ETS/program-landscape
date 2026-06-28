import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kku/db';
import { S3Storage, ApiError } from '@kku/shared';
import { createHash } from 'node:crypto';
import { AiJobsQueueService } from '../ai-jobs/ai-jobs-queue.service';

// Service backing /admin/trend-documents. Owns the MinIO client for storing
// uploaded documents, creates TrendDocument rows, and enqueues the
// ANALYZE_TREND_DOCUMENT ai-job (consumed by the ingestion worker, which
// converts to Markdown via markitdown → drafts the signal → publishes →
// enriches).
//
// Mirrors PdfIntakeService's storage setup, but writes to its own
// `trend-documents/` key prefix and its own table.

type SignalTypeHint = 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';

// Formats the markitdown sidecar converts. The extension is preserved on the
// stored object so the ingestion runner can hand markitdown a correct hint.
const SUPPORTED_UPLOAD_EXTS = ['pdf', 'docx', 'xlsx', 'pptx', 'html', 'htm', 'csv', 'txt', 'md'] as const;
type SupportedUploadExt = (typeof SUPPORTED_UPLOAD_EXTS)[number];
const UPLOAD_CONTENT_TYPES: Record<SupportedUploadExt, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
};

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

  // Upload a document (PDF / DOCX / XLSX / PPTX / HTML / CSV / TXT / MD).
  // Content-hash dedup against prior trend documents so the same file isn't
  // re-analysed; a fresh upload of a new file always enqueues.
  async ingestFile(input: {
    originalFilename: string;
    bytes: Buffer;
    signalTypeHint?: SignalTypeHint;
    uploadedByUserId: string | null;
  }): Promise<{ trendDocumentId: string; deduplicated: boolean }> {
    const { bytes } = input;
    const ext = (input.originalFilename.split('.').pop() ?? '').toLowerCase();
    if (!SUPPORTED_UPLOAD_EXTS.includes(ext as SupportedUploadExt)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `Unsupported file type "${ext || '(none)'}". Allowed: ${SUPPORTED_UPLOAD_EXTS.join(', ')}.`,
      );
    }
    if (bytes.length < 4) {
      throw new ApiError('VALIDATION_FAILED', 'Uploaded file is empty.');
    }
    // Defensive: a .pdf must actually be a PDF (cheap magic-byte check).
    if (ext === 'pdf' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new ApiError('VALIDATION_FAILED', 'File is named .pdf but is not a PDF (missing %PDF- header).');
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const existing = await prisma.trendDocument.findFirst({
      where: { contentHash, status: { in: ['SUCCEEDED', 'PROCESSING', 'PENDING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { trendDocumentId: existing.id, deduplicated: true };

    const key = `trend-documents/${contentHash}.${ext}`;
    await this.storage.putObject({
      bucket: this.rawBucket,
      key,
      body: bytes,
      contentType: UPLOAD_CONTENT_TYPES[ext as SupportedUploadExt] ?? 'application/octet-stream',
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

  // Remove a source document/URL AND its published signal from the Trends
  // Radar. There are no FK constraints onto trend_signals, so we explicitly
  // tidy the loose links: the signal row, any inbox notifications that point
  // at it, the stored object (FILE sources), then the document row itself.
  async remove(id: string): Promise<{ removed: true; deletedSignal: boolean }> {
    const doc = await prisma.trendDocument.findUnique({ where: { id } });
    if (!doc) throw new ApiError('NOT_FOUND', 'Trend document not found');

    let deletedSignal = false;
    if (doc.trendSignalId) {
      await prisma.notification.deleteMany({ where: { entityId: doc.trendSignalId } });
      const del = await prisma.trendSignal.deleteMany({ where: { id: doc.trendSignalId } });
      deletedSignal = del.count > 0;
    }

    // Best-effort: drop the stored object. Content-hash dedup guarantees one
    // document per object, so nothing else references this key.
    if (doc.storageUrl?.startsWith('s3://')) {
      try {
        const without = doc.storageUrl.slice('s3://'.length);
        const slash = without.indexOf('/');
        if (slash > 0) {
          await this.storage.deleteObject(without.slice(0, slash), without.slice(slash + 1));
        }
      } catch (e) {
        this.logger.warn(`failed to delete stored object for trend document ${id}: ${String(e)}`);
      }
    }

    await prisma.trendDocument.delete({ where: { id } });
    this.logger.log(`removed trend document ${id}${deletedSignal ? ' + its signal' : ''}`);
    return { removed: true, deletedSignal };
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
