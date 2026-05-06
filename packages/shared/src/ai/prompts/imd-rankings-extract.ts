import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// imd-rankings.v1
//
// Extracts country-level rankings from one of IMD's three annual public
// summary PDFs:
//   - World Competitiveness Yearbook (WCY)            — June release
//   - World Talent Ranking           (WTR)            — September release
//   - World Digital Competitiveness Ranking (WDCR)    — November release
//
// The free executive summaries published at imd.org/wcc include the
// overall ranking table for ~67 economies plus brief sub-pillar
// breakdowns for the top-N or for a "country profile" section.
//
// Output: structured rows tagged with the dataset the PDF represents.
// One row per (year × dataset × economy × indicatorKey). Indicators
// follow the slash-delimited convention used by ImdRanking:
//   <dataset>.overall                 — headline rank
//   <dataset>.<pillar>                — sub-pillar within the dataset
//
// PDF is sent via Gemini File API (no inline tokens). Missing fields →
// null. Unknown economies → still extracted; the analyst maps unknown
// codes to ImdEconomy rows during review.
// ─────────────────────────────────────────────────────────────────────────────

export const IMD_RANKINGS_EXTRACT_VERSION = 'imd-rankings.v1';
export const IMD_RANKINGS_EXTRACTION_KIND = 'IMD_RANKINGS';

const ImdRowSchema = z.object({
  /** Economy code as published by IMD — usually 2–3 letters (e.g. "TH",
   *  "SG", "USA", "HK"). Verbatim — DO NOT normalise. */
  economyCode: z.string().min(2).max(8),
  /** Economy name verbatim (e.g. "Thailand", "China Mainland", "Hong
   *  Kong SAR"). */
  economyName: z.string().min(2).max(80),
  /** Slash-delimited indicator key, lowercase. Examples:
   *   "wcy.overall", "wcy.economic_performance",
   *   "wtr.overall", "wtr.investment_development",
   *   "wdcr.overall", "wdcr.knowledge". */
  indicatorKey: z.string().min(2).max(80),
  /** Rank position — 1 = best. Null when only a value is published. */
  rank: z.number().int().min(1).max(200).nullable(),
  /** Numeric score (typically 0–100 or raw indicator value). Null when
   *  only a rank is published. */
  value: z.number().nullable(),
  /** Total economies ranked that year. Null when not stated. */
  totalRanked: z.number().int().min(10).max(200).nullable(),
  /** Verbatim string from the PDF — kept for analyst sanity-check. */
  rawValue: z.string().max(120).nullable(),
});
export type ImdRow = z.infer<typeof ImdRowSchema>;

export const ImdRankingsExtractionSchema = z.object({
  /** Year the data refers to (CE). For WCY this is published in
   *  spring/summer of the same year. */
  year: z.number().int().min(2000).max(2030),
  /** Which IMD dataset this PDF represents. The classifier hint nudges
   *  the AI; if the PDF clearly contains a different dataset, the AI
   *  should set this to what's actually in the document. */
  dataset: z.enum(['WCY', 'WTR', 'WDCR']),
  /** Per-economy ranking rows. */
  rankings: z.array(ImdRowSchema).min(0).max(500),
  /** AI's self-rated confidence 0..1. Lower when many fields are
   *  missing or only the headline table is in the brief. */
  confidence: z.number().min(0).max(1),
  /** One-paragraph operator-facing summary — methodology notes, sample
   *  caveats, "this brief only includes top-30 sub-pillars" disclaimers. */
  caveatNote: z.string().max(2000).nullable(),
});
export type ImdRankingsExtraction = z.infer<typeof ImdRankingsExtractionSchema>;

export interface ImdRankingsExtractInput {
  /** Hint extracted from filename (e.g. "WCY", "WTR", "WDCR"). The AI
   *  should override if the document clearly says otherwise. */
  datasetHint?: 'WCY' | 'WTR' | 'WDCR' | null;
  /** Year hint extracted from filename (e.g. 2024). */
  yearHint?: number | null;
}

const SYSTEM_PROMPT = `You are extracting country-level rankings from an IMD World Competitiveness Center public summary PDF (Lausanne, Switzerland).

GROUND RULES:

1. Identify which dataset this PDF represents:
   - WCY  = World Competitiveness Yearbook (4 pillars: economic_performance,
           government_efficiency, business_efficiency, infrastructure)
   - WTR  = World Talent Ranking (3 factors: investment_development, appeal, readiness)
   - WDCR = World Digital Competitiveness Ranking (3 factors: knowledge,
           technology, future_readiness)

2. Extract the OVERALL ranking table (one row per economy, headline rank).
   Use indicatorKey = "<dataset>.overall" (lowercase).

3. When the PDF includes pillar/factor sub-tables (typical for the headline
   chart and the country-profile pages), extract those too. Use
   indicatorKey = "<dataset>.<pillar>" with the pillar names from rule 1.

4. Use IMD's published economy codes verbatim. They're 2–3 letters, e.g.
   "TH", "SG", "USA", "HK", "TW", "CN", "KOR", "JPN".

5. \`rank\`: position only (1=best). \`value\`: the numeric score when shown
   (typically 0–100). When the brief only shows ranks, \`value\` is null.
   When it only shows scores, \`rank\` is null. \`totalRanked\` = the universe
   size that year (e.g. 67 in 2024, 64 in 2023).

6. \`year\`: the data year (CE). This is usually printed at the cover or in
   the title (e.g. "World Competitiveness Yearbook 2024").

7. Keep \`rawValue\` as the verbatim string the rank/score was published as,
   for analyst sanity-check. Examples: "25", "73.245", "39 (-3 from 2023)".

8. Set \`confidence\` lower when:
   - The PDF only has top-N rankings (not all 67 economies)
   - Sub-pillar tables are partial / cut off
   - You had to guess the dataset because the title was ambiguous

9. DO NOT invent rows. If an economy isn't in the published table, omit it.

Output: a single JSON object matching the schema below.`;

const USER_PROMPT = (input: ImdRankingsExtractInput) => `Extract IMD rankings from this PDF.

Filename hints: dataset=${input.datasetHint ?? '<unknown>'}, year=${input.yearHint ?? '<unknown>'}

Output as a single JSON object:

\`\`\`json
{
  "year": <number CE>,
  "dataset": "WCY" | "WTR" | "WDCR",
  "rankings": [
    {
      "economyCode": "<2–3 letter code>",
      "economyName": "<verbatim name>",
      "indicatorKey": "<dataset>.overall | <dataset>.<pillar>",
      "rank": <int 1..200 or null>,
      "value": <number or null>,
      "totalRanked": <int or null>,
      "rawValue": "<verbatim string or null>"
    }
  ],
  "confidence": <0..1>,
  "caveatNote": "<one paragraph or null>"
}
\`\`\`

Notes:
- Use lowercase pillar names: economic_performance, government_efficiency,
  business_efficiency, infrastructure (WCY); investment_development, appeal,
  readiness (WTR); knowledge, technology, future_readiness (WDCR).
- Don't normalise economy names — preserve verbatim.
- Use null for any field not clearly stated.`;

export function buildImdRankingsExtractMessages(
  input: ImdRankingsExtractInput,
): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT(input) },
  ];
}
