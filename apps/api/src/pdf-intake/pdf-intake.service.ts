import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, prisma, type PdfSourceCategory, type PdfLanguage } from '@kku/db';
import { S3Storage, ApiError } from '@kku/shared';
import { createHash } from 'node:crypto';
import { PdfIntakeQueueService } from './pdf-intake-queue.service';

// Service backing the /pdfs/* endpoints. Owns:
//   - the MinIO client (for upload + signed URLs)
//   - PdfDocument lifecycle (create, re-queue, approve, reject)
//   - enqueueing intake jobs (delegates to PdfIntakeQueueService)
//
// The ingestion worker does the actual pipeline work. This service only
// produces jobs + exposes read endpoints + manages review actions.

@Injectable()
export class PdfIntakeService implements OnModuleInit {
  private readonly logger = new Logger(PdfIntakeService.name);
  private storage!: S3Storage;
  private rawBucket!: string;
  private signedUrlTtlSeconds!: number;

  constructor(
    private readonly config: ConfigService,
    private readonly intakeQueue: PdfIntakeQueueService,
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
    this.signedUrlTtlSeconds = Number(this.config.get('PDF_SIGNED_URL_TTL_SECONDS') ?? 900);
  }

  // Upload a single PDF. Content-hash dedup: if a PdfDocument with the
  // same hash already exists, we return it without re-uploading. The
  // intake pipeline is ONLY enqueued for net-new rows (returning an
  // existing in PENDING state re-enqueues so the caller can nudge a
  // stuck pipeline).
  async uploadPdf(input: {
    originalFilename: string;
    bytes: Buffer;
    uploadedByUserId: string | null;
    sourceCategoryHint?: PdfSourceCategory;
    sourceOrg?: string;
    language?: PdfLanguage;
    notes?: string;
  }): Promise<{ pdfDocumentId: string; deduplicated: boolean; enqueued: boolean }> {
    const contentHash = createHash('sha256').update(input.bytes).digest('hex');
    const existing = await prisma.pdfDocument.findUnique({ where: { contentHash } });
    if (existing) {
      // Re-enqueue only if it's stuck in PENDING. A COMPLETED doc needs
      // the explicit "Re-extract" action, not an upload-as-retry.
      let enqueued = false;
      if (existing.processingStatus === 'PENDING' || existing.processingStatus === 'FAILED') {
        await prisma.pdfDocument.update({
          where: { id: existing.id },
          data: { processingStatus: 'PENDING', processingError: null },
        });
        await this.intakeQueue.enqueue(existing.id, 'UPLOAD');
        enqueued = true;
      }
      return { pdfDocumentId: existing.id, deduplicated: true, enqueued };
    }

    const category = input.sourceCategoryHint ?? 'OTHER';
    const key = `${category.toLowerCase()}/${contentHash}.pdf`;
    await this.storage.putObject({
      bucket: this.rawBucket,
      key,
      body: input.bytes,
      contentType: 'application/pdf',
      metadata: {
        originalFilename: input.originalFilename,
        uploader: input.uploadedByUserId ?? 'anonymous',
      },
    });
    const storageUrl = `s3://${this.rawBucket}/${key}`;

    const doc = await prisma.pdfDocument.create({
      data: {
        originalFilename: input.originalFilename,
        storageUrl,
        fileSize: input.bytes.byteLength,
        pageCount: 0,
        sourceCategory: category,
        sourceCategoryHint: input.sourceCategoryHint ?? null,
        sourceOrg: input.sourceOrg ?? null,
        language: input.language ?? 'TH',
        contentHash,
        processingStatus: 'PENDING',
        uploadedByUserId: input.uploadedByUserId,
      },
    });

    await this.intakeQueue.enqueue(doc.id, 'UPLOAD');
    return { pdfDocumentId: doc.id, deduplicated: false, enqueued: true };
  }

  async signedPdfUrl(pdfDocumentId: string): Promise<string> {
    const doc = await prisma.pdfDocument.findUnique({ where: { id: pdfDocumentId } });
    if (!doc) throw new ApiError('NOT_FOUND', 'PdfDocument not found');
    const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(doc.storageUrl);
    if (!match) throw new ApiError('INTERNAL', `Malformed storageUrl: ${doc.storageUrl}`);
    const [, bucket, key] = match;
    if (!bucket || !key) throw new ApiError('INTERNAL', 'Malformed storageUrl');
    return this.storage.getSignedDownloadUrl({
      bucket,
      key,
      ttlSeconds: this.signedUrlTtlSeconds,
    });
  }

  async listQueue(opts: { status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED'; limit: number }) {
    // The review queue is "PDFs that have at least one PENDING_REVIEW
    // extraction" by default. Admin can switch to other statuses to
    // audit historical decisions.
    const status = opts.status ?? 'PENDING_REVIEW';
    return prisma.pdfDocument.findMany({
      where: {
        processingStatus: 'COMPLETED',
        extractions: { some: { reviewStatus: status } },
      },
      orderBy: { uploadedAt: 'desc' },
      take: opts.limit,
      include: {
        _count: { select: { extractions: true } },
        extractions: {
          where: { reviewStatus: status },
          select: { id: true, extractionType: true, confidence: true },
        },
      },
    });
  }

  async getOne(pdfDocumentId: string) {
    const doc = await prisma.pdfDocument.findUnique({
      where: { id: pdfDocumentId },
      include: {
        pages: { orderBy: { pageNumber: 'asc' } },
        extractions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!doc) throw new ApiError('NOT_FOUND', 'PdfDocument not found');
    return doc;
  }

  async approveExtraction(input: {
    extractionId: string;
    reviewerId: string;
    reviewNotes?: string;
    editedPayload?: Record<string, unknown>;
  }) {
    const data: Prisma.PdfExtractionUpdateInput = {
      reviewStatus: 'APPROVED',
      reviewedBy: { connect: { id: input.reviewerId } },
      reviewedAt: new Date(),
      reviewNotes: input.reviewNotes,
    };
    if (input.editedPayload) {
      data.payloadJson = input.editedPayload as Prisma.InputJsonValue;
    }
    return prisma.pdfExtraction.update({ where: { id: input.extractionId }, data });
  }

  async rejectExtraction(input: {
    extractionId: string;
    reviewerId: string;
    reviewNotes: string;
  }) {
    return prisma.pdfExtraction.update({
      where: { id: input.extractionId },
      data: {
        reviewStatus: 'REJECTED',
        reviewedBy: { connect: { id: input.reviewerId } },
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes,
      },
    });
  }

  async requeueIntake(pdfDocumentId: string): Promise<void> {
    // Flip back to PENDING (clearing any prior error) and enqueue a
    // MANUAL job. Does NOT delete existing PdfExtraction rows — the
    // pipeline's runner handles that per-extractor via deleteMany on
    // matching (methodVersion, extractionType), keeping audit trail.
    await prisma.pdfDocument.update({
      where: { id: pdfDocumentId },
      data: { processingStatus: 'PENDING', processingError: null },
    });
    await this.intakeQueue.enqueue(pdfDocumentId, 'MANUAL');
  }

  async bulkReprocess(opts: { sourceCategory?: PdfSourceCategory; limit: number; triggeredBy: string }) {
    const where = opts.sourceCategory ? { sourceCategory: opts.sourceCategory } : {};
    const pdfs = await prisma.pdfDocument.findMany({
      where,
      select: { id: true },
      take: opts.limit,
    });
    let enqueued = 0;
    for (const p of pdfs) {
      await this.requeueIntake(p.id);
      enqueued++;
    }
    this.logger.log(
      `Bulk reprocess requested by ${opts.triggeredBy} — enqueued ${enqueued} PDFs (category=${opts.sourceCategory ?? 'all'})`,
    );
    return { enqueued };
  }

  private required(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new Error(`Missing required env var: ${key}`);
    return v;
  }
}
