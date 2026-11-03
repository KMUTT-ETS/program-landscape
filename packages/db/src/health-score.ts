import { Prisma } from '@prisma/client';
import type { SfrBand } from '@prisma/client';
import { z } from 'zod';
import { getInstitution, intakeComplianceFor, intakeFloors } from '@kku/shared';
import type { IntakeCompliance } from '@kku/shared';
import type { ScopeLevel } from './scope';
import { prisma } from './index';
import { queryMetricByScope, type MetricRow } from './scope';
import { realDataWhere, realDataSql } from './data-quality';
import { programFunnelYears, scopeFunnelLatestYear } from './program-funnel';
import { JOBTHAI_MIN_LINK_SCORE, JOBTHAI_MIN_POSTINGS_FOR_SIGNAL, JOBTHAI_MIN_RELEVANT_SKILLS } from './jobthai-bridge';
import { programJobThaiSkillCoverage } from './jobthai';
import { DEMAND_SOURCE_LINKEDIN, demandMatchSourceWhere } from './demand-match-sources';
import { NATIONAL_REGION, projectionRegionForInstitution } from './projection-region';
import { getAcademicYearContext } from './academic-year';
import { GRANT_AWARD_LABEL, grantAward, withAward } from './grant-award';
import { pickFinancialYear } from './financial-year';
import {
  dqCompetencyByScope,
  dqDriverScore,
  DQ_BAND_CEILING,
  DQ_BAND_FLOOR,
  DQ_BAND_PASS,
  DQ_ELIGIBLE_LEVEL,
} from './student-dq';

/** Annual tuition revenue target by program level (THB). Used by the
 *  health-score.v3.5 financial-dimension `revenue_scale` driver AND by
 *  lifecycle.v1.4's `revenue_scale` driver. Reflects KKU's actual
 *  revenue distribution as of 2026 — re-calibrate if the underlying
 *  tuition/cohort economics shift materially.
 *
 *  Lives here (not in program-deep-dive.ts) because program-deep-dive
 *  imports from health-score; defining it the other way around would
 *  create a circular dependency. */
export const REVENUE_TARGET_THB_BY_LEVEL: Record<
  'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
  number
> = {
  BACHELOR: 8_000_000,
  MASTER: 2_000_000,
  DOCTORAL: 2_000_000,
  HIGHER_GRAD_DIPLOMA: 2_000_000,
};

/** Universal "flagship" threshold in THB/year — the gate that decides
 *  whether a program is revenue-substantial enough to claim FRONTIER.
 *  Level-INDEPENDENT by design: FRONTIER is strategic, not academic, so
 *  a 2M-THB boutique PhD doesn't earn the verdict even if it's "good
 *  for a PhD." Below this threshold, lifecycle.v1.4 caps FRONTIER to
 *  RISING via `lowRevenuePotentialFrontierCap`.
 *
 *  Calibration: 3M ≈ 30 bachelor students × 100k THB tuition, or
 *  20 master students × 150k, or 20 PhD students × 150k. Reflects the
 *  smallest cohort that can plausibly carry "flagship" institutional
 *  weight given the non-degree HRD shift squeezing post-grad programs. */
export const FLAGSHIP_REVENUE_FLOOR_THB = 3_000_000;

// Health scores for the Portfolio Overview Cockpit + Deep-Dive radar.
// Five dimensions + overall composite. Scores 0-100 where 100 is healthy.
//
// Methodology: see docs/methodologies/health-score.md. Edit that first
// when changing the formula, then bump HEALTH_SCORE_VERSION here, then
// change the logic.
//
// Null handling rule: missing metrics are EXCLUDED from the average
// (not substituted with 0 or 50). dataCompletenessPct on every score
// tells the reader how much data actually went into it.

// v3.0 (2026-05-02) — full redesign. Five dimensions, all backed by
// real data after the 2026-04-27 → 2026-05-02 connector flips:
//
//   * attractiveness  — TCAS-anchored: competition vs peers, fill rate,
//                       enrollment trend
//   * financial       — net contribution per student, revenue coverage,
//                       tuition trend
//   * capability      — senior-rank share, publications per faculty,
//                       retirement horizon (was placeholder in v2)
//   * outcomes        — TCAS percentile + alumni outcomes (kku-alumni
//                       still pending; TCAS percentile lights it up)
//   * relevance       — labour-market alignment, demand-match filled,
//                       demographic resilience, strategic sector
//                       alignment (was placeholder in v2)
//
// v2 / v2.1 driver `labor_market_alignment_kmitl` (LinkedIn via MHESI,
// 4-quadrant fallback) is preserved under `relevance`. v1 / v2 / v2.1
// rows retained for audit; new rows stamp v3.0.
// v3.5 (2026-05-12) adds the `revenue_scale` driver to the financial
// dimension: level-aware absolute revenue scaled 0-100 against the
// per-level target. Captures "is this program revenue-substantial for
// its level" — complements the existing per-student / coverage / trend
// drivers (which are all ratios). Lifecycle.v1.4 uses the same
// signal as a first-class lifecycle driver + flagship-floor gate.
//
// v3.6 (2026-05-12) adds the `pedagogical_fit` driver to the relevance
// dimension, sourced from ProgramPedagogyAssessment.overallScore (the
// new `program-pedagogy.v1` extractor). Captures "does this program
// teach in ways the discipline actually demands" — medical programs
// without PBL drop, engineering without project-based+internship
// drops, humanities without seminar/practicum drops. Null-safe when
// the pedagogy assessment hasn't run yet.
// v3.7 (2026-05-19) — outcomes dimension gains `student_satisfaction`
// driver, sourced from POWERBI.EVALUATE_INSTRUCTOR via the new
// `kku-evaluations` connector (`evaluation_response_summaries`).
// Aggregates the program's courses' weighted-mean rating across
// main terms (semester 1+2) all observed years, normalised
// 3.5→0..5.0→100 on the 1-5 likert scale (anchored linear, captures
// the ceiling-biased distribution from kku-evaluations.v1 §"Score
// scale"). Null when the program teaches no courses surveyed in
// window (rare — most active programs have hundreds of cells).
// v3.9 (2026-08-16) — financial dimension scores on the last COMPLETE
// academic year, never the one still being billed. `FinancialMetric.
// fiscalYear` holds an academic year (Jun–May) whose tuition is billed
// across TWO fiscal-year cycles — the in-progress year therefore only
// ever has semester 1 billed (median ~44-47% of the prior year), no
// matter how healthy the program is. The old 30%-ratio-only guard let
// most of those through. Head selection (`net_contribution_per_student`,
// `revenue_coverage_program_direct`, `revenue_scale`) now goes through
// `pickFinancialYear()`; `tuition_trend_slope` excludes the in-progress
// year from its series before the (retained, secondary) ratio guard
// runs. See `packages/db/src/financial-year.ts` and
// `docs/methodologies/health-score.md` §v3.9 for the full reasoning and
// the measured before/after impact. Enrolment-based drivers
// (`enrollment_trend_slope`, `kku_intake_policy`) are unaffected —
// recruitment for an academic year finishes at its START, a different
// calendar question from tuition completeness.
//
// v4.0 (2026-08-25) — the Outcomes dimension gains
// `dq_digital_competency`, the respondent-weighted mean over DQ theory
// modules 1-12, banded on KKU's pass mark (≤50 → 0, 70 → 50, ≥90 →
// 100). Bachelor programmes with ≥5 scored students only; every other
// programme gets null, which the dimension excludes from its mean — so
// the 199 non-bachelor programmes are untouched. Module 13 is out
// because its uptake runs 48.7%-96.7% by faculty and including it would
// score programmes on how far the rollout reached them. See
// `dqCompetencyDriver` below, `packages/db/src/student-dq.ts` for the
// band and the eligibility gates, and
// `docs/methodologies/health-score.md` §v4.0 for the reasoning and the
// measured drift across all 301 programmes.
//
// v5.0 (2026-09-12) — SCOPE DRIVER PARITY. The faculty/department/
// university scorers had drifted 2-4 drivers behind the program scorers
// since v3.0: relevance hardcoded two drivers to null and never
// implemented a third, financial ran on two drivers the program scorer
// does not have and none of the four it does, attractiveness kept only
// its three aggregate TCAS ratios, outcomes dropped job relevance,
// further study and the TCAS percentile. Measured 2026-09-12, every one
// of 24 faculties scored BELOW its program mean — 11.6 pts on average,
// 28.5 at worst — with relevance alone at -56.4. Capability, the only
// dimension already at parity, was also the only one that agreed (+0.4).
//
// Drivers whose calibration is per-program (absolute THB/yr slopes,
// per-level revenue targets, intake floors, peer-subject percentiles)
// now roll up as the mean of their program values; drivers whose scale
// is scope-invariant stay ratio-of-sums, which weights by program size.
// dataCompletenessPct now counts drivers a scorer never built, so the
// three dimensions that reported 100% while missing half their inputs
// report honestly. Composites above program scope MOVE. See
// `docs/methodologies/health-score.md` and
// `docs/superpowers/plans/2026-09-12-health-score-scope-driver-parity.md`.
// JOBTHAI_MIN_LINK_SCORE moved to jobthai-bridge.ts in v5.2 so the health
// driver and the Deep-Dive Skills coverage section apply one rule.

//
// v5.1 (2026-09-13) — the Relevance dimension gains
// `jobthai_demand_alignment`: the share of a programme's taught skills that
// its linked JobThai occupations demand. The direct analogue of
// `labour_market_alignment`, which reads the LinkedIn-via-MHESI feed, so the
// two are comparable and can visibly disagree.
//
// Source caveats, which travel with every figure derived from it: 37.0% of the
// 47,631 postings are Bangkok and 3.3% the 20 Northeast provinces (Khon Kaen
// 304), so this is a national signal rather than a regional one; there is no
// salary, employer or posting date in the source.
//
// NULL, NEVER 0, where the data cannot speak — and for postgraduate programmes
// that is the normal case rather than an edge case. Only 41 of 47,631 postings
// state a postgraduate qualification as their minimum, so the bridge leaves
// almost every master's and doctoral programme without an eligible link. 82% of
// doctoral programmes DO match a field of study, but on bachelor-level adverts;
// scoring a PhD from undergraduate vacancies would have looked entirely healthy
// and been wrong.
//
// Thresholds are measured, not assumed: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL = 20
// (the observed 25th percentile), MIN_SKILL_OVERLAP_SHARE = 0.5,
// MAX_PROGRAMMES_PER_FIELD = 15. See packages/db/src/jobthai-bridge.ts.
//
// v5.2 (2026-09-13) — two corrections to the JobThai signal and one weighting.
//
//   1. The programme links were wrong (jobthai-bridge.v2). The skill-overlap
//      path intersected taught skills with every skill ONE posting named, and
//      transferable skills carried it: Doctor of Medicine linked to Sales/AE on
//      Communication, Critical thinking, Teamwork and Professional ethics.
//      Overlap-only links carried 120,251 of 132,902 postings. The
//      field-of-study score also changed from matched-fields/distinct-fields
//      (Mechanical Eng -> mechanical engineer 0.04) to a posting share (0.57).
//   2. The driver was circular. A skill-overlap link exists exactly when the
//      programme's taught skills are demanded, so every overlap-linked
//      programme scored >= 50 by construction; 37 of the 64 scored under v5.1
//      took at least 80% of their postings from such links. The driver now
//      reads only field-of-study and corroborated links, counts a skill as
//      demanded at a 5% posting share, leaves out skills most occupations
//      demand, and takes taught / relevant from the AI curriculum check
//      (program_demand_matches rows tagged 'jobthai') — the same instrument as
//      demand_match_filled. Exact skill-ID overlap read 0 for 29 of 41
//      programmes: curricula say "Legal Drafting", postings "Litigation".
//   3. Labour-market demand is weighted DOMESTIC 75 : GLOBAL 25. JobThai is the
//      domestic signal, LinkedIn-via-MHESI the global one (Council direction,
//      2026-09-13). The pair keeps its weight of two drivers in the Relevance
//      mean and only the split inside it changes; when one source is null the
//      other counts as a single driver. See LABOUR_MARKET_DEMAND_WEIGHTS.
//
// v5.3 (2026-10-02) — capability gains external_grant_engagement: the share
//   of a programme's active teaching staff on at least one externally funded
//   project (research_service_project_members) in the last 3 complete Thai
//   fiscal years, 60% -> 100. Null, never 0, until the kku-research-services
//   sync has 30 days of green history. Built by grantEngagementDriver at
//   both program and scope (that module was removed in v5.4).
//
// v5.4 (2026-10-03) — external grants move from Capability to an AWARD on
//   Financial. The external_grant_engagement driver and its 30-day gate are
//   removed (Capability is back to four drivers at 25 %). Financial gains up
//   to +10 points AFTER its drivers are averaged: grant baht per active
//   teaching staff member per year, last 3 complete Thai FY, log curve
//   ฿0.1 M → 0 to ฿3 M → +10 (packages/db/src/grant-award.ts). Never lowers
//   a score, never touches completeness, null base earns nothing.
//
// v5.5 (2026-11-03) — the demographic-resilience driver reads the
//   institution's region from the organisation profile (regionEn, matched
//   against the regions the projection carries; no match or no profile ->
//   the driver is null, never the national series) instead of a hard-coded
//   'Northeast'. The student:staff-ratio band comes from the faculty's
//   Teaching Mode (Faculty.sfrBand; default Professional) instead of a
//   hard-coded faculty-code map; KKU's bands were backfilled by migration,
//   so its scores are unchanged.
export const HEALTH_SCORE_VERSION = 'health-score.v5.5';

// ── Cost-allocation methodology (gap #5) ────────────────────────────
// The Financial dimension's `net_contribution_per_student` +
// `revenue_coverage_program_direct` drivers depend on
// `FinancialMetric.{directCost, allocatedFacultyCost, allocatedFacilityCost,
// allocatedOverhead}`. The methodology that computes those values
// (activity-based allocation across faculty/facility/overhead pools) is
// documented at docs/methodologies/cost-allocation.md and is **v0
// draft — pending Finance Committee approval**.
//
// Surface this prominently. The methodology-bundle (see
// packages/db/src/methodology-bundle.ts) marks `cost-allocation` as a
// preview methodology so Council-facing PDFs render a PREVIEW badge in
// the methodology appendix. When v1 lands, bump the constant + remove
// from PREVIEW_METHODOLOGIES.
export const COST_ALLOCATION_VERSION = 'cost-allocation.v0';

// ── Intake-floor policy ─────────────────────────────────────────────
// Council policy: every programme must hit a minimum new-intake floor each
// academic year. Failing the floor is a structural risk signal — strict for
// undergraduate (closure-track), watch-list for postgraduate (where a small
// cohort is structurally normal).
//
// The floors themselves are NOT here any more. They were `30` and `8`,
// written in this file and copied into risk-scoring.ts, which judged every
// adopting institution by one university's rule and gave two constants the
// freedom to drift apart. They now sit on the organisation profile and are
// read through @kku/shared's intake-policy module, which is also where the
// curves live. An installation with no profile configured yields no floors,
// and the driver below reads null rather than guessing.
//
// Compliance state surfaces in the attractiveness driver's `raw.compliance`
// field and feeds the lifecycle verdict.
export type { IntakeCompliance } from '@kku/shared';

/** Standalone helper for surface-layer code (deep-dive header, dashboard,
 *  cockpit). Returns the canonical compliance state for any program given
 *  its level + latest intake. Wraps `intakeComplianceFor` so callers
 *  don't need to import the internal scoring math. */
export function getKkuIntakePolicyVerdict(
  level: string,
  latestIntake: number | null,
): { state: IntakeCompliance; floor: number } {
  const v = intakeComplianceFor(level, latestIntake, intakeFloors());
  return { state: v.state, floor: v.floor };
}

export const HEALTH_DIMENSIONS = [
  'attractiveness',
  'financial',
  'capability',
  'outcomes',
  'relevance',
] as const;
export type HealthDimension = (typeof HEALTH_DIMENSIONS)[number];

// ──────────────────────────────────────────────────────────────────────────
// Canonical driver registry (v5.0)
//
// The authoritative list of drivers each dimension can carry, at ANY
// scope. `summariseDrivers` pads canonical labels a scorer did not
// construct with an explicit null entry and counts them against
// dataCompletenessPct.
//
// WHY THIS EXISTS: before v5.0 completeness was nonNull/constructed, so a
// scorer that simply never built a driver reported 100% complete while
// missing half its inputs. The faculty-scope scorers had drifted 2-4
// drivers behind the program scorers since v3.0 and nothing surfaced it.
// A driver added here but forgotten in a scorer now shows up as a
// completeness drop instead of vanishing silently.
//
// Adding a driver: add the label here AND to every scorer for that
// dimension (program + scope), or pass it in `omittedLabels` where it
// genuinely cannot apply.
/**
 * `raw` marker on a driver that `summariseDrivers` PADDED because the
 * scorer for this scope never constructed it. Distinct from a computed
 * driver that found no data (value null, raw carries the evidence):
 * this one means the code path does not exist at this scope.
 *
 * The parity guard asserts no canonical driver carries it. Without a
 * marker the guard is unfalsifiable — padding puts every canonical label
 * in the list, so a label-presence assertion passes forever.
 */
export const DRIVER_NOT_COMPUTED = { notComputedAtThisScope: true } as const;

export const DIMENSION_DRIVERS = {
  attractiveness: [
    'tcas_competition_ratio',
    'tcas_fill_rate',
    'tcas_registration_yield',
    'tcas_competition_vs_peers',
    'enrollment_trend_slope',
    'kku_intake_policy',
  ],
  financial: [
    'net_contribution_per_student',
    'revenue_coverage_program_direct',
    'revenue_coverage_ratio',
    'net_contribution_per_program',
    'tuition_trend_slope',
    'revenue_scale',
  ],
  capability: [
    'senior_rank_share',
    'publications_per_faculty',
    'retirement_horizon_5y',
    'student_faculty_ratio',
  ],
  outcomes: [
    'tcas_min_score_percentile',
    'employment_rate',
    'job_relevance',
    'average_salary',
    'further_study_rate',
    'student_satisfaction',
    'dq_digital_competency',
  ],
  relevance: [
    'labour_market_alignment',
    'demand_match_filled',
    'demographic_resilience',
    'strategic_sector_alignment',
    'pedagogical_fit',
    'jobthai_demand_alignment',
  ],
} as const satisfies Record<HealthDimension, readonly string[]>;

export const HealthScoreSchema = z.object({
  // null when every underlying metric was null — never 0.
  score: z.number().min(0).max(100).nullable(),
  dataCompletenessPct: z.number().min(0).max(100),
  // Subscores per underlying metric (for the hover tooltip — "here's
  // what's driving this dimension").
  drivers: z.array(
    z.object({
      label: z.string(),
      value: z.number().min(0).max(100).nullable(),
      raw: z.unknown(),
    }),
  ),
  // v5.4: Financial only — the external-grant award added after the drivers
  // are averaged. Optional so stored snapshots from earlier versions parse.
  award: z
    .object({
      label: z.literal(GRANT_AWARD_LABEL),
      points: z.number().min(0).max(10).nullable(),
      baseScore: z.number().min(0).max(100).nullable(),
      raw: z.unknown(),
    })
    .nullable()
    .optional(),
});
export type HealthScore = z.infer<typeof HealthScoreSchema>;

export const HealthDimensionScoresSchema = z.object({
  attractiveness: HealthScoreSchema,
  financial: HealthScoreSchema,
  capability: HealthScoreSchema,
  outcomes: HealthScoreSchema,
  relevance: HealthScoreSchema,
});
export type HealthDimensionScores = z.infer<typeof HealthDimensionScoresSchema>;

export const HealthScoreRowSchema = z.object({
  scope: z.string(),
  scopeId: z.string(),
  scopeLabel: z.string(),     // legacy "EN · TH" — kept for AI prompt + log paths
  scopeLabelTh: z.string(),   // Thai-primary, used by UI two-line cells
  scopeLabelEn: z.string(),   // English secondary
  parentScopeId: z.string().nullable(),
  methodologyVersion: z.string(),
  dimensions: HealthDimensionScoresSchema,
  overall: HealthScoreSchema,
  latestFreshness: z.date().nullable(),
});
export type HealthScoreRow = z.infer<typeof HealthScoreRowSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────

export async function computeHealthScores(
  scope: ScopeLevel,
  scopeId: string | null,
): Promise<HealthScoreRow[]> {
  // resolveChildren returns the EFFECTIVE child scope — usually the
  // natural child (faculty → department → program) but can collapse
  // a level when the org tree is incomplete (e.g., faculties whose
  // canonical programs all have departmentId=NULL skip the department
  // tier and return programs directly).
  const { scope: childScope, nodes: children } = await resolveChildren(scope, scopeId);

  // Pre-compute KMITL alignment for every program in one pass — used
  // by the relevance dimension. Empty map when the LinkedIn-via-MHESI
  // dataset has no rows yet → driver returns null per scope.
  const programAlignment = await computeKmitlProgramAlignment();

  const rows: HealthScoreRow[] = [];
  for (const child of children) {
    const enrollment = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'enrollment',
    });
    const financialsAgg = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'financial',
    });
    const outcomes = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'outcomes',
    });

    // Program-scope reads raw rows directly so the scorers can apply
    // partial-year heuristics + use program-internal fields the MV
    // doesn't expose. Faculty/dept/uni scopes still use the MV.
    const isProgram = childScope === 'program';

    // Pick the latest year that ACTUALLY has data for this family,
    // not just the latest year in the MV's union-of-years column. The
    // MV creates a row per (scope × year) for every distinct year
    // across enrollment ∪ financial ∪ outcomes; the freshest family
    // pulls forward the year axis, leaving NULL columns for the lagging
    // families. Without this filter, the LAGGING family (typically
    // outcomes — the survey runs ~6mo after the academic year) reads
    // null because its row at the latest universe-wide year is empty.
    // (Attractiveness pulls TCAS directly per scope — see
    // scoreAttractivenessScope — so we don't pre-pick an enrolment row
    // for it. Financial / outcomes still pivot on the latest year that
    // actually has data for that family.)
    const latestFinancial = latestWith(financialsAgg, (r) => r.netContributionTotal !== null);
    const latestOutcomes = latestWith(outcomes, (r) => r.employmentRateWeighted !== null);

    const attractiveness = isProgram
      ? await scoreAttractivenessProgram(child.id)
      : await scoreAttractivenessScope(childScope, child.id);
    const financial = isProgram
      ? await scoreFinancialProgram(child.id, enrollment)
      : await scoreFinancialScope(latestFinancial, childScope, child.id, enrollment);
    const capability = isProgram
      ? await scoreCapabilityProgram(child.id)
      : await scoreCapabilityScope(child.id, childScope);
    const outcomesScore = isProgram
      ? await scoreOutcomesProgram(child.id, latestOutcomes)
      : await scoreOutcomesScope(childScope, child.id, latestOutcomes);
    const relevance = isProgram
      ? await scoreRelevanceProgram(child.id, programAlignment.get(child.id) ?? null)
      : await scoreRelevanceScope(child.id, childScope, programAlignment);

    const dimensions: HealthScoreRow['dimensions'] = {
      attractiveness,
      financial,
      capability,
      outcomes: outcomesScore,
      relevance,
    };
    rows.push({
      scope: childScope,
      scopeId: child.id,
      scopeLabel: child.label,
      scopeLabelTh: child.labelTh,
      scopeLabelEn: child.labelEn,
      parentScopeId: child.parentId,
      methodologyVersion: HEALTH_SCORE_VERSION,
      dimensions,
      overall: combineDimensions(Object.values(dimensions)),
      latestFreshness:
        enrollment.at(-1)?.latestFreshness ??
        financialsAgg.at(-1)?.latestFreshness ??
        outcomes.at(-1)?.latestFreshness ??
        null,
    });
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// Program-level dimension averages (radar benchmarks)
//
// The deep-dive Health radar overlays a University average and a Faculty
// average against the program's own scores. These are the MEAN of the
// PROGRAM-LEVEL dimension scores (not the faculty/university rollup
// composite) — i.e. score every program at program scope, then average
// each dimension. Null dimensions are EXCLUDED from the mean (null = "no
// data", never 0 — same rule the scorers use).
//
// The values are identical regardless of which program is open, so the
// whole computation is memoised per-process with a 5-minute TTL. Cold
// computation fans out computeHealthScores('program', id) over every
// program in bounded-concurrency chunks (mirrors the cockpit heatmap's
// per-program fan-out; the expensive KMITL alignment scan inside is
// already memoised so it runs once, not once-per-program).
// ──────────────────────────────────────────────────────────────────────────

export interface ProgramDimensionMeans {
  attractiveness: number | null;
  financial: number | null;
  capability: number | null;
  outcomes: number | null;
  relevance: number | null;
  /** Programs that contributed ≥1 non-null dimension to these means. */
  sampleSize: number;
}

export interface ProgramDimensionAverages {
  methodologyVersion: string;
  programCount: number;
  university: ProgramDimensionMeans;
  /** Keyed by facultyId. */
  byFaculty: Record<string, ProgramDimensionMeans>;
}

interface DimAcc {
  attractiveness: { sum: number; n: number };
  financial: { sum: number; n: number };
  capability: { sum: number; n: number };
  outcomes: { sum: number; n: number };
  relevance: { sum: number; n: number };
  programs: number;
}

const PROGRAM_AVG_CONCURRENCY = 12;
// 30-minute TTL: the portfolio-wide dimension means shift only when the
// underlying health data refreshes (weekly-ish), so a long window keeps
// the cold-miss fan-out (one score per program) rare — only the first
// deep-dive view per window pays it; the rest are a map lookup.
const PROGRAM_AVG_TTL_MS = 30 * 60_000;
let _programAvgCache: { at: number; data: ProgramDimensionAverages } | null = null;

export async function computeProgramDimensionAverages(): Promise<ProgramDimensionAverages> {
  const now = Date.now();
  if (_programAvgCache && now - _programAvgCache.at < PROGRAM_AVG_TTL_MS) {
    return _programAvgCache.data;
  }
  const data = await _computeProgramDimensionAveragesImpl();
  _programAvgCache = { at: now, data };
  return data;
}

function freshAcc(): DimAcc {
  return {
    attractiveness: { sum: 0, n: 0 },
    financial: { sum: 0, n: 0 },
    capability: { sum: 0, n: 0 },
    outcomes: { sum: 0, n: 0 },
    relevance: { sum: 0, n: 0 },
    programs: 0,
  };
}

function accAdd(acc: DimAcc, dims: HealthScoreRow['dimensions']): boolean {
  let contributed = false;
  for (const d of HEALTH_DIMENSIONS) {
    const s = dims[d].score;
    if (s === null) continue;
    acc[d].sum += s;
    acc[d].n += 1;
    contributed = true;
  }
  if (contributed) acc.programs += 1;
  return contributed;
}

function accMeans(acc: DimAcc): ProgramDimensionMeans {
  const m = (x: { sum: number; n: number }) => (x.n > 0 ? x.sum / x.n : null);
  return {
    attractiveness: m(acc.attractiveness),
    financial: m(acc.financial),
    capability: m(acc.capability),
    outcomes: m(acc.outcomes),
    relevance: m(acc.relevance),
    sampleSize: acc.programs,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Program-score index (v5.0)
//
// One fan-out, two consumers: the deep-dive radar's dimension averages
// and the scope scorers' driver rollups. Built over canonical+ACTIVE
// programs only — the same population resolveChildren lists under a
// faculty, so a faculty score rolls up exactly the programs shown
// beneath it.
//
// MUST NOT be called from the program branch of computeHealthScores —
// the index is built BY that branch, and calling it from there would
// recurse forever.
export interface ProgramScoreIndexEntry {
  programId: string;
  facultyId: string | null;
  dimensions: HealthScoreRow['dimensions'];
  /** Overall composite, null when every dimension was null. */
  overall: number | null;
}
export type ProgramScoreIndex = Map<string, ProgramScoreIndexEntry>;

let _programIndexCache: { at: number; index: ProgramScoreIndex } | null = null;

/** Every ACTIVE programme's health, memoised for PROGRAM_AVG_TTL_MS. Exported
 *  for the gap map, which needs one number per programme without 297 calls. */
export async function getProgramScoreIndex(): Promise<ProgramScoreIndex> {
  const now = Date.now();
  if (_programIndexCache && now - _programIndexCache.at < PROGRAM_AVG_TTL_MS) {
    return _programIndexCache.index;
  }
  const programs = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, facultyId: true },
  });
  const index: ProgramScoreIndex = new Map();
  for (let i = 0; i < programs.length; i += PROGRAM_AVG_CONCURRENCY) {
    const slice = programs.slice(i, i + PROGRAM_AVG_CONCURRENCY);
    const scored = await Promise.all(
      slice.map((p) =>
        computeHealthScores('program', p.id)
          .then((rows) => ({ p, row: rows[0] ?? null }))
          .catch(() => ({ p, row: null as HealthScoreRow | null })),
      ),
    );
    for (const { p, row } of scored) {
      if (!row) continue;
      index.set(p.id, { programId: p.id, facultyId: p.facultyId, dimensions: row.dimensions, overall: row.overall.score });
    }
  }
  _programIndexCache = { at: now, index };
  return index;
}

/**
 * Drop the memoised index. MUST be called in test `beforeEach` — the memo
 * is per-process, so without this a later test reads the program set a
 * previous test mocked, and the failure looks like a scorer bug.
 */
export function invalidateProgramScoreIndexCache(): void {
  _programIndexCache = null;
  _programAvgCache = null;
}

// Mean of the non-null program-level values of one driver across a
// program set. Null (never 0) when no program carries it — a data gap is
// not a bad score, the same rule every scorer uses.
function rolledUpDriver(
  index: ProgramScoreIndex,
  programIds: readonly string[],
  dimension: HealthDimension,
  label: string,
): HealthScore['drivers'][number] {
  const values: number[] = [];
  for (const id of programIds) {
    const entry = index.get(id);
    if (!entry) continue;
    const v = entry.dimensions[dimension].drivers.find((d) => d.label === label)?.value;
    if (v !== null && v !== undefined) values.push(v);
  }
  const value = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    label,
    value: value === null ? null : clamp(value),
    raw: { rolledUp: true, fromPrograms: values.length, ofPrograms: programIds.length },
  };
}

/** Test-only seam. */
export const rolledUpDriverForTest = rolledUpDriver;

async function _computeProgramDimensionAveragesImpl(): Promise<ProgramDimensionAverages> {
  const index = await getProgramScoreIndex();
  const uni = freshAcc();
  const byFaculty = new Map<string, DimAcc>();
  for (const entry of index.values()) {
    accAdd(uni, entry.dimensions);
    if (entry.facultyId) {
      const facAcc = byFaculty.get(entry.facultyId) ?? freshAcc();
      accAdd(facAcc, entry.dimensions);
      byFaculty.set(entry.facultyId, facAcc);
    }
  }
  return {
    methodologyVersion: HEALTH_SCORE_VERSION,
    programCount: index.size,
    university: accMeans(uni),
    byFaculty: Object.fromEntries(
      [...byFaculty.entries()].map(([fid, acc]) => [fid, accMeans(acc)]),
    ),
  };
}

// Pick the most recent year-row in a metric series that actually
// satisfies `predicate`. Falls back to null when no row qualifies.
// MV rows are ordered ASC by year, so we walk backwards from the tail.
function latestWith<T>(rows: T[], predicate: (r: T) => boolean): T | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (predicate(r)) return r;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Child resolution
// ──────────────────────────────────────────────────────────────────────────


interface ChildNode {
  id: string;
  label: string; // legacy single-line "EN · TH" form, retained for any
                 //  surface that renders one string (logs, AI prompts).
  labelTh: string;
  labelEn: string;
  parentId: string | null;
}

interface ChildResolution {
  /** Effective scope of the returned nodes — usually the natural child
   *  scope (university → faculty → department → program), but may
   *  collapse one level when an intermediate org tier is empty. */
  scope: ScopeLevel;
  nodes: ChildNode[];
}

async function resolveChildren(scope: ScopeLevel, scopeId: string | null): Promise<ChildResolution> {
  if (scope === 'university') {
    // Curriculum landscape = academic faculties that host at least one
    // canonical-297 program. Excludes:
    //   - non-academic units (kind != ACADEMIC: ADMIN / RESEARCH_CENTER /
    //     INSTITUTE) — they hold staff but no curriculum
    //   - academic faculties with zero canonical programs — cockpit
    //     can't compute meaningful health scores for them anyway
    const rows = await prisma.faculty.findMany({
      where: {
        kind: 'ACADEMIC',
        programs: {
          some: {
            status: 'ACTIVE',
            sequenceNoFromSheet: { not: null },
          },
        },
      },
      select: { id: true, nameEn: true, nameTh: true },
      // Thai-dictionary order. Postgres en_US.utf8 honours libc's Thai
      // collation rules including leading-vowel reorder — verified
      // against the canonical 26 academic faculties on 2026-05-07.
      orderBy: { nameTh: 'asc' },
    });
    return {
      scope: 'faculty',
      nodes: rows.map((r) => ({
        id: r.id,
        label: `${r.nameEn} · ${r.nameTh}`,
        labelTh: r.nameTh ?? '',
        labelEn: r.nameEn ?? '',
        parentId: null,
      })),
    };
  }
  if (scope === 'faculty') {
    if (!scopeId) return { scope: 'program', nodes: [] };
    // Two-level drill (university → faculty → program) — the
    // department middle tier was removed 2026-05-07. Departments
    // didn't add useful aggregation in many faculties (some had every
    // program with departmentId=NULL anyway, e.g., Engineering's 19/19),
    // and the extra click without much information confused users.
    // The department scope still works if hit by direct URL (the
    // 'department' branch below stays intact), but the cockpit no
    // longer auto-navigates through it.
    const progRows = await prisma.program.findMany({
      where: {
        facultyId: scopeId,
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
      },
      select: { id: true, nameEn: true, nameTh: true, facultyId: true },
      orderBy: { code: 'asc' },
    });
    return {
      scope: 'program',
      nodes: progRows.map((r) => ({
        id: r.id,
        label: `${r.nameEn} · ${r.nameTh}`,
        labelTh: r.nameTh ?? '',
        labelEn: r.nameEn ?? '',
        parentId: r.facultyId,
      })),
    };
  }
  if (scope === 'department') {
    if (!scopeId) return { scope: 'program', nodes: [] };
    const rows = await prisma.program.findMany({
      where: {
        departmentId: scopeId,
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
      },
      select: { id: true, nameEn: true, nameTh: true, departmentId: true },
      orderBy: { code: 'asc' },
    });
    return {
      scope: 'program',
      nodes: rows.map((r) => ({
        id: r.id,
        label: `${r.nameEn} · ${r.nameTh}`,
        labelTh: r.nameTh ?? '',
        labelEn: r.nameEn ?? '',
        parentId: r.departmentId,
      })),
    };
  }
  if (!scopeId) return { scope: 'program', nodes: [] };
  const row = await prisma.program.findUnique({
    where: { id: scopeId },
    select: { id: true, nameEn: true, nameTh: true, departmentId: true },
  });
  return {
    scope: 'program',
    nodes: row
      ? [{
          id: row.id,
          label: `${row.nameEn} · ${row.nameTh}`,
          labelTh: row.nameTh ?? '',
          labelEn: row.nameEn ?? '',
          parentId: row.departmentId,
        }]
      : [],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Attractiveness — TCAS competition + fill + enrollment trend
// ──────────────────────────────────────────────────────────────────────────

async function scoreAttractivenessProgram(programId: string): Promise<HealthScore> {
  // This installation's council policy. Null when no organisation profile
  // exists, which makes the intake driver read null rather than silently
  // judging the programme by whatever floor happened to be in the source.
  const floors = intakeFloors();

  // Latest COMPLETE year TCAS funnel — sums across rounds 1–4 + any
  // sub-rounds for the program's most recent FINISHED recruitment.
  // POWERBI.ADMISSION_STAT_CURRID gives quota / applicants / passed /
  // Clearinghouse send + confirm / registrar reg_reported.
  //
  // "Complete" = at least one round has reg_reported > 0. The current
  // recruitment year (in-progress) has reg_reported still null/0 across
  // all rounds — including it would make the registration-yield
  // driver score that program at 0% which is misleading. We score
  // against the latest completed cohort instead; the in-progress year
  // stays in the DB as informational data.
  //
  // Four drivers:
  //   - tcas_competition_ratio  (applicants / enrollSeats)
  //   - tcas_fill_rate          (totalPassed / enrollSeats)
  //   - tcas_registration_yield (regReported / sendClearinghouse)
  //   - tcas_competition_vs_peers — KKU's competition ratio vs the
  //     median ratio across other Thai universities running a
  //     comparable subject in TCAS3 (peer rows still live in
  //     TcasAdmissionStat — only KKU rows there were retired).
  //
  // Plus enrollment-trend + KKU intake-floor compliance drivers
  // (unchanged).
  const programRow = await prisma.program.findUnique({
    where: { id: programId },
    select: { level: true, nameTh: true },
  });

  // Latest COMPLETE year — a BE entry year is complete once its academic
  // year has started (the configurable academic-year boundary; see
  // packages/db/src/academic-year.ts). The in-progress current cohort stays
  // in the DB as informational data; scoring uses the latest COMPLETE year.
  // Sourced from ADMISSION_STAT via the funnel adapter (per-year totals,
  // realData-gated, canonical program_id); `isComplete` is set by
  // `programFunnelYears`, which delegates to `entryYearComplete`.
  const funnelYears = await programFunnelYears(programId);
  const latestYearOverall = funnelYears[0]?.entryYearBE ?? null;
  const latestComplete = funnelYears.find((y) => y.isComplete) ?? null;

  let funnelTotals: {
    enrollSeats: number;
    applicants: number;
    passed: number;
    sendCh: number;
    regReported: number;
    rounds: number;
    year: number;
    inProgressYear: number | null;
  } | null = null;
  if (latestComplete !== null) {
    funnelTotals = {
      enrollSeats: latestComplete.enrollSeats,
      applicants: latestComplete.totalApplicants,
      passed: latestComplete.totalPassed,
      sendCh: latestComplete.sendClearinghouse,
      regReported: latestComplete.regReported,
      rounds: latestComplete.rounds,
      year: latestComplete.entryYearBE,
      inProgressYear:
        latestYearOverall !== null && latestYearOverall > latestComplete.entryYearBE
          ? latestYearOverall
          : null,
    };
  }

  // Peer competition ratio for the latest complete year — TCAS3 peer
  // rows in TcasAdmissionStat (KKU's own rows there were retired but
  // ~25,705 peer rows remain). Match by extractSubjectSignature on
  // Program.nameTh (the new funnel doesn't carry programmeName).
  let peerMedianRatio: number | null = null;
  let peerCount = 0;
  if (latestComplete !== null && programRow?.nameTh) {
    const subjectKey = extractSubjectSignature(programRow.nameTh);
    if (subjectKey.length >= 2) {
      const peerRows = await prisma.tcasAdmissionStat.findMany({
        where: {
          entryYearBE: latestComplete.entryYearBE,
          institutionName: { not: getInstitution().nameTh },
          programmeName: { contains: subjectKey, mode: 'insensitive' },
          quota: { gt: 0 },
          ...realDataWhere(),
        },
        select: { quota: true, applicants: true, programmeName: true },
      });
      const peerRatios = peerRows
        .filter((p) => extractSubjectSignature(p.programmeName) === subjectKey)
        .map((p) => p.applicants / p.quota)
        .sort((a, b) => a - b);
      peerCount = peerRatios.length;
      if (peerRatios.length > 0) {
        peerMedianRatio = peerRatios[Math.floor(peerRatios.length / 2)] ?? null;
      }
    }
  }

  // Enrollment series for the trend driver.
  const enrollment = await prisma.enrollmentMetric.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: { academicYear: 'asc' },
    select: { academicYear: true, enrolled: true },
  });

  const drivers = [
    {
      label: 'tcas_competition_ratio',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        const ratio = funnelTotals.applicants / funnelTotals.enrollSeats;
        return ratio >= 10
          ? 100
          : ratio >= 5
            ? 70 + ((ratio - 5) / 5) * 30
            : ratio >= 2
              ? 40 + ((ratio - 2) / 3) * 30
              : ratio >= 1
                ? 20 + (ratio - 1) * 20
                : Math.max(0, ratio * 20);
      })(),
      raw: funnelTotals,
    },
    {
      label: 'tcas_fill_rate',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        // passed/seats ≥ 0.5 → 100, linear below.
        const fill = funnelTotals.passed / funnelTotals.enrollSeats;
        return fill >= 0.5 ? 100 : clamp((fill / 0.5) * 100);
      })(),
      raw: funnelTotals
        ? { passed: funnelTotals.passed, seats: funnelTotals.enrollSeats }
        : null,
    },
    {
      label: 'tcas_registration_yield',
      value: (() => {
        // Yield = reg_reported / send_clearinghouse. Programs that lose
        // most accepted students between Clearinghouse and registration
        // are bleeding attractiveness. ≥0.85 = excellent; 0.5 = mid;
        // <0.3 = serious leakage.
        if (!funnelTotals || funnelTotals.sendCh <= 0) return null;
        const yieldRate = funnelTotals.regReported / funnelTotals.sendCh;
        return yieldRate >= 0.85
          ? 100
          : yieldRate >= 0.5
            ? 50 + ((yieldRate - 0.5) / 0.35) * 50
            : Math.max(0, yieldRate * 100);
      })(),
      raw: funnelTotals
        ? { regReported: funnelTotals.regReported, sendCh: funnelTotals.sendCh }
        : null,
    },
    {
      label: 'tcas_competition_vs_peers',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        if (peerMedianRatio === null || peerMedianRatio <= 0) return null;
        const kkuRatio = funnelTotals.applicants / funnelTotals.enrollSeats;
        // Score 50 = parity with peer median; 100 = 2× peer median.
        // Peers come from TCAS3 only — sample size and methodology
        // differ from our full-funnel data, so this is comparative
        // signal not a precise apples-to-apples metric. Worth half
        // weight in summariseDrivers (which it gets automatically by
        // virtue of being one of N drivers).
        return clamp((kkuRatio / peerMedianRatio) * 50);
      })(),
      raw: {
        kkuRatio:
          funnelTotals && funnelTotals.enrollSeats > 0
            ? funnelTotals.applicants / funnelTotals.enrollSeats
            : null,
        peerMedianRatio,
        peerCount,
        year: latestComplete?.entryYearBE ?? null,
      },
    },
    {
      label: 'enrollment_trend_slope',
      value: (() => {
        // Drop the most-recent year if it looks partial (cohort < 30%
        // of the prior year — same heuristic as financials).
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        if (series.length < 2) return null;
        const slope = linearSlope(series);
        // 0 = flat (50). +5 students/year → 100. -5 → 0.
        return clamp(50 + (slope / 5) * 50);
      })(),
      raw: { series: enrollment.map((r) => r.enrolled) },
    },
    {
      // Intake-floor policy. The floors come from this installation's
      // organisation profile, not from the source — see @kku/shared's
      // intake-policy module. Bachelor breaches are strict
      // (closure-track); postgraduate breaches are watch-list. The
      // driver's `raw.compliance` is the canonical surface for UI badges
      // and lifecycle verdicts.
      //
      // The label keeps its historic name: it is written into stored
      // assessments and named in the methodology docs, so renaming it is a
      // versioned change rather than a tidy-up.
      label: 'kku_intake_policy',
      value: (() => {
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        const latestIntake = series[series.length - 1]?.value ?? null;
        return intakeComplianceFor(programRow?.level ?? 'BACHELOR', latestIntake, floors).score;
      })(),
      raw: (() => {
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        const latestIntake = series[series.length - 1]?.value ?? null;
        const verdict = intakeComplianceFor(programRow?.level ?? 'BACHELOR', latestIntake, floors);
        return {
          level: programRow?.level ?? null,
          latestIntake,
          floor: verdict.floor,
          compliance: verdict.state,
        };
      })(),
    },
  ];
  return summariseDrivers('attractiveness', drivers);
}

async function scoreAttractivenessScope(
  scope: ScopeLevel,
  scopeId: string,
): Promise<HealthScore> {
  // Faculty/dept/uni attractiveness — aggregate the recruitment funnel
  // across canonical+ACTIVE programs at the scope, latest COMPLETE entry
  // year only. Source: admission_campaign_stats (POWERBI.ADMISSION_STAT)
  // via the funnel adapter.
  //
  // Three drivers (equal-weighted in summariseDrivers):
  //   - tcas_competition_ratio = applicants / enrollSeats
  //       → ≥10× : 100   ≥5× : 70   ≥2× : 40   ≥1× : 20   <1× : 0
  //   - tcas_fill_rate = totalPassed / enrollSeats
  //       → 0.5+ : 100; linear below
  //   - tcas_registration_yield = regReported / sendClearinghouse
  //       → 0.85+ : 100; 0.5 = mid (50); linear below
  const totals = await scopeFunnelLatestYear(scope, scope === 'university' ? null : scopeId);
  const applicants = totals.totalApplicants;
  const seats = totals.enrollSeats;
  const passed = totals.totalPassed;
  const sendCh = totals.sendClearinghouse;
  const regReported = totals.regReported;

  const competitionRatio = seats > 0 ? applicants / seats : null;
  const fillRate = seats > 0 ? passed / seats : null;
  const yieldRate = sendCh > 0 ? regReported / sendCh : null;

  const drivers: HealthScore['drivers'] = [
    {
      label: 'tcas_competition_ratio',
      value: competitionRatio === null
        ? null
        : competitionRatio >= 10
          ? 100
          : competitionRatio >= 5
            ? 70 + ((competitionRatio - 5) / 5) * 30
            : competitionRatio >= 2
              ? 40 + ((competitionRatio - 2) / 3) * 30
              : competitionRatio >= 1
                ? 20 + (competitionRatio - 1) * 20
                : Math.max(0, competitionRatio * 20),
      raw: { applicants, seats, competitionRatio },
    },
    {
      label: 'tcas_fill_rate',
      value: fillRate === null
        ? null
        : fillRate >= 0.5
          ? 100
          : clamp((fillRate / 0.5) * 100),
      raw: { passed, seats, fillRate },
    },
    {
      label: 'tcas_registration_yield',
      value: yieldRate === null
        ? null
        : yieldRate >= 0.85
          ? 100
          : yieldRate >= 0.5
            ? 50 + ((yieldRate - 0.5) / 0.35) * 50
            : Math.max(0, yieldRate * 100),
      raw: { regReported, sendCh, yieldRate },
    },
  ];

  // v5.0: the three per-program drivers roll up from the program scores.
  // Their calibration cannot be reused against a faculty-wide total — a
  // subject-peer percentile, a ±5 students/yr slope and a per-level
  // intake floor are all per-program quantities. Before this the scope
  // scorer kept only the three aggregate TCAS ratios, which are the HIGH
  // ones, so faculty attractiveness read +25.8 pts above its program mean.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    rolledUpDriver(index, programIds, 'attractiveness', 'tcas_competition_vs_peers'),
    rolledUpDriver(index, programIds, 'attractiveness', 'enrollment_trend_slope'),
    rolledUpDriver(index, programIds, 'attractiveness', 'kku_intake_policy'),
  );
  return summariseDrivers('attractiveness', drivers);
}

// ──────────────────────────────────────────────────────────────────────────
// Financial — per-student contribution + cost coverage + tuition trend
// ──────────────────────────────────────────────────────────────────────────

// Scope-only financial drivers: `revenue_coverage_ratio` is the
// ratio-of-sums analogue of the program scorer's
// `revenue_coverage_program_direct`, and "what does the average program
// contribute" is undefined for a single program. Omitted rather than
// null so a program's dataCompletenessPct is not docked for drivers that
// cannot apply to it.
const PROGRAM_FINANCIAL_OMITTED = ['revenue_coverage_ratio', 'net_contribution_per_program'] as const;

// v5.4: the external-grant award is applied to the FINISHED Financial score —
// after summariseDrivers — so it can only raise the score and never moves
// completeness. A null base earns nothing and costs no grant query.
async function applyGrantAward(
  base: HealthScore,
  staffIds: () => Promise<string[]>,
): Promise<HealthScore> {
  if (base.score === null) {
    return withAward(base, {
      label: GRANT_AWARD_LABEL,
      points: null,
      raw: { reason: 'no-base-financial-score' },
    });
  }
  return withAward(base, await grantAward(await staffIds()));
}

/** Distinct ACTIVE teaching staff across the given programmes. */
async function activeStaffIdsForPrograms(programIds: readonly string[]): Promise<string[]> {
  if (programIds.length === 0) return [];
  const links = await prisma.programFaculty.findMany({
    where: { programId: { in: [...programIds] } },
    select: { facultyMember: { select: { id: true, isActive: true } } },
  });
  return [...new Set(links.filter((l) => l.facultyMember.isActive).map((l) => l.facultyMember.id))];
}

async function scoreFinancialProgram(programId: string, enrollment: MetricRow[]): Promise<HealthScore> {
  const base = await scoreFinancialProgramBase(programId, enrollment);
  return applyGrantAward(base, () => activeStaffIdsForPrograms([programId]));
}

async function scoreFinancialScope(
  row: MetricRow | null,
  scope: ScopeLevel,
  scopeId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  const base = await scoreFinancialScopeBase(row, scope, scopeId, enrollment);
  return applyGrantAward(base, async () => activeStaffIdsForPrograms(await collectProgramIdsForScope(scopeId, scope)));
}

async function scoreFinancialProgramBase(
  programId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  const [rows, programMeta] = await Promise.all([
    prisma.financialMetric.findMany({
      where: { programId, ...realDataWhere() },
      orderBy: { fiscalYear: 'asc' },
    }),
    prisma.program.findUnique({ where: { id: programId }, select: { level: true } }),
  ]);
  if (rows.length === 0) {
    return noDataScore('financial', PROGRAM_FINANCIAL_OMITTED);
  }
  const num = (v: { toNumber: () => number } | unknown): number =>
    typeof v === 'number' ? v : (v as { toNumber: () => number }).toNumber();

  // Score on the latest COMPLETE academic year — never the year still
  // being billed. See packages/db/src/financial-year.ts for why a ratio
  // test alone can't detect "in progress" (median in-progress year reads
  // ~44% of the prior complete year, but with a long tail above 90%).
  const academicYearCtx = await getAcademicYearContext();
  const currentAcademicYearCE = academicYearCtx.currentAcademicYearBE - 543;
  const pick = pickFinancialYear(rows, currentAcademicYearCE, (row) => num(row.tuitionRevenue));
  if (!pick.row) {
    return noDataScore('financial', PROGRAM_FINANCIAL_OMITTED);
  }
  const head = pick.row;
  const tuition = num(head.tuitionRevenue);
  const direct = num(head.directCost);
  const facility = num(head.allocatedFacilityCost);
  const overhead = num(head.allocatedOverhead);
  const netContribution = num(head.netContribution);
  const programDirectCost = direct + facility + overhead;

  const enrolledHead =
    enrollment.find((e) => e.year === head.fiscalYear)?.enrolledTotal ??
    enrollment.at(-1)?.enrolledTotal ??
    null;

  const drivers = [
    {
      label: 'net_contribution_per_student',
      value: (() => {
        if (!enrolledHead || enrolledHead === 0) return null;
        const perStudent = netContribution / enrolledHead;
        // 100k THB / student → 100; 0 → 50; -50k → 0.
        return clamp(50 + (perStudent / 100_000) * 50);
      })(),
      raw: enrolledHead ? netContribution / enrolledHead : null,
    },
    {
      label: 'revenue_coverage_program_direct',
      value: (() => {
        if (programDirectCost <= 0) return tuition > 0 ? 80 : null;
        return clamp((tuition / programDirectCost / 1.2) * 100);
      })(),
      raw: tuition,
    },
    {
      label: 'tuition_trend_slope',
      value: (() => {
        // Exclude the in-progress academic year BEFORE the ratio-based
        // applyPartialYearDrop runs — a half-billed year drags the slope
        // toward a manufactured decline no matter its ratio to the prior
        // year (see excludeInProgressYear's doc comment). This mirrors
        // the head-selection rule in pickFinancialYear above.
        const series = applyPartialYearDrop(
          excludeInProgressYear(
            rows.map((r) => ({ year: r.fiscalYear, value: num(r.tuitionRevenue) })),
            currentAcademicYearCE,
          ),
        );
        if (series.length < 2) return null;
        const slope = linearSlope(series);
        // +500k THB/year growth → 100; flat → 50; declining → toward 0.
        return clamp(50 + (slope / 500_000) * 50);
      })(),
      raw: rows.map((r) => num(r.tuitionRevenue)),
    },
    {
      label: 'revenue_scale',
      // v3.5: level-aware absolute revenue. Captures "is this program
      // revenue-substantial for its level" — complements per-student /
      // coverage / trend ratios above with the absolute scale signal.
      // 0-100 scaled against REVENUE_TARGET_THB_BY_LEVEL: ratio 1.0 → 75,
      // ratio 0.5 → 50, ratio 2.0 → 100 (capped), ratio 0 → 0.
      value: (() => {
        const level = programMeta?.level ?? null;
        if (!level || !(level in REVENUE_TARGET_THB_BY_LEVEL)) return null;
        if (tuition <= 0) return 0;
        const target = REVENUE_TARGET_THB_BY_LEVEL[level as keyof typeof REVENUE_TARGET_THB_BY_LEVEL];
        const ratio = tuition / target;
        // Linear: ratio 0 → 0, 1 → 75, 2+ → 100. Encodes diminishing
        // returns past the per-level target (after ratio≥2, you're
        // already revenue-substantial).
        return clamp(Math.min(ratio, 2) * 50);
      })(),
      raw: { latestAnnualRevenueThb: tuition, level: programMeta?.level ?? null },
    },
  ];
  return summariseDrivers('financial', drivers, PROGRAM_FINANCIAL_OMITTED);
}

async function scoreFinancialScopeBase(
  row: MetricRow | null,
  scope: ScopeLevel,
  scopeId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  // Enrolment for the financial head year, falling back to the latest
  // enrolment row — the MV pivots per family, so the financial row can
  // carry a null enrolledTotal. Mirrors scoreFinancialProgramBase.
  const enrolledHead =
    (row ? enrollment.find((e) => e.year === row.year)?.enrolledTotal : null) ??
    enrollment.at(-1)?.enrolledTotal ??
    null;

  const drivers: HealthScore['drivers'] = [
    {
      label: 'net_contribution_per_program',
      value: (() => {
        if (row?.netContributionTotal === null || row?.netContributionTotal === undefined) return null;
        if (!row.programCount) return null;
        return clamp(50 + (row.netContributionTotal / row.programCount / 20_000_000) * 50);
      })(),
      raw: row?.netContributionTotal,
    },
    {
      label: 'revenue_coverage_ratio',
      value: (() => {
        if (!row?.tuitionRevenueTotal || !row.totalCostTotal) return null;
        return clamp((row.tuitionRevenueTotal / row.totalCostTotal / 1.2) * 100);
      })(),
      raw: row?.tuitionRevenueTotal,
    },
    {
      // v5.0: ratio-of-sums, not a mean of per-program ratios — the
      // ฿100k/student scale is scope-invariant, so aggregating weights by
      // program size instead of letting a 7-student program count as much
      // as a 700-student one.
      label: 'net_contribution_per_student',
      value: (() => {
        if (row?.netContributionTotal === null || row?.netContributionTotal === undefined) return null;
        if (!enrolledHead || enrolledHead === 0) return null;
        const perStudent = row.netContributionTotal / enrolledHead;
        return clamp(50 + (perStudent / 100_000) * 50);
      })(),
      raw: { netContributionTotal: row?.netContributionTotal ?? null, enrolled: enrolledHead },
    },
  ];

  // v5.0: absolute-THB calibration cannot be reused at scope. ±฿500k/yr
  // means "excellent" for one program and noise for a whole faculty, and
  // revenue_scale is scored against a per-LEVEL target a faculty does not
  // have. Both roll up from the program scores instead.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    rolledUpDriver(index, programIds, 'financial', 'tuition_trend_slope'),
    rolledUpDriver(index, programIds, 'financial', 'revenue_scale'),
  );

  // revenue_coverage_program_direct is deliberately NOT rolled up:
  // revenue_coverage_ratio above is the same metric as ratio-of-sums, and
  // carrying both would weight cost coverage twice in the mean.
  return summariseDrivers('financial', drivers, ['revenue_coverage_program_direct']);
}

// ──────────────────────────────────────────────────────────────────────────
// Capability — senior rank + publications + retirement horizon
// ──────────────────────────────────────────────────────────────────────────

async function scoreCapabilityProgram(programId: string): Promise<HealthScore> {
  const links = await prisma.programFaculty.findMany({
    where: { programId },
    include: {
      facultyMember: {
        select: {
          id: true,
          rank: true,
          isActive: true,
          retirementDate: true,
        },
      },
    },
  });
  const active = links.filter((l) => l.facultyMember.isActive);
  if (active.length === 0) {
    return noDataScore('capability');
  }

  // Latest-year enrolment + faculty discipline (drives the SFR band).
  // QS/THE both weight student-faculty ratio heavily — and apply
  // different thresholds by subject (clinical = strict, humanities =
  // lenient). Pull the program's faculty teaching-mode band.
  const [latestEnrollment, programRow] = await Promise.all([
    prisma.enrollmentMetric.findFirst({
      where: { programId, ...realDataWhere() },
      orderBy: { academicYear: 'desc' },
      select: { enrolled: true },
    }),
    prisma.program.findUnique({
      where: { id: programId },
      select: { faculty: { select: { sfrBand: true } } },
    }),
  ]);
  const enrolled = latestEnrollment?.enrolled ?? 0;
  const sfrBand = sfrBandFor(programRow?.faculty?.sfrBand);

  // Publications: research outputs in the last 3 years for the same
  // faculty members.
  const memberIds = active.map((l) => l.facultyMember.id);
  const currentYear = new Date().getUTCFullYear();
  const pubCount =
    memberIds.length > 0
      ? await prisma.researchOutput.count({
          where: {
            facultyMemberId: { in: memberIds },
            year: { gte: currentYear - 3 },
            ...realDataWhere(),
          },
        })
      : 0;

  const seniorCount = active.filter(
    (l) => l.facultyMember.rank === 'PROF' || l.facultyMember.rank === 'ASSOC_PROF',
  ).length;

  const fiveYearHorizon = new Date();
  fiveYearHorizon.setUTCFullYear(fiveYearHorizon.getUTCFullYear() + 5);
  const retiringSoon = active.filter(
    (l) =>
      l.facultyMember.retirementDate !== null &&
      l.facultyMember.retirementDate <= fiveYearHorizon,
  ).length;

  const drivers = [
    {
      label: 'senior_rank_share',
      value: clamp((seniorCount / active.length) * 200), // 50% senior → 100
      raw: { seniorCount, total: active.length },
    },
    {
      label: 'publications_per_faculty',
      value: (() => {
        const ratio = pubCount / active.length;
        // 5 publications / faculty / 3 years → 100. 0 → 0.
        return clamp((ratio / 5) * 100);
      })(),
      raw: { pubCount, faculty: active.length, windowYears: 3 },
    },
    {
      label: 'retirement_horizon_5y',
      value: clamp(100 - (retiringSoon / active.length) * 100),
      raw: { retiringSoon, total: active.length },
    },
    {
      label: 'student_faculty_ratio',
      // Discipline-aware: clinical programs scored against a stricter
      // band than humanities. Null when no enrolment data yet —
      // programs without recent EnrollmentMetric rows get a null
      // driver rather than a misleading "perfect" 100.
      value: enrolled === 0
        ? null
        : clamp(scoreStudentFacultyRatio(enrolled / active.length, sfrBand)),
      raw: {
        enrolled,
        faculty: active.length,
        ratio: enrolled === 0 ? null : enrolled / active.length,
        band: sfrBand,
        bandThresholds: SFR_BANDS[sfrBand],
      },
    },
  ];
  return summariseDrivers('capability', drivers);
}

// ── Discipline-aware student-per-faculty ratio scoring ────────────────
//
// QS World Rankings + THE both apply different SFR thresholds by
// subject. Clinical disciplines (MD, dentistry, vet, nursing) require
// far more 1:1 supervision than humanities or business; a flat 5/15/45
// scale would punish humanities programs and over-reward medical
// schools. The bands below mirror QS subject-band conventions:
//
//   CLINICAL    — bedside / lab-supervised programs       6:1 → 100, 16:1 → 0
//   STEM_LAB    — lab-intensive sciences + engineering    10:1 → 100, 28:1 → 0
//   STUDIO      — studio / individual-instruction arts    8:1 → 100, 22:1 → 0
//   PROFESSIONAL — business / law / professional cohorts  18:1 → 100, 38:1 → 0
//   HUMANITIES  — lecture-driven humanities + social sci  22:1 → 100, 48:1 → 0
//
// Each band: linear from "world-class" at the lower bound to 0 at the
// upper bound; below lower → 100; above upper → 0.
const SFR_BANDS: Record<SfrBand, { lower: number; upper: number }> = {
  CLINICAL:     { lower: 6,  upper: 16 },
  STEM_LAB:     { lower: 10, upper: 28 },
  STUDIO:       { lower: 8,  upper: 22 },
  PROFESSIONAL: { lower: 18, upper: 38 },
  HUMANITIES:   { lower: 22, upper: 48 },
};

/**
 * The band for a faculty: its stored teaching mode, or PROFESSIONAL (the mid
 * band) when none is set. Faculties on a fresh install carry none; KKU's were
 * backfilled by migration 20261103120000_faculty_sfr_band.
 */
export function sfrBandFor(sfrBand: SfrBand | null | undefined): SfrBand {
  return sfrBand ?? 'PROFESSIONAL';
}

function scoreStudentFacultyRatio(ratio: number, band: SfrBand): number {
  const { lower, upper } = SFR_BANDS[band];
  if (ratio <= lower) return 100;
  if (ratio >= upper) return 0;
  return 100 - ((ratio - lower) / (upper - lower)) * 100;
}

async function scoreCapabilityScope(scopeId: string, scope: ScopeLevel): Promise<HealthScore> {
  // Aggregate over all programs under this scope.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  if (programIds.length === 0) return noDataScore('capability');

  // SFR band selection at scope level:
  //   faculty / department → use that faculty's discipline band
  //   university (rollup)  → use PROFESSIONAL (middle-of-the-road) since
  //                          the row aggregates a mix of disciplines
  let scopeBand: SfrBand = 'PROFESSIONAL';
  if (scope === 'faculty' || scope === 'department') {
    const fac = await prisma.faculty.findFirst({
      where:
        scope === 'faculty'
          ? { id: scopeId }
          : { departments: { some: { id: scopeId } } },
      select: { sfrBand: true },
    });
    scopeBand = sfrBandFor(fac?.sfrBand);
  } else if (scope === 'program') {
    const p = await prisma.program.findUnique({
      where: { id: scopeId },
      select: { faculty: { select: { sfrBand: true } } },
    });
    scopeBand = sfrBandFor(p?.faculty?.sfrBand);
  }
  const links = await prisma.programFaculty.findMany({
    where: { programId: { in: programIds } },
    include: {
      facultyMember: {
        select: { id: true, rank: true, isActive: true, retirementDate: true },
      },
    },
  });
  const distinctActive = new Map<string, typeof links[number]['facultyMember']>();
  for (const l of links) {
    if (l.facultyMember.isActive) distinctActive.set(l.facultyMember.id, l.facultyMember);
  }
  const active = [...distinctActive.values()];
  if (active.length === 0) return noDataScore('capability');

  const memberIds = active.map((m) => m.id);
  const currentYear = new Date().getUTCFullYear();
  const pubCount = await prisma.researchOutput.count({
    where: { facultyMemberId: { in: memberIds }, year: { gte: currentYear - 3 }, ...realDataWhere() },
  });
  const seniorCount = active.filter((m) => m.rank === 'PROF' || m.rank === 'ASSOC_PROF').length;
  const fiveYearHorizon = new Date();
  fiveYearHorizon.setUTCFullYear(fiveYearHorizon.getUTCFullYear() + 5);
  const retiringSoon = active.filter(
    (m) => m.retirementDate !== null && m.retirementDate <= fiveYearHorizon,
  ).length;

  // Aggregate enrolment across all programs in scope (sum of latest year per program).
  const latestEnrolByProgram = await prisma.$queryRaw<Array<{ enrolled: bigint }>>(Prisma.sql`
    WITH latest AS (
      SELECT program_id, MAX(academic_year) as max_year
      FROM enrollment_metrics em0
      WHERE program_id = ANY(${programIds})
        AND ${realDataSql('em0')}
      GROUP BY program_id
    )
    SELECT em.enrolled::bigint as enrolled
    FROM enrollment_metrics em
    JOIN latest l ON l.program_id = em.program_id AND em.academic_year = l.max_year
    WHERE ${realDataSql('em')};
  `);
  const totalEnrolled = latestEnrolByProgram.reduce((s, r) => s + Number(r.enrolled), 0);
  const drivers = [
    { label: 'senior_rank_share', value: clamp((seniorCount / active.length) * 200), raw: { seniorCount, total: active.length } },
    { label: 'publications_per_faculty', value: clamp((pubCount / active.length / 5) * 100), raw: { pubCount, total: active.length } },
    { label: 'retirement_horizon_5y', value: clamp(100 - (retiringSoon / active.length) * 100), raw: { retiringSoon, total: active.length } },
    {
      label: 'student_faculty_ratio',
      value: totalEnrolled === 0
        ? null
        : clamp(scoreStudentFacultyRatio(totalEnrolled / active.length, scopeBand)),
      raw: {
        enrolled: totalEnrolled,
        faculty: active.length,
        ratio: totalEnrolled === 0 ? null : totalEnrolled / active.length,
        band: scopeBand,
        bandThresholds: SFR_BANDS[scopeBand],
      },
    },
  ];
  return summariseDrivers('capability', drivers);
}

// ──────────────────────────────────────────────────────────────────────────
// Outcomes — TCAS percentile + employment + salary
// ──────────────────────────────────────────────────────────────────────────

async function scoreOutcomesProgram(programId: string, oRow: MetricRow | null): Promise<HealthScore> {
  // TCAS min-score percentile: KKU's min score's percentile among
  // peer programs in the same subject + (year, round).
  const kkuTcas = await prisma.tcasAdmissionStat.findFirst({
    where: { programId, minScorePass1: { not: null }, ...realDataWhere() },
    orderBy: [{ entryYearBE: 'desc' }, { round: 'desc' }],
  });
  let percentile: number | null = null;
  if (kkuTcas && kkuTcas.minScorePass1 !== null) {
    const subjectKey = extractSubjectSignature(kkuTcas.programmeName);
    const peers = await prisma.tcasAdmissionStat.findMany({
      where: {
        entryYearBE: kkuTcas.entryYearBE,
        round: kkuTcas.round,
        minScorePass1: { not: null },
        institutionName: { not: getInstitution().nameTh },
        programmeName: { contains: subjectKey, mode: 'insensitive' },
        ...realDataWhere(),
      },
      select: { minScorePass1: true, programmeName: true },
    });
    const peerScores = peers
      .filter((p) => extractSubjectSignature(p.programmeName) === subjectKey)
      .map((p) => p.minScorePass1!)
      .filter((v): v is number => v !== null);
    if (peerScores.length >= 3) {
      const below = peerScores.filter((s) => s < kkuTcas.minScorePass1!).length;
      percentile = (below / peerScores.length) * 100;
    }
  }

  // Pull the latest GraduateOutcome row directly. The annual KKU
  // graduate-employment survey (real data, ingested via
  // `pnpm outcomes:ingest`) is the canonical source; fall back to the
  // MV-aggregate `oRow` when no GraduateOutcome row exists yet for
  // this program (postgrad programs aren't surveyed; older cohorts
  // may not yet be ingested).
  const grad = await prisma.graduateOutcome.findFirst({
    where: { programId, ...realDataWhere() },
    orderBy: [{ surveyYear: 'desc' }, { graduationYear: 'desc' }],
  });

  const drivers: HealthScore['drivers'] = [
    {
      label: 'tcas_min_score_percentile',
      value: percentile !== null ? clamp(percentile) : null,
      raw: { kkuMin: kkuTcas?.minScorePass1, percentile },
    },
    {
      label: 'employment_rate',
      // GraduateOutcome.employmentRate is 0..1; convert to 0..100.
      // Fall back to MV when no survey row exists.
      value: grad
        ? clamp(grad.employmentRate * 100)
        : oRow?.employmentRateWeighted != null
          ? clamp(oRow.employmentRateWeighted * 100)
          : null,
      raw: grad
        ? {
            employmentRate: grad.employmentRate,
            surveyYear: grad.surveyYear,
            graduationYear: grad.graduationYear,
            sampleSize: grad.sampleSize,
            method: grad.methodologyVersion,
          }
        : oRow?.employmentRateWeighted,
    },
    {
      label: 'job_relevance',
      // Share of graduates whose job is "ตรงสาขา" (matches discipline).
      // 0..1 → 0..100. Null when not surveyed (postgrad) or when the
      // report didn't break this out per program.
      value: grad && grad.jobRelevanceScore > 0
        ? clamp(grad.jobRelevanceScore * 100)
        : null,
      raw: grad
        ? { jobRelevanceScore: grad.jobRelevanceScore, surveyYear: grad.surveyYear }
        : null,
    },
    {
      label: 'average_salary',
      // Thai graduate-salary anchors (Council benchmark 2024):
      //   ฿15,000 → 0     (legal floor)
      //   ฿20,000 → 40    (typical entry)
      //   ฿25,000 → 70
      //   ฿35,000+ → 100  (premium / high-skill clinical / engineering)
      value: (() => {
        const salary = grad ? Number(grad.averageSalary) : oRow?.averageSalaryWeighted ?? null;
        if (!salary || salary <= 0) return null;
        return clamp(((salary - 15_000) / 200));
      })(),
      raw: grad
        ? { averageSalary: Number(grad.averageSalary), surveyYear: grad.surveyYear }
        : oRow?.averageSalaryWeighted,
    },
    {
      label: 'further_study_rate',
      // Share continuing to graduate school. Mid-band is the sweet
      // spot — too low signals weak academic pipeline; too high
      // suggests under-employment masquerading as further study.
      // 0..0.05 → 50 (low), 0.05..0.15 → 100 (sweet spot), 0.15..0.30
      // → 70, 0.30+ → 30.
      value: grad
        ? clamp(scoreFurtherStudyRate(grad.furtherStudyRate))
        : null,
      raw: grad
        ? { furtherStudyRate: grad.furtherStudyRate, surveyYear: grad.surveyYear }
        : null,
    },
    // v3.7: student-satisfaction driver — POWERBI.EVALUATE_INSTRUCTOR
    // weighted mean rating, normalised to the [3.5, 5.0] band.
    await studentSatisfactionDriver({ scope: 'program', scopeId: programId }),
  ];

  // v4.0: DQ digital competency. Returns null — meaning "omit", not
  // "no data" — for non-bachelor programs, which keep the six drivers
  // above and their completeness with them. See `dqCompetencyDriver`.
  const dq = await dqCompetencyDriver({ scope: 'program', scopeId: programId });
  if (dq) drivers.push(dq);

  // Omitted, not null: from v5.0 summariseDrivers pads any canonical
  // driver a scorer did not build, so without this the non-bachelor
  // omission above would come back as a missing driver and dock
  // completeness for an instrument that cannot apply.
  return summariseDrivers('outcomes', drivers, dq ? [] : ['dq_digital_competency']);
}

// Sweet-spot scoring for further-study rate. Both extremes are
// negative signals (no academic pipeline / under-employment).
function scoreFurtherStudyRate(rate: number): number {
  if (rate <= 0.05) return 50 + (rate / 0.05) * 50; // 0% → 50, 5% → 100
  if (rate <= 0.15) return 100;
  if (rate <= 0.30) return 100 - ((rate - 0.15) / 0.15) * 30; // → 70 at 30%
  return Math.max(30, 70 - ((rate - 0.30) / 0.20) * 40);     // taper to 30
}

async function scoreOutcomesScope(
  scope: ScopeLevel,
  scopeId: string,
  row: MetricRow | null,
): Promise<HealthScore> {
  const drivers: HealthScore['drivers'] = [
    {
      label: 'employment_rate',
      value: row?.employmentRateWeighted !== null && row?.employmentRateWeighted !== undefined
        ? clamp(row.employmentRateWeighted * 100)
        : null,
      raw: row?.employmentRateWeighted,
    },
    {
      label: 'average_salary',
      value: row?.averageSalaryWeighted ? clamp((row.averageSalaryWeighted / 30_000) * 100) : null,
      raw: row?.averageSalaryWeighted,
    },
    await studentSatisfactionDriver({ scope, scopeId }),
  ];

  // v4.0 — the mean is computed from the cube AT THIS SCOPE, never by
  // averaging program scores. Faculty / department / university always
  // carry the driver (they contain bachelor programs); the omission
  // branch only fires if this is ever called at program scope.
  const dq = await dqCompetencyDriver({ scope, scopeId });
  if (dq) drivers.push(dq);

  // v5.0: neither job relevance nor further study has an aggregate column
  // in the materialised view, and the TCAS min-score percentile is a
  // per-program peer-subject comparison. All three were simply absent at
  // scope while the dimension still reported 100% complete, leaving
  // faculty outcomes +9.3 pts above its program mean.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    rolledUpDriver(index, programIds, 'outcomes', 'job_relevance'),
    rolledUpDriver(index, programIds, 'outcomes', 'further_study_rate'),
    rolledUpDriver(index, programIds, 'outcomes', 'tcas_min_score_percentile'),
  );

  return summariseDrivers('outcomes', drivers, dq ? [] : ['dq_digital_competency']);
}

// ── student_satisfaction driver (added v3.7) ─────────────────────────
//
// Aggregates the program's (or scope's) courses' weighted-mean rating
// from POWERBI.EVALUATE_INSTRUCTOR via evaluation_response_summaries.
// Normalised 3.5→0..5.0→100 on the 1-5 likert scale (anchored linear),
// which captures the ceiling-biased distribution (87% ≥ 4.0 per
// docs/methodologies/evaluations.md §"Score scale"). Below 3.5
// saturates at 0; above 5.0 is impossible. Null when no surveyed
// cells exist for this scope in window — caller treats null as a
// data gap (driver excluded from the dimension average, completeness
// drops), NOT as a zero penalty.
//
// Scope:
//   - program → join through program_courses where program_id = scopeId
//   - faculty → join through program_courses → programs where program.faculty_id = scopeId
//   - department → similar, programs.department_id = scopeId
//   - university → no scope filter (Σ across all programs)
//
// The same cell can be attributed to multiple programs (general-ed
// courses) — at faculty/dept/uni rollups this is the correct posture
// (the cell SHOULD count once per program that teaches it). The
// double-count is benign for the weighted mean since both copies
// carry the same rating + respondent count.
async function studentSatisfactionDriver(args: {
  scope: ScopeLevel;
  scopeId: string;
  // Program-scope shortcut — when caller already has the programId,
  // skip the program→faculty rollup. Same WHERE clause is built either
  // way; this is purely for readability at call sites.
  programId?: string;
}): Promise<HealthScore['drivers'][number]> {
  // $queryRawUnsafe + plain SQL + positional params — same pattern as
  // dashboard-overview.ts. Calling this with a Prisma.Sql fragment
  // (Prisma.sql`...`) under concurrent Promise.all execution
  // intermittently produces `syntax error at or near "$1"` because
  // Prisma's Sql-object instanceof check fails across async contexts
  // and the parameter mis-binds. Plain string + positional params
  // bypasses the Sql-object machinery entirely.
  let scopeSql: string;
  const scopeParams: unknown[] = [];
  if (args.scope === 'program') {
    scopeSql = 'AND pc.program_id = $1';
    scopeParams.push(args.scopeId);
  } else if (args.scope === 'faculty') {
    scopeSql = 'AND p.faculty_id = $1';
    scopeParams.push(args.scopeId);
  } else if (args.scope === 'department') {
    scopeSql = 'AND p.department_id = $1';
    scopeParams.push(args.scopeId);
  } else {
    // university — no scope filter (Σ across all programs).
    scopeSql = '';
  }
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      rating: number | null;
      n: bigint;
      cells: bigint;
      courses: bigint;
      years: bigint;
    }>
  >(
    `
    SELECT
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating,
      COALESCE(SUM(e.respondent_count), 0)::bigint                                                  AS n,
      COUNT(*)::bigint                                                                              AS cells,
      COUNT(DISTINCT e.course_code)::bigint                                                         AS courses,
      COUNT(DISTINCT e.acad_year_be)::bigint                                                        AS years
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN program_courses pc ON pc.course_code = e.course_code
    JOIN programs p ON p.id = pc.program_id
    WHERE ds.mocked = false
      AND e.semester IN (1, 2)
      ${scopeSql}
    `,
    ...scopeParams,
  );
  const r = rows[0];
  if (!r || r.rating === null || Number(r.cells) === 0) {
    return { label: 'student_satisfaction', value: null, raw: null };
  }
  const rating = Number(r.rating);
  // Anchored linear: 3.5 → 0, 5.0 → 100. Below 3.5 saturates at 0.
  // Spreads the [3.5, 5.0] band — where 95%+ of real ratings sit —
  // across the full 0..100 health-score range so programs actually
  // differentiate. A naive [1, 5] → [0, 100] would compress every
  // program into the 75-100 band given KKU's ceiling-biased data.
  const value = clamp(((rating - 3.5) / 1.5) * 100);
  return {
    label: 'student_satisfaction',
    value,
    raw: {
      ratingAvg: rating,
      respondentCount: Number(r.n),
      cellCount: Number(r.cells),
      coursesObserved: Number(r.courses),
      yearsObserved: Number(r.years),
      normalisation: '3.5 → 0, 5.0 → 100 (anchored linear)',
      source: 'kku-evaluations.v1',
    },
  };
}

// ── dq_digital_competency driver (added v4.0) ────────────────────────
//
// KKU's Digital Intelligence test is a competency every undergraduate
// sits, so how a program's students score is evidence of what that
// program develops in them. The driver is the respondent-weighted mean
// over theory modules 1-12, banded on KKU's own pass mark:
// ≤50 → 0 · 70 → 50 · ≥90 → 100.
//
// Everything that decides the number lives in `student-dq.ts`, beside
// the cubes and the dashboard that share the same rules:
//   - `dqCompetencyByScope` computes SUM/SUM AT THE SCOPE ASKED FOR,
//     never a mean of program means (the cube exists for that reason:
//     the mean-of-means error is 0.8 points on module 1 at university
//     scope), excludes module 13 (uptake 48.7%-96.7% by faculty, so it
//     would score the rollout rather than the students), restricts to
//     `level = 'BACHELOR'`, and applies the ≥5 scored-student floor;
//   - `dqDriverScore` applies the band.
// It carries the same `$queryRawUnsafe` discipline as
// `studentSatisfactionDriver` above, for the same reason — this is one
// of the concurrent call sites that provoked the `$1` mis-binding.
//
// Two different absences, deliberately handled differently — this is
// the difference between "we don't know" and "the question doesn't
// apply", and `dataCompletenessPct` is Council-facing (the cockpit
// bands it at 75/50, the deep-dive header prints it, verdict snapshots
// store it):
//
//   * A NON-BACHELOR program returns null from here and the driver is
//     OMITTED from the array entirely. DQ is an undergraduate
//     instrument; a doctoral program is not *missing* a DQ score, DQ
//     does not apply to it. Appending a null would put a driver that
//     can never apply into its denominator and report it as having
//     less complete data than before purely because an undergraduate
//     instrument exists (measured: 2.4-14.3 points of false loss across
//     all 199). Same distinction the deep-dive section draws between
//     `not-applicable` and `no-data`.
//   * A BACHELOR program with no DQ rows, or under the 5-student
//     floor, gets the driver with a NULL value. There the evidence is
//     genuinely missing, and it SHOULD count against completeness.
//     Never 0 either way: a program with no DQ evidence has not scored
//     zero. `summariseDrivers` excludes nulls from the dimension mean.
//
// Faculty / department / university scopes always carry the driver:
// they legitimately contain bachelor programs, and the cube's own join
// applies the level gate inside the aggregate.
async function dqCompetencyDriver(args: {
  scope: ScopeLevel;
  scopeId: string;
}): Promise<HealthScore['drivers'][number] | null> {
  if (args.scope === 'program') {
    const program = await prisma.program.findUnique({
      where: { id: args.scopeId },
      select: { level: true },
    });
    // Only a POSITIVELY known ineligible level omits the driver. An
    // unknown program keeps it (null-valued) rather than silently
    // shrinking its denominator on a lookup miss.
    if (program && program.level !== DQ_ELIGIBLE_LEVEL) return null;
  }
  const dq = await dqCompetencyByScope({ scope: args.scope, scopeId: args.scopeId });
  return {
    label: 'dq_digital_competency',
    value: dqDriverScore(dq.rawMean),
    // `raw` carries the evidence, `scoredStudents` above all: the
    // 5-student floor is low by decision, so every surface that renders
    // this score must be able to show how thin it is.
    raw:
      dq.rawMean === null
        ? null
        : {
            rawMean: dq.rawMean,
            scoredStudents: dq.scoredStudents,
            programCount: dq.programCount,
            // Both of these reach Council through the provenance
            // drawer, so both are built from the SAME constants
            // `dqDriverScore` applies — never restated as literals
            // here, which would be a second source for the band.
            passMark: DQ_BAND_PASS,
            band:
              `≤${DQ_BAND_FLOOR} → 0, ${DQ_BAND_PASS} → 50, ` +
              `≥${DQ_BAND_CEILING} → 100 (anchored on the pass mark)`,
            modulesCounted: 'theory 1-12 (module 13 excluded — uneven rollout)',
            source: 'student-dq.v1',
          },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Relevance — labour-market alignment + demand-match + demographic +
// strategic-sector. Most signals real after the connector flips on
// 2026-04-27 → 2026-05-02.
// ──────────────────────────────────────────────────────────────────────────

const STRATEGIC_KMITL_GROUPS = new Set([
  'IT',
  'Engineer',
  'Health Science',
  'Smart Farmer',
  'New S Curve',
  'Food',
]);

// ── jobthai_demand_alignment driver (added v5.1) ─────────────────────
//
// Share of a programme's taught skills that its linked JobThai occupations
// demand. The direct analogue of `labour_market_alignment`, which reads the
// LinkedIn-via-MHESI feed, so the two are comparable and can visibly disagree.
//
// NULL, NEVER 0, in three cases, each a data gap rather than poor performance:
//   - the programme has no eligible link. For postgraduate programmes that is
//     by design: the bridge admits only postings whose stated minimum is a
//     postgraduate qualification, and just 41 of 47,631 postings do. 82% of
//     doctoral programmes DO match a field of study, but those matches sit on
//     bachelor-level adverts, and scoring a PhD on undergraduate vacancies
//     would look healthy and be wrong;
//   - the postings behind its links total fewer than
//     JOBTHAI_MIN_POSTINGS_FOR_SIGNAL (20, the measured 25th percentile);
//   - the programme has no taught skills, so the denominator is zero.
async function jobThaiDemandAlignmentDriver(
  programId: string,
): Promise<HealthScore['drivers'][number]> {
  const label = 'jobthai_demand_alignment';
  // One loader shared with the Deep-Dive Skills coverage section (v5.2), so the
  // score and the gap list a reader sees beside it cannot disagree.
  const { demand, checklist, matches } = await programJobThaiSkillCoverage(programId);
  if (demand.status !== 'ok') {
    return {
      label,
      value: null,
      raw: { reason: demand.status, occupations: demand.occupations, postings: demand.postings, floor: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL, minLinkScore: JOBTHAI_MIN_LINK_SCORE },
    };
  }

  // v5.2: the AI curriculum check decides whether each demanded skill is taught
  // and whether it is relevant to the discipline — the same instrument as
  // demand_match_filled. Exact skill-ID overlap read 0 for 29 of 41 programmes
  // on dev, because curricula say "Legal Drafting" where postings say
  // "Litigation". Generic skills are not on the checklist: teaching
  // communication says nothing about fit to this field's jobs.
  const rows = [...matches.values()];
  const relevant = rows.filter((r) => r.relevant);
  if (relevant.length < JOBTHAI_MIN_RELEVANT_SKILLS) {
    return {
      label,
      value: null,
      raw: {
        reason: rows.length === 0
          ? 'curriculum match not yet computed for JobThai demand'
          : `only ${relevant.length} relevant JobThai-demanded skills — below the ${JOBTHAI_MIN_RELEVANT_SKILLS}-skill floor`,
        relevantDemanded: relevant.length,
        demandedSkills: checklist.length,
        occupations: demand.occupations,
        postings: demand.postings,
      },
    };
  }
  const matched = relevant.filter((r) => r.matched).length;

  return {
    label,
    value: clamp((matched / relevant.length) * 100),
    raw: {
      relevantDemanded: relevant.length,
      matchedDemanded: matched,
      checkedSkills: rows.length,
      demandedSkills: checklist.length,
      occupations: demand.occupations,
      postings: demand.postings,
      // Carried so a provenance drawer can state the caveat with numbers: this
      // is a national signal, 37% Bangkok and 3.3% Northeast.
      source: 'jobthai',
    },
  };
}

async function scoreRelevanceProgram(
  programId: string,
  kmitlAlignment: number | null,
): Promise<HealthScore> {
  // Demand-match: share of *relevant* demanded skills the curriculum
  // already teaches. Only counts rows where relevant=true.
  const matchRows = await prisma.programDemandMatch.findMany({
    where: { programId, relevant: true, ...demandMatchSourceWhere(DEMAND_SOURCE_LINKEDIN), ...realDataWhere() },
    select: { matched: true },
  });
  let demandMatchValue: number | null = null;
  if (matchRows.length > 0) {
    const matched = matchRows.filter((r) => r.matched).length;
    demandMatchValue = clamp((matched / matchRows.length) * 100);
  }

  // Demographic resilience: inverted required cohort share at +10y.
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { kmitlCareerIds: true, level: true },
  });
  const demo = await computeRequiredShareAt10Y(programId, program?.level ?? 'BACHELOR');
  const demoOutlook = demo.share;
  let demoValue: number | null = null;
  if (demoOutlook !== null) {
    // requiredShare 0.05% (5e-4) → 50; 0.001% → ~100; 0.2% → ~0.
    demoValue = clamp(100 - (demoOutlook / 0.002) * 100);
  }

  // Strategic-sector alignment: 100 if any KMITL career maps to a
  // strategic-sector group; 50 otherwise.
  let sectorValue: number | null = null;
  if (program && program.kmitlCareerIds.length > 0) {
    const careers = await prisma.kmitlCareer.findMany({
      where: { kmitlCareerId: { in: program.kmitlCareerIds }, ...realDataWhere() },
      select: { groupName: true },
    });
    const inStrategic = careers.some((c) => STRATEGIC_KMITL_GROUPS.has(c.groupName));
    sectorValue = inStrategic ? 100 : 50;
  }

  // v3.6: pedagogical_fit driver — discipline-fit score from
  // ProgramPedagogyAssessment.overallScore (`program-pedagogy.v1`).
  // Null when the assessment hasn't run yet — completeness drops, no
  // penalty applied.
  const pedagogyAssessment = await prisma.programPedagogyAssessment.findUnique({
    where: { programId },
    select: { overallScore: true, disciplineFitScore: true, qaScore: true },
  });
  const pedagogicalFit: number | null = pedagogyAssessment?.overallScore ?? null;

  const drivers = [
    {
      label: 'labour_market_alignment',
      value: kmitlAlignment === null ? null : clamp(kmitlAlignment),
      raw: kmitlAlignment,
    },
    { label: 'demand_match_filled', value: demandMatchValue, raw: { totalRelevant: matchRows.length } },
    { label: 'demographic_resilience', value: demoValue, raw: { requiredShare10y: demoOutlook, region: demo.region, reason: demo.reason } },
    // `targetedCareers` is the raw-payload field surfaced on the
    // hover tooltip for this driver. It's the COUNT of LinkedIn-demand
    // career groups the program has been mapped to — used to
    // disambiguate "high score because actually strategic" from "high
    // score from a fluke 1-career match". We deliberately don't say
    // "kmitl" in any user-visible string — KMITL is the API host, the
    // data origin is LinkedIn (subscribed by MHESI). See
    // memory/feedback_kmitl_data_attribution.md.
    { label: 'strategic_sector_alignment', value: sectorValue, raw: { targetedCareers: program?.kmitlCareerIds.length ?? 0 } },
    await jobThaiDemandAlignmentDriver(programId),
    {
      label: 'pedagogical_fit',
      value: pedagogicalFit === null ? null : clamp(pedagogicalFit),
      raw: pedagogyAssessment
        ? {
            overall: pedagogyAssessment.overallScore,
            disciplineFit: pedagogyAssessment.disciplineFitScore,
            qa: pedagogyAssessment.qaScore,
          }
        : null,
    },
  ];
  return summariseDrivers('relevance', drivers);
}

async function scoreRelevanceScope(
  scopeId: string,
  scope: ScopeLevel,
  programAlignment: Map<string, number>,
): Promise<HealthScore> {
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  if (programIds.length === 0) {
    return noDataScore('relevance');
  }
  const alignmentValues = programIds
    .map((id) => programAlignment.get(id))
    .filter((v): v is number => v !== undefined);
  const alignment =
    alignmentValues.length > 0
      ? alignmentValues.reduce((a, b) => a + b, 0) / alignmentValues.length
      : null;

  const matchRows = await prisma.programDemandMatch.findMany({
    where: { programId: { in: programIds }, relevant: true, ...demandMatchSourceWhere(DEMAND_SOURCE_LINKEDIN), ...realDataWhere() },
    select: { matched: true, programId: true },
  });
  const byProgram = new Map<string, { m: number; t: number }>();
  for (const r of matchRows) {
    const c = byProgram.get(r.programId) ?? { m: 0, t: 0 };
    c.t++;
    if (r.matched) c.m++;
    byProgram.set(r.programId, c);
  }
  const matchValues = [...byProgram.values()].filter((c) => c.t > 0).map((c) => (c.m / c.t) * 100);
  const demandMatch =
    matchValues.length > 0 ? matchValues.reduce((a, b) => a + b, 0) / matchValues.length : null;

  // v5.0: the three per-program drivers are rolled up from the program
  // scores rather than dropped. Before this, faculty relevance was the
  // mean of ONE surviving low driver (labour_market_alignment, 8-20)
  // while the three high ones were discarded — demographic resilience
  // ~97, strategic sector ~100, pedagogical fit ~85. Every faculty
  // therefore read 8-32 against a program mean of 68-83, a -56 pt
  // dimension gap that dominated the cockpit's faculty composites.
  const index = await getProgramScoreIndex();
  const drivers = [
    { label: 'labour_market_alignment', value: alignment === null ? null : clamp(alignment), raw: alignment },
    { label: 'demand_match_filled', value: demandMatch === null ? null : clamp(demandMatch), raw: demandMatch },
    rolledUpDriver(index, programIds, 'relevance', 'demographic_resilience'),
    rolledUpDriver(index, programIds, 'relevance', 'strategic_sector_alignment'),
    rolledUpDriver(index, programIds, 'relevance', 'pedagogical_fit'),
    rolledUpDriver(index, programIds, 'relevance', 'jobthai_demand_alignment'),
  ];
  return summariseDrivers('relevance', drivers);
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const KMITL_DEMAND_THRESHOLD_PCT = 5;
const KMITL_QUADRANT_FALLBACK = [
  { dataScope: 'THAILAND' as const, dataSource: 'JOB_POSTINGS' as const },
  { dataScope: 'GLOBAL' as const,   dataSource: 'JOB_POSTINGS' as const },
  { dataScope: 'THAILAND' as const, dataSource: 'PROFILES' as const },
  { dataScope: 'GLOBAL' as const,   dataSource: 'PROFILES' as const },
] as const;

// Per-process memo with 60s TTL. The map is the same for every program
// + scope (it's a global program-skill ↔ KMITL-demand alignment), so
// when computeHealthScores runs in a fan-out (cockpit/matrix calls it
// once per program, ~297 times) we don't redo this expensive scan-of-
// all-programSkills 297 times. 60s window: long enough to coalesce a
// request burst, short enough to pick up new ProgramSkill rows from the
// AI extraction queue. Reset implicitly on Prisma client recreation
// (dev hot reload). Verified prod 2026-05-10: cockpit/matrix was
// hitting Postgres connection limit due to the per-program fan-out.
let _kmitlAlignmentCache: { at: number; map: Map<string, number> } | null = null;
const KMITL_ALIGNMENT_TTL_MS = 60_000;

async function computeKmitlProgramAlignment(): Promise<Map<string, number>> {
  const now = Date.now();
  if (_kmitlAlignmentCache && now - _kmitlAlignmentCache.at < KMITL_ALIGNMENT_TTL_MS) {
    return _kmitlAlignmentCache.map;
  }
  const map = await _computeKmitlProgramAlignmentImpl();
  _kmitlAlignmentCache = { at: now, map };
  return map;
}

async function _computeKmitlProgramAlignmentImpl(): Promise<Map<string, number>> {
  const programSkills = await prisma.programSkill.findMany({
    select: { programId: true, skillId: true },
  });
  if (programSkills.length === 0) return new Map();
  const skillsByProgram = new Map<string, Set<string>>();
  for (const ps of programSkills) {
    const set = skillsByProgram.get(ps.programId) ?? new Set();
    set.add(ps.skillId);
    skillsByProgram.set(ps.programId, set);
  }
  const out = new Map<string, number>();
  const programIds = [...skillsByProgram.keys()];
  for (const quadrant of KMITL_QUADRANT_FALLBACK) {
    const remaining = programIds.filter((id) => !out.has(id));
    if (remaining.length === 0) break;
    const demandRows = await prisma.kmitlCareerSkillDemand.findMany({
      where: {
        dataScope: quadrant.dataScope,
        dataSource: quadrant.dataSource,
        percentage: { gte: KMITL_DEMAND_THRESHOLD_PCT },
        skillId: { not: null },
        ...realDataWhere(),
      },
      select: { skillId: true },
      distinct: ['skillId'],
    });
    if (demandRows.length === 0) continue;
    const demanded = new Set(demandRows.map((r) => r.skillId!).filter(Boolean));
    for (const pid of remaining) {
      const skills = skillsByProgram.get(pid)!;
      let matched = 0;
      for (const sid of skills) if (demanded.has(sid)) matched++;
      if (matched > 0 && skills.size > 0) out.set(pid, (matched / skills.size) * 100);
    }
  }
  return out;
}

const DEMOGRAPHIC_PROJECTION_SOURCE = 'NESDC-PopProj-2010-2040';

export interface RequiredShareResult {
  share: number | null;
  /** The projection region used; null when none resolved. */
  region: string | null;
  /** Why the share is null, when it is. */
  reason: string | null;
}

// The 0.002 curve in the driver is calibrated for a REGIONAL cohort, so the
// national 'TH' series is never substituted: an unset or unmatched region
// leaves the driver null (a data gap, not a score).
export async function computeRequiredShareAt10Y(
  programId: string,
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
): Promise<RequiredShareResult> {
  const cohort = level === 'BACHELOR' ? '18-22' : '23-29';
  const targetYear = new Date().getUTCFullYear() + 10;
  const regionRows = await prisma.demographicProjection.findMany({
    where: { source: DEMOGRAPHIC_PROJECTION_SOURCE },
    distinct: ['region'],
    select: { region: true },
  });
  const region = projectionRegionForInstitution(regionRows.map((r) => r.region));
  if (region === NATIONAL_REGION) {
    return {
      share: null,
      region: null,
      reason:
        'region-not-set: set the organisation region to one of the projection regions (' +
        regionRows.map((r) => r.region).filter((r) => r !== NATIONAL_REGION).join(', ') +
        ')',
    };
  }
  const projection = await prisma.demographicProjection.findFirst({
    where: {
      region,
      ageCohort: cohort,
      year: targetYear,
      source: DEMOGRAPHIC_PROJECTION_SOURCE,
    },
    select: { population: true },
  });
  if (!projection || projection.population <= 0) return { share: null, region, reason: 'no-projection' };
  const enrollment = await prisma.enrollmentMetric.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: { academicYear: 'desc' },
    take: 2,
    select: { enrolled: true },
  });
  if (enrollment.length === 0) return { share: null, region, reason: 'no-enrollment' };
  // Use the prior year if it's higher (in-progress current year is
  // partial — enrolled count would be too small).
  const baseline = enrollment.length >= 2 && enrollment[1]!.enrolled > enrollment[0]!.enrolled
    ? enrollment[1]!.enrolled
    : enrollment[0]!.enrolled;
  if (baseline === 0) return { share: null, region, reason: 'no-enrollment' };
  return { share: baseline / projection.population, region, reason: null };
}

async function collectProgramIdsForScope(scopeId: string, scope: ScopeLevel): Promise<string[]> {
  if (scope === 'program') return [scopeId];
  // Canonical+ACTIVE only, matching resolveChildren — so a scope score
  // aggregates exactly the programs listed beneath it. Before v5.0 this
  // helper counted retired and non-canonical rows that the heatmap never
  // showed, so the relevance and capability scope drivers averaged a
  // different population than the row they appeared on.
  const canonical = { status: 'ACTIVE' as const, sequenceNoFromSheet: { not: null } };
  if (scope === 'department') {
    const ps = await prisma.program.findMany({
      where: { departmentId: scopeId, ...canonical },
      select: { id: true },
    });
    return ps.map((p) => p.id);
  }
  if (scope === 'faculty') {
    const ps = await prisma.program.findMany({
      where: {
        OR: [{ facultyId: scopeId }, { department: { facultyId: scopeId } }],
        ...canonical,
      },
      select: { id: true },
    });
    return ps.map((p) => p.id);
  }
  // university
  const ps = await prisma.program.findMany({ where: canonical, select: { id: true } });
  return ps.map((p) => p.id);
}

function extractSubjectSignature(programmeName: string): string {
  const inParens = programmeName.match(/\(([^)]+)\)/);
  if (inParens) return normaliseSubjectKey(inParens[1]!);
  const withSakha = programmeName.match(/สาขาวิชา\s*([^\s,()/]+(?:\s+[^\s,()/]+)?)/);
  if (withSakha) return normaliseSubjectKey(withSakha[1]!);
  return normaliseSubjectKey(programmeName);
}

// Normalise a Thai discipline key for cross-row equality. Strips
// degree-name suffixes (บัณฑิต / มหาบัณฑิต / ดุษฎีบัณฑิต), the
// "หลักสูตร"/"สาขาวิชา" prefix words, and the mai-thanthakhat (์) silent
// mark — so "แพทยศาสตรบัณฑิต" and "แพทยศาสตร์" both collapse to
// "แพทยศาสตร". Necessary because the new TCAS funnel doesn't carry the
// peer institutions' programmeName format; we resolve via Program.nameTh
// which often has the degree-only form.
function normaliseSubjectKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^(หลักสูตร|สาขาวิชา)\s*/g, '')
    .replace(/(ดุษฎีบัณฑิต|มหาบัณฑิต|บัณฑิต)$/g, '')
    .replace(/์/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface SeriesPoint { year: number; value: number }

/**
 * Drops any point at or after `currentAcademicYearCE` — the academic year
 * still being taught and billed — from a trend series. ONLY the tuition
 * driver (`tuition_trend_slope`) calls this. It deliberately does NOT run
 * on the enrolment-based series feeding `enrollment_trend_slope` /
 * `kku_intake_policy` a few lines above: those two calendars diverge
 * within the same academic year. Recruitment for an academic year is
 * finished at that year's START, so the in-progress year's headcount can
 * be a real, complete figure. Tuition for that same year is billed across
 * TWO fiscal-year cycles and isn't fully collected until roughly a year
 * AFTER it starts — see `packages/db/src/financial-year.ts` for the full
 * reasoning and `pickFinancialYear`, which this mirrors for head
 * selection. Do not "unify" this with `applyPartialYearDrop` below without
 * re-deriving that distinction first.
 */
function excludeInProgressYear(series: SeriesPoint[], currentAcademicYearCE: number): SeriesPoint[] {
  return series.filter((p) => p.year < currentAcademicYearCE);
}

// Ratio-based partial-year guard. Used AS-IS (no year exclusion) by the
// enrolment drivers above; used by the tuition driver only AFTER
// excludeInProgressYear has already removed the in-progress year — see
// that function's doc comment for why the two call sites differ.
function applyPartialYearDrop(series: SeriesPoint[]): SeriesPoint[] {
  if (series.length < 2) return series;
  const last = series[series.length - 1]!.value;
  const prior = series[series.length - 2]!.value;
  if (prior > 0 && last < prior * 0.3) return series.slice(0, -1);
  return series;
}

function linearSlope(series: SeriesPoint[]): number {
  if (series.length < 2) return 0;
  const n = series.length;
  const meanX = series.reduce((s, p) => s + p.year, 0) / n;
  const meanY = series.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of series) {
    num += (p.year - meanX) * (p.value - meanY);
    den += (p.year - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}

/**
 * v5.2 — labour-market demand, DOMESTIC 75 : GLOBAL 25.
 *
 * `jobthai_demand_alignment` (JobThai, domestic) and `labour_market_alignment`
 * (LinkedIn via MHESI, global) keep their combined weight of two drivers in the
 * Relevance mean; only the split between them becomes 75:25. Both stay separate,
 * visible drivers and both count toward completeness. A null source is a data
 * gap, so the other counts as an ordinary single driver.
 */
export const LABOUR_MARKET_DEMAND_WEIGHTS = {
  jobthai_demand_alignment: 0.75,
  labour_market_alignment: 0.25,
} as const;

const WEIGHTED_DRIVER_GROUPS: Partial<Record<HealthDimension, Readonly<Record<string, number>>>> = {
  relevance: LABOUR_MARKET_DEMAND_WEIGHTS,
};

function summariseDrivers(
  dimension: HealthDimension,
  drivers: HealthScore['drivers'],
  omittedLabels: readonly string[] = [],
): HealthScore {
  const canonical = DIMENSION_DRIVERS[dimension];
  const omitted = new Set(omittedLabels);
  const present = new Map(drivers.map((d) => [d.label, d]));

  // Canonical order, padding anything the scorer never built. An omitted
  // label is dropped entirely — it is not "missing data", it is an
  // instrument that cannot apply at this scope/level.
  const resolved: HealthScore['drivers'] = [];
  for (const label of canonical) {
    if (omitted.has(label)) continue;
    resolved.push(present.get(label) ?? { label, value: null, raw: DRIVER_NOT_COMPUTED });
  }
  // Anything a scorer emitted that is not canonical is a bug; keep it
  // visible rather than swallowing it.
  for (const d of drivers) {
    if (!(canonical as readonly string[]).includes(d.label)) resolved.push(d);
  }

  const applicable = resolved.length;
  const nonNull = resolved.filter((d) => d.value !== null);
  const completeness = applicable > 0 ? (nonNull.length / applicable) * 100 : 0;
  if (nonNull.length === 0) {
    return { score: null, dataCompletenessPct: completeness, drivers: resolved };
  }
  // A weighted group keeps the combined weight its members would have had
  // (one per non-null member) and only redistributes it internally. Collapsing
  // the pair into a single slot would have halved labour-market's say in the
  // dimension — measured on dev, Industrial Engineering 66 -> 78 from that alone.
  const group = WEIGHTED_DRIVER_GROUPS[dimension];
  let total = 0;
  let count = 0;
  let groupSum = 0;
  let groupWeight = 0;
  let groupMembers = 0;
  for (const d of nonNull) {
    const w = group?.[d.label];
    if (w === undefined) {
      total += d.value ?? 0;
      count += 1;
    } else {
      groupSum += w * (d.value ?? 0);
      groupWeight += w;
      groupMembers += 1;
    }
  }
  if (groupWeight > 0) {
    total += (groupSum / groupWeight) * groupMembers;
    count += groupMembers;
  }
  const score = total / count;
  return { score: clamp(score), dataCompletenessPct: completeness, drivers: resolved };
}

// The scorer RAN and found nothing — every canonical driver explicitly
// null, `raw` empty. Distinct from a driver `summariseDrivers` had to pad
// because this scope's scorer does not implement it (DRIVER_NOT_COMPUTED).
// Conflating the two would make the parity guard unfalsifiable.
function noDataScore(
  dimension: HealthDimension,
  omittedLabels: readonly string[] = [],
): HealthScore {
  const omitted = new Set(omittedLabels);
  return summariseDrivers(
    dimension,
    DIMENSION_DRIVERS[dimension]
      .filter((label) => !omitted.has(label))
      .map((label) => ({ label, value: null, raw: null })),
    omittedLabels,
  );
}

/** Test-only seam — `summariseDrivers` is module-private by design. */
export const summariseDriversForTest = summariseDrivers;


function combineDimensions(dims: HealthScore[]): HealthScore {
  const nonNull = dims.filter((d) => d.score !== null);
  const completenessContribs = dims.map((d) => d.dataCompletenessPct / 100);
  const avgCompleteness = (completenessContribs.reduce((s, v) => s + v, 0) / dims.length) * 100;
  if (nonNull.length === 0) {
    return { score: null, dataCompletenessPct: avgCompleteness, drivers: [] };
  }
  const score = nonNull.reduce((s, d) => s + (d.score ?? 0), 0) / nonNull.length;
  return { score: clamp(score), dataCompletenessPct: avgCompleteness, drivers: [] };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
