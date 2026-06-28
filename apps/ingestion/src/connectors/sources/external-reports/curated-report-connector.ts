import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma, type SignalType } from '@kku/db';
import {
  S3Storage,
  type ConnectorContext,
  type DataSourceInputFormat,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';
import { BaseConnector } from '../../base/base-connector';

// ─────────────────────────────────────────────────────────────────────────────
// Curated-Report Connector — real-mode implementation for the 8 external
// policy / industry / multilateral PDF sources (MHESI, NESDC, NXPO, BOI,
// EECO, WEF, OECD, ADB).
//
// These sources don't expose machine-readable APIs. Their content is
// authoritative published documents — annual reports, policy plans,
// committee minutes — that change at the cadence of the issuing
// organisation's calendar (quarterly to yearly, not real-time).
//
// Real-mode strategy:
//   1. A curator-maintained JSON catalog ships with the connector,
//      listing the canonical URLs of the documents we want tracked.
//      Each entry carries title + summary + publication date + the
//      issuing org's URL (stable enough for citation).
//   2. On run, the connector attempts to download each entry's PDF
//      (best-effort, with timeout + UA header). Some sites are bot-
//      firewalled (BOI uses Incapsula, OECD has CF challenges) — when
//      a fetch fails, we degrade gracefully instead of erroring.
//   3. Every catalog entry is materialised as a TrendSignal row so it
//      shows up in the Trends Radar regardless of whether the PDF
//      could be downloaded. Successfully-downloaded PDFs additionally
//      land as PdfDocument rows so the intake pipeline can OCR + tag
//      them. Analysts can manually upload the PDFs that the connector
//      couldn't auto-fetch via the existing /admin/data-sources flow.
//
// Idempotent:
//   - TrendSignal is upserted on (sourceUrl, detectedDate, signalType).
//     A re-run with the same catalog inserts no duplicates.
//   - PdfDocument is upserted on contentHash (existing PdfDocument
//     contract) — bytes-identical re-fetch hits the same row.
// ─────────────────────────────────────────────────────────────────────────────

export interface CuratedCatalogEntry {
  /** Stable id within this connector's catalog — used for run-level dedup. */
  externalId: string;
  /** English title (TrendSignal.title is mandatory). */
  title: string;
  /** Optional Thai summary, ~50-300 chars. */
  summaryTh?: string;
  /** Optional English summary, ~50-300 chars. */
  summaryEn?: string;
  /** Canonical URL of the document — points at the issuing org's
   *  published PDF or report landing page. */
  sourceUrl: string;
  /** ISO-8601 date the document was published / observed upstream. */
  publishedDate: string;
  /** SignalType: POLICY / RESEARCH / MARKET / TECH / NEWS. */
  signalType: SignalType;
  /** 0.0–1.0 — relative impact for Trends Radar dot sizing. */
  impactScore: number;
  /** Optional sector / topic tags surfaced in the radar's filter rail. */
  tags?: string[];
}

const CatalogEntrySchema = z.object({
  externalId: z.string(),
  title: z.string().min(1),
  summaryTh: z.string().optional(),
  summaryEn: z.string().optional(),
  sourceUrl: z.string().url(),
  publishedDate: z.string(),
  signalType: z.enum(['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS']),
  impactScore: z.number().min(0).max(1),
  tags: z.array(z.string()).optional(),
});

const CatalogSchema = z.object({
  /** Issuing org for the source-org column on TrendSignal / PdfDocument. */
  sourceOrgName: z.string(),
  /** PDF intake's source-category tag for downloads from this source. */
  pdfCategory: z.enum(['POLICY', 'REPORT', 'SURVEY']),
  /** Default language for downloaded PDFs (TH for Thai gov sources, EN
   *  for global multilaterals). */
  defaultLanguage: z.enum(['TH', 'EN', 'MIXED']).default('EN'),
  entries: z.array(CatalogEntrySchema),
});

export interface CuratedReportRawData {
  entry: CuratedCatalogEntry;
  /** PDF bytes if download succeeded; null when fetch failed or the
   *  entry's URL points at an HTML landing page. */
  pdfBytes: Buffer | null;
  /** The actual filename to save under (derived from URL or title). */
  filename: string;
  /** Why bytes are null when they are. */
  fetchError?: string;
}

const FETCH_TIMEOUT_MS = 30_000;
// Several upstreams (MHESI, WEF, OECD) 403/refuse a bot UA. A real browser
// UA is required to download their public reports. (Verified: mhesi/wef PDFs
// return 403/000 with the old UA, 200 with this one.)
const FETCH_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export abstract class CuratedReportConnector extends BaseConnector {
  readonly inputFormat: DataSourceInputFormat = 'PDF';
  readonly mocked = false;

  /** Path to the catalog JSON, relative to the repo root. */
  protected abstract readonly catalogPath: string;

  protected async loadCatalog(): Promise<z.infer<typeof CatalogSchema>> {
    const fullPath = path.resolve(__dirname, this.catalogPath);
    if (!existsSync(fullPath)) {
      throw new Error(`Curated catalog missing at ${fullPath}`);
    }
    const raw = JSON.parse(readFileSync(fullPath, 'utf8'));
    return CatalogSchema.parse(raw);
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const catalog = await this.loadCatalog();
    const results: RawRecord[] = [];
    for (const entry of catalog.entries) {
      const filename = filenameFromEntry(entry);
      let pdfBytes: Buffer | null = null;
      let fetchError: string | undefined;
      // Best-effort PDF download. Skip non-PDF URLs (landing pages)
      // entirely — trying to download HTML wastes time and the
      // intake pipeline can't OCR an HTML response.
      if (entry.sourceUrl.toLowerCase().endsWith('.pdf')) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          const res = await fetch(entry.sourceUrl, {
            signal: controller.signal,
            headers: {
              'user-agent': FETCH_USER_AGENT,
              accept: 'application/pdf,*/*',
            },
            redirect: 'follow',
          });
          clearTimeout(timer);
          const ct = res.headers.get('content-type') ?? '';
          if (!res.ok) {
            fetchError = `HTTP ${res.status}`;
          } else if (!ct.toLowerCase().includes('pdf')) {
            fetchError = `non-PDF content-type (${ct})`;
          } else {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 1024) {
              // Tiny payloads are usually firewall challenges, not
              // real PDFs.
              fetchError = `payload too small (${buf.length} bytes)`;
            } else {
              pdfBytes = buf;
            }
          }
        } catch (err) {
          fetchError = err instanceof Error ? err.message : String(err);
        }
      } else {
        fetchError = 'sourceUrl is a landing page (no .pdf suffix)';
      }
      if (fetchError) {
        ctx.log.info(`Curated fetch fell through to signal-only`, {
          entry: entry.externalId,
          reason: fetchError,
        });
      }
      results.push({
        externalId: entry.externalId,
        sourceTimestamp: new Date(entry.publishedDate),
        data: { entry, pdfBytes, filename, fetchError } as CuratedReportRawData,
      });
    }
    return results;
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const { entry, pdfBytes, filename, fetchError } = raw.data as CuratedReportRawData;
    const records: NormalizedRecord[] = [
      // TrendSignal is the always-on output. Tracks the document in
      // the Trends Radar regardless of whether we got the PDF bytes.
      {
        target: 'trend_signals',
        externalId: entry.externalId,
        payload: {
          title: entry.title,
          summaryTh: entry.summaryTh ?? null,
          summaryEn: entry.summaryEn ?? null,
          sourceUrl: entry.sourceUrl,
          signalType: entry.signalType,
          impactScore: entry.impactScore,
          publishedDate: entry.publishedDate,
          tags: entry.tags ?? [],
          pdfDownloadStatus: pdfBytes ? 'downloaded' : 'pending',
          fetchError: fetchError ?? null,
        },
        freshnessDate: raw.sourceTimestamp,
      },
    ];
    if (pdfBytes) {
      // PdfDocument is created only when we actually got bytes.
      // Hash-keyed dedup means re-runs don't double-store.
      const contentHash = createHash('sha256').update(pdfBytes).digest('hex');
      records.push({
        target: 'pdf_documents',
        externalId: contentHash,
        payload: {
          filename,
          byteSize: pdfBytes.byteLength,
          bytes: pdfBytes,
          contentHash,
        },
        freshnessDate: raw.sourceTimestamp,
      });
    }
    return records;
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    const catalog = await this.loadCatalog();
    let signalsLoaded = 0;
    let pdfsLoaded = 0;
    let failed = 0;
    let lastPdfId: string | undefined;
    let storage: S3Storage | undefined;

    for (const n of normalized) {
      try {
        if (n.target === 'trend_signals') {
          const p = n.payload as Record<string, unknown>;
          // Upsert on (sourceUrl, detectedDate, signalType) — same
          // document republished elsewhere becomes a different row,
          // re-fetch of the same row updates summaries.
          const detectedDate = new Date(String(p.publishedDate));
          const existing = await prisma.trendSignal.findFirst({
            where: {
              sourceUrl: String(p.sourceUrl),
              detectedDate,
              signalType: p.signalType as SignalType,
            },
            select: { id: true },
          });
          if (existing) {
            await prisma.trendSignal.update({
              where: { id: existing.id },
              data: {
                title: String(p.title),
                summaryTh: (p.summaryTh ?? null) as string | null,
                summaryEn: (p.summaryEn ?? null) as string | null,
                impactScore: Number(p.impactScore),
              },
            });
          } else {
            await prisma.trendSignal.create({
              data: {
                signalType: p.signalType as SignalType,
                title: String(p.title),
                summaryTh: (p.summaryTh ?? null) as string | null,
                summaryEn: (p.summaryEn ?? null) as string | null,
                sourceUrl: String(p.sourceUrl),
                detectedDate,
                impactScore: Number(p.impactScore),
                affectedProgramIds: [],
                affectedSkillIds: [],
              },
            });
          }
          signalsLoaded++;
        } else if (n.target === 'pdf_documents') {
          const p = n.payload as {
            filename: string;
            byteSize: number;
            bytes: Buffer;
            contentHash: string;
          };
          if (!storage) storage = getPdfStorage();
          const bucket = process.env.MINIO_BUCKET_PDF_RAW ?? 'pdf-raw';
          const key = `${catalog.pdfCategory.toLowerCase()}/${p.contentHash}.pdf`;
          await storage.putObject({
            bucket,
            key,
            body: p.bytes,
            contentType: 'application/pdf',
            metadata: {
              originalFilename: p.filename,
              sourceOrg: catalog.sourceOrgName,
              connectorSlug: ctx.dataSource.slug,
            },
          });
          const doc = await prisma.pdfDocument.upsert({
            where: { contentHash: p.contentHash },
            update: {
              sourceCategoryHint: catalog.pdfCategory,
              sourceOrg: catalog.sourceOrgName,
              language: catalog.defaultLanguage,
            },
            create: {
              originalFilename: p.filename,
              storageUrl: `s3://${bucket}/${key}`,
              fileSize: p.byteSize,
              pageCount: 0,
              sourceCategory: catalog.pdfCategory,
              sourceCategoryHint: catalog.pdfCategory,
              sourceOrg: catalog.sourceOrgName,
              language: catalog.defaultLanguage,
              contentHash: p.contentHash,
              processingStatus: 'PENDING',
            },
          });
          lastPdfId = doc.id;
          pdfsLoaded++;
        }
      } catch (err) {
        ctx.log.error(`Curated load failed`, {
          target: n.target,
          externalId: n.externalId,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: signalsLoaded + pdfsLoaded,
      recordsFailed: failed,
      pdfDocumentId: lastPdfId,
      metadata: {
        signalsLoaded,
        pdfsLoaded,
        catalogEntries: catalog.entries.length,
        sourceOrg: catalog.sourceOrgName,
      },
    };
  }
}

function filenameFromEntry(entry: CuratedCatalogEntry): string {
  // Derive a sensible filename from the URL's last path segment, or
  // fall back to a sluggified title.
  try {
    const u = new URL(entry.sourceUrl);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last && last.toLowerCase().endsWith('.pdf')) return last;
  } catch {
    // Not a parseable URL — fallthrough.
  }
  const slug = entry.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug}.pdf`;
}

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

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}
