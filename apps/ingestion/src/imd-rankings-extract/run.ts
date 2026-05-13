import { prisma, materialiseImdRankings } from '@kku/db';
import {
  buildImdRankingsExtractMessages,
  IMD_RANKINGS_EXTRACT_VERSION,
  IMD_RANKINGS_EXTRACTION_KIND,
  ImdRankingsExtractionSchema,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { Logger } from '@nestjs/common';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';

const imdLogger = new Logger('ImdRankingsExtract');

// ─────────────────────────────────────────────────────────────────────────────
// IMD rankings extract — given a PdfDocument that contains an IMD WCY /
// WTR / WDCR public summary, run the AI extractor and persist the result
// as an AiExtraction row (extractionKind=IMD_RANKINGS). Approval lives in
// /admin/extraction-review and triggers the materialise step
// (materialiseImdRankings) which upserts ImdEconomy + ImdRanking.
//
// Input: a pdfDocumentId. The PDF must exist in MinIO. If it doesn't,
// returns FAILED with a clear reason.
//
// Output: { status: SUCCEEDED, aiExtractionId, ... } | SKIPPED | FAILED.
//
// Filename hints are best-effort. Set the dataset hint via
// FILENAME-MATCH-RULES below; the AI will override if the document
// content is clearly different.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunImdRankingsExtractParams {
  pdfDocumentId: string;
  ai: AiService;
  storage: S3Storage;
  triggeredByUserId?: string | null;
  /** Bypass the "already extracted" skip. Pass when re-running after a
   *  prompt edit / methodology bump. */
  force?: boolean;
}

export type RunImdRankingsExtractOutcome =
  | {
      status: 'SUCCEEDED';
      aiExtractionId: string;
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      rowsExtracted: number;
      /** True when the extraction cleared the auto-approve threshold
       *  and was stamped AUTO_APPROVED at write time. */
      autoApproved: boolean;
      /** True when materialiseImdRankings ran successfully right after
       *  auto-approval — ImdRanking + ImdEconomy rows already upserted. */
      materialised: boolean;
      /** Set when materialisation was attempted but failed. The AI
       *  extraction row is persisted regardless. */
      materialisationError: string | null;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

function detectDatasetFromFilename(filename: string): 'WCY' | 'WTR' | 'WDCR' | null {
  const f = filename.toUpperCase();
  if (f.includes('WCY') || f.includes('WORLD-COMPETITIVENESS') || f.includes('WORLD COMPETITIVENESS')) return 'WCY';
  if (f.includes('WTR') || f.includes('WORLD-TALENT') || f.includes('WORLD TALENT')) return 'WTR';
  if (f.includes('WDCR') || f.includes('WORLD-DIGITAL') || f.includes('WORLD DIGITAL')) return 'WDCR';
  return null;
}

function detectYearFromFilename(filename: string): number | null {
  // Match a 4-digit year between 2010 and 2099. Take the first hit.
  const m = /(20[1-9]\d)/.exec(filename);
  return m ? Number(m[1]) : null;
}

export async function runImdRankingsExtract(
  params: RunImdRankingsExtractParams,
): Promise<RunImdRankingsExtractOutcome> {
  const pdf = await prisma.pdfDocument.findUnique({
    where: { id: params.pdfDocumentId },
    select: { id: true, storageUrl: true, originalFilename: true },
  });
  if (!pdf) return { status: 'SKIPPED', reason: `PdfDocument not found: ${params.pdfDocumentId}` };

  if (!params.force) {
    const existing = await prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'pdf',
        sourceEntityId: pdf.id,
        extractionKind: IMD_RANKINGS_EXTRACTION_KIND,
      },
      select: { id: true },
    });
    if (existing) {
      return {
        status: 'SKIPPED',
        reason: `${IMD_RANKINGS_EXTRACTION_KIND} extraction already exists for this PDF; pass force=true to re-run`,
      };
    }
  }

  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(pdf.storageUrl);
  if (!m) return { status: 'FAILED', reason: `unrecognised storageUrl: ${pdf.storageUrl}` };
  const url = await params.storage.getSignedDownloadUrl({
    bucket: m[1]!,
    key: m[2]!,
    ttlSeconds: 300,
  });
  const res = await fetch(url);
  if (!res.ok) return { status: 'FAILED', reason: `PDF fetch ${res.status}` };
  const bytes = Buffer.from(await res.arrayBuffer());

  const extracted = await extractNativeText(bytes);
  if (!extracted.fullText || extracted.fullText.trim().length < 200) {
    return {
      status: 'FAILED',
      reason: `PDF text extraction yielded ${extracted.fullText?.length ?? 0} chars — likely a scanned PDF. OCR via Claude vision (prompt 04 follow-up) needed.`,
    };
  }

  const datasetHint = detectDatasetFromFilename(pdf.originalFilename);
  const yearHint = detectYearFromFilename(pdf.originalFilename);

  const messages = buildImdRankingsExtractMessages({ datasetHint, yearHint });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'imd',
        kind: 'imd-rankings',
        userId: params.triggeredByUserId ?? null,
        traceId: `imd-rankings-${pdf.id}`,
      },
      messages: [
        ...messages,
        // Append the PDF text as an additional user turn — keeps the
        // schema-locked output closer to the structured intent.
        { role: 'user', content: `\n\n--- PDF TEXT START ---\n${extracted.fullText.slice(0, 200_000)}\n--- PDF TEXT END ---` },
      ],
      methodVersion: IMD_RANKINGS_EXTRACT_VERSION,
      // Bumped 16000 → 50000 on 2026-05-13 — see program-digest/run.ts.
      maxOutputTokens: 50_000,
    },
    ImdRankingsExtractionSchema,
  );

  // See program-digest/run.ts for the rationale on auto-approve at
  // write time. Same env var, same default (0) — disables human review
  // entirely unless the operator brings it back via the env.
  const autoApproveThreshold = Number(process.env.AI_AUTO_APPROVE_THRESHOLD ?? 0);
  const autoApprove = response.confidence >= autoApproveThreshold;

  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'pdf',
      sourceEntityId: pdf.id,
      extractionKind: IMD_RANKINGS_EXTRACTION_KIND,
      payloadJson: response.parsed as object,
      confidence: response.confidence,
      methodVersion: IMD_RANKINGS_EXTRACT_VERSION,
      aiInferenceId: response.aiInferenceId,
      reviewStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
      reasoning: response.reasoning ?? null,
    },
    select: { id: true },
  });

  let materialised = false;
  let materialisationError: string | null = null;
  if (autoApprove) {
    try {
      await materialiseImdRankings(created.id);
      materialised = true;
    } catch (err) {
      materialisationError = err instanceof Error ? err.message : String(err);
      imdLogger.warn(
        `materialiseImdRankings failed for extraction ${created.id} (pdf ${pdf.id}): ${materialisationError}`,
      );
    }
  }

  return {
    status: 'SUCCEEDED',
    aiExtractionId: created.id,
    aiInferenceId: response.aiInferenceId,
    confidence: response.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    rowsExtracted: response.parsed.rankings.length,
    autoApproved: autoApprove,
    materialised,
    materialisationError,
  };
}
