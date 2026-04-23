import { prisma } from '@kku/db';
import type {
  ConnectorContext,
  DataSourceInputFormat,
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

  // PDF connectors don't transform the PDF in-process — extraction is
  // 03b's job. Transform returns a single placeholder NormalizedRecord
  // so load() has something to key the PdfDocument row off.
  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const payload = raw.data as PdfRawPayload;
    return [
      {
        target: 'pdf_documents',
        externalId: raw.externalId,
        payload: {
          filename: payload.filename,
          byteSize: payload.bytes.byteLength,
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

    for (const n of normalized) {
      try {
        // contentHash has a UNIQUE constraint — upsert by that so repeated
        // fetches of the same PDF bytes deduplicate cleanly.
        const payload = n.payload as {
          filename: string;
          byteSize: number;
          sourceCategory:
            | 'POLICY'
            | 'REPORT'
            | 'CURRICULUM'
            | 'PEER_PROGRAM'
            | 'SURVEY'
            | 'COMMITTEE_MINUTES'
            | 'OTHER';
          sourceOrg: string | null;
          language: 'TH' | 'EN' | 'MIXED';
          contentHash: string;
        };

        // Real impl: upload bytes to MinIO pdf-raw, get storageUrl.
        // Mock: synthesize a placeholder URL the 03b pipeline can later
        // detect as unresolved.
        const storageUrl = `s3://pdf-raw/placeholder/${payload.contentHash}.pdf`;

        const doc = await prisma.pdfDocument.upsert({
          where: { contentHash: payload.contentHash },
          update: {
            // Keep metadata in sync if the same content is refetched
            // with different categorisation (ingestion taxonomy change).
            sourceCategory: payload.sourceCategory,
            sourceOrg: payload.sourceOrg,
            language: payload.language,
          },
          create: {
            originalFilename: payload.filename,
            storageUrl,
            fileSize: payload.byteSize,
            pageCount: 0, // 03b fills this after parse
            sourceCategory: payload.sourceCategory,
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

function hashBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
