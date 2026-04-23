import { prisma } from '@kku/db';
import { S3Storage, type DataSourceInputFormat } from '@kku/shared';
import type {
  ConnectorContext,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';
import { createHash } from 'node:crypto';
import { BaseConnector } from './base-connector';

// Connector kind: PDF_UPLOAD. The most important kind for this project —
// most Thai government data arrives as PDFs, and the extraction pipeline
// lives in prompt 03b. PDF connectors do NOT extract data themselves;
// they fetch PDF *bytes* from their source and hand them off by:
//   1. uploading the bytes to MinIO (pdf-raw bucket)
//   2. creating a `PdfDocument` row with the right sourceCategory +
//      sourceOrg
//   3. setting processingStatus = PENDING — the 03b pipeline picks up
//      pending rows and does OCR + extraction + routing to domain tables
//
// `transform` for a PDF connector is thin: it carries the PdfDocument.id
// forward so `load` can attach it to the IngestionRun.
//
// `load` returns pdfDocumentId so the runner can write it on the
// IngestionRun row, giving operators a direct link from the run list
// to the PDF intake pipeline's progress.

export interface PdfRawPayload {
  bytes: Buffer;
  filename: string;
  sourceCategory:
    | 'POLICY'
    | 'REPORT'
    | 'CURRICULUM'
    | 'PEER_PROGRAM'
    | 'SURVEY'
    | 'COMMITTEE_MINUTES'
    | 'OTHER';
  sourceOrg?: string;
  language?: 'TH' | 'EN' | 'MIXED';
}

export abstract class PdfUploadConnector extends BaseConnector {
  readonly inputFormat: DataSourceInputFormat = 'PDF';

  // Concrete connectors implement `fetchPdfs(since?)` — a typed version
  // of the generic fetch(). Default fetch() wraps each returned payload
  // in a RawRecord.
  abstract fetchPdfs(ctx: ConnectorContext, since?: Date): Promise<PdfRawPayload[]>;

  async fetch(ctx: ConnectorContext, since?: Date): Promise<RawRecord[]> {
    const payloads = await this.fetchPdfs(ctx, since);
    return payloads.map((p) => ({
      externalId: hashBytes(p.bytes),
      data: p,
      sourceTimestamp: new Date(),
    }));
  }

  // PDF connectors don't extract in-process — extraction happens in the
  // intake pipeline (this file's load() pushes the bytes to MinIO and
  // creates a PdfDocument in PENDING state, the BullMQ pdf-intake worker
  // then picks it up). Transform carries the bytes through to load() so
  // the final step can PUT them to storage.
  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const payload = raw.data as PdfRawPayload;
    return [
      {
        target: 'pdf_documents',
        externalId: raw.externalId,
        payload: {
          filename: payload.filename,
          byteSize: payload.bytes.byteLength,
          bytes: payload.bytes,
          sourceCategory: payload.sourceCategory,
          sourceOrg: payload.sourceOrg ?? null,
          language: payload.language ?? 'TH',
          contentHash: raw.externalId,
        },
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    let loaded = 0;
    let failed = 0;
    let lastPdfId: string | undefined;
    const storage = getPdfStorage();

    for (const n of normalized) {
      try {
        const payload = n.payload as unknown as PdfLoadPayload;

        // Upload bytes to MinIO under a stable, hash-derived key so the
        // same PDF never produces two objects. PdfDocument.contentHash
        // has a UNIQUE constraint — upsert keyed by it guarantees dedup
        // at the DB level too.
        const bucket = getPdfBucket();
        const key = `${payload.sourceCategory.toLowerCase()}/${payload.contentHash}.pdf`;
        await storage.putObject({
          bucket,
          key,
          body: payload.bytes,
          contentType: 'application/pdf',
          metadata: {
            originalFilename: payload.filename,
            sourceOrg: payload.sourceOrg ?? 'unknown',
            connectorSlug: ctx.dataSource.slug,
          },
        });
        const storageUrl = `s3://${bucket}/${key}`;

        const doc = await prisma.pdfDocument.upsert({
          where: { contentHash: payload.contentHash },
          update: {
            // Keep metadata in sync if the same content is refetched
            // with different categorisation (ingestion taxonomy change).
            // DON'T change sourceCategory once set — the human reviewer
            // may have overridden it. sourceCategoryHint captures the
            // connector's latest guess so the review UI can surface a
            // "this connector thinks it's POLICY now" hint.
            sourceCategoryHint: payload.sourceCategory,
            sourceOrg: payload.sourceOrg,
            language: payload.language,
          },
          create: {
            originalFilename: payload.filename,
            storageUrl,
            fileSize: payload.byteSize,
            pageCount: 0, // filled by the intake pipeline after parse
            sourceCategory: payload.sourceCategory,
            sourceCategoryHint: payload.sourceCategory,
            sourceOrg: payload.sourceOrg,
            language: payload.language,
            contentHash: payload.contentHash,
            processingStatus: 'PENDING',
          },
        });

        lastPdfId = doc.id;
        loaded++;
      } catch (err) {
        ctx.log.error(`Failed to create PdfDocument`, {
          error: err instanceof Error ? err.message : String(err),
          externalId: n.externalId,
        });
        failed++;
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      pdfDocumentId: lastPdfId,
      metadata: { pdfsCreated: loaded },
    };
  }
}

interface PdfLoadPayload {
  filename: string;
  byteSize: number;
  bytes: Buffer;
  sourceCategory:
    | 'POLICY'
    | 'REPORT'
    | 'CURRICULUM'
    | 'PEER_PROGRAM'
    | 'SURVEY'
    | 'COMMITTEE_MINUTES'
    | 'JOB_POSTINGS_BATCH'
    | 'OTHER';
  sourceOrg: string | null;
  language: 'TH' | 'EN' | 'MIXED';
  contentHash: string;
}

// Lazy singleton. Constructed once the env vars are available; subsequent
// connectors reuse it. Keeps the PdfUploadConnector base reusable in tests
// where nothing ever calls load().
let _storage: S3Storage | undefined;
function getPdfStorage(): S3Storage {
  if (_storage) return _storage;
  _storage = new S3Storage({
    endpoint: requiredEnv('MINIO_ENDPOINT'),
    region: process.env.MINIO_REGION ?? 'us-east-1',
    accessKeyId: requiredEnv('MINIO_ACCESS_KEY'),
    secretAccessKey: requiredEnv('MINIO_SECRET_KEY'),
    publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT || undefined,
  });
  return _storage;
}

function getPdfBucket(): string {
  return process.env.MINIO_BUCKET_PDF_RAW ?? 'pdf-raw';
}

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function hashBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
