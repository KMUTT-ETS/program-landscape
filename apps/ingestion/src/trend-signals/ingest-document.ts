import { prisma } from '@kku/db';
import {
  buildTrendDocumentIngestMessages,
  TrendDocumentIngestSchema,
  TREND_DOCUMENT_INGEST_VERSION,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';
import { createSignal } from '../trend-monitors/monitors';
import { analyzeTrendSignal } from './analyze';

// ─────────────────────────────────────────────────────────────────────────────
// Document → trend signal. Backs the ANALYZE_TREND_DOCUMENT ai-job.
//
// For one TrendDocument (an uploaded PDF or a pasted URL):
//   1. obtain the document's plain text (MinIO PDF → pdfjs, or fetch URL →
//      pdfjs/HTML-strip),
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
  triggeredByUserId?: string | null;
}

export type RunTrendDocumentIngestOutcome =
  | { status: 'SUCCEEDED'; trendSignalId: string; signalType: string; impactScore: number; analysisOk: boolean }
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
    let text: string;
    if (doc.sourceType === 'FILE') {
      if (!params.storage) throw new Error('storage not configured — cannot read the uploaded PDF');
      text = await extractPdfFromStorage(doc.storageUrl, params.storage);
    } else {
      if (!doc.sourceUrl) throw new Error('URL document has no sourceUrl');
      text = await fetchUrlText(doc.sourceUrl);
    }
    text = text.trim();
    if (text.length < 40) {
      throw new Error('no usable text extracted (document may be a scan, empty, or blocked)');
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

// Read a stored PDF (s3://bucket/key) from MinIO via a short-lived signed URL
// and extract its native text. Mirrors the program-digest fetch+extract path.
async function extractPdfFromStorage(storageUrl: string | null, storage: S3Storage): Promise<string> {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(storageUrl ?? '');
  if (!m) throw new Error(`unrecognised storageUrl: ${storageUrl}`);
  const url = await storage.getSignedDownloadUrl({ bucket: m[1]!, key: m[2]!, ttlSeconds: 300 });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const extracted = await extractNativeText(bytes);
  return extracted.fullText ?? '';
}

// Fetch a URL and return plain text. A PDF link → pdfjs; an HTML page →
// tag-stripped readable text.
async function fetchUrlText(rawUrl: string): Promise<string> {
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
  const buf = Buffer.from(await res.arrayBuffer());
  const looksPdf = contentType.includes('application/pdf') || buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (looksPdf) {
    const extracted = await extractNativeText(buf);
    return extracted.fullText ?? '';
  }
  return htmlToText(buf.toString('utf8'));
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
