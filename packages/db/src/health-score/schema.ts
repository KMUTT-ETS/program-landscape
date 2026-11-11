import { z } from 'zod';
import { GRANT_AWARD_LABEL } from '../grant-award';

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
