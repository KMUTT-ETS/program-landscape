// Health score — public surface of packages/db/src/health-score/.
//
// Five dimensions + an overall composite, 0-100 where 100 is healthy.
// Methodology: docs/methodologies/health-score.md.
// Adapting it for your institution: ./README.md, then ./tuning.ts.

export {
  REVENUE_TARGET_THB_BY_LEVEL,
  FLAGSHIP_REVENUE_FLOOR_THB,
  LABOUR_MARKET_DEMAND_WEIGHTS,
  INSTITUTION_REVISION,
  HEALTH_SCORE_TUNING,
  type CurvePoints,
} from './tuning';
export { UPSTREAM_HEALTH_SCORE_VERSION, HEALTH_SCORE_VERSION, COST_ALLOCATION_VERSION } from './version';
export { getKkuIntakePolicyVerdict, type IntakeCompliance } from './intake-policy';
export { HEALTH_DIMENSIONS, type HealthDimension, DRIVER_NOT_COMPUTED, DIMENSION_DRIVERS } from './drivers';
export {
  HealthScoreSchema,
  type HealthScore,
  HealthDimensionScoresSchema,
  type HealthDimensionScores,
  HealthScoreRowSchema,
  type HealthScoreRow,
} from './schema';
export { computeHealthScores } from './compute';
export {
  type ProgramDimensionMeans,
  type ProgramDimensionAverages,
  computeProgramDimensionAverages,
  type ProgramScoreIndexEntry,
  type ProgramScoreIndex,
  getProgramScoreIndex,
  invalidateProgramScoreIndexCache,
  rolledUpDriverForTest,
} from './program-index';
export { sfrBandFor } from './curves';
export { computeKmitlProgramAlignment, type RequiredShareResult, computeRequiredShareAt10Y } from './relevance-inputs';
export { summariseDriversForTest } from './summarise';
