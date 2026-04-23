import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════
// Scenario engine types (prompt 09)
//
// Pure data. No Prisma imports, no DB, no side effects — this module
// compiles into @kku/shared, which is consumable by both apps/api and
// the Next.js edge runtime.
// ═══════════════════════════════════════════════════════════════════════

export const SCENARIO_ENGINE_VERSION = 'scenario-engine.v1';

export const ScenarioTypeSchema = z.enum([
  'SUNSET',
  'MERGE',
  'LAUNCH',
  'RESHAPE',
  'REBALANCE',
]);
export type ScenarioType = z.infer<typeof ScenarioTypeSchema>;

export const ScenarioWorkflowStatusSchema = z.enum([
  'DRAFT',
  'SHARED',
  'COUNCIL_REVIEWED',
  'DECIDED',
  'ARCHIVED',
]);
export type ScenarioWorkflowStatus = z.infer<typeof ScenarioWorkflowStatusSchema>;

// ── Baseline snapshot ─────────────────────────────────────────────────
export const BaselineProgramSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameEn: z.string(),
  nameTh: z.string(),
  facultyId: z.string(),
  departmentId: z.string().nullable(),
  currentEnrollment: z.number().int().nonnegative(),
  currentGraduates: z.number().int().nonnegative(),
  tuitionPerStudent: z.number().nonnegative(),
  costPerStudent: z.number().nonnegative(),
  skillIds: z.array(z.string()),
});
export type BaselineProgram = z.infer<typeof BaselineProgramSchema>;

export const BaselineSnapshotSchema = z.object({
  baseYear: z.number().int(),
  programs: z.array(BaselineProgramSchema),
  demographicMultiplierByYear: z.record(z.string(), z.number().positive()),
});
export type BaselineSnapshot = z.infer<typeof BaselineSnapshotSchema>;

// ── Assumptions ───────────────────────────────────────────────────────
//
// Each assumption has a canonical system default; scenario authors
// override a subset. Engine merges default ⊕ override before running.
export const ScenarioAssumptionsSchema = z.object({
  // Annual % growth applied to tuitionPerStudent.
  tuitionGrowthPct: z.number().default(0.03),
  // Annual % inflation applied to costPerStudent.
  costInflationPct: z.number().default(0.025),
  // Annual demand-growth multiplier on enrollment demand signal.
  demandGrowthPct: z.number().default(0.02),
  // Year-over-year student retention (1.0 = keep all).
  retentionRate: z.number().min(0).max(1).default(0.92),
  // Scalar applied on top of the baseline's demographicMultiplier (1.0 = no change).
  demographicShockPct: z.number().default(0),
  // Financial stress test — -0.20 => 20% revenue haircut every year.
  financialShockPct: z.number().default(0),
  // AI/automation displacement applied to graduate employment rate (0.10 = 10% displacement).
  aiDisplacementPct: z.number().default(0),
});
export type ScenarioAssumptions = z.infer<typeof ScenarioAssumptionsSchema>;

export const DEFAULT_ASSUMPTIONS: ScenarioAssumptions = ScenarioAssumptionsSchema.parse({});

// ── Interventions ─────────────────────────────────────────────────────
//
// Discriminated union keyed by `kind`. Engine applies these in order;
// later interventions see earlier interventions' effects.
const SunsetInterventionSchema = z.object({
  kind: z.literal('sunset'),
  programId: z.string(),
  // Years over which enrollment phases out linearly. Default 4.
  phaseOutYears: z.number().int().min(1).max(10).default(4),
});

const MergeInterventionSchema = z.object({
  kind: z.literal('merge'),
  // First program is the "surviving" one; others are absorbed.
  programIds: z.array(z.string()).min(2),
  // Cost-synergy coefficient applied to combined cost. 0.85 = 15% saving.
  synergyCoefficient: z.number().min(0.5).max(1.2).default(0.85),
  // Enrollment retention after merge (some students drop out during transitions).
  mergeRetention: z.number().min(0.5).max(1.0).default(0.92),
});

const LaunchInterventionSchema = z.object({
  kind: z.literal('launch'),
  // Synthetic program spec.
  name: z.string(),
  nameTh: z.string().optional(),
  targetIntake: z.number().int().positive(),
  // Years over which intake ramps up linearly to target. Default 3.
  rampYears: z.number().int().min(1).max(5).default(3),
  tuitionPerStudent: z.number().positive(),
  costPerStudent: z.number().positive(),
  targetSkillIds: z.array(z.string()).default([]),
  facultyId: z.string(),
  departmentId: z.string().nullable().optional(),
});

const ReshapeInterventionSchema = z.object({
  kind: z.literal('reshape'),
  programId: z.string(),
  // All optional — set only fields that change.
  newIntake: z.number().int().positive().optional(),
  newTuitionPerStudent: z.number().positive().optional(),
  newCostPerStudent: z.number().positive().optional(),
  addSkillIds: z.array(z.string()).optional(),
  removeSkillIds: z.array(z.string()).optional(),
});

const RebalanceInterventionSchema = z.object({
  kind: z.literal('rebalance'),
  // Bulk action — multiply intake of all programs matching filter.
  intakeMultiplier: z.number().positive(),
  // Optional program scope — if absent, applies to all programs.
  programIds: z.array(z.string()).optional(),
});

export const InterventionSchema = z.discriminatedUnion('kind', [
  SunsetInterventionSchema,
  MergeInterventionSchema,
  LaunchInterventionSchema,
  RebalanceInterventionSchema,
  ReshapeInterventionSchema,
]);
export type Intervention = z.infer<typeof InterventionSchema>;

// ── Outcomes ─────────────────────────────────────────────────────────
export const ProjectionYearSchema = z.object({
  year: z.number().int(),
  enrolled: z.number(),
  graduates: z.number(),
  revenue: z.number(),
  cost: z.number(),
  netContribution: z.number(),
  skillProduction: z.record(z.string(), z.number()),
});
export type ProjectionYear = z.infer<typeof ProjectionYearSchema>;

export const ScenarioOutcomeSchema = z.object({
  years: z.array(ProjectionYearSchema),
  totalRevenue: z.number(),
  totalCost: z.number(),
  totalNetContribution: z.number(),
  peakEnrollment: z.number(),
  graduatesCumulative: z.number(),
});
export type ScenarioOutcome = z.infer<typeof ScenarioOutcomeSchema>;

export const SensitivityEntrySchema = z.object({
  assumptionKey: z.string(),
  deltaPct: z.number(), // e.g. 0.1 for ±10%
  lowOutcomeDelta: z.number(),  // how much totalNetContribution changes when the assumption is bumped DOWN
  highOutcomeDelta: z.number(), // same for UP
});
export type SensitivityEntry = z.infer<typeof SensitivityEntrySchema>;

export const MonteCarloBandSchema = z.object({
  // 80% CI on totalNetContribution across MC iterations.
  totalNetContributionCi80: z.tuple([z.number(), z.number()]),
  totalNetContributionMean: z.number(),
  totalNetContributionStdDev: z.number(),
  iterations: z.number().int().positive(),
});
export type MonteCarloBand = z.infer<typeof MonteCarloBandSchema>;

export const RiskEntrySchema = z.object({
  category: z.enum(['financial', 'academic', 'faculty', 'brand', 'regulatory', 'political']),
  severity: z.enum(['low', 'medium', 'high']),
  titleTh: z.string(),
  descriptionTh: z.string(),
  mitigation: z.string().optional(),
});
export type RiskEntry = z.infer<typeof RiskEntrySchema>;

export const ScenarioRunResultSchema = z.object({
  baseline: ScenarioOutcomeSchema,
  scenario: ScenarioOutcomeSchema,
  deltaTotalNetContribution: z.number(),
  deltaTotalRevenue: z.number(),
  deltaTotalCost: z.number(),
  monteCarlo: MonteCarloBandSchema,
  sensitivity: z.array(SensitivityEntrySchema),
  // Engine doesn't generate risks itself — the AI insights pipeline does.
  // Run results carry an empty array initially; API stitches risks in after AI returns.
  riskRegister: z.array(RiskEntrySchema).default([]),
  methodologyVersion: z.string(),
  seed: z.number().int(),
  monteCarloN: z.number().int().positive(),
});
export type ScenarioRunResult = z.infer<typeof ScenarioRunResultSchema>;

// ── Engine input ─────────────────────────────────────────────────────
export interface EngineInput {
  baseline: BaselineSnapshot;
  assumptions: ScenarioAssumptions;
  interventions: Intervention[];
  horizonYears: number;
  monteCarloN?: number;
  seed?: number;
}
