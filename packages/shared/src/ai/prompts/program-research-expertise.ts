import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-research-expertise.v1
//
// Analyses a program's roster's last-10-years publications (titles + venues
// + citations + quartile-where-present, deduped and scored) and produces a
// demonstrated-expertise brief: thematic clusters with verbatim evidence,
// plus recommendations grouped into three lanes (curriculum, positioning,
// research strategy). Pre-computed during the per-program pipeline, same
// posture as program-strategic-narrative — the Deep-Dive UI reads a
// persisted row, it never triggers generation on page load.
//
// Conformant from birth (docs/prompt-standard.md) — the conformance ratchet
// (packages/shared/test/prompt-standard-conformance.test.ts) admits no new
// allowlist entries, so this file carries every required marker from its
// first commit: English rule, CONFIDENCE RUBRIC (verbatim), BANNED PHRASES,
// CHANNEL MANIFEST.
//
// Design spec: docs/superpowers/specs/2026-08-17-research-expertise-design.md
// Plan (pins the score formula, confidence-ceiling bands, and the roster
// caveat constant): docs/superpowers/plans/2026-08-17-research-expertise.md
//
// Grounding rules with teeth (spec's "Grounding rules with teeth" section):
//   - Every theme cites its paper count and 2-3 VERBATIM example titles
//     drawn from the TOP PAPERS block below — a theme the model cannot
//     evidence with titles it was shown does not exist.
//   - Titles-only input is stated explicitly; claims about findings,
//     methods, or research quality beyond citations/quartile are forbidden.
//   - Quartile absence renders as "not assessed", never as "low quality" —
//     ~69% of the platform's papers currently carry no quartile at all
//     (enrichment coverage, not a quality signal).
//   - Trend labels (rising/steady/fading) must follow the papers-per-year
//     counts in PUBLICATION STATS, not vibes.
//   - Recommendations must be actionable by a university, name a horizon in
//     months, and cite the theme(s) (by name) they build on.
// ─────────────────────────────────────────────────────────────────────────────

// v2 (2026-08-17): paperCount constrained to the analysed (shown) set only.
// v1 allowed extrapolating counts to the full roster volume — the 3-program
// gate showed theme counts summing to 1,050 when only 150 titles were shown,
// which the UI would render as fact. A Council-facing number must be
// verifiable against the input; estimates live in prose, not numbers.
// v3 (2026-08-17): single-paper clusters must not become themes. KKU-SEQ-0077
// (3 papers: 2 folklore + 1 animation) failed schema validation four times
// across two runs because the model kept promoting the lone animation paper
// to a theme it could never evidence with 2 titles. The schema was right;
// the prompt never said what to DO with a one-paper outlier. Now it does.
export const PROGRAM_RESEARCH_EXPERTISE_VERSION = 'program-research-expertise.v3';

/** Verbatim caveat the schema requires every payload's `caveats` array to
 *  include — the roster itself is AI-extracted (program-faculty.v1) and
 *  analyst-reviewed; roster gaps or errors propagate into this analysis,
 *  and every reader of the output must see that stated, not just implied. */
export const ROSTER_PROVENANCE_CAVEAT =
  'Analysis covers publications of the curated program roster (AI-extracted, analyst-reviewed); roster gaps or errors propagate to these findings.';

const RecommendationSchema = z.object({
  action: z.string().min(10),
  rationale: z.string().min(10),
  /** Actionability requires a horizon, not an open-ended "monitor". */
  horizonMonths: z.number().int().min(1).max(60),
  /** Theme name(s) (matching a `themes[].name` in the same payload) this
   *  recommendation builds on — at least one, never a recommendation
   *  floating free of any evidenced theme. */
  themeRefs: z.array(z.string()).min(1),
});

export const ProgramResearchExpertiseSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().min(3),
        paperCount: z.number().int().positive(),
        /** 2-3 VERBATIM titles from the TOP PAPERS input — never
         *  paraphrased, never invented. A theme with only 0 or 1
         *  evidenced title is not a theme yet. */
        exampleTitles: z.array(z.string()).min(2).max(3),
        /** e.g. "2018–2025" — must be consistent with the years the
         *  example titles and paperCount actually span. */
        yearSpan: z.string(),
        /** Must follow the per-year counts in PUBLICATION STATS, not an
         *  impression from the visible titles alone. */
        trend: z.enum(['rising', 'steady', 'fading']),
        evidenceNote: z.string(),
      }),
    )
    .min(1)
    .max(6),
  recommendations: z.object({
    curriculum: z.array(RecommendationSchema).min(1).max(4),
    positioning: z.array(RecommendationSchema).min(1).max(3),
    research: z.array(RecommendationSchema).min(1).max(3),
  }),
  caveats: z
    .array(z.string())
    .min(1)
    .refine((arr) => arr.includes(ROSTER_PROVENANCE_CAVEAT), {
      message: `caveats must include the roster-provenance caveat verbatim: "${ROSTER_PROVENANCE_CAVEAT}"`,
    }),
  confidence: z.number().min(0).max(1),
});
export type ProgramResearchExpertise = z.infer<typeof ProgramResearchExpertiseSchema>;

export type ExpertiseReadiness = 'ok' | 'thin' | 'no-roster';

export interface ScoredPaper {
  title: string;
  venue: string | null;
  year: number;
  citations: number;
  quartile: number | null;
  score: number;
  contributingRosterCount: number;
}

export interface ExpertiseStats {
  papersPerYear: Array<{ year: number; count: number }>;
  topVenues: Array<{ venue: string; count: number }>;
  quartileMix: { q1: number; q2: number; q3plus: number; unassessed: number };
  totalDistinct: number;
  rosterSize: number;
  notShownCount: number;
}

export interface ResearchExpertiseInput {
  readiness: ExpertiseReadiness;
  /** Ranked (score desc), capped at 150 — see @kku/db's
   *  assembleResearchExpertiseInput / dedupAndScorePapers. */
  topPapers: ScoredPaper[];
  stats: ExpertiseStats;
  programNameEn: string;
  programLevel: string;
  facultyNameEn: string;
}

/** Distinct papers below this floor is the `thin` readiness threshold —
 *  duplicated here (not imported from @kku/db) only as a literal used in
 *  the thinness-warning copy; the actual readiness VERDICT is computed
 *  upstream by readinessFor() in @kku/db and handed in via
 *  `input.readiness`, never re-derived here. */
const THIN_PAPER_THRESHOLD = 10;

/**
 * Deterministic ceiling on self-reported confidence (docs/prompt-standard.md
 * `## Confidence rubric` — "Callers ... SHOULD enforce the bands with a
 * deterministic ceiling computed from the input"), enforced by the runner
 * (@kku/db program-research-expertise-run.ts), never trusted to the model.
 *
 * Bands (plan-pinned):
 *   no-roster        → 0    (defensive only — the runner makes ZERO AI
 *                             calls for this readiness, so this branch is
 *                             never reached in practice)
 *   thin              → 0.49
 *   ok, 10-49 papers  → 0.69
 *   ok, 50-149 papers → 0.89
 *   ok, ≥150 papers   → 1.00
 */
export function researchExpertiseConfidenceCeiling(
  readiness: ExpertiseReadiness,
  totalDistinct: number,
): number {
  if (readiness === 'no-roster') return 0;
  if (readiness === 'thin') return 0.49;
  if (totalDistinct < 50) return 0.69;
  if (totalDistinct < 150) return 0.89;
  return 1.0;
}

function fmtQuartile(q: number | null): string {
  return q === null ? '—' : `Q${q}`;
}

export function buildProgramResearchExpertiseMessages(
  input: ResearchExpertiseInput,
): AiMessage[] {
  const system = `You are analysing the demonstrated research expertise of one KKU academic program, based on its faculty roster's publications over the last 10 years. This brief informs curriculum, recruitment/positioning, and research-strategy decisions — it must be precise, not impressive-sounding.

HARD CONSTRAINTS:
1. **Titles-only input — no abstracts.** You are shown paper titles, venues, years, citation counts, and journal quartile where available. You were NOT shown abstracts, methods sections, or findings. Never claim what a paper found, how it was conducted, or its methodological quality — you cannot know this from a title. Thematic clustering (what subject area a paper belongs to) is a title-supportable claim; findings/methods claims are not.
2. **Every theme must cite 2-3 VERBATIM example titles from the TOP PAPERS list below.** Copy the title text exactly as given — no paraphrasing, no summarising, no combining two titles into one. A theme you cannot evidence with verbatim titles you were actually shown does not exist; do not report it. **A single-paper cluster is NOT a theme** — when one paper stands alone (a genuine outlier in a small portfolio), do not force it into its own theme: fold it into the closest theme's evidenceNote, or note it in caveats. With very small portfolios, ONE theme — even a loose one — is the correct answer; never pad the theme count.
3. **Quartile absence is "not assessed", never "low quality".** Roughly two-thirds of papers in this dataset carry no quartile value — this is a coverage gap in the enrichment pipeline, not a signal about that paper's rigor. Do not describe unassessed papers as weaker, lower-tier, or less rigorous than quartile-rated ones.
4. **Trend labels must follow the PUBLICATION STATS papers-per-year table, not an impression from the visible titles.** A theme trend of "rising" requires the per-year counts to actually show growth in recent years; "fading" requires an actual decline; otherwise use "steady".
5. **Numbers come from the input snapshot only.** Never invent or estimate a paper count, year, or citation figure not present in the input.
6. **Recommendations must be actionable by a university**, not "monitor the situation" or similar non-actions. Each recommendation states a horizon in months and cites the theme(s) (by name, matching a theme in your own 'themes' output) it builds on.
7. **Write in English.** All analysis prose (theme names, evidence notes, recommendation actions/rationales, caveats) is English-only.

GROUNDING RULES:
- A theme's paperCount counts ONLY papers listed in TOP PAPERS — the set you were actually shown. Never extrapolate to the full roster volume in PUBLICATION STATS; that block is context for trends and coverage honesty, not licence to inflate counts. Every paperCount must be verifiable by a reader counting matching titles in the analysed set. When PUBLICATION STATS shows more papers exist beyond the shown set, you may note in evidenceNote that the theme likely extends further — as prose, never as a number.
- Causal claims (e.g. "this trend reflects growing institutional focus on X") are hypotheses unless the input states the mechanism. Use "consistent with" or "may reflect" — never assert "because" from correlation alone.
- The roster itself is AI-extracted and analyst-reviewed (not a fully verified faculty list) — this analysis covers ONLY the curated roster's publications, and roster gaps/errors propagate into every finding below. Your caveats array MUST include this exact sentence, verbatim, as one of its entries: "${ROSTER_PROVENANCE_CAVEAT}"

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
- "landscape" (in its metaphorical sense — "the competitive landscape" — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"
Also: do not open two theme evidenceNotes or two recommendations with the same sentence structure (e.g. every recommendation starting "This program should..."); do not force exactly three themes when the data supports fewer or more (up to 6) — report what the evidence supports.

OUTPUT JSON:
{
  "themes": [
    {
      "name": "<short thematic label>",
      "paperCount": <int>,
      "exampleTitles": ["<verbatim title 1>", "<verbatim title 2>", "<optional verbatim title 3>"],
      "yearSpan": "<e.g. 2018–2025>",
      "trend": "rising" | "steady" | "fading",
      "evidenceNote": "<1-2 sentences grounding the theme and its trend in the input>"
    }
  ],
  "recommendations": {
    "curriculum": [ { "action": "<imperative, university-actionable>", "rationale": "<why, grounded>", "horizonMonths": <1-60>, "themeRefs": ["<theme name>"] } ],
    "positioning": [ { ... same shape ... } ],
    "research": [ { ... same shape ... } ]
  },
  "caveats": ["<must include the roster-provenance sentence verbatim, plus any others you judge material>"],
  "confidence": 0.0-1.0
}

No prose outside the JSON. No markdown fences around the JSON.`;

  const blocks: string[] = [];
  blocks.push(`PROGRAM
  Name:     ${input.programNameEn}
  Level:    ${input.programLevel}
  Faculty:  ${input.facultyNameEn}`);

  if (input.readiness === 'thin') {
    blocks.push(
      `THINNESS WARNING: this roster has only ${input.stats.totalDistinct} distinct papers in the last 10 years — below the ${THIN_PAPER_THRESHOLD}-paper analysis threshold. Report themes ONLY where the visible titles genuinely support a cluster; a roster this size may not support more than 1-2 themes, and that is the correct, honest output. Do not pad the theme count or inflate confidence to compensate for sparse evidence.`,
    );
  }

  const paperLines = input.topPapers
    .map(
      (p) =>
        `  ${p.year} · ${fmtQuartile(p.quartile)} · ${p.citations} citations · ${p.venue ?? 'venue not recorded'} · ${p.title}`,
    )
    .join('\n');
  blocks.push(
    `TOP PAPERS (${input.topPapers.length} shown, ranked by a recency×citations×quartile score; ${input.stats.notShownCount} further papers not shown — see PUBLICATION STATS for the full-roster picture)\n${paperLines || '  (none)'}`,
  );

  const papersPerYearStr =
    input.stats.papersPerYear.length > 0
      ? input.stats.papersPerYear.map((y) => `${y.year}:${y.count}`).join(', ')
      : 'no data';
  const topVenuesStr =
    input.stats.topVenues.length > 0
      ? input.stats.topVenues.map((v) => `${v.venue} (${v.count})`).join(', ')
      : 'no data';
  blocks.push(`PUBLICATION STATS
  Roster size:                 ${input.stats.rosterSize} members
  Total distinct papers (10y): ${input.stats.totalDistinct}
  Papers shown above:          ${input.topPapers.length} (${input.stats.notShownCount} not shown)
  Papers per year:              ${papersPerYearStr}
  Top venues:                   ${topVenuesStr}
  Quartile mix:                 Q1 ${input.stats.quartileMix.q1} · Q2 ${input.stats.quartileMix.q2} · Q3/Q4 ${input.stats.quartileMix.q3plus} · not assessed ${input.stats.quartileMix.unassessed}`);

  const user = `${blocks.join('\n\n')}

Analyse this roster's demonstrated research expertise now. Return JSON exactly as specified above.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - PROGRAM            — programNameEn, programLevel, facultyNameEn
//     (identity only; always present).
//   - TOP PAPERS          — input.topPapers: deduped, scored, ranked
//     publications (title, venue, year, citations, quartile) from
//     @kku/db's assembleResearchExpertiseInput() — the roster's
//     ResearchOutput rows for the last 10 years, capped at the top 150 by
//     score. NO abstracts, methods, or findings text — titles + venues
//     only, hence the titles-only grounding rule above.
//   - PUBLICATION STATS   — input.stats: papersPerYear, topVenues (≤15),
//     quartileMix, totalDistinct, rosterSize, notShownCount — a
//     deterministic, code-computed summary of the FULL deduped roster
//     output (not just the visible top-150), so the model's trend and
//     paperCount claims can be checked against numbers it did not itself
//     produce.
//   - readiness           — 'ok' | 'thin' | 'no-roster', drives the
//     in-prompt thinness warning; 'no-roster' is never actually sent to
//     the model (the runner skips generation entirely for that verdict).
//
// Deliberately omitted, with reason:
//   - Abstracts — not stored in ResearchOutput (title/venue/citations/
//     quartile only); wiring an abstract-enrichment connector is a
//     recorded future upgrade (design spec's "Deferred" section), not
//     something this prompt can pretend to have today.
//   - Teaching evaluations / pedagogy assessment — a different question
//     (curriculum delivery quality, not demonstrated research expertise);
//     lives in its own ProgramPedagogyAssessment / deep-dive section.
//   - AI peer review (ProgramPeerReview) — a separate deep-dive section
//     with its own methodology and its own claims about curriculum
//     content; mixing it in here would blur which section is the source
//     of a given claim. A future narrative version MAY cite this prompt's
//     themes as a channel (recorded as a future upgrade, not wired now).
//   - Individual faculty member identities — this prompt reports at the
//     THEME level (what the roster collectively demonstrates), not a
//     per-person breakdown; the roster-provenance caveat covers the
//     roster-quality dependency without naming individuals.
// ─────────────────────────────────────────────────────────────────────────────
