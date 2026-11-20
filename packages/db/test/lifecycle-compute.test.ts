import { describe, expect, it } from 'vitest';

import { computeLifecycle } from '../src/lifecycle/compute';
import { baseInputs, healthRow, withAi } from './fixtures/lifecycle-inputs';

describe('computeLifecycle', () => {
  it('neutral inputs score the baseline and are STABLE with no gates', () => {
    const r = computeLifecycle(baseInputs());
    expect(r.trajectoryScore).toBe(50);
    expect(r.verdict).toBe('STABLE');
    expect(r.ungatedVerdict).toBe('STABLE');
    expect(r.gatesApplied).toEqual([]);
    expect(r.methodologyVersion).toBe('lifecycle.v1.4');
  });

  it('sums contributions onto the baseline and clamps to 0-100', () => {
    // AI 80 → +15, health 70 → +8.
    expect(computeLifecycle(baseInputs({ aiReadiness: withAi(80), health: healthRow({ overall: 70 }) })).trajectoryScore).toBe(73);
    expect(computeLifecycle(baseInputs({ aiReadiness: withAi(0), health: healthRow({ overall: 0, capability: 0, labourMarket: 0 }) })).trajectoryScore).toBe(0);
  });

  it('sorts drivers by magnitude, keeping insertion order on ties', () => {
    // content_modernity +10 and demographic_resilience +10 tie; modernity comes first.
    const r = computeLifecycle(
      baseInputs({
        peerReview: { contentModernity: { verdict: 'FRONTIER' } },
        health: healthRow({ resilience: 90 }),
      }),
    );
    expect(r.drivers.slice(0, 2).map((d) => d.label)).toEqual(['content_modernity', 'demographic_resilience']);
    expect(r.narrative).toContain('Lifting forces: curriculum modernity, demographic resilience.');
  });

  it('the narrative names the gate and the counterfactual when one fires', () => {
    const r = computeLifecycle(
      baseInputs({ aiReadiness: withAi(20), health: healthRow({ overall: 100, enrollmentTrend: 100, tuitionTrend: 100, resilience: 90, capability: 90 }) }),
    );
    expect(r.ungatedVerdict).toBe('RISING');
    expect(r.verdict).toBe('STABLE');
    expect(r.narrative).toContain('Modifier gate(s) lowered verdict from RISING to STABLE: AI readiness < 30 (STABLE cap).');
  });

  it('hints at the missing peer review', () => {
    expect(computeLifecycle(baseInputs({ hasPeerSelection: false })).narrative).toContain('AI peer review not yet generated');
    expect(computeLifecycle(baseInputs()).narrative).not.toContain('AI peer review not yet generated');
  });

  it('stamps generatedAt from the given clock', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    expect(computeLifecycle(baseInputs(), now).generatedAt).toBe('2026-11-20T00:00:00.000Z');
  });
});
