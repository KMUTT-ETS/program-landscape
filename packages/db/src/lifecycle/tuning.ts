// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle verdict — TUNING
//
// Every number that decides how a program's signals become a trajectory
// score (0-100) and a verdict (SUNSET / STABLE / RISING / FRONTIER) lives in
// this file. If you are adapting the lifecycle verdict for your institution,
// this is normally the only file you edit.
//
// Before you change anything:
//   1. Read ./README.md and docs/guides/adapt-a-methodology.md.
//   2. Set LIFECYCLE_INSTITUTION_REVISION below. The stamped methodology
//      version becomes `<upstream version>+<your revision>`, so a verdict your
//      installation computed can never be mistaken for one computed by the
//      upstream formula. Bump the revision every time you change a value here.
//   3. Pin the new version in packages/db/test/lifecycle-tuning-pin.test.ts.
//      That test fails whenever a value here changes without a new version,
//      which is what keeps published verdicts reproducible.
//   4. Record what you changed and why in your copy of ./README.md
//      ("Version history").
//
// What is NOT here (shared with the health score, so it lives in
// ../health-score/tuning.ts and changing it moves both methodologies):
//   - REVENUE_TARGET_THB_BY_LEVEL       → the `revenue_scale` driver's target
//   - FLAGSHIP_REVENUE_FLOOR_THB        → the `lowRevenuePotentialFrontierCap` gate
//   - shared.partialYearBelowShareOfPrior → which year's revenue counts (load.ts)
//
// Which file computes each driver and gate: see ./README.md.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Your institution's revision of the upstream lifecycle methodology, or null
 * when you run the upstream values unchanged.
 *
 * Format: lowercase letters, digits, dots and dashes, starting with a letter
 * or digit — e.g. 'kmutt.1', then 'kmutt.2' after the next change. The
 * stamped version becomes e.g. 'lifecycle.v1.4+kmutt.1'.
 *
 * Upstream (KKU) leaves this null and bumps UPSTREAM_LIFECYCLE_VERSION in
 * ./version.ts instead.
 */
export const LIFECYCLE_INSTITUTION_REVISION: string | null = null;

/** Band rows as [atLeast, contribution], thresholds descending. The first
 *  row whose threshold the value reaches (value >= atLeast) wins; a value
 *  below every row gets `below`. */
export type BandTable = ReadonlyArray<readonly [atLeast: number, contribution: number]>;

/** A banded driver: a step function of its input. */
export interface Banded {
  readonly bands: BandTable;
  readonly below: number;
}

/** A linear driver: (value - centre) * weight, clamped to ±cap when set. */
export interface Linear {
  readonly centre: number;
  readonly weight: number;
  readonly cap?: number;
}

export const LIFECYCLE_TUNING = {
  /** Trajectory score = baseline + the sum of driver contributions, clamped
   *  to [min, max]. */
  score: { baseline: 50, min: 0, max: 100 },

  /** One entry per driver, keyed by the label shown in the app. Inputs are
   *  0-100 scores unless the comment says otherwise. A missing input always
   *  contributes 0 (no penalty for data gaps). */
  drivers: {
    /** AI-readiness composite. The single heaviest driver (±25). */
    ai_readiness: { centre: 50, weight: 0.5 } satisfies Linear,
    /** Overall health score (±20). */
    health_overall: { centre: 50, weight: 0.4 } satisfies Linear,
    /** Health driver attractiveness.enrollment_trend_slope, capped ±15. */
    enrollment_trend: { centre: 50, weight: 0.6, cap: 15 } satisfies Linear,
    /** Health driver financial.tuition_trend_slope, capped ±10. */
    tuition_trend: { centre: 50, weight: 0.4, cap: 10 } satisfies Linear,
    /** AI peer review's content-modernity verdict. Any other verdict, or no
     *  review, contributes `other`. */
    content_modernity: { FRONTIER: 10, OLD_SCHOOL: -10, other: 0 },
    /** Health driver relevance.labour_market_alignment. */
    labour_market_alignment: {
      bands: [[70, 15], [50, 5], [30, -5]],
      below: -15,
    } satisfies Banded,
    /** Latest annual tuition revenue ÷ the level's target
     *  (REVENUE_TARGET_THB_BY_LEVEL). Input is the ratio, not a 0-100 score. */
    revenue_scale: {
      bands: [[1.5, 10], [1.0, 5], [0.5, 0], [0.25, -5]],
      below: -10,
    } satisfies Banded,
    /** Count of `major` content gaps in the AI peer review: perGap each,
     *  never below floor. */
    major_content_gaps: { perGap: -4, floor: -12 },
    /** Health driver relevance.demographic_resilience. */
    demographic_resilience: {
      bands: [[80, 10], [50, 0]],
      below: -10,
    } satisfies Banded,
    /** Share of active students past their expected graduation, 0-1. Input
     *  is the share, not a 0-100 score. */
    delayed_graduation_share: {
      bands: [[0.25, -10], [0.15, -5], [0.05, -2]],
      below: 0,
    } satisfies Banded,
    /** Health capability dimension score. */
    capability_strength: {
      bands: [[80, 8], [60, 3], [40, 0]],
      below: -8,
    } satisfies Banded,
  },

  /** Trajectory score → verdict, before gates. FRONTIER also needs the AI
   *  peer review's content-modernity verdict to be FRONTIER; otherwise a
   *  score at or above frontierAtLeast is RISING. */
  verdict: { frontierAtLeast: 80, risingAtLeast: 65, stableAtLeast: 45 },

  /** Modifier gates — they can lower a verdict, never raise it. */
  gates: {
    /** AI readiness below this caps RISING/FRONTIER at STABLE. */
    aiReadinessStableBelow: 30,
    /** AI readiness below this caps FRONTIER at RISING. */
    aiReadinessFrontierBelow: 50,
    /** Labour-market alignment below this caps RISING/FRONTIER at STABLE. */
    labourMarketStableBelow: 30,
    /** Labour-market alignment below this caps FRONTIER at RISING. */
    labourMarketFrontierBelow: 50,
  },
} as const;
