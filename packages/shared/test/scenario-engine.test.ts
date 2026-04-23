import { describe, expect, it } from 'vitest';
import {
  buildBaselineSnapshot,
  DEFAULT_ASSUMPTIONS,
  runScenario,
  SCENARIO_ENGINE_VERSION,
  type BaselineProgram,
  type EngineInput,
  type Intervention,
} from '../src/scenarios';

// Pure-function engine tests. No DB, no mocks. The rules the engine
// MUST never regress on:
//   1. Deterministic — same inputs (seed fixed) → same outputs, bitwise.
//   2. Sunset removes the sunsetted program's revenue contribution.
//   3. Merge synergy → combined cost < sum of individual costs.
//   4. Full-portfolio stress test runs in well under 30s.
//   5. Methodology version stamps every run.

function makeProgram(id: string, overrides: Partial<BaselineProgram> = {}): BaselineProgram {
  return {
    id,
    code: `P-${id}`,
    nameEn: `Program ${id}`,
    nameTh: `หลักสูตร ${id}`,
    facultyId: 'f1',
    departmentId: null,
    currentEnrollment: 100,
    currentGraduates: 22,
    tuitionPerStudent: 30_000,
    costPerStudent: 28_000,
    skillIds: ['sk1', 'sk2'],
    ...overrides,
  };
}

function baselineInput(programs: BaselineProgram[], overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    baseline: buildBaselineSnapshot({
      baseYear: 2025,
      programs,
      demographicMultiplierByYear: { '2026': 1.0, '2027': 0.98, '2028': 0.96, '2029': 0.94, '2030': 0.92 },
    }),
    assumptions: DEFAULT_ASSUMPTIONS,
    interventions: [],
    horizonYears: 5,
    monteCarloN: 20, // keep tests fast
    seed: 42,
    ...overrides,
  };
}

describe('runScenario — determinism', () => {
  it('returns bitwise-identical output for the same inputs + seed', () => {
    const input = baselineInput([makeProgram('a'), makeProgram('b')]);
    const r1 = runScenario(input);
    const r2 = runScenario(input);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.methodologyVersion).toBe(SCENARIO_ENGINE_VERSION);
  });

  it('different seeds change the Monte Carlo band (but not the point estimate)', () => {
    const input = baselineInput([makeProgram('a'), makeProgram('b')]);
    const rA = runScenario({ ...input, seed: 1 });
    const rB = runScenario({ ...input, seed: 2 });
    // Point estimate is deterministic — seed only affects MC.
    expect(rA.scenario.totalNetContribution).toBeCloseTo(rB.scenario.totalNetContribution);
    // MC bounds should differ (with non-zero stdDev in assumptions).
    expect(rA.monteCarlo.totalNetContributionMean).not.toBe(rB.monteCarlo.totalNetContributionMean);
  });
});

describe('runScenario — sunset intervention', () => {
  it('removes the sunsetted program\'s revenue contribution', () => {
    const programs = [makeProgram('keep'), makeProgram('close')];
    const baseline = runScenario(baselineInput(programs));

    const intervention: Intervention = { kind: 'sunset', programId: 'close', phaseOutYears: 4 };
    const scenario = runScenario(baselineInput(programs, { interventions: [intervention] }));

    // Scenario revenue should drop by ~half (2 identical programs, one closes).
    expect(scenario.scenario.totalRevenue).toBeLessThan(baseline.scenario.totalRevenue);
    const revenueRatio = scenario.scenario.totalRevenue / baseline.scenario.totalRevenue;
    expect(revenueRatio).toBeGreaterThan(0.45);
    expect(revenueRatio).toBeLessThan(0.55);
    // Delta vs no-intervention should be negative.
    expect(scenario.deltaTotalRevenue).toBeLessThan(0);
  });
});

describe('runScenario — merge synergy', () => {
  it('combined cost is less than sum of individual costs (synergy applied)', () => {
    const pA = makeProgram('a', { costPerStudent: 30_000, currentEnrollment: 100 });
    const pB = makeProgram('b', { costPerStudent: 30_000, currentEnrollment: 100 });

    const preMerge = runScenario(baselineInput([pA, pB]));

    const intervention: Intervention = {
      kind: 'merge',
      programIds: ['a', 'b'],
      synergyCoefficient: 0.85,
      mergeRetention: 1.0, // remove retention variable for a cleaner test
    };
    const merged = runScenario(baselineInput([pA, pB], { interventions: [intervention] }));

    // With synergyCoefficient=0.85, total cost must be less than baseline.
    expect(merged.scenario.totalCost).toBeLessThan(preMerge.scenario.totalCost);
    const costRatio = merged.scenario.totalCost / preMerge.scenario.totalCost;
    expect(costRatio).toBeGreaterThan(0.75);
    expect(costRatio).toBeLessThan(0.95);
  });
});

describe('runScenario — launch', () => {
  it('adds a synthetic program that contributes revenue + cost + graduates', () => {
    const baseline = runScenario(baselineInput([makeProgram('existing')]));

    const intervention: Intervention = {
      kind: 'launch',
      name: 'AI Engineering',
      targetIntake: 80,
      rampYears: 3,
      tuitionPerStudent: 40_000,
      costPerStudent: 35_000,
      targetSkillIds: ['sk-ai'],
      facultyId: 'f1',
      departmentId: null,
    };
    const withLaunch = runScenario(baselineInput([makeProgram('existing')], { interventions: [intervention] }));

    expect(withLaunch.scenario.totalRevenue).toBeGreaterThan(baseline.scenario.totalRevenue);
    expect(withLaunch.scenario.totalCost).toBeGreaterThan(baseline.scenario.totalCost);
  });
});

describe('runScenario — full portfolio demographic stress test', () => {
  it('runs <30s against a 297-program synthetic portfolio', () => {
    const programs = Array.from({ length: 297 }, (_, i) => makeProgram(`prog-${i}`));
    const input = baselineInput(programs, {
      assumptions: { ...DEFAULT_ASSUMPTIONS, demographicShockPct: -0.1 },
      monteCarloN: 100,
      horizonYears: 5,
    });
    const t0 = Date.now();
    const result = runScenario(input);
    const elapsedMs = Date.now() - t0;
    expect(elapsedMs).toBeLessThan(30_000);
    expect(result.scenario.years.length).toBe(5);
    // Demographic shock → outcome should be WORSE than baseline (no shock).
    const noShock = runScenario({ ...input, assumptions: DEFAULT_ASSUMPTIONS });
    expect(result.scenario.totalNetContribution).toBeLessThan(noShock.scenario.totalNetContribution);
  });
});

describe('runScenario — sensitivity + Monte Carlo shape', () => {
  it('sensitivity rows are sorted by absolute impact', () => {
    const result = runScenario(baselineInput([makeProgram('a')]));
    const rows = result.sensitivity;
    for (let i = 1; i < rows.length; i++) {
      const prev = Math.max(Math.abs(rows[i - 1]!.lowOutcomeDelta), Math.abs(rows[i - 1]!.highOutcomeDelta));
      const cur = Math.max(Math.abs(rows[i]!.lowOutcomeDelta), Math.abs(rows[i]!.highOutcomeDelta));
      expect(cur).toBeLessThanOrEqual(prev);
    }
  });

  it('Monte Carlo CI80 contains the mean', () => {
    const result = runScenario(baselineInput([makeProgram('a'), makeProgram('b')], { monteCarloN: 200 }));
    const [lo, hi] = result.monteCarlo.totalNetContributionCi80;
    expect(result.monteCarlo.totalNetContributionMean).toBeGreaterThanOrEqual(lo);
    expect(result.monteCarlo.totalNetContributionMean).toBeLessThanOrEqual(hi);
  });
});
