// TEMPORARY — deleted once the lifecycle refactor is proven equal.
// Compares computeLifecycle() with the frozen legacy formula over a seeded
// sample of a grid that straddles every band edge and gate threshold.

import { describe, expect, it } from 'vitest';

import { REVENUE_TARGET_THB_BY_LEVEL } from '../src/health-score/tuning';
import { computeLifecycle } from '../src/lifecycle/compute';
import type { LifecycleInputs } from '../src/lifecycle/types';
import { healthRow, withAi } from './fixtures/lifecycle-inputs';
import { legacyComputeLifecycle } from './fixtures/lifecycle-legacy';

const AI = [0, 12.4, 29.999, 30, 49.999, 50, 75, 100];
const OVERALL = [null, 0, 44.4, 50, 100];
const SLOPE = [undefined, null, 0, 24.99, 50, 75.01, 100];
const MODERNITY = [undefined, 'FRONTIER', 'IN_BETWEEN', 'OLD_SCHOOL'];
const GAPS = [0, 1, 4];
const LABOUR = [undefined, null, 0, 29.999, 30, 45.6, 49.999, 50, 69.999, 70, 100];
const RESILIENCE = [undefined, null, 49.999, 50, 79.999, 80];
const DELAYED: Array<[number, number]> = [[0, 0], [0, 3], [20, 1], [100, 5], [20, 3], [20, 5], [7, 2]];
const CAPABILITY = [null, 0, 39.999, 40, 59.999, 60, 80];
const BACHELOR = REVENUE_TARGET_THB_BY_LEVEL.BACHELOR;
const REVENUE = [null, 0, 1_000_000, 2_999_999, 3_000_000, BACHELOR * 0.25, BACHELOR * 0.5, BACHELOR, BACHELOR * 1.5, 60_000_000];
const LEVEL = ['BACHELOR', 'DOCTORAL', 'MASTER', null, 'UNKNOWN'];
const PEER = [true, false];

/** Deterministic LCG so the sample is the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}

function sample(r: () => number): LifecycleInputs {
  const [totalActive, delayedCount] = pick(r, DELAYED);
  const modernity = pick(r, MODERNITY);
  const gaps = pick(r, GAPS);
  const revenue = pick(r, REVENUE);
  const hasHealth = r() > 0.05;
  return {
    health: hasHealth
      ? healthRow({
          overall: pick(r, OVERALL),
          enrollmentTrend: pick(r, SLOPE),
          tuitionTrend: pick(r, SLOPE),
          labourMarket: pick(r, LABOUR),
          resilience: pick(r, RESILIENCE),
          capability: pick(r, CAPABILITY),
        })
      : null,
    aiReadiness: withAi(pick(r, AI)),
    peerReview:
      modernity === undefined && gaps === 0 && r() > 0.5
        ? null
        : {
            ...(modernity === undefined ? {} : { contentModernity: { verdict: modernity } }),
            contentGaps: [
              ...Array.from({ length: gaps }, () => ({ severity: 'major' })),
              { severity: 'minor' },
            ],
          },
    hasPeerSelection: pick(r, PEER),
    cohorts: { totalActive, delayedCount },
    demographicRiskLevel: pick(r, ['low', 'high', 'unknown', null] as const),
    level: pick(r, LEVEL),
    latestAnnualRevenueThb: revenue,
    latestRevenueFiscalYear: revenue === null ? null : 2568,
  };
}

describe('lifecycle refactor equivalence', () => {
  it('computeLifecycle equals the legacy formula on 250k sampled inputs', () => {
    const r = rng(20261120);
    const verdicts = new Map<string, number>();
    const gates = new Map<string, number>();
    for (let i = 0; i < 250_000; i++) {
      const inputs = sample(r);
      const { generatedAt: _g, ...actual } = computeLifecycle(inputs);
      const expected = legacyComputeLifecycle(inputs);
      if (!Object.is(actual.trajectoryScore, expected.trajectoryScore) || JSON.stringify(actual) !== JSON.stringify(expected)) {
        expect(actual, `sample ${i}: ${JSON.stringify(inputs)}`).toStrictEqual(expected);
      }
      verdicts.set(actual.ungatedVerdict, (verdicts.get(actual.ungatedVerdict) ?? 0) + 1);
      for (const g of actual.gatesApplied) gates.set(g.name, (gates.get(g.name) ?? 0) + 1);
    }
    // The sample must actually reach every verdict and fire every gate.
    expect([...verdicts.keys()].sort()).toEqual(['FRONTIER', 'RISING', 'STABLE', 'SUNSET']);
    expect(gates.size).toBe(6);
  });

  it('agrees on signed zeros and exact floats (toStrictEqual on a sub-sample)', () => {
    const r = rng(7);
    for (let i = 0; i < 2_000; i++) {
      const inputs = sample(r);
      const { generatedAt: _g, ...actual } = computeLifecycle(inputs);
      expect(actual).toStrictEqual(legacyComputeLifecycle(inputs));
    }
  });
});
