import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// Summarises a single fetched item (URL_LIST URL response, or a single
// search-result document) into a TrendSignal-ready payload. Phase 5 of
// the admin-console redesign.
//
// The fetcher hands raw text (HTML stripped, or RSS-item text) to this
// prompt; the prompt returns a structured object the caller writes to
// `trend_signals` with `externalAiSourceId` set. No vector embeddings
// — the existing analyst/cockpit code reads TrendSignal as plain rows.
//
// docs/prompt-standard.md conformance (2026-08-17 rewrite, audit #13):
//   - English rule, CONFIDENCE RUBRIC (verbatim), BANNED PHRASES, CHANNEL
//     MANIFEST all added below.
//   - `title` language fix (the audit's specific finding): v1 said "Thai OR
//     English, whichever fits the content" — a non-deterministic choice
//     that is itself a standard violation (the model, not a stated rule,
//     decided the language on every call). `title` is now English-only,
//     with an explicit carve-out to quote a Thai source headline verbatim
//     in quotation marks when that is the clearest way to identify the
//     item — a verbatim quote is a structural extraction requirement, not
//     new Thai analysis prose (docs/prompt-standard.md's Extraction
//     addendum + program-research-expertise's evidenceQuote precedent).
//
// STOP — NOT flipped in this rewrite (reported, not guessed):
//   `summaryTh`/`summaryEn` are UNCHANGED. `runExternalAiSource()`
//   (packages/db/src/external-ai-runner.ts) writes both verbatim into
//   TrendSignal.summaryTh/summaryEn, the same broadly-read columns flagged
//   in trend-document-ingest.v2's header note (trends radar + detail,
//   program deep-dive, sign-in teaser, program-detail-data.ts, analyst tool
//   executor, external-ai admin service). Same "wider than
//   prompts+consumers-in-code" cascade — a live product decision, not a
//   same-commit rename. Also out of the audit's own scope for this prompt
//   (the audit named only the `title` non-determinism, not summaryTh).
// ─────────────────────────────────────────────────────────────────────────────

// v2 (2026-08-17): prompt-standard.md conformance — markers added, `title`
// language made deterministic (English, verbatim-Thai-quote carve-out). No
// other output shape changes.
export const EXTERNAL_FEED_SUMMARY_VERSION = 'external-feed-summary.v2';

export const ExternalFeedSummarySchema = z.object({
  title: z.string().min(1),
  summaryTh: z.string().min(1),
  summaryEn: z.string().min(1),
  // Impact 0-1 (continuous), surfaced in TrendSignal.impactScore. The
  // operator-set source default is a STARTING POINT — the LLM bumps
  // it up/down based on actual content (e.g. an MHESI announcement
  // about a specific program type is higher-impact than a generic
  // weekly newsletter from the same source).
  impactScore: z.number().min(0).max(1),
  // Optional override of the source default — useful when an item
  // from a POLICY source is actually about research/market.
  signalType: z
    .enum(['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS'])
    .optional(),
  // Topical keywords for downstream matching against ProgramSkill /
  // Sector. Free-text Thai or English — no taxonomy resolution at
  // the prompt layer.
  topicKeywords: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});
export type ExternalFeedSummary = z.infer<typeof ExternalFeedSummarySchema>;

export interface ExternalFeedSummaryInput {
  sourceName: string;
  sourceDefaultSignalType: 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';
  sourceDefaultImpact: number;
  fetchedUrl: string;
  fetchedAt: string; // ISO
  rawContent: string; // pre-cleaned plain-text body
}

export function buildExternalFeedSummaryMessages(
  input: ExternalFeedSummaryInput,
): AiMessage[] {
  const inst = getInstitution();
  const system = `You distil one fetched intelligence item from "${input.sourceName}" into a single TrendSignal payload for ${inst.shortNameEn}'s curriculum-landscape app. Audience: University Council + strategic planners + analysts.

Output STRICT JSON (no prose, no fences) matching:
{
  "title": "<short title — 10-18 words — English>",
  "summaryTh": "<3-5 sentences in Thai. Don't translate from English machine-style; rewrite for a Thai reader.>",
  "summaryEn": "<3-5 sentences in English.>",
  "impactScore": 0.0-1.0,
  "signalType": "POLICY|RESEARCH|MARKET|TECH|NEWS",
  "topicKeywords": ["<keyword>", ...],
  "confidence": 0.0-1.0
}

OUTPUT LANGUAGE: \`title\` is English, always — never leave the language choice to what "fits the content" on a given call. EXCEPTION: when the source item's own headline is Thai and quoting it verbatim is the clearest way to identify the item (e.g. a named Thai-language ministry circular), quote that Thai headline VERBATIM in quotation marks inside an otherwise-English title (e.g. \`MHESI circular "ประกาศ..." raises funding thresholds for STEM programs\`) — a verbatim quote is a data label, not new Thai analysis prose, so it is not a language violation. Never write a wholly Thai title, and never paraphrase a Thai headline into new (non-verbatim) Thai wording.

Defaults / heuristics:
- The source's declared signalType is "${input.sourceDefaultSignalType}" and default impact is ${input.sourceDefaultImpact.toFixed(2)}. Start there; deviate when the content clearly warrants.
- impactScore rubric (calibrate to ${inst.shortNameEn}'s strategic decision-making):
  - >=0.8: directly affects which programs to launch/close/restructure in the next 1-3 years
  - 0.5-0.79: informs faculty-level planning OR signals an emerging skill area
  - 0.2-0.49: background / sector context
  - <0.2: marginal relevance — borderline whether to surface
- If the item is not relevant to higher-education / labour-market / curriculum / ${inst.shortNameEn} at all, return confidence < 0.3 and the operator will filter it out.
- topicKeywords: 3-8 concrete terms (skill names, sectors, program areas, policy instruments). Mix Thai + English; don't pad with generic words.
- summaryTh must be natural Thai — not a literal translation of summaryEn.
- Stay grounded in what the source actually says. Don't extrapolate. If the content is thin, say so in the summary.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95. Thin, off-topic, or barely-fetchable content (stripped boilerplate, a paywall stub) should score in the lower bands.

BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — "the competitive landscape" — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  // Cap raw content to keep prompt tokens reasonable. Most fetched
  // articles fit comfortably in 30k chars after HTML stripping; the
  // outliers (long PDF / report extracts) get trimmed.
  const body = input.rawContent.length > 32_000
    ? input.rawContent.slice(0, 32_000) + '\n\n…[truncated]'
    : input.rawContent;

  const user = `Source: ${input.sourceName}
URL: ${input.fetchedUrl}
Fetched at: ${input.fetchedAt}

Content:
${body}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - rawContent          — the fetcher's pre-cleaned plain-text body of one
//     fetched URL_LIST item or WEB_SEARCH result (HTML-stripped by
//     packages/db/src/external-ai-runner.ts's stripExternalAiHtml(), or a
//     Playwright-rendered page for HEADLESS-strategy sources), capped at
//     32k chars here.
//   - sourceName / sourceDefaultSignalType / sourceDefaultImpact — the
//     operator-configured ExternalAiSource this item came from; used as a
//     calibration starting point the model may deviate from (RULE:
//     "Start there; deviate when the content clearly warrants"), never as
//     a value the model must copy blindly.
//   - fetchedUrl / fetchedAt — provenance shown to the model so it can
//     reference "this item" concretely; not analysed content itself.
//
// Deliberately omitted, with reason:
//   - KKU's program/skill list — this prompt classifies ONE external item
//     into a TrendSignal shape; it does not decide which KKU programs the
//     item affects. affectedProgramIds stays empty on creation
//     (packages/db/src/external-ai-runner.ts) — a later
//     trend-signal-analysis pass (run separately, not chained
//     automatically the way trend-document-ingest chains it) is the
//     grounded place for that decision.
//   - Prior signals from the same source — dedup against the last 30 days
//     by (externalAiSourceId, sourceUrl) happens in the runner BEFORE this
//     prompt is even called, so a duplicate item never reaches the model;
//     no "have I seen this before" channel is needed here.
// ─────────────────────────────────────────────────────────────────────────────
