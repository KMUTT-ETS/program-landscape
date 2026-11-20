import { describe, expect, it } from 'vitest';

import { applyGates, LIFECYCLE_GATES, ungatedVerdict, type GateContext } from '../src/lifecycle/gates';

const ctx = (over: Partial<GateContext> = {}): GateContext => ({
  aiReadiness: 90,
  labourMarketScore: null,
  latestAnnualRevenueThb: null,
  modernityVerdict: 'FRONTIER',
  ...over,
});

describe('ungatedVerdict', () => {
  it('FRONTIER needs both the score and a FRONTIER modernity verdict', () => {
    expect(ungatedVerdict(80, 'FRONTIER')).toBe('FRONTIER');
    expect(ungatedVerdict(80, 'IN_BETWEEN')).toBe('RISING');
    expect(ungatedVerdict(80, null)).toBe('RISING');
    expect(ungatedVerdict(79.9, 'FRONTIER')).toBe('RISING');
  });

  it('bands below FRONTIER are inclusive', () => {
    expect([65, 64.9, 45, 44.9].map((s) => ungatedVerdict(s, null))).toEqual([
      'RISING',
      'STABLE',
      'STABLE',
      'SUNSET',
    ]);
  });
});

describe('applyGates', () => {
  it('runs the six gates in their fixed order', () => {
    expect(LIFECYCLE_GATES.map((g) => g.name)).toEqual([
      'oldSchoolContentCap',
      'aiReadinessStableCap',
      'aiReadinessFrontierCap',
      'lowLabourMarketAlignmentStableCap',
      'lowLabourMarketAlignmentFrontierCap',
      'lowRevenuePotentialFrontierCap',
    ]);
  });

  it('chains: a FRONTIER capped to RISING can still be capped to STABLE', () => {
    const r = applyGates('FRONTIER', ctx({ aiReadiness: 40, labourMarketScore: 20 }));
    expect(r.gatesApplied.map((g) => [g.name, g.from, g.to])).toEqual([
      ['aiReadinessFrontierCap', 'FRONTIER', 'RISING'],
      ['lowLabourMarketAlignmentStableCap', 'RISING', 'STABLE'],
    ]);
    expect(r.verdict).toBe('STABLE');
  });

  it('missing labour-market and revenue data fire no gate', () => {
    expect(applyGates('FRONTIER', ctx())).toEqual({ verdict: 'FRONTIER', gatesApplied: [] });
  });

  it('gates never touch STABLE or SUNSET', () => {
    const harsh = ctx({ aiReadiness: 0, labourMarketScore: 0, latestAnnualRevenueThb: 0, modernityVerdict: 'OLD_SCHOOL' });
    expect(applyGates('STABLE', harsh).gatesApplied).toEqual([]);
    expect(applyGates('SUNSET', harsh).gatesApplied).toEqual([]);
  });

  it('OLD_SCHOOL content caps RISING at STABLE', () => {
    const r = applyGates('RISING', ctx({ modernityVerdict: 'OLD_SCHOOL' }));
    expect(r.gatesApplied).toEqual([
      {
        name: 'oldSchoolContentCap',
        from: 'RISING',
        to: 'STABLE',
        reason:
          'Peer-review content modernity verdict = OLD_SCHOOL; curriculum out of touch with the field caps the verdict at STABLE regardless of trajectory.',
      },
    ]);
  });

  it('zero revenue counts as below the flagship floor', () => {
    const r = applyGates('FRONTIER', ctx({ latestAnnualRevenueThb: 0 }));
    expect(r.verdict).toBe('RISING');
    expect(r.gatesApplied[0]?.name).toBe('lowRevenuePotentialFrontierCap');
    expect(r.gatesApplied[0]?.reason).toBe(
      'Annual tuition revenue 0.0M THB < 3M flagship floor — FRONTIER reserved for revenue-substantial programs (strategic, not academic); caps at RISING. Path to FRONTIER: grow cohort or partnerships.',
    );
  });

  it('reason text interpolates the score and the threshold', () => {
    const r = applyGates('RISING', ctx({ aiReadiness: 12.4 }));
    expect(r.gatesApplied[0]?.reason).toBe(
      'AI readiness 12/100 < 30 — program faces structural AI threat regardless of trajectory; caps verdict at STABLE.',
    );
    const lm = applyGates('FRONTIER', ctx({ labourMarketScore: 45.6 }));
    expect(lm.gatesApplied[0]?.reason).toBe(
      'Labour-market alignment 46/100 < 50 — FRONTIER label reserved for programs that meet employer demand; caps at RISING.',
    );
  });

  it('short labels match the published narrative wording', () => {
    expect(LIFECYCLE_GATES.map((g) => g.shortLabel)).toEqual([
      'OLD_SCHOOL content cap',
      'AI readiness < 30 (STABLE cap)',
      'AI readiness < 50 (FRONTIER cap)',
      'Labour-market alignment < 30 (STABLE cap)',
      'Labour-market alignment < 50 (FRONTIER cap)',
      'Revenue < 3M THB/yr flagship floor (FRONTIER cap)',
    ]);
  });
});
