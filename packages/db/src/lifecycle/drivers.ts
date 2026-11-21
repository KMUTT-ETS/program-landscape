// The eleven lifecycle drivers. Each turns one signal into a signed
// contribution to the trajectory score; the numbers are in ./tuning.ts.
// A missing signal always contributes 0 — no penalty for data gaps.

import type { HealthDimension, HealthScoreRow } from '../health-score';
import { REVENUE_TARGET_THB_BY_LEVEL } from '../health-score/tuning';
import { bandScore, linearContribution } from './bands';
import { LIFECYCLE_TUNING, type Linear } from './tuning';
import type { LifecycleInputs, ProgramLifecycleDriver } from './types';

const T = LIFECYCLE_TUNING.drivers;

type RevenueLevel = keyof typeof REVENUE_TARGET_THB_BY_LEVEL;

function revenueTargetFor(level: string | null): number | null {
  if (!level || !(level in REVENUE_TARGET_THB_BY_LEVEL)) return null;
  return REVENUE_TARGET_THB_BY_LEVEL[level as RevenueLevel];
}

/** The revenue_scale driver: latest annual tuition revenue against the
 *  level's target. 0 when revenue is missing or ≤ 0, or the level has no
 *  target (no penalty for data gaps). */
export function computeRevenueScaleContribution(
  latestAnnualRevenueThb: number | null,
  level: RevenueLevel | string | null,
): number {
  if (latestAnnualRevenueThb === null || latestAnnualRevenueThb <= 0) return 0;
  const target = revenueTargetFor(level);
  if (target === null) return 0;
  return bandScore(latestAnnualRevenueThb / target, T.revenue_scale);
}

/** A health sub-driver's 0-100 value, or null when it wasn't computed. */
function healthDriverValue(
  health: HealthScoreRow | null,
  dim: HealthDimension,
  label: string,
): number | null {
  return health?.dimensions[dim].drivers.find((d) => d.label === label)?.value ?? null;
}

/** The peer review's content-modernity verdict, or null when no review. */
export function modernityVerdictOf(inputs: LifecycleInputs): string | null {
  return inputs.peerReview?.contentModernity?.verdict ?? null;
}

/** The health relevance driver labour_market_alignment, or null. */
export function labourMarketScoreOf(inputs: LifecycleInputs): number | null {
  return healthDriverValue(inputs.health, 'relevance', 'labour_market_alignment');
}

function linearFromHealth(
  inputs: LifecycleInputs,
  dim: HealthDimension,
  healthLabel: string,
  outLabel: string,
  t: Linear,
): ProgramLifecycleDriver {
  const value = healthDriverValue(inputs.health, dim, healthLabel);
  if (value === null) return { label: outLabel, contribution: 0, raw: { score: null } };
  return { label: outLabel, contribution: linearContribution(value, t), raw: { score: value } };
}

/** All eleven drivers, in the fixed order the trajectory score sums them
 *  (and that breaks ties when they are later sorted by magnitude). */
export function buildLifecycleDrivers(inputs: LifecycleInputs): ProgramLifecycleDriver[] {
  const { health, aiReadiness, cohorts, level } = inputs;

  const overall = health?.overall.score ?? null;
  const modernity = modernityVerdictOf(inputs);
  const labourMarket = labourMarketScoreOf(inputs);
  const resilience = healthDriverValue(health, 'relevance', 'demographic_resilience');
  const capability = health?.dimensions.capability.score ?? null;
  const majorGapCount =
    inputs.peerReview?.contentGaps?.filter((g) => g.severity === 'major').length ?? 0;
  const delayedShare = cohorts.totalActive > 0 ? cohorts.delayedCount / cohorts.totalActive : 0;

  return [
    {
      label: 'ai_readiness',
      contribution: linearContribution(aiReadiness.overallScore, T.ai_readiness),
      raw: {
        score: aiReadiness.overallScore,
        curriculumIntegration: aiReadiness.subScores.curriculumIntegration,
        skillResilience: aiReadiness.subScores.skillResilience,
        researchPresence: aiReadiness.subScores.researchPresence,
      },
    },
    {
      label: 'health_overall',
      contribution: overall === null ? 0 : linearContribution(overall, T.health_overall),
      raw: { score: overall, completeness: health?.overall.dataCompletenessPct ?? 0 },
    },
    linearFromHealth(inputs, 'attractiveness', 'enrollment_trend_slope', 'enrollment_trend', T.enrollment_trend),
    linearFromHealth(inputs, 'financial', 'tuition_trend_slope', 'tuition_trend', T.tuition_trend),
    {
      label: 'content_modernity',
      contribution:
        modernity === 'FRONTIER'
          ? T.content_modernity.FRONTIER
          : modernity === 'OLD_SCHOOL'
            ? T.content_modernity.OLD_SCHOOL
            : T.content_modernity.other,
      raw: { verdict: modernity ?? 'unknown' },
    },
    {
      label: 'labour_market_alignment',
      contribution: labourMarket === null ? 0 : bandScore(labourMarket, T.labour_market_alignment),
      raw: { score: labourMarket },
    },
    {
      label: 'revenue_scale',
      contribution: computeRevenueScaleContribution(inputs.latestAnnualRevenueThb, level),
      raw: {
        latestAnnualRevenueThb: inputs.latestAnnualRevenueThb,
        fiscalYear: inputs.latestRevenueFiscalYear,
        level,
        target: level ? revenueTargetFor(level) : null,
      },
    },
    {
      label: 'major_content_gaps',
      contribution: Math.max(majorGapCount * T.major_content_gaps.perGap, T.major_content_gaps.floor),
      raw: { count: majorGapCount },
    },
    {
      label: 'demographic_resilience',
      contribution: resilience === null ? 0 : bandScore(resilience, T.demographic_resilience),
      raw: { score: resilience, riskLevel: inputs.demographicRiskLevel ?? 'unknown' },
    },
    {
      label: 'delayed_graduation_share',
      contribution: bandScore(delayedShare, T.delayed_graduation_share),
      raw: { delayedPct: delayedShare * 100 },
    },
    {
      label: 'capability_strength',
      contribution: capability === null ? 0 : bandScore(capability, T.capability_strength),
      raw: { score: capability },
    },
  ];
}
