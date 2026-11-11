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
