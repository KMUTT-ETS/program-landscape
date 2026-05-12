import { z } from 'zod';
import type { AiMessage } from '../types';

// Summarises a single fetched item (URL_LIST URL response, or a single
// search-result document) into a TrendSignal-ready payload. Phase 5 of
// the admin-console redesign.
//
// The fetcher hands raw text (HTML stripped, or RSS-item text) to this
// prompt; the prompt returns a structured object the caller writes to
// `trend_signals` with `externalAiSourceId` set. No vector embeddings
// — the existing analyst/cockpit code reads TrendSignal as plain rows.

export const EXTERNAL_FEED_SUMMARY_VERSION = 'external-feed-summary.v1';

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
  const system = `You distil one fetched intelligence item from "${input.sourceName}" into a single TrendSignal payload for KKU's curriculum-landscape app. Audience: University Council + strategic planners + analysts.

Output STRICT JSON (no prose, no fences) matching:
{
  "title": "<short title — 10-18 words — Thai OR English, whichever fits the content>",
  "summaryTh": "<3-5 sentences in Thai. Don't translate from English machine-style; rewrite for a Thai reader.>",
  "summaryEn": "<3-5 sentences in English.>",
  "impactScore": 0.0-1.0,
  "signalType": "POLICY|RESEARCH|MARKET|TECH|NEWS",
  "topicKeywords": ["<keyword>", ...],
  "confidence": 0.0-1.0
}

Defaults / heuristics:
- The source's declared signalType is "${input.sourceDefaultSignalType}" and default impact is ${input.sourceDefaultImpact.toFixed(2)}. Start there; deviate when the content clearly warrants.
- impactScore rubric (calibrate to KKU's strategic decision-making):
  - >=0.8: directly affects which programs to launch/close/restructure in the next 1-3 years
  - 0.5-0.79: informs faculty-level planning OR signals an emerging skill area
  - 0.2-0.49: background / sector context
  - <0.2: marginal relevance — borderline whether to surface
- If the item is not relevant to higher-education / labour-market / curriculum / KKU at all, return confidence < 0.3 and the operator will filter it out.
- topicKeywords: 3-8 concrete terms (skill names, sectors, program areas, policy instruments). Mix Thai + English; don't pad with generic words.
- summaryTh must be natural Thai — not a literal translation of summaryEn.
- Stay grounded in what the source actually says. Don't extrapolate. If the content is thin, say so in the summary.`;

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
