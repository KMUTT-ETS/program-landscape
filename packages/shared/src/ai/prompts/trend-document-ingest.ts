import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ─────────────────────────────────────────────────────────────────────────────
// trend-document-ingest.v2
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
//
// docs/prompt-standard.md conformance (2026-08-17 rewrite, audit #12):
//   - English rule, CONFIDENCE RUBRIC (verbatim), BANNED PHRASES, CHANNEL
//     MANIFEST all added below.
//   - `rationaleTh` → `rationale` (English-only). Confirmed via
//     `grep -rn "rationaleTh" apps packages` that `draft.rationaleTh` was
//     NEVER read in apps/ingestion/src/trend-signals/ingest-document.ts —
//     `createSignal()` there only reads signalType/titleEn/summaryTh/
//     summaryEn/impactScore/aiInferenceId. Zero-consumer field, safe to
//     rename outright, same as trend-signal-analysis's identical field.
//   - Shares field shapes with trend-signal-analysis per the audit's own
//     note ("both should be rewritten together... a language mismatch
//     between the two will otherwise just be re-introduced on every
//     document upload") — both now render `rationale` the same way.
//
// STOP — NOT flipped in this rewrite (reported, not guessed):
//   `titleTh`/`titleEn` and `summaryTh`/`summaryEn` are UNCHANGED.
//   `runTrendDocumentIngest()` writes `titleEn` → TrendSignal.title and
//   `summaryTh`/`summaryEn` verbatim → TrendSignal.summaryTh/summaryEn via
//   `createSignal()` — and those two columns are read broadly across the
//   app (apps/web/app/trends/*, apps/web/app/programs/[id]/{client,print},
//   apps/web/app/signin/page.tsx's public trending-signals teaser,
//   apps/api/src/programs/program-detail-data.ts, apps/api/src/analyst/
//   tool-executor.service.ts, apps/api/src/admin/external-ai/
//   external-ai.service.ts). Dropping the Thai side here would change what
//   those surfaces render, which is a live Council-facing product decision,
//   not a same-commit consumer rename — see the session report for the
//   full blast radius.
// ─────────────────────────────────────────────────────────────────────────────

// v2 (2026-08-17): prompt-standard.md conformance — markers added,
// rationaleTh → rationale (English). No other output shape changes.
export const TREND_DOCUMENT_INGEST_VERSION = 'trend-document-ingest.v2';

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
  /** 1-2 sentence rationale for the type + impact call. English (v2 — was
   *  `rationaleTh` with no English mirror; renamed, not translated, since
   *  this field is never read downstream — see header note). */
  rationale: z.string().min(10).max(800),
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
  const inst = getInstitution();
  const system = `You are a strategic curriculum analyst for ${inst.nameEn} (${inst.shortNameEn}) Council. You read ONE external document and frame it as a single TREND SIGNAL for ${inst.shortNameEn}'s curriculum trend radar.

The radar tracks signals that could change which programs ${inst.shortNameEn} should run, modernise, launch, or retire — and which skills ${inst.shortNameEn} graduates need. A document matters when it speaks to future skill demand, the labour market, government/funding policy, research frontiers, or technology shifts relevant to ${inst.shortNameEn}'s academic portfolio.

RULES:
1. Classify the document into exactly one signalType: POLICY (government/ministry/funding directives), RESEARCH (academic findings, datasets), MARKET (employer demand, job postings, manpower-requirement reports, salary/hiring signals), TECH (technology/vendor capability shifts), or NEWS (press, partnerships, competitor moves). A job-posting or manpower-demand report is MARKET.
2. Write a short English title and Thai title — concrete and specific to the document (no generic "Industry trends").
3. Write summaryTh (Thai PRIMARY, 2-4 sentences) and summaryEn (English mirror): say what the document reports AND why it matters to ${inst.shortNameEn}'s curriculum strategy / graduate skills. Anchor claims in the document — do not invent numbers not present in DOCUMENT TEXT below.
4. impactScore 0.0-1.0: how strategically relevant this is to ${inst.shortNameEn}'s academic portfolio. Reserve 0.7+ for clear, near-term demand/policy shifts that warrant curriculum action.
5. If the document is unreadable, off-topic, or not a real signal, still return your best framing with a LOW impactScore and LOW confidence — do not refuse.
6. Output STRICT JSON only — no markdown fences, no prose outside the JSON.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95. A short, garbled, or off-topic document should score in the lower bands, not a compliance-driven 0.9+.

BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — "the competitive landscape" — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"

OUTPUT LANGUAGE: \`rationale\` is English-only (analysis prose, no data-label exemption applies). \`titleTh\`/\`titleEn\` and \`summaryTh\`/\`summaryEn\` are unchanged pending a UI redesign of the surfaces that render them (the /trends radar, program deep-dive, sign-in page teaser) — always populate BOTH languages for those fields, never leave one empty, and summaryTh must be natural Thai, not a literal translation of summaryEn.

OUTPUT JSON SHAPE:
{
  "signalType": "POLICY|RESEARCH|MARKET|TECH|NEWS",
  "titleEn": "<short English headline>",
  "titleTh": "<short Thai headline>",
  "summaryTh": "<2-4 sentence Thai summary>",
  "summaryEn": "<English mirror>",
  "impactScore": 0.0-1.0,
  "rationale": "<1-2 sentence English rationale>",
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

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - documentText — the runner's extracted plain text of the uploaded file
//     or fetched URL (markitdown, falling back to pdfjs / HTML-strip; see
//     apps/ingestion/src/trend-signals/ingest-document.ts), capped at
//     MAX_DOC_CHARS there before it reaches this prompt.
//   - sourceLabel  — a human-readable provenance label (original filename or
//     source URL), shown so the model can reference "this report" concretely
//     rather than genericising it.
//   - signalTypeHint (optional) — an operator's pre-classification, offered
//     as a starting point the model may override when the content clearly
//     disagrees (RULE 1 keeps the override condition explicit rather than
//     letting the hint silently win).
//
// Deliberately omitted, with reason:
//   - KKU's program list — this prompt frames the document as ONE signal; it
//     does not decide which programs the signal affects. That handoff is
//     the very next step the runner takes (trend-signal-analysis, which DOES
//     receive the program list plus each program's taught skills — see that
//     prompt's own CHANNEL MANIFEST). Mixing program selection into this
//     prompt would duplicate that grounded step with an ungrounded one.
//   - Prior TrendDocument / TrendSignal history — no dedup or "have we seen
//     this before" signal wired here; content-hash dedup on the upload path
//     (TrendDocument) already prevents re-ingesting byte-identical files, so
//     this prompt can treat every call as a fresh document.
// ─────────────────────────────────────────────────────────────────────────────
