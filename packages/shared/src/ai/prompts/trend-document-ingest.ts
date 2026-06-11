import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// trend-document-ingest.v1
//
// Turns ONE arbitrary external document (a job-posting / manpower-demand PDF, a
// policy announcement, an industry report, a news article — uploaded as a file
// or fetched from a URL) into a single TREND SIGNAL draft for the /trends radar:
//   • signalType  — POLICY | RESEARCH | MARKET | TECH | NEWS
//   • title       — short English headline (UI labels are English)
//   • summaryTh / summaryEn — what the document says + why it matters to KKU's
//     curriculum strategy (Thai-primary per the language strategy, English mirror)
//   • impactScore — 0..1 strategic relevance to KKU's programs / labour-market fit
//
// The runner (apps/ingestion) creates the signal from this draft, then runs the
// existing trend-signal-analysis pass to attach affected programs/skills +
// recommended actions. So this prompt does NOT pick programs — it only frames
// the document as a signal.
// ─────────────────────────────────────────────────────────────────────────────

export const TREND_DOCUMENT_INGEST_VERSION = 'trend-document-ingest.v1';

export const TrendDocumentIngestSchema = z.object({
  /** The kind of signal this document represents. A job-posting / manpower
   *  demand report is MARKET; a ministry circular is POLICY; an academic
   *  paper/dataset is RESEARCH; a vendor/tech announcement is TECH; a press
   *  article is NEWS. */
  signalType: z.enum(['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS']),
  /** Short English headline for the radar (≤140 chars). */
  titleEn: z.string().min(4).max(160),
  /** Short Thai headline. */
  titleTh: z.string().min(2).max(200),
  /** 2-4 sentence Thai summary: what the document says + why it matters to KKU
   *  curriculum strategy / labour-market fit. */
  summaryTh: z.string().min(20).max(1200),
  /** English mirror of the summary. */
  summaryEn: z.string().min(20).max(1200),
  /** 0..1 strategic relevance to KKU's academic portfolio. 0.7+ = act now,
   *  0.4-0.69 = watch, <0.4 = informational. */
  impactScore: z.number().min(0).max(1),
  /** 1-2 sentence Thai rationale for the type + impact call. */
  rationaleTh: z.string().min(10).max(800),
  /** Self-rated confidence that the document was understood + framed well. */
  confidence: z.number().min(0).max(1),
});
export type TrendDocumentIngest = z.infer<typeof TrendDocumentIngestSchema>;

export interface TrendDocumentIngestInput {
  /** Extracted plain text of the document (already truncated by the runner). */
  documentText: string;
  /** A human label for provenance — the original filename or the source URL. */
  sourceLabel: string;
  /** Optional operator hint for the signal type; the model may override it if
   *  the content clearly disagrees. */
  signalTypeHint?: string | null;
}

export function buildTrendDocumentIngestMessages(input: TrendDocumentIngestInput): AiMessage[] {
  const system = `You are a strategic curriculum analyst for Khon Kaen University (KKU) Council. You read ONE external document and frame it as a single TREND SIGNAL for KKU's curriculum trend radar.

The radar tracks signals that could change which programs KKU should run, modernise, launch, or retire — and which skills KKU graduates need. A document matters when it speaks to future skill demand, the labour market, government/funding policy, research frontiers, or technology shifts relevant to KKU's academic portfolio.

RULES:
1. Classify the document into exactly one signalType: POLICY (government/ministry/funding directives), RESEARCH (academic findings, datasets), MARKET (employer demand, job postings, manpower-requirement reports, salary/hiring signals), TECH (technology/vendor capability shifts), or NEWS (press, partnerships, competitor moves). A job-posting or manpower-demand report is MARKET.
2. Write a short English title and Thai title — concrete and specific to the document (no generic "Industry trends").
3. Write summaryTh (Thai PRIMARY, 2-4 sentences) and summaryEn (English mirror): say what the document reports AND why it matters to KKU's curriculum strategy / graduate skills. Anchor claims in the document — do not invent numbers.
4. impactScore 0.0-1.0: how strategically relevant this is to KKU's academic portfolio. Reserve 0.7+ for clear, near-term demand/policy shifts that warrant curriculum action.
5. If the document is unreadable, off-topic, or not a real signal, still return your best framing with a LOW impactScore and LOW confidence — do not refuse.
6. Output STRICT JSON only — no markdown fences, no prose outside the JSON.

OUTPUT JSON SHAPE:
{
  "signalType": "POLICY|RESEARCH|MARKET|TECH|NEWS",
  "titleEn": "<short English headline>",
  "titleTh": "<short Thai headline>",
  "summaryTh": "<2-4 sentence Thai summary>",
  "summaryEn": "<English mirror>",
  "impactScore": 0.0-1.0,
  "rationaleTh": "<1-2 sentence Thai rationale>",
  "confidence": 0.0-1.0
}`;

  const hint = input.signalTypeHint
    ? `\n\nOperator hint for the signal type: ${input.signalTypeHint} (override it if the content clearly indicates a different type).`
    : '';

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `SOURCE: ${input.sourceLabel}${hint}\n\nDOCUMENT TEXT:\n"""\n${input.documentText}\n"""\n\nFrame this document as one trend signal. Produce the JSON.`,
    },
  ];
}
