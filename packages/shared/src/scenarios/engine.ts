// ═══════════════════════════════════════════════════════════════════════
// Scenario engine (prompt 09) — v1
//
// Pure function: given the same inputs, always returns the same output.
// No Date.now() calls (baseline carries baseYear), no Math.random (we
// use a seeded PRNG for Monte Carlo). Callers hand in everything they
// want reflected in the run.
// ═══════════════════════════════════════════════════════════════════════

import {
  BaselineSnapshotSchema,
  DEFAULT_ASSUMPTIONS,
  SCENARIO_ENGINE_VERSION,
  ScenarioAssumptionsSchema,
  type BaselineProgram,
  type BaselineSnapshot,
  type EngineInput,
  type Intervention,
  type MonteCarloBand,
  type ProjectionYear,
  type ScenarioAssumptions,
  type ScenarioOutcome,
  type ScenarioRunResult,
  type SensitivityEntry,
} from './types';

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────
// Deterministic + fast. Fine for Monte Carlo at our N.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller to turn two uniforms into a Gaussian.
function gaussian(rng: () => number, mean = 0, stdDev = 1): number {
  const u1 = Math.max(rng(), 1e-9); // avoid log(0)
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

// ── Public entry point ──────────────────────────────────────────────
export function runScenario(input: EngineInput): ScenarioRunResult {
  // Validate inputs — cheap and catches schema drift early. Use the
  // parsed result (which fills in defaults for missing assumption keys
  // via the Zod schema) so downstream math doesn't NaN out when the
  // caller passes a partial / wrong-keyed assumptions object.
  BaselineSnapshotSchema.parse(input.baseline);
  const assumptions = ScenarioAssumptionsSchema.parse(input.assumptions);

  const horizonYears = Math.max(1, Math.min(input.horizonYears, 20));
  const monteCarloN = Math.max(1, Math.min(input.monteCarloN ?? 100, 2000));
  const seed = input.seed ?? 42;

  // Point estimates: baseline outcome (no interventions) vs scenario outcome.
  const baseline = projectOutcome(input.baseline, assumptions, [], horizonYears);
  const scenario = projectOutcome(
    input.baseline,
    assumptions,
    input.interventions,
    horizonYears,
  );

  // Sensitivity — bump each assumption ±10% and record the outcome delta.
  // Pass the parsed (defaults-filled) assumptions so the sensitivity sweep
  // doesn't NaN out on missing keys.
  const inputWithParsedAssumptions = { ...input, assumptions };
  const sensitivity = computeSensitivity(inputWithParsedAssumptions, horizonYears);

  // Monte Carlo.
  const monteCarlo = runMonteCarlo(inputWithParsedAssumptions, horizonYears, monteCarloN, seed);

  return {
    baseline,
    scenario,
    deltaTotalNetContribution: scenario.totalNetContribution - baseline.totalNetContribution,
    deltaTotalRevenue: scenario.totalRevenue - baseline.totalRevenue,
    deltaTotalCost: scenario.totalCost - baseline.totalCost,
    monteCarlo,
    sensitivity,
    riskRegister: [],
    methodologyVersion: SCENARIO_ENGINE_VERSION,
    seed,
    monteCarloN,
  };
}

// ── Core projection ─────────────────────────────────────────────────
function projectOutcome(
  baseline: BaselineSnapshot,
  assumptions: ScenarioAssumptions,
  interventions: Intervention[],
  horizonYears: number,
): ScenarioOutcome {
  // Deep-clone the programs list so interventions can mutate their own copy
  // without leaking across scenario runs.
  let programs: BaselineProgram[] = baseline.programs.map((p) => ({ ...p, skillIds: [...p.skillIds] }));
  let syntheticProgramCounter = 0;

  // Apply LAUNCH + REBALANCE + RESHAPE + MERGE + SUNSET in a deterministic
  // order. SUNSET last so its zeroing effects aren't re-inflated by later
  // interventions.
  const order: Intervention['kind'][] = ['launch', 'reshape', 'rebalance', 'merge', 'sunset'];
  for (const kind of order) {
    for (const intv of interventions) {
      if (intv.kind !== kind) continue;
      programs = applyIntervention(programs, intv, baseline.baseYear, () => {
        syntheticProgramCounter += 1;
        return `synthetic-${syntheticProgramCounter}`;
      });
    }
  }

  // Year-by-year projection.
  const years: ProjectionYear[] = [];
  let peakEnrollment = 0;
  for (let y = 0; y < horizonYears; y++) {
    const year = baseline.baseYear + y + 1;
    const demoBase = baseline.demographicMultiplierByYear[String(year)] ?? 1;
    const demoMultiplier = demoBase * (1 + assumptions.demographicShockPct);

    let totalEnrolled = 0;
    let totalGraduates = 0;
    let totalRevenue = 0;
    let totalCost = 0;
    const skillProduction: Record<string, number> = {};

    for (const p of programs) {
      if (p.currentEnrollment <= 0) continue;
      const retention = Math.pow(assumptions.retentionRate, y);
      const demandMultiplier = Math.pow(1 + assumptions.demandGrowthPct, y);
      // Enrollment: starting baseline × demographic × demand × retention.
      // Retention decays year-over-year within a cohort; demand grows the
      // incoming class.
      const yearEnrolled = p.currentEnrollment * demoMultiplier * demandMultiplier * retention;
      // Graduates per year ≈ 1/4 of enrolled for a 4-year bachelor's,
      // adjusted by current graduate ratio.
      const grad4yrRate = p.currentEnrollment > 0 ? p.currentGraduates / p.currentEnrollment : 0.22;
      const yearGraduates = yearEnrolled * grad4yrRate * (1 - assumptions.aiDisplacementPct);

      const tuition = p.tuitionPerStudent * Math.pow(1 + assumptions.tuitionGrowthPct, y);
      const costPerStudent = p.costPerStudent * Math.pow(1 + assumptions.costInflationPct, y);

      const revenue = tuition * yearEnrolled * (1 + assumptions.financialShockPct);
      const cost = costPerStudent * yearEnrolled;

      totalEnrolled += yearEnrolled;
      totalGraduates += yearGraduates;
      totalRevenue += revenue;
      totalCost += cost;

      for (const skillId of p.skillIds) {
        skillProduction[skillId] = (skillProduction[skillId] ?? 0) + yearGraduates / Math.max(p.skillIds.length, 1);
      }
    }

    peakEnrollment = Math.max(peakEnrollment, totalEnrolled);
    years.push({
      year,
      enrolled: totalEnrolled,
      graduates: totalGraduates,
      revenue: totalRevenue,
      cost: totalCost,
      netContribution: totalRevenue - totalCost,
      skillProduction,
    });
  }

  const totalRevenue = years.reduce((s, y) => s + y.revenue, 0);
  const totalCost = years.reduce((s, y) => s + y.cost, 0);
  const graduatesCumulative = years.reduce((s, y) => s + y.graduates, 0);

  return {
    years,
    totalRevenue,
    totalCost,
    totalNetContribution: totalRevenue - totalCost,
    peakEnrollment,
    graduatesCumulative,
  };
}

// ── Interventions ────────────────────────────────────────────────────
function applyIntervention(
  programs: BaselineProgram[],
  intv: Intervention,
  _baseYear: number,
  newId: () => string,
): BaselineProgram[] {
  switch (intv.kind) {
    case 'sunset': {
      // v1: full immediate closure (enrollment → 0 from year 1 onward).
      // `phaseOutYears` is captured in the intervention schema for a
      // future v2 that models a linear phase-out inside projectOutcome.
      // Keeping v1 step-function makes the "sunset removes this
      // program's revenue" contract testable and unambiguous.
      return programs.map((p) =>
        p.id === intv.programId
          ? { ...p, currentEnrollment: 0, currentGraduates: 0 }
          : p,
      );
    }
    case 'merge': {
      const [survivorId, ...absorbedIds] = intv.programIds;
      const absorbed = programs.filter((p) => absorbedIds.includes(p.id));
      const merged = programs
        .map((p) => {
          if (p.id !== survivorId) return p;
          const totalEnrollment =
            p.currentEnrollment + absorbed.reduce((s, a) => s + a.currentEnrollment, 0);
          const totalGraduates =
            p.currentGraduates + absorbed.reduce((s, a) => s + a.currentGraduates, 0);
          const totalCost =
            p.costPerStudent * p.currentEnrollment +
            absorbed.reduce((s, a) => s + a.costPerStudent * a.currentEnrollment, 0);
          // Synergy applied on cost side only.
          const blendedCost =
            totalEnrollment > 0 ? (totalCost * intv.synergyCoefficient) / totalEnrollment : p.costPerStudent;
          // Tuition — weighted average by enrollment.
          const totalTuitionWeighted =
            p.tuitionPerStudent * p.currentEnrollment +
            absorbed.reduce((s, a) => s + a.tuitionPerStudent * a.currentEnrollment, 0);
          const blendedTuition =
            totalEnrollment > 0 ? totalTuitionWeighted / totalEnrollment : p.tuitionPerStudent;
          const blendedSkills = Array.from(new Set([...p.skillIds, ...absorbed.flatMap((a) => a.skillIds)]));
          return {
            ...p,
            currentEnrollment: Math.round(totalEnrollment * intv.mergeRetention),
            currentGraduates: Math.round(totalGraduates * intv.mergeRetention),
            tuitionPerStudent: blendedTuition,
            costPerStudent: blendedCost,
            skillIds: blendedSkills,
          };
        })
        .filter((p) => !absorbedIds.includes(p.id));
      return merged;
    }
    case 'launch': {
      const base: BaselineProgram = {
        id: newId(),
        code: `NEW-${intv.name.slice(0, 3).toUpperCase()}`,
        nameEn: intv.name,
        nameTh: intv.nameTh ?? intv.name,
        facultyId: intv.facultyId,
        departmentId: intv.departmentId ?? null,
        currentEnrollment: Math.round(intv.targetIntake / intv.rampYears),
        currentGraduates: 0,
        tuitionPerStudent: intv.tuitionPerStudent,
        costPerStudent: intv.costPerStudent,
        skillIds: intv.targetSkillIds,
      };
      return [...programs, base];
    }
    case 'reshape': {
      return programs.map((p) => {
        if (p.id !== intv.programId) return p;
        let skills = p.skillIds;
        if (intv.addSkillIds) skills = Array.from(new Set([...skills, ...intv.addSkillIds]));
        if (intv.removeSkillIds) skills = skills.filter((s) => !intv.removeSkillIds!.includes(s));
        return {
          ...p,
          currentEnrollment: intv.newIntake ?? p.currentEnrollment,
          tuitionPerStudent: intv.newTuitionPerStudent ?? p.tuitionPerStudent,
          costPerStudent: intv.newCostPerStudent ?? p.costPerStudent,
          skillIds: skills,
        };
      });
    }
    case 'rebalance': {
      const applicable = intv.programIds;
      return programs.map((p) => {
        if (applicable && !applicable.includes(p.id)) return p;
        return {
          ...p,
          currentEnrollment: Math.round(p.currentEnrollment * intv.intakeMultiplier),
        };
      });
    }
  }
}

// ── Sensitivity analysis ─────────────────────────────────────────────
//
// For each assumption, bump ±10% and record outcome change. Cheap:
// 2 runs per assumption, no stochasticity.
function computeSensitivity(input: EngineInput, horizonYears: number): SensitivityEntry[] {
  const baseOutcome = projectOutcome(input.baseline, input.assumptions, input.interventions, horizonYears);
  const deltaPct = 0.1;
  const keys: Array<keyof ScenarioAssumptions> = [
    'tuitionGrowthPct',
    'costInflationPct',
    'demandGrowthPct',
    'retentionRate',
    'demographicShockPct',
    'financialShockPct',
    'aiDisplacementPct',
  ];
  const out: SensitivityEntry[] = [];
  for (const key of keys) {
    const orig = input.assumptions[key];
    // For fractions clamped to [0,1], bump absolute by small amount instead
    // of percentage to avoid hitting the clamp.
    const step = key === 'retentionRate' ? 0.05 : Math.max(Math.abs(orig * deltaPct), 0.005);
    const lowAssumptions = { ...input.assumptions, [key]: clamp(orig - step, key) };
    const highAssumptions = { ...input.assumptions, [key]: clamp(orig + step, key) };
    const lowOutcome = projectOutcome(input.baseline, lowAssumptions, input.interventions, horizonYears);
    const highOutcome = projectOutcome(input.baseline, highAssumptions, input.interventions, horizonYears);
    out.push({
      assumptionKey: key,
      deltaPct,
      lowOutcomeDelta: lowOutcome.totalNetContribution - baseOutcome.totalNetContribution,
      highOutcomeDelta: highOutcome.totalNetContribution - baseOutcome.totalNetContribution,
    });
  }
  // Sort by absolute impact — most sensitive first (typical tornado order).
  out.sort(
    (a, b) =>
      Math.max(Math.abs(b.lowOutcomeDelta), Math.abs(b.highOutcomeDelta)) -
      Math.max(Math.abs(a.lowOutcomeDelta), Math.abs(a.highOutcomeDelta)),
  );
  return out;
}

function clamp(v: number, key: keyof ScenarioAssumptions): number {
  if (key === 'retentionRate') return Math.max(0, Math.min(1, v));
  return v;
}

// ── Monte Carlo ─────────────────────────────────────────────────────
function runMonteCarlo(
  input: EngineInput,
  horizonYears: number,
  n: number,
  seed: number,
): MonteCarloBand {
  const rng = mulberry32(seed);
  const samples: number[] = [];
  // Per-assumption standard deviation. Conservative defaults — tight
  // enough that v1 bands aren't a caricature, loose enough to capture
  // real uncertainty.
  const stdDevs: Record<keyof ScenarioAssumptions, number> = {
    tuitionGrowthPct: 0.01,
    costInflationPct: 0.01,
    demandGrowthPct: 0.015,
    retentionRate: 0.03,
    demographicShockPct: 0.02,
    financialShockPct: 0.05,
    aiDisplacementPct: 0.03,
  };
  for (let i = 0; i < n; i++) {
    const perturbed: ScenarioAssumptions = { ...input.assumptions };
    for (const [rawKey, std] of Object.entries(stdDevs)) {
      const key = rawKey as keyof ScenarioAssumptions;
      const base = input.assumptions[key];
      const perturbation = gaussian(rng, 0, std);
      perturbed[key] = clamp(base + perturbation, key);
    }
    const outcome = projectOutcome(input.baseline, perturbed, input.interventions, horizonYears);
    samples.push(outcome.totalNetContribution);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
  const stdDev = Math.sqrt(variance);
  const lowIdx = Math.floor(samples.length * 0.1);
  const highIdx = Math.ceil(samples.length * 0.9) - 1;
  return {
    totalNetContributionCi80: [samples[lowIdx] ?? mean, samples[highIdx] ?? mean],
    totalNetContributionMean: mean,
    totalNetContributionStdDev: stdDev,
    iterations: n,
  };
}

// ── Default baseline builder ────────────────────────────────────────
// Helper for tests + API: project a baseline from DB rows.
export function buildBaselineSnapshot(params: {
  baseYear: number;
  programs: BaselineProgram[];
  demographicMultiplierByYear: Record<string, number>;
}): BaselineSnapshot {
  return BaselineSnapshotSchema.parse(params);
}

export { SCENARIO_ENGINE_VERSION, DEFAULT_ASSUMPTIONS };
