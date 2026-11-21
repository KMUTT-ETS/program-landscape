// The lifecycle formula as a pure function: already-fetched inputs in,
// verdict out. No database access — load.ts does that.
//
//   trajectoryScore = clamp(baseline + Σ driver contributions)   (drivers.ts)
//   ungatedVerdict  = bands on the score                          (gates.ts)
//   verdict         = ungatedVerdict after the modifier gates     (gates.ts)

import { buildLifecycleDrivers, labourMarketScoreOf, modernityVerdictOf } from './drivers';
import { applyGates, ungatedVerdict as verdictFromScore } from './gates';
import { buildNarrative } from './narrative';
import { LIFECYCLE_TUNING } from './tuning';
import type { LifecycleInputs, ProgramLifecycleResult } from './types';
import { LIFECYCLE_VERSION } from './version';

const S = LIFECYCLE_TUNING.score;

export function computeLifecycle(
  inputs: LifecycleInputs,
  now: Date = new Date(),
): ProgramLifecycleResult {
  const drivers = buildLifecycleDrivers(inputs);
  const summed = drivers.reduce((s, d) => s + d.contribution, 0);
  const trajectoryScore = Math.max(S.min, Math.min(S.max, S.baseline + summed));

  const modernityVerdict = modernityVerdictOf(inputs);
  const ungatedVerdict = verdictFromScore(trajectoryScore, modernityVerdict);
  const { verdict, gatesApplied } = applyGates(ungatedVerdict, {
    aiReadiness: inputs.aiReadiness.overallScore,
    labourMarketScore: labourMarketScoreOf(inputs),
    latestAnnualRevenueThb: inputs.latestAnnualRevenueThb,
    modernityVerdict,
  });

  // Stable sort: ties keep the insertion order of buildLifecycleDrivers.
  const sortedDrivers = [...drivers].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );

  return {
    verdict,
    ungatedVerdict,
    trajectoryScore,
    drivers: sortedDrivers,
    gatesApplied,
    narrative: buildNarrative({
      verdict,
      ungatedVerdict,
      trajectoryScore,
      modernityVerdict,
      sortedDrivers,
      gatesApplied,
      hasPeerSelection: inputs.hasPeerSelection,
    }),
    methodologyVersion: LIFECYCLE_VERSION,
    generatedAt: now.toISOString(),
  };
}
