import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Gap-map Council brief — one call over the rows on screen (spec §6). Up to
// five findings, each citing a row's numbers, plus what the data cannot tell.
// Replaces gap-insights.v2's three modes.
//
// Version-bumping rule: any change here = bump VERSION; AiInference.
// methodVersion records it.
// ─────────────────────────────────────────────────────────────────────────────

export const GAP_BRIEF_VERSION = 'gap-brief.v1';
export const GAP_BRIEF_MAX_ROWS = 60;

/** The six verdicts `gap-map.v2` can produce (GAP_VERDICTS in @kku/db). The
 *  model may only echo a verdict the row already carries, so this list must
 *  stay in step with the rules module — a brief that invents a seventh name
 *  is a brief the reader cannot trace back to the table. */
export const GAP_BRIEF_VERDICTS = [
  'white-space',
  'under-served',
  'served',
  'over-served',
  'supply-unknown',
  'too-few-postings',
] as const;

export const GapBriefOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        fieldNameEn: z.string().min(1),
        verdict: z.enum(GAP_BRIEF_VERDICTS),
        /** The row's numbers, restated: shares, ratio, graduates, postings. */
        evidence: z.string().min(1).max(400),
        implication: z.string().min(1).max(400),
      }),
    )
    .max(5),
  cannotTell: z.array(z.string().max(300)).max(6),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(600),
});
export type GapBriefOutput = z.infer<typeof GapBriefOutputSchema>;

export interface GapBriefRow {
  nameEn: string;
  nameTh: string;
  verdict: string;
  demandSharePct: number;
  supplySharePct: number;
  ratio: number | null;
  gradsPerYear: number | null;
  pipelineArrow: 'up' | 'down' | 'flat' | null;
  postings: number;
  topOccupations: string[];
  risingSkills: string[];
  trendSignalTitles: string[];
}

export interface GapBriefInput {
  view: {
    scopeLabel: string;
    verdict: string;
    facultyLabel: string | null;
    thresholds: { under: number; over: number };
  };
  rows: GapBriefRow[];
  reconciliation: {
    fieldPostings: number;
    anyFieldPostings: number;
    otherMentions: number;
    proposedFields: number;
    approvedFields: number;
  };
}

const ARROW = { up: 'pipeline growing', down: 'pipeline shrinking', flat: 'pipeline steady' } as const;

export function buildGapBriefMessages(input: GapBriefInput): AiMessage[] {
  if (input.rows.length === 0) throw new Error('Empty view — nothing to brief');
  if (input.rows.length > GAP_BRIEF_MAX_ROWS) {
    throw new Error(`Too many rows: ${input.rows.length} > ${GAP_BRIEF_MAX_ROWS}`);
  }

  const system = `You write a short brief for a university Council from a table that compares the labour market's demand for fields of study with the university's supply of graduates.

Each row is a field of study. Demand share = the share of Thai job adverts (JobThai) that ask for that field. Supply share = the share of the university's graduates per year that hold it. Ratio = supply share ÷ demand share.

The six verdicts, and what each one means:
- white-space — the university has no programme in this field at all.
- under-served — ratio below ${input.view.thresholds.under}: the university produces fewer graduates than the field's share of adverts.
- served — ratio between the two thresholds.
- over-served — ratio above ${input.view.thresholds.over}.
- supply-unknown — the university HAS programmes in this field but no graduate figures for any of them, so no ratio could be computed. This is a missing measurement, not a shortfall.
- too-few-postings — too few adverts to score; no verdict.

Output STRICT JSON (no prose, no markdown fences):
{
  "findings": [ { "title": "<≤160 chars>", "fieldNameEn": "<a row's English name, verbatim>", "verdict": "<that row's verdict>", "evidence": "<the row's numbers restated, ≤400 chars>", "implication": "<what it means for the Council, ≤400 chars>" } ],
  "cannotTell": [ "<a limit of this data, ≤300 chars>" ],
  "confidence": 0.0-1.0,
  "reasoning": "<≤600 chars>"
}

Rules:
1. At most 5 findings. Prefer, in order: white spaces with the strongest demand and any signals; under-served fields whose pipeline is growing; over-served fields whose pipeline is shrinking.
2. Every finding names ONE row by its exact English name and restates its numbers in evidence. Never cite a number that is not in the table.
3. Do not recommend closing, merging or launching a programme. State what the numbers show and what question they raise.
4. Never present a supply-unknown field as under-served, as a shortage, or as a white space. Say that the graduate figures are missing for its programmes and that no ratio exists until they arrive.
5. cannotTell: at least two entries, drawn from the reconciliation line and the source's limits (national adverts, Bangkok-weighted, no salaries, no dates, postgraduate fields unscored, proposed fields unreviewed, fields whose supply is unmeasured).
6. LANGUAGE RULE (English-only free text): every free-text field MUST be written in English. Thai field names appear only inside the table you are given.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  const fmt = (n: number) => n.toLocaleString('en-US');
  const rowsBlock = input.rows
    .map(
      (r) =>
        `- ${r.nameEn} (${r.nameTh}) — ${r.verdict}; demand ${r.demandSharePct.toFixed(1)} %, supply ${r.supplySharePct.toFixed(1)} %, ratio ${r.ratio ?? '—'}; graduates/yr ${r.gradsPerYear == null ? '—' : fmt(Math.round(r.gradsPerYear))}${r.pipelineArrow ? ` (${ARROW[r.pipelineArrow]})` : ''}; ${fmt(r.postings)} adverts` +
        (r.topOccupations.length ? `; occupations: ${r.topOccupations.slice(0, 3).join(', ')}` : '') +
        (r.risingSkills.length ? `; rising skills (LinkedIn via MHESI): ${r.risingSkills.join(', ')}` : '') +
        (r.trendSignalTitles.length ? `; trend signals: ${r.trendSignalTitles.slice(0, 3).join(' | ')}` : ''),
    )
    .join('\n');

  const user = `[View] ${input.view.scopeLabel}${input.view.facultyLabel ? ` · faculty ${input.view.facultyLabel}` : ''} · verdict filter: ${input.view.verdict} · thresholds under ${input.view.thresholds.under} / over ${input.view.thresholds.over}

[Rows] (${input.rows.length})
${rowsBlock}

[Reconciliation] ${fmt(input.reconciliation.fieldPostings)} adverts name a canonical field; ${fmt(input.reconciliation.anyFieldPostings)} say "any field"; ${fmt(input.reconciliation.otherMentions)} mentions are long-tail strings below the floor; taxonomy ${input.reconciliation.approvedFields} approved / ${input.reconciliation.proposedFields} proposed.

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - view — scope label, verdict filter, faculty filter, thresholds: the
//     brief describes exactly what the reader has on screen.
//   - rows — every visible gap-map row: names, verdict, shares, ratio,
//     graduates/yr + pipeline arrow, postings, top occupations, rising
//     skills (LinkedIn via MHESI), trend-signal titles.
//   - reconciliation — the line under the table, so the model can state
//     what the shares leave out.
//
// Deliberately omitted, with reason:
//   - per-programme rows — the brief is about fields; programme detail is
//     the Deep-Dive's job and would invite programme-level recommendations
//     (rule 3).
//   - health scores — a different methodology; mixing them here would make
//     the brief's numbers untraceable to the table.
//   - programmesWithSupply — the count behind a supply-unknown verdict. The
//     verdict name already carries the fact the reader needs ("no graduate
//     figures"); a second, partially-measured count would invite the model
//     to reason about a ratio the table does not show.
// ─────────────────────────────────────────────────────────────────────────────
