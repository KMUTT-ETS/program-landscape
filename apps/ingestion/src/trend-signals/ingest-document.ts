import { prisma } from '@kku/db';
import {
  buildTrendDocumentIngestMessages,
  TrendDocumentIngestSchema,
  TREND_DOCUMENT_INGEST_VERSION,
  type AiService,
  type S3Storage,
  type MarkitdownClient,
} from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';
import { createSignal } from '../trend-monitors/monitors';
import { analyzeTrendSignal } from './analyze';

// ─────────────────────────────────────────────────────────────────────────────
// Document → trend signal. Backs the ANALYZE_TREND_DOCUMENT ai-job.
//
// For one TrendDocument (an uploaded PDF/DOCX/XLSX/PPTX/HTML or a pasted URL):
//   1. obtain the document's text as Markdown via the markitdown sidecar
//      (PDF/DOCX/XLSX/PPTX/HTML → structure-preserving Markdown). If markitdown
//      is unavailable/errors, fall back to pdfjs (PDF) / HTML-strip,
//   2. draft a signal (trend-document-ingest.v1): type, TH/EN title+summary,
//      impact score,
//   3. createSignal() — the signal is now LIVE on the radar (auto-publish),
//   4. analyzeTrendSignal() — attach affected programs/skills + recommended
//      actions (best-effort; the signal stays published even if this fails),
//   5. record status + the published signal id back on the TrendDocument.
// ─────────────────────────────────────────────────────────────────────────────

// Cap the text we hand the model. Manpower/job-posting reports are usually a
// few pages; this keeps us well inside the model's input budget while covering
// the substance of long documents.
const MAX_DOC_CHARS = 24_000;
const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface RunTrendDocumentIngestParams {
  trendDocumentId: string;
  ai: AiService;
  storage?: S3Storage;
  // markitdown sidecar — primary text-extraction path. Optional: when absent
  // the runner falls back to pdfjs (PDF) / HTML-strip.
  markitdown?: MarkitdownClient;
  triggeredByUserId?: string | null;
}

export type ExtractionMethod = 'markitdown' | 'pdfjs' | 'html-strip';

export type RunTrendDocumentIngestOutcome =
  | {
      status: 'SUCCEEDED';
      trendSignalId: string;
      signalType: string;
      impactScore: number;
      analysisOk: boolean;
      extractionMethod: ExtractionMethod;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function runTrendDocumentIngest(
  params: RunTrendDocumentIngestParams,
): Promise<RunTrendDocumentIngestOutcome> {
  const doc = await prisma.trendDocument.findUnique({ where: { id: params.trendDocumentId } });
  if (!doc) return { status: 'SKIPPED', reason: `trend document not found: ${params.trendDocumentId}` };

  await prisma.trendDocument.update({
    where: { id: doc.id },
    data: { status: 'PROCESSING', error: null },
  });

  try {
    // ── 1. obtain text ──────────────────────────────────────────────────
    const sourceLabel = doc.originalFilename ?? doc.sourceUrl ?? doc.id;
    // Get the raw bytes + a filename hint (the extension drives markitdown's
    // converter choice and the legacy fallback's PDF-vs-HTML branch). The
    // bytes are produced node-side, so the markitdown sidecar needs no
    // outbound network.
    let bytes: Buffer;
    let filename: string;
    if (doc.sourceType === 'FILE') {
      if (!params.storage) throw new Error('storage not configured — cannot read the uploaded document');
      bytes = await fetchStorageBytes(doc.storageUrl, params.storage);
      filename = doc.originalFilename ?? filenameFromStorageUrl(doc.storageUrl);
    } else {
      if (!doc.sourceUrl) throw new Error('URL document has no sourceUrl');
      const fetched = await fetchUrlBytes(doc.sourceUrl);
      bytes = fetched.bytes;
      filename = filenameForUrl(doc.sourceUrl, fetched.contentType, bytes);
    }

    const { text: rawText, method } = await extractText(bytes, filename, params.markitdown);
    const text = rawText.trim();
    if (text.length < 40) {
      throw new Error('no usable text extracted (document may be a scan, empty, or an unsupported/blocked format)');
    }
    const clipped = text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) : text;

    // ── 2. draft the signal ─────────────────────────────────────────────
    const draftResp = await params.ai.extractStructured(
      {
        ctx: {
          module: 'trends',
          kind: 'trend-document-ingest',
          userId: params.triggeredByUserId ?? null,
          traceId: `trend-doc-${doc.id}`,
        },
        messages: buildTrendDocumentIngestMessages({
          documentText: clipped,
          sourceLabel,
          signalTypeHint: doc.signalTypeHint,
        }),
        methodVersion: TREND_DOCUMENT_INGEST_VERSION,
        maxOutputTokens: 3000,
      },
      TrendDocumentIngestSchema,
    );
    const draft = draftResp.parsed;

    // ── 3. publish (auto) ───────────────────────────────────────────────
    const { id: signalId } = await createSignal({
      signalType: draft.signalType,
      title: draft.titleEn,
      summaryTh: draft.summaryTh,
      summaryEn: draft.summaryEn,
      // Provenance link for URL inputs; FILE inputs are linked via the
      // TrendDocument ledger (their PDF has no public URL).
      sourceUrl: doc.sourceType === 'URL' ? (doc.sourceUrl ?? undefined) : undefined,
      impactScore: draft.impactScore,
      aiInferenceId: draftResp.aiInferenceId ?? undefined,
    });

    // ── 4. enrich (best-effort) ─────────────────────────────────────────
    const analysis = await analyzeTrendSignal({
      signalId,
      ai: params.ai,
      triggeredByUserId: params.triggeredByUserId,
    });
    const analysisOk = analysis.status === 'SUCCEEDED';

    // ── 5. record ───────────────────────────────────────────────────────
    await prisma.trendDocument.update({
      where: { id: doc.id },
      data: {
        status: 'SUCCEEDED',
        trendSignalId: signalId,
        error: analysisOk ? null : `published; enrichment ${analysis.status}: ${'reason' in analysis ? analysis.reason : ''}`,
      },
    });

    return {
      status: 'SUCCEEDED',
      trendSignalId: signalId,
      signalType: draft.signalType,
      impactScore: draft.impactScore,
      analysisOk,
      extractionMethod: method,
    };
  } catch (e) {
    const reason = (e as Error).message ?? String(e);
    await prisma.trendDocument.update({
      where: { id: doc.id },
      data: { status: 'FAILED', error: reason.slice(0, 1000) },
    });
    return { status: 'FAILED', reason };
  }
}

// Convert document bytes → text. Primary path is the markitdown sidecar
// (PDF/DOCX/XLSX/PPTX/HTML → Markdown). On any markitdown failure — or when no
// client is wired — degrade to the legacy path: pdfjs for PDFs, HTML-strip
// otherwise. (A non-PDF Office file with no markitdown yields junk that the
// < 40-char guard rejects, surfacing as a clean FAILED.)
async function extractText(
  bytes: Buffer,
  filename: string,
  markitdown: MarkitdownClient | undefined,
): Promise<{ text: string; method: ExtractionMethod }> {
  if (markitdown) {
    try {
      const res = await markitdown.convert({ bytes, filename });
      return { text: res.markdown, method: 'markitdown' };
    } catch {
      // fall through to the legacy path — degrade, don't fail the ingest.
    }
  }
  const isPdf =
    filename.toLowerCase().endsWith('.pdf') || bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf) {
    const extracted = await extractNativeText(bytes);
    return { text: extracted.fullText ?? '', method: 'pdfjs' };
  }
  return { text: htmlToText(bytes.toString('utf8')), method: 'html-strip' };
}

// Read a stored document (s3://bucket/key) from MinIO via a short-lived signed
// URL. Mirrors the program-digest fetch path.
async function fetchStorageBytes(storageUrl: string | null, storage: S3Storage): Promise<Buffer> {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(storageUrl ?? '');
  if (!m) throw new Error(`unrecognised storageUrl: ${storageUrl}`);
  const url = await storage.getSignedDownloadUrl({ bucket: m[1]!, key: m[2]!, ttlSeconds: 300 });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`document fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Derive a filename (for the extension hint) from a storage key.
function filenameFromStorageUrl(storageUrl: string | null): string {
  const key = storageUrl?.split('/').pop() ?? 'document';
  return key.includes('.') ? key : `${key}.bin`;
}

// Fetch a URL's raw bytes with the existing guarded fetch (browser UA +
// timeout). SSRF/timeout control stays node-side; the sidecar never fetches.
async function fetchUrlBytes(rawUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(rawUrl, {
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/pdf,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`URL fetch failed: ${res.status}`);
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType };
}

// Pick a filename (extension) for a URL fetch so markitdown selects the right
// converter: PDF by content-type or magic bytes; a known extension in the URL
// path; otherwise default to .html.
function filenameForUrl(rawUrl: string, contentType: string, bytes: Buffer): string {
  const looksPdf =
    contentType.includes('application/pdf') || bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  if (looksPdf) return 'page.pdf';
  let pathname = '';
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = '';
  }
  const ext = pathname.match(/\.([a-z0-9]{1,5})$/i)?.[0]?.toLowerCase();
  const known = ['.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.html', '.htm', '.txt', '.md'];
  if (ext && known.includes(ext)) return `page${ext}`;
  return 'page.html';
}

// Minimal HTML → text: drop script/style/noscript, strip tags, decode the
// handful of entities that actually matter, collapse whitespace. Good enough
// for a single AI summarisation pass — we are not building a reader view.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
