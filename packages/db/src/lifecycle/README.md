# Lifecycle verdict

A program's lifecycle verdict is one of SUNSET, STABLE, RISING or FRONTIER.
It comes from a **trajectory score** (0–100) and up to six **modifier gates**.
The methodology (what each signal means and why) is in the in-app paper at
`/docs/methodology` (`apps/web/app/docs/methodology/content-{en,th}.tsx`).
This folder is how the verdict is computed.

```
trajectoryScore = clamp(50 + Σ driver contributions, 0, 100)
ungatedVerdict  = FRONTIER ≥ 80 (and peer review says FRONTIER) · RISING ≥ 65 · STABLE ≥ 45 · else SUNSET
verdict         = ungatedVerdict after the gates (a gate can lower a verdict, never raise it)
```

| Verdict | Council action |
|---|---|
| SUNSET | Declining on several fronts: closure, merger or radical restructure |
| STABLE | Meeting current expectations, not growing: hold and monitor |
| RISING | Improving across several signals: fund continued development |
| FRONTIER | Leading-edge, future-defining: showcase and scale |

## Changing a number → `tuning.ts`

Every weight, band, verdict threshold and gate limit is in `tuning.ts`, keyed
by the driver label you see in the app. Most adaptations touch only that file.

When you change it:

1. Set or bump `LIFECYCLE_INSTITUTION_REVISION` in `tuning.ts` (e.g.
   `'kmutt.1'`). Every verdict your installation computes is then stamped
   `lifecycle.v1.4+kmutt.1`, so it can't be mistaken for an upstream verdict.
2. Run `pnpm --filter @kku/db test lifecycle-tuning-pin`. It fails and prints
   the fingerprint to pin for your new version. Add that line to `PINNED` in
   `packages/db/test/lifecycle-tuning-pin.test.ts`.
3. Update the anchor tests in `packages/db/test/lifecycle-drivers.test.ts` and
   `lifecycle-gates.test.ts` that assert the old values.
4. Record the change under "Version history" below in your copy.

Three numbers are shared with the health score and live in
`../health-score/tuning.ts`: `REVENUE_TARGET_THB_BY_LEVEL` (the
`revenue_scale` target), `FLAGSHIP_REVENUE_FLOOR_THB` (the revenue gate) and
`shared.partialYearBelowShareOfPrior` (which year's revenue counts). Changing
one moves both methodologies, so it needs a new version of each. Both pin
tests cover them.

## Changing how something is computed → the file that owns it

| File | What it does |
|---|---|
| `tuning.ts` | Every number |
| `version.ts` | `UPSTREAM_LIFECYCLE_VERSION`, and `LIFECYCLE_VERSION` with your revision |
| `drivers.ts` | The eleven drivers: signals → signed contributions |
| `bands.ts` | The two driver shapes, banded (`bandScore`) and linear (`linearContribution`) |
| `gates.ts` | Score → verdict, and the gate table (`LIFECYCLE_GATES`) in application order |
| `narrative.ts` | The 2–3 sentence explanation stored with every verdict |
| `compute.ts` | `computeLifecycle(inputs)`: the whole formula, pure, no database |
| `load.ts` | `loadLifecycleInputs(programId)`: every database read, plus the revenue-year rule |
| `index.ts` | `programLifecycleVerdict(programId)`: load → compute → snapshot write-through |
| `types.ts` | `LifecycleInputs` and the result types |

### Drivers

A missing input always contributes 0. There is no penalty for a data gap.

| Driver | Input | Tuning key | Range |
|---|---|---|---|
| `ai_readiness` | AI-readiness composite | linear, centre 50 × 0.5 | ±25 |
| `health_overall` | Overall health score | linear, centre 50 × 0.4 | ±20 |
| `enrollment_trend` | Health `attractiveness.enrollment_trend_slope` | linear × 0.6, cap 15 | ±15 |
| `tuition_trend` | Health `financial.tuition_trend_slope` | linear × 0.4, cap 10 | ±10 |
| `content_modernity` | AI peer review verdict | FRONTIER +10 / OLD_SCHOOL −10 | ±10 |
| `labour_market_alignment` | Health `relevance.labour_market_alignment` | bands 70 / 50 / 30 | −15…+15 |
| `revenue_scale` | Annual tuition ÷ level target | bands 1.5 / 1.0 / 0.5 / 0.25 | −10…+10 |
| `major_content_gaps` | Major gaps in the AI peer review | −4 each, floor −12 | −12…0 |
| `demographic_resilience` | Health `relevance.demographic_resilience` | bands 80 / 50 | −10…+10 |
| `delayed_graduation_share` | Share of active students past expected graduation | bands 0.25 / 0.15 / 0.05 | −10…0 |
| `capability_strength` | Health capability dimension | bands 80 / 60 / 40 | −8…+8 |

### Gates (in application order)

| Gate | Fires when | Effect |
|---|---|---|
| `oldSchoolContentCap` | Peer review calls the content OLD_SCHOOL | RISING/FRONTIER → STABLE |
| `aiReadinessStableCap` | AI readiness < 30 | RISING/FRONTIER → STABLE |
| `aiReadinessFrontierCap` | AI readiness < 50 | FRONTIER → RISING |
| `lowLabourMarketAlignmentStableCap` | Labour-market alignment < 30 | RISING/FRONTIER → STABLE |
| `lowLabourMarketAlignmentFrontierCap` | Labour-market alignment < 50 | FRONTIER → RISING |
| `lowRevenuePotentialFrontierCap` | Annual tuition < 3M THB (a zero figure counts) | FRONTIER → RISING |

Each gate works on the verdict left by the gates before it. A gate whose
input is missing never fires. The result keeps the verdict before the gates
(`ungatedVerdict`) and every gate that fired (`gatesApplied`), so a Council
reader can see what each institutional position changed.

## Version history

- **v1.4 (2026-05-12)**: revenue-production potential. KKU-SEQ-0291 (PhD
  Epidemiology & Biostatistics, ~2M THB/yr, ~4 students a cohort) reached
  FRONTIER under v1.3. That was right on content and alignment, but FRONTIER
  means "a flagship the university should invest more in", which a boutique
  program with a structural revenue ceiling can't carry. Two changes:
  - A new `revenue_scale` driver (±10), banded against a per-level target, so
    doctoral programs aren't judged against bachelor's revenue.
  - A new `lowRevenuePotentialFrontierCap` gate with a level-independent 3M
    THB/yr floor. "Good for your level" earns a driver bump, but
    flagship-class needs absolute scale.
- **v1.3 (2026-05-12)**: qualitative vs quantitative content signals.
  KKU-SEQ-0018 showed an over-weighted peer-review modernity verdict hiding a
  12.5% labour-market-alignment gap. Three changes:
  - `content_modernity` went from ±20 to ±10. It is an LLM-as-judge reading of
    the syllabus, and halving it stops a "modern in name only" verdict from
    maxing the trajectory on its own.
  - `labour_market_alignment` became a first-class driver (±15). Before, it
    was diluted three layers deep (relevance dimension → overall health ×
    0.4).
  - Two labour-market gates, mirroring the AI-readiness pair.
- **v1.2 (2026-05-12)**: the gate counterfactual (gap #8). The result gained
  `ungatedVerdict` and `gatesApplied[]`. The gated verdict was unchanged.
- **v1.1 (2026-05-02)**: AI readiness became the heaviest driver (±25), and
  `health_overall` went from 0.5 to 0.4 to make room. Added the two
  AI-readiness gates.

**2026-11-20, no version change:** the code moved from `program-deep-dive.ts`
into this folder, with every number in `tuning.ts`. All 137 dev-DB programs
gave byte-identical results before and after, as did 250,000 sampled inputs
across every band edge. Known divergence, left for a future v1.5: the
revenue year is picked with the v1.4 rule in `load.ts`, not with the health
score's `pickFinancialYear()` (health-score v3.9).
