# Scenario engine methodology — v1

**Version:** `scenario-engine.v1`
**Introduced:** 2026-04-23 (Prompt 09, Strategic Scenario Planner)
**Owner:** Analyst + Executive teams

---

## Scope

Projects a KKU program portfolio forward under a set of **assumptions** and a list of **interventions**. Every Council-facing scenario (sunset, merge, launch, reshape, rebalance) routes through `runScenario()` in `@kku/shared/scenarios/engine.ts`. Output carries `methodologyVersion = 'scenario-engine.v1'`; when the math changes, bump to v2.

## Guarantees

- **Deterministic.** Same inputs → bitwise-identical outputs. Monte Carlo uses a seeded Mulberry32 PRNG so runs are reproducible across machines.
- **Pure.** No Date.now, no Math.random, no DB calls. Baseline + assumptions + interventions + seed are the entire world.
- **Validated.** Inputs pass through Zod at the boundary (`BaselineSnapshotSchema`, `ScenarioAssumptionsSchema`, `InterventionSchema`). Shape drift fails fast at the API edge, never silently inside the engine.

## Inputs

### Baseline snapshot
For each program in scope:
- `currentEnrollment`, `currentGraduates` (from `EnrollmentMetric` latest year)
- `tuitionPerStudent`, `costPerStudent` (from `FinancialMetric` latest year)
- `skillIds` (from `ProgramSkill` weighted union)

Plus a `demographicMultiplierByYear` table — the projected 18–22 cohort size at each target year, normalised to `baseYear = 1.0`. Sourced from `DemographicProjection` for the scenario's region (default Thailand).

### Assumptions (7 in v1)

| Key | Default | Meaning |
|---|---|---|
| `tuitionGrowthPct` | 0.03 | Annual tuition growth |
| `costInflationPct` | 0.025 | Annual cost inflation |
| `demandGrowthPct` | 0.02 | Annual demand (enrollment) growth multiplier |
| `retentionRate` | 0.92 | Year-over-year cohort retention |
| `demographicShockPct` | 0 | Scalar added on top of baseline demographic multiplier |
| `financialShockPct` | 0 | Scalar applied to tuition revenue (e.g., −0.20 for a 20% shock) |
| `aiDisplacementPct` | 0 | Graduate employment haircut (0.10 = 10% displacement) |

Scenario authors override a subset in `Scenario.assumptionsJson`; the engine merges `DEFAULT_ASSUMPTIONS ⊕ overrides` before running.

### Interventions (5 kinds)

All share a discriminator (`kind`). The engine applies them in a fixed order: **launch → reshape → rebalance → merge → sunset**. Later interventions see earlier effects. Sunset is last so its zeroing is authoritative.

- **Sunset** — closes a program. v1 sets `currentEnrollment = 0` from year 1 onward (step function). The `phaseOutYears` field is captured for a v2 linear phase-out.
- **Merge** — combines ≥ 2 programs into the first ("surviving") one. Combined cost = sum × `synergyCoefficient` (default 0.85). Enrollment × `mergeRetention` (default 0.92). Skills unioned. Absorbed programs dropped from the portfolio.
- **Launch** — adds a synthetic program. Starts at `targetIntake / rampYears`, ramps linearly to target over `rampYears`. Synthetic id = `synthetic-N`.
- **Reshape** — in-place edit of a program (new intake, tuition, cost, skill add/remove). Any omitted field keeps the baseline.
- **Rebalance** — multiply intake of all programs in `programIds` (or all programs) by `intakeMultiplier`.

## Projection math

For each horizon year `y ∈ [0, horizonYears)` and each program:

```
year = baseYear + y + 1
demoMultiplier = baseline.demographicMultiplier[year] × (1 + demographicShockPct)
retention = retentionRate ^ y
demandMultiplier = (1 + demandGrowthPct) ^ y

yearEnrolled = currentEnrollment × demoMultiplier × demandMultiplier × retention
grad4yrRate = currentGraduates / currentEnrollment   (fallback 0.22)
yearGraduates = yearEnrolled × grad4yrRate × (1 − aiDisplacementPct)

tuitionY = tuitionPerStudent × (1 + tuitionGrowthPct) ^ y
costY    = costPerStudent    × (1 + costInflationPct) ^ y

revenue = tuitionY × yearEnrolled × (1 + financialShockPct)
cost    = costY    × yearEnrolled
netContribution = revenue − cost
skillProduction[skillId] += yearGraduates / max(skillIds.length, 1)
```

Sum across programs → yearly totals. Sum across years → totals.

**Note:** v1 treats each program's student population as a pure flow (no stocks). Cohort dynamics (a student enrolls → stays 4 years → graduates) aren't modelled at year-level precision — this keeps the math tractable at 297 programs × 20 years. A v2 cohort model would add accuracy at the cost of complexity.

## Monte Carlo

For each of N iterations (default 100, capped 2000):
1. Perturb each assumption with Gaussian noise: `a_i ~ N(a_i, σ_i)`
2. Re-run `projectOutcome` deterministically
3. Record `totalNetContribution`

`σ_i` defaults (in assumption units):

| Assumption | σ |
|---|---|
| tuitionGrowthPct | 0.01 |
| costInflationPct | 0.01 |
| demandGrowthPct | 0.015 |
| retentionRate | 0.03 |
| demographicShockPct | 0.02 |
| financialShockPct | 0.05 |
| aiDisplacementPct | 0.03 |

80% CI = [10th percentile, 90th percentile] of the N samples.

**Limits:** Gaussian perturbation + independent assumption noise is a v1 approximation — real assumptions are correlated (tuition growth and cost inflation move together; demographic shocks may correlate with demand). A v2 with a correlation matrix or empirical resampling would be more honest. Documented as a known limit; accuracy re-visited after a year of real runs.

## Sensitivity analysis

For each assumption, bump ±10% (or ±0.05 for `retentionRate` to avoid hitting the [0, 1] clamp), re-run deterministically, record delta in `totalNetContribution`. Output rows sorted by absolute impact — the tornado chart shows the most-consequential assumptions at the top. No stochasticity here; this is a structural analysis, not probabilistic.

## Risk register

Engine does NOT generate risks. The AI insights pipeline (`scenario-insights.ts`) produces a `RiskEntry[]` via a separate call and the API stitches them into the run result before persisting. Keeps the engine pure and auditable.

## Known limits

1. **No cohort model.** Year-level enrollment is a function of current enrollment × multipliers, not a stock-flow that tracks students year 1→4.
2. **Independent assumption noise in Monte Carlo.** Real assumptions correlate; v1 treats them as independent.
3. **Step-function sunset.** `phaseOutYears` field exists in the schema but is a no-op in v1 math. Captures intent for v2.
4. **Synthetic launch programs inherit no historical data.** Their ramp is deterministic based on `targetIntake` + `rampYears`; real programs have enrollment variance v1 doesn't capture.
5. **Skill production distributed evenly across a program's skills.** Real programs weight skills via `ProgramSkill.weight`; v1 treats them uniformly to keep the engine self-contained. A v2 can take the weighted map as an input.

## Deferred

- [ ] Cohort model (students year 1 → 4 as a stock)
- [ ] Correlated Monte Carlo (covariance matrix)
- [ ] Linear phase-out for sunset (`phaseOutYears` enabled)
- [ ] Weighted skill production using `ProgramSkill.weight`
- [ ] Regional variation in demographic multiplier within one scenario
- [ ] Multi-region expansion model (prompt 14 Mekong connector)

## Change log

- **2026-04-23 — v1** — initial engine. 5 intervention types, 7 assumptions, seeded Monte Carlo, sensitivity tornado.
