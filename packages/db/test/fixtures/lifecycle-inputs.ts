// Builders for LifecycleInputs in tests. Only the fields the lifecycle
// formula reads are meaningful; the rest are filler.

import type { HealthScore, HealthScoreRow } from '../../src/health-score';
import type { LifecycleInputs } from '../../src/lifecycle/types';

/** The health signals lifecycle reads. null = signal absent. */
export interface HealthSignals {
  overall?: number | null;
  completeness?: number;
  enrollmentTrend?: number | null;
  tuitionTrend?: number | null;
  labourMarket?: number | null;
  resilience?: number | null;
  capability?: number | null;
}

function dim(
  score: number | null,
  drivers: Array<{ label: string; value: number | null }> = [],
): HealthScore {
  return {
    score,
    dataCompletenessPct: 100,
    drivers: drivers.map((d) => ({ ...d, raw: null })),
  };
}

/** A HealthScoreRow carrying only the given signals. An absent sub-driver
 *  is left out of its dimension, as the scorer does when it can't compute
 *  one; pass null to include it with a null value. */
export function healthRow(s: HealthSignals): HealthScoreRow {
  const present = (label: string, v: number | null | undefined) =>
    v === undefined ? [] : [{ label, value: v }];
  return {
    scope: 'program',
    scopeId: 'p1',
    scopeLabel: 'P',
    scopeLabelTh: 'P',
    scopeLabelEn: 'P',
    parentScopeId: null,
    methodologyVersion: 'test',
    latestFreshness: null,
    overall: { ...dim(s.overall ?? null), dataCompletenessPct: s.completeness ?? 80 },
    dimensions: {
      attractiveness: dim(50, present('enrollment_trend_slope', s.enrollmentTrend)),
      financial: dim(50, present('tuition_trend_slope', s.tuitionTrend)),
      capability: dim(s.capability ?? null),
      outcomes: dim(50),
      relevance: dim(50, [
        ...present('labour_market_alignment', s.labourMarket),
        ...present('demographic_resilience', s.resilience),
      ]),
    },
  };
}

/** Neutral inputs: AI readiness 50, no health row, no review, no revenue,
 *  peer selection present. Every driver contributes 0. */
export function baseInputs(over: Partial<LifecycleInputs> = {}): LifecycleInputs {
  return {
    health: null,
    aiReadiness: {
      overallScore: 50,
      subScores: { curriculumIntegration: 50, skillResilience: 50, researchPresence: 50 },
    },
    peerReview: null,
    hasPeerSelection: true,
    cohorts: { totalActive: 0, delayedCount: 0 },
    demographicRiskLevel: null,
    level: null,
    latestAnnualRevenueThb: null,
    latestRevenueFiscalYear: null,
    ...over,
  };
}

export function withAi(overallScore: number): LifecycleInputs['aiReadiness'] {
  return {
    overallScore,
    subScores: { curriculumIntegration: 50, skillResilience: 50, researchPresence: 50 },
  };
}
