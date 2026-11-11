// ─────────────────────────────────────────────────────────────────────────────
// Health score — TUNING
//
// Every number that decides how a raw figure becomes a 0-100 driver score
// lives in this file. If you are adapting the health score for your
// institution, this is normally the only file you edit.
//
// Before you change anything:
//   1. Read docs/guides/adapt-a-methodology.md ("Where to change what").
//   2. Set INSTITUTION_REVISION below. The stamped methodology version becomes
//      `<upstream version>+<your revision>`, so a score your installation
//      computed can never be mistaken for one computed by the upstream
//      formula. Bump the revision every time you change a value here.
//   3. Pin the new version in packages/db/test/health-score-tuning-pin.test.ts.
//      That test fails whenever a value here changes without a new version,
//      which is what keeps published scores reproducible.
//   4. Record what you changed and why in your copy of
//      docs/methodologies/health-score.md.
//
// What is NOT here:
//   - Intake floors per level          → organisation profile (admin UI)
//   - Region for demographic resilience → organisation profile (admin UI)
//   - Each faculty's teaching-mode band → Faculty.sfrBand (admin UI); the
//     band THRESHOLDS are below
//   - The DQ digital-competency band   → packages/db/src/student-dq.ts
//     (shared with the DQ dashboard, so it lives beside the data)
//   - Zone cut-offs (danger < 40, healthy ≥ 65) → packages/shared/src/health/zones.ts
//     (presentation, not formula: moving them needs no version change)
//
// Which file computes each driver: see ./README.md.
// ─────────────────────────────────────────────────────────────────────────────

import type { SfrBand } from '@prisma/client';

/**
 * Your institution's revision of the upstream health-score methodology, or
 * null when you run the upstream values unchanged.
 *
 * Format: lowercase letters, digits, dots and dashes, starting with a letter
 * or digit — e.g. 'kmutt.1', then 'kmutt.2' after the next change. The
 * stamped version becomes e.g. 'health-score.v5.6+kmutt.1'.
 *
 * Upstream (KKU) leaves this null and bumps UPSTREAM_HEALTH_SCORE_VERSION in
 * ./version.ts instead.
 */
export const INSTITUTION_REVISION: string | null = null;

/** A score curve given as [input, score] points, inputs ascending. Below the
 *  first point the score is the first point's score; at or above the last
 *  point it is the last point's score; in between it is linear. */
export type CurvePoints = ReadonlyArray<readonly [input: number, score: number]>;

// ── Institution policy ──────────────────────────────────────────────────────

/** Annual tuition revenue target by program level (THB). Used by the
 *  financial dimension's `revenue_scale` driver AND by lifecycle.v1.4's
 *  `revenue_scale` driver. Reflects KKU's actual revenue distribution as of
 *  2026 — re-calibrate if the underlying tuition/cohort economics differ. */
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
 *  RISING via `lowRevenuePotentialFrontierCap`. Not a health-score input;
 *  it sits here because it is calibrated against the same revenue targets.
 *
 *  Calibration: 3M ≈ 30 bachelor students × 100k THB tuition, or
 *  20 master students × 150k, or 20 PhD students × 150k. Reflects the
 *  smallest cohort that can plausibly carry "flagship" institutional
 *  weight given the non-degree HRD shift squeezing post-grad programs. */
export const FLAGSHIP_REVENUE_FLOOR_THB = 3_000_000;

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

// ── Driver curves ───────────────────────────────────────────────────────────

export const HEALTH_SCORE_TUNING = {
  /** Used by more than one dimension. */
  shared: {
    /** A trend series drops its latest year when that year is below this
     *  share of the year before (a partial year, not a real decline).
     *  Applies to `enrollment_trend_slope`, `kku_intake_policy` and
     *  `tuition_trend_slope`. */
    partialYearBelowShareOfPrior: 0.3,
  },

  attractiveness: {
    /** `tcas_competition_ratio` — applicants per planned seat → score.
     *  ≥10× : 100, 5× : 70, 2× : 40, 1× : 20, 0 : 0. */
    competitionRatio: [
      [0, 0],
      [1, 20],
      [2, 40],
      [5, 70],
      [10, 100],
    ] as CurvePoints,
    /** `tcas_fill_rate` — admitted / seats at or above this share → 100,
     *  linear below. */
    fillRateFullAt: 0.5,
    /** `tcas_registration_yield` — reported / sent to Clearinghouse.
     *  ≥0.85 : 100, 0.5 : 50, linear below. */
    registrationYield: [
      [0, 0],
      [0.5, 50],
      [0.85, 100],
    ] as CurvePoints,
    /** `tcas_competition_vs_peers` — score when the programme's competition
     *  ratio equals the peer median (2× the median → twice this, capped 100). */
    peerParityScore: 50,
    /** `enrollment_trend_slope` — flat → 50; this many extra students per year
     *  → 100; the same decline → 0. */
    enrollmentSlopeStudentsPerYearForFull: 5,
  },

  financial: {
    /** `net_contribution_per_student` — 0 → 50; this many THB per student → 100;
     *  the same loss → 0. */
    netContributionPerStudentThbForFull: 100_000,
    /** `net_contribution_per_program` (faculty / department / university only)
     *  — same shape, per programme in scope. */
    netContributionPerProgramThbForFull: 20_000_000,
    /** `revenue_coverage_program_direct` and `revenue_coverage_ratio` —
     *  tuition / cost at this ratio → 100. */
    revenueCoverageTargetRatio: 1.2,
    /** `revenue_coverage_program_direct` when a programme reports tuition but
     *  no direct cost. */
    revenueCoverageScoreWhenNoCost: 80,
    /** `tuition_trend_slope` — flat → 50; this many THB per year growth → 100;
     *  the same decline → 0. */
    tuitionSlopeThbPerYearForFull: 500_000,
    /** `revenue_scale` — score = min(revenue / level target, cap) × points.
     *  With 50 and 2: half the target → 25, the target → 50, 2× → 100.
     *  The level targets are REVENUE_TARGET_THB_BY_LEVEL above. */
    revenueScalePointsPerTarget: 50,
    revenueScaleCapTargetMultiple: 2,
  },

  capability: {
    /** `senior_rank_share` — ranks that count as senior, and the share of
     *  active teaching staff at those ranks that scores 100 (linear below). */
    seniorRanks: ['PROF', 'ASSOC_PROF'] as readonly string[],
    seniorRankShareFullAt: 0.5,
    /** `publications_per_faculty` — research outputs per active staff member
     *  over the window that scores 100 (linear below). */
    publicationsPerFacultyForFull: 5,
    publicationsWindowYears: 3,
    /** `retirement_horizon_5y` — staff retiring within this many years count
     *  against the score. The driver label keeps "5y" whatever this is set to. */
    retirementHorizonYears: 5,
    /** `student_faculty_ratio` — students per active staff member. At or
     *  below `lower` → 100, at or above `upper` → 0, linear between.
     *  Each faculty picks its band in the admin UI (Faculty.sfrBand).
     *
     *   CLINICAL     — bedside / lab-supervised programs
     *   STEM_LAB     — lab-intensive sciences + engineering
     *   STUDIO       — studio / individual-instruction arts
     *   PROFESSIONAL — business / law / professional cohorts
     *   HUMANITIES   — lecture-driven humanities + social sciences
     *
     *  Mirrors QS subject-band conventions: clinical disciplines need far
     *  more 1:1 supervision than humanities or business, so one flat scale
     *  would punish humanities programs and over-reward medical schools. */
    studentFacultyRatioBands: {
      CLINICAL:     { lower: 6,  upper: 16 },
      STEM_LAB:     { lower: 10, upper: 28 },
      STUDIO:       { lower: 8,  upper: 22 },
      PROFESSIONAL: { lower: 18, upper: 38 },
      HUMANITIES:   { lower: 22, upper: 48 },
    } as Record<SfrBand, { lower: number; upper: number }>,
    /** Band for a faculty with none set, and for the university-wide row
     *  (which mixes every discipline). */
    defaultStudentFacultyBand: 'PROFESSIONAL' as SfrBand,
  },

  outcomes: {
    /** `tcas_min_score_percentile` — fewest peer programmes needed before a
     *  percentile is reported (fewer → null). */
    tcasPercentileMinPeers: 3,
    /** `average_salary` at programme scope — this salary → 0, `fullAtThb` → 100,
     *  linear between. */
    averageSalary: { zeroAtThb: 15_000, fullAtThb: 35_000 },
    /** `average_salary` at faculty / department / university scope:
     *  0 → 0, this salary → 100, linear. (A different curve from programme
     *  scope; kept as published in v5.6.) */
    averageSalaryScopeFullAtThb: 30_000,
    /** `further_study_rate` — share of graduates continuing to graduate
     *  school. Both extremes are negative signals (no academic pipeline /
     *  under-employment), so the curve peaks in the middle:
     *   0 → scoreAtZero, rising to 100 at `risingTo`;
     *   100 up to `plateauTo`;
     *   falling to `scoreAtDecliningEnd` at `decliningTo`;
     *   then tapering over `taperSpan` to `floor`, never below it. */
    furtherStudy: {
      scoreAtZero: 50,
      risingTo: 0.05,
      plateauTo: 0.15,
      decliningTo: 0.3,
      scoreAtDecliningEnd: 70,
      taperSpan: 0.2,
      floor: 30,
    },
    /** `student_satisfaction` — mean course-evaluation rating on the 1-5
     *  scale. `zeroAtRating` → 0, `fullAtRating` → 100, linear. Anchored on
     *  the band where 95%+ of KKU's ratings sit, so programmes differentiate;
     *  a naive 1 → 0, 5 → 100 would put every programme between 75 and 100. */
    studentSatisfaction: { zeroAtRating: 3.5, fullAtRating: 5.0 },
  },

  relevance: {
    /** `labour_market_alignment` — a skill counts as demanded when at least
     *  this % of LinkedIn-via-MHESI postings/profiles in its career name it. */
    linkedInSkillDemandThresholdPct: 5,
    /** `demographic_resilience` — the programme's intake as a share of the
     *  regional age cohort projected 10 years out. 0 → 100, this share → 0,
     *  linear. Calibrated for a REGIONAL cohort. */
    demographicRequiredShareForZero: 0.002,
    /** `strategic_sector_alignment` — LinkedIn career groups treated as
     *  strategic sectors, and the score with / without a mapped career in
     *  one of them. */
    strategicCareerGroups: [
      'IT',
      'Engineer',
      'Health Science',
      'Smart Farmer',
      'New S Curve',
      'Food',
    ] as readonly string[],
    strategicSectorScore: 100,
    nonStrategicSectorScore: 50,
    /** Weighting inside the Relevance mean; see LABOUR_MARKET_DEMAND_WEIGHTS. */
    labourMarketDemandWeights: LABOUR_MARKET_DEMAND_WEIGHTS,
  },
} as const;
