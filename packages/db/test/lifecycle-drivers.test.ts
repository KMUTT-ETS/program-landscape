import { describe, expect, it } from 'vitest';

import { REVENUE_TARGET_THB_BY_LEVEL } from '../src/health-score/tuning';
import { bandScore, linearContribution } from '../src/lifecycle/bands';
import { buildLifecycleDrivers, computeRevenueScaleContribution } from '../src/lifecycle/drivers';
import { LIFECYCLE_TUNING } from '../src/lifecycle/tuning';
import type { LifecycleInputs } from '../src/lifecycle/types';
import { baseInputs, healthRow, withAi } from './fixtures/lifecycle-inputs';

const T = LIFECYCLE_TUNING.drivers;

function contributionOf(inputs: LifecycleInputs, label: string): number {
  const d = buildLifecycleDrivers(inputs).find((x) => x.label === label);
  if (!d) throw new Error(`no driver ${label}`);
  return d.contribution;
}

describe('bandScore', () => {
  it('labour-market bands are inclusive at each edge', () => {
    const t = T.labour_market_alignment;
    expect([70, 69.999, 50, 30, 29.999].map((v) => bandScore(v, t))).toEqual([15, 5, 5, -5, -15]);
  });

  it('capability scores 0 at exactly 40 and -8 just below', () => {
    const t = T.capability_strength;
    expect([80, 60, 40, 39.999].map((v) => bandScore(v, t))).toEqual([8, 3, 0, -8]);
  });

  it('delayed-graduation share bands', () => {
    const t = T.delayed_graduation_share;
    expect([0, 0.05, 0.15, 0.25].map((v) => bandScore(v, t))).toEqual([0, -2, -5, -10]);
  });
});

describe('linearContribution', () => {
  it('enrollment trend is capped at ±15', () => {
    const t = T.enrollment_trend;
    expect([100, 0, 60].map((v) => linearContribution(v, t))).toEqual([15, -15, 6]);
  });

  it('AI readiness is uncapped (±25 over 0-100)', () => {
    expect(linearContribution(0, T.ai_readiness)).toBe(-25);
    expect(linearContribution(100, T.ai_readiness)).toBe(25);
  });
});

describe('computeRevenueScaleContribution', () => {
  const target = REVENUE_TARGET_THB_BY_LEVEL.BACHELOR;

  it('missing, zero or unknown-level revenue contributes 0', () => {
    expect(computeRevenueScaleContribution(null, 'BACHELOR')).toBe(0);
    expect(computeRevenueScaleContribution(0, 'BACHELOR')).toBe(0);
    expect(computeRevenueScaleContribution(target, 'UNKNOWN')).toBe(0);
    expect(computeRevenueScaleContribution(target, null)).toBe(0);
  });

  it('bands on the revenue / level-target ratio', () => {
    expect([1.5, 1.0, 0.5, 0.25, 0.2].map((r) => computeRevenueScaleContribution(target * r, 'BACHELOR')))
      .toEqual([10, 5, 0, -5, -10]);
  });
});

describe('buildLifecycleDrivers', () => {
  it('returns the 11 drivers in insertion order', () => {
    expect(buildLifecycleDrivers(baseInputs()).map((d) => d.label)).toEqual([
      'ai_readiness',
      'health_overall',
      'enrollment_trend',
      'tuition_trend',
      'content_modernity',
      'labour_market_alignment',
      'revenue_scale',
      'major_content_gaps',
      'demographic_resilience',
      'delayed_graduation_share',
      'capability_strength',
    ]);
  });

  it('neutral inputs contribute 0 everywhere', () => {
    expect(buildLifecycleDrivers(baseInputs()).every((d) => d.contribution === 0)).toBe(true);
  });

  it('major content gaps: -4 each, floored at -12', () => {
    const gaps = (n: number) =>
      baseInputs({ peerReview: { contentGaps: Array.from({ length: n }, () => ({ severity: 'major' })) } });
    expect([0, 2, 5].map((n) => contributionOf(gaps(n), 'major_content_gaps'))).toEqual([-0, -8, -12]);
  });

  it('content modernity by verdict, unknown when absent', () => {
    const m = (verdict: string) => baseInputs({ peerReview: { contentModernity: { verdict } } });
    expect(['FRONTIER', 'IN_BETWEEN', 'OLD_SCHOOL'].map((v) => contributionOf(m(v), 'content_modernity')))
      .toEqual([10, 0, -10]);
    const absent = buildLifecycleDrivers(baseInputs()).find((d) => d.label === 'content_modernity');
    expect(absent).toEqual({ label: 'content_modernity', contribution: 0, raw: { verdict: 'unknown' } });
  });

  it('delayed graduation with no active students contributes 0', () => {
    expect(contributionOf(baseInputs({ cohorts: { totalActive: 0, delayedCount: 3 } }), 'delayed_graduation_share')).toBe(0);
    expect(contributionOf(baseInputs({ cohorts: { totalActive: 20, delayedCount: 5 } }), 'delayed_graduation_share')).toBe(-10);
  });

  it('reads health sub-drivers and keeps the raw payloads', () => {
    const inputs = baseInputs({
      aiReadiness: withAi(80),
      health: healthRow({ overall: 70, enrollmentTrend: 100, tuitionTrend: null, labourMarket: 72, resilience: 45, capability: 61 }),
      demographicRiskLevel: 'high',
      level: 'BACHELOR',
      latestAnnualRevenueThb: REVENUE_TARGET_THB_BY_LEVEL.BACHELOR,
      latestRevenueFiscalYear: 2568,
    });
    const byLabel = Object.fromEntries(buildLifecycleDrivers(inputs).map((d) => [d.label, d]));
    expect(byLabel.ai_readiness?.contribution).toBe(15);
    expect(byLabel.health_overall).toEqual({ label: 'health_overall', contribution: 8, raw: { score: 70, completeness: 80 } });
    expect(byLabel.enrollment_trend?.contribution).toBe(15);
    expect(byLabel.tuition_trend).toEqual({ label: 'tuition_trend', contribution: 0, raw: { score: null } });
    expect(byLabel.labour_market_alignment?.contribution).toBe(15);
    expect(byLabel.demographic_resilience).toEqual({
      label: 'demographic_resilience',
      contribution: -10,
      raw: { score: 45, riskLevel: 'high' },
    });
    expect(byLabel.capability_strength?.contribution).toBe(3);
    expect(byLabel.revenue_scale).toEqual({
      label: 'revenue_scale',
      contribution: 5,
      raw: {
        latestAnnualRevenueThb: REVENUE_TARGET_THB_BY_LEVEL.BACHELOR,
        fiscalYear: 2568,
        level: 'BACHELOR',
        target: REVENUE_TARGET_THB_BY_LEVEL.BACHELOR,
      },
    });
  });
});
