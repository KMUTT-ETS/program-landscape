# Lifecycle trajectory score: tuning-file refactor, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the lifecycle verdict (`programLifecycleVerdict`, trajectory score, gates, narrative) out of `packages/db/src/program-deep-dive.ts` into `packages/db/src/lifecycle/`. Every number goes in one `tuning.ts`, guarded by a tuning-pin test. **No output changes.**

**Architecture:** This follows the health-score refactor (commit `ef2b6631`). `load.ts` does all Prisma I/O and produces a plain `LifecycleInputs` object. `compute.ts` is a pure function `LifecycleInputs → ProgramLifecycleResult`, built from `drivers.ts` (11 drivers) and `gates.ts` (6 gates as a declarative table). `index.ts` keeps the public surface: `programLifecycleVerdict(programId)` = load → compute → snapshot upsert. Thresholds live in `tuning.ts`. The version is `UPSTREAM_LIFECYCLE_VERSION` plus an optional institution revision.

**Tech Stack:** TypeScript strict, Prisma, Vitest (`pnpm --filter @kku/db test`).

**Spec:** this conversation's agreed design (no separate spec). Source of truth for current behaviour: `packages/db/src/program-deep-dive.ts:1295-1955` at the commit the branch starts from.

## Global Constraints

- **Zero output change.** For every program in the dev DB, `verdict`, `ungatedVerdict`, `trajectoryScore`, `drivers` (order, labels, contributions, `raw`), `gatesApplied` (names, from/to, reason text) and `narrative` must be byte-identical before and after the refactor. `generatedAt` is the only field that may differ.
- `UPSTREAM_LIFECYCLE_VERSION` stays `'lifecycle.v1.4'`. With no institution revision, the stamped `LIFECYCLE_VERSION` is exactly `'lifecycle.v1.4'`.
- Public names re-exported through `@kku/db` stay unchanged: `programLifecycleVerdict`, `computeRevenueScaleContribution`, `ProgramLifecycleDriver`, `LifecycleGateEffect`, `ProgramLifecycleResult`.
- The institution revision constant is named `LIFECYCLE_INSTITUTION_REVISION`. `INSTITUTION_REVISION` is already exported by health-score, and `export *` would collide.
- Shared numbers are imported from `packages/db/src/health-score/tuning.ts` and never copied: `REVENUE_TARGET_THB_BY_LEVEL`, `FLAGSHIP_REVENUE_FLOOR_THB`, `HEALTH_SCORE_TUNING.shared.partialYearBelowShareOfPrior` (0.3).
- No `any`. Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit with `git commit -F <file>`.
- Work in a worktree on branch `refactor/lifecycle-tuning` off `develop`. The main tree has unrelated uncommitted changes.
- Out of scope (note in the decisions log, do NOT change): lifecycle uses its own "latest year, drop if < 30% of prior" revenue pick, while health-score v3.9 moved to `pickFinancialYear()`. Aligning them changes scores and needs `lifecycle.v1.5`.

## Review Focus

1. **A `Decimal` zero tuition counts as data, not as missing.** `!head?.tuitionRevenue` is false for a Prisma `Decimal(0)`, so revenue becomes `0`. Then `revenue_scale` contributes 0, but the flagship-floor gate *does* fire. `load.ts` must keep this exactly; the test is in Task 6.
2. **Floating-point identity.** Linear drivers must compute `(value - centre) * weight` in that order before clamping. Writing `value * weight - centre * weight` changes results in the last bit and breaks the byte-identical check. This is covered by the Task 5 grid test.
3. **Band edges are inclusive (`>=`)** for every banded driver, except `capability_strength`, whose lowest band reads `< 40 → -8`. Expressed as `[40, 0]` with `below: -8`, it must still give `0` at exactly 40. Task 3 has an anchor test at each edge.
4. **Gate order and chaining.** Gates run in a fixed order on the running verdict. A FRONTIER that AI readiness caps to RISING must still be eligible for the labour-market STABLE cap. A null labour-market score or null revenue must fire no gate. Task 4 tests the chained cases.
5. **Driver order in the result.** `drivers` is sorted by |contribution| descending with a stable sort over the original insertion order (ai_readiness, health_overall, enrollment_trend, tuition_trend, content_modernity, labour_market_alignment, revenue_scale, major_content_gaps, demographic_resilience, delayed_graduation_share, capability_strength). Ties must keep that order, and so must narrative "Lifting forces"/"Drag". Task 5 has a tie test.

---

## File structure

```
packages/db/src/lifecycle/
  README.md     # how to adapt; version history v1.1–v1.4 (moved from code comments)
  tuning.ts     # LIFECYCLE_TUNING, LIFECYCLE_INSTITUTION_REVISION, BandTable type
  version.ts    # UPSTREAM_LIFECYCLE_VERSION, LIFECYCLE_VERSION
  types.ts      # ProgramLifecycleDriver, LifecycleGateEffect, ProgramLifecycleResult, LifecycleInputs
  bands.ts      # bandScore(), linearContribution()
  drivers.ts    # buildLifecycleDrivers(inputs) + computeRevenueScaleContribution
  gates.ts      # LIFECYCLE_GATES table, ungatedVerdict(), applyGates()
  narrative.ts  # buildNarrative(), verdictHeadline, labelToPhrase, labelGateName
  compute.ts    # computeLifecycle(inputs, now) — pure
  load.ts       # loadLifecycleInputs(programId), pickLatestAnnualRevenue()
  index.ts      # programLifecycleVerdict() + re-exports
packages/db/test/
  lifecycle-tuning-pin.test.ts
  lifecycle-drivers.test.ts
  lifecycle-gates.test.ts
  lifecycle-compute.test.ts
  lifecycle-equivalence.test.ts   # temporary, deleted in Task 7
  fixtures/lifecycle-legacy.ts    # temporary frozen copy, deleted in Task 7
```

Modified: `packages/db/src/program-deep-dive.ts` (lifecycle code removed), `packages/db/src/index.ts` (add `export * from './lifecycle'`), `packages/db/src/program-strategic-narrative-run.ts` (import from `./lifecycle`), `packages/db/src/methodology-bundle.ts` (import `LIFECYCLE_VERSION`, drop local const and its history comment), `docs/guides/adapt-a-methodology.md`, `docs/superpowers/notes/decisions-log.md`, `CLAUDE.md`.

There is **no** new `docs/methodologies/lifecycle.md`. `adapt-a-methodology.md` says the health + lifecycle methodology lives in the in-app paper (`apps/web/app/docs/methodology/content-{en,th}.tsx`) and the markdown copy is retired. The version history goes in `lifecycle/README.md`, as health-score's does.

---

### Task 1: Branch, baseline, frozen legacy reference, input types

**Files:**
- Create: `packages/db/src/lifecycle/types.ts`, `packages/db/test/fixtures/lifecycle-legacy.ts`
- Scratch (not committed): `<scratchpad>/lifecycle-before.json`

**Interfaces:**
- Produces, in `types.ts`: `ProgramLifecycleDriver`, `LifecycleGateEffect` and `ProgramLifecycleResult`, moved verbatim from `program-deep-dive.ts:1311-1361` with their doc comments (`program-deep-dive.ts` re-imports them for now). Also:
  ```ts
  export interface LifecycleInputs {
    health: HealthScoreRow | null;
    aiReadiness: Pick<ProgramAiReadiness, 'overallScore'> & {
      subScores: Pick<ProgramAiReadiness['subScores'], 'curriculumIntegration' | 'skillResilience' | 'researchPresence'>;
    };
    peerReview: { contentModernity?: { verdict: string }; contentGaps?: Array<{ severity: string }> } | null;
    hasPeerSelection: boolean;
    cohorts: { totalActive: number; delayedCount: number };
    demographicRiskLevel: DemographicRiskLevel | null;
    level: string | null;
    latestAnnualRevenueThb: number | null;
    latestRevenueFiscalYear: number | null;
  }
  ```
- Produces, in the fixture: `legacyComputeLifecycle(inputs: LifecycleInputs): Omit<ProgramLifecycleResult, 'generatedAt'>`. This is a **verbatim** copy of the current body from the `// ── Driver 1` comment through building `result`, plus `extractDriverFromHealth`, `labelGateName`, `verdictHeadline`, `labelToPhrase` and `computeRevenueScaleContribution`. The fetched locals are replaced by `inputs.*` reads and the snapshot upsert is dropped. Mapping: `demoOutlook?.riskLevel ?? 'unknown'` becomes `inputs.demographicRiskLevel ?? 'unknown'`; `peerSelections.length === 0` becomes `!inputs.hasPeerSelection`; `program?.level` becomes `inputs.level`. Inline the numeric literals it already has. Don't import from `src/lifecycle/` anything except types.

- [ ] **Step 1:** Use superpowers:using-git-worktrees to create a worktree on `refactor/lifecycle-tuning` from `develop`. Run `pnpm install` and `pnpm link-env` there. Copy this plan into the worktree.
- [ ] **Step 2: Capture the baseline** (before any code change), from the worktree's `packages/db`:
  ```bash
  pnpm exec tsx -e "import {prisma, programLifecycleVerdict} from './src/index'; (async()=>{const ps=await prisma.program.findMany({select:{id:true},orderBy:{id:'asc'}}); const out:Record<string,unknown>={}; for(const p of ps){const r=await programLifecycleVerdict(p.id); const {generatedAt, ...rest}=r; out[p.id]=rest;} require('node:fs').writeFileSync(process.argv[1], JSON.stringify(out)); await prisma.\$disconnect();})()" <scratchpad>/lifecycle-before.json
  ```
  Expected: the file exists, with one key per program (~300). Record the count. If the API dev server is running ingestion that writes health inputs, pause it until Task 7.
- [ ] **Step 3:** Create `types.ts`. Change `program-deep-dive.ts` to `import type { … } from './lifecycle/types'` and re-export the three result types from there. Create the legacy fixture.
- [ ] **Step 4:** Run `pnpm --filter @kku/db typecheck` (or `pnpm typecheck`). Expected: clean.
- [ ] **Step 5: Commit** — `refactor(lifecycle): extract lifecycle types and freeze a legacy reference`.

---

### Task 2: `tuning.ts`, `version.ts`, pin test

**Files:**
- Create: `packages/db/src/lifecycle/tuning.ts`, `packages/db/src/lifecycle/version.ts`, `packages/db/test/lifecycle-tuning-pin.test.ts`

**Interfaces:**
- `tuning.ts` exports:
  ```ts
  /** [atLeast, contribution] rows, thresholds descending; first row whose threshold ≤ value wins. */
  export type BandTable = ReadonlyArray<readonly [atLeast: number, contribution: number]>;
  export interface Banded { bands: BandTable; below: number }
  export interface Linear { centre: number; weight: number; cap?: number }
  export const LIFECYCLE_INSTITUTION_REVISION: string | null = null;
  export const LIFECYCLE_TUNING: { … } as const
  ```
  `LIFECYCLE_TUNING` holds exactly these values, keyed by driver label:
  | key | value |
  |---|---|
  | `score` | `{ baseline: 50, min: 0, max: 100 }` |
  | `drivers.ai_readiness` | Linear `{ centre: 50, weight: 0.5 }` |
  | `drivers.health_overall` | Linear `{ centre: 50, weight: 0.4 }` |
  | `drivers.enrollment_trend` | Linear `{ centre: 50, weight: 0.6, cap: 15 }` (reads `attractiveness.enrollment_trend_slope`) |
  | `drivers.tuition_trend` | Linear `{ centre: 50, weight: 0.4, cap: 10 }` (reads `financial.tuition_trend_slope`) |
  | `drivers.content_modernity` | `{ FRONTIER: 10, OLD_SCHOOL: -10, other: 0 }` |
  | `drivers.labour_market_alignment` | Banded `[[70,15],[50,5],[30,-5]]`, below `-15` |
  | `drivers.revenue_scale` | Banded on revenue/target ratio `[[1.5,10],[1.0,5],[0.5,0],[0.25,-5]]`, below `-10` |
  | `drivers.major_content_gaps` | `{ perGap: -4, floor: -12 }` |
  | `drivers.demographic_resilience` | Banded `[[80,10],[50,0]]`, below `-10` |
  | `drivers.delayed_graduation_share` | Banded on share 0–1 `[[0.25,-10],[0.15,-5],[0.05,-2]]`, below `0` |
  | `drivers.capability_strength` | Banded `[[80,8],[60,3],[40,0]]`, below `-8` |
  | `verdict` | `{ frontierAtLeast: 80, risingAtLeast: 65, stableAtLeast: 45 }` |
  | `gates` | `{ aiReadinessStableBelow: 30, aiReadinessFrontierBelow: 50, labourMarketStableBelow: 30, labourMarketFrontierBelow: 50 }` |
  The header comment copies the health-score `tuning.ts` header (what's here, what's not, the four "before you change anything" steps), pointing at the lifecycle pin test and `lifecycle/README.md`. It states that the revenue targets, flagship floor and partial-year share come from `../health-score/tuning`.
- `version.ts` exports `UPSTREAM_LIFECYCLE_VERSION = 'lifecycle.v1.4'` and `LIFECYCLE_VERSION: string` (`upstream` or `` `${upstream}+${revision}` ``).

- [ ] **Step 1: Write the pin test.** It mirrors `health-score-tuning-pin.test.ts` (same header text adapted, same three `it`s). The fingerprint is the first 16 hex chars of sha256 over `JSON.stringify({ tuning: LIFECYCLE_TUNING, revenueTargets: REVENUE_TARGET_THB_BY_LEVEL, flagshipFloor: FLAGSHIP_REVENUE_FLOOR_THB, partialYearBelowShareOfPrior: HEALTH_SCORE_TUNING.shared.partialYearBelowShareOfPrior })`. Start with `PINNED = {}`.
- [ ] **Step 2:** Run `pnpm --filter @kku/db test lifecycle-tuning-pin`. Expected: FAIL, because the modules don't exist yet.
- [ ] **Step 3:** Create `tuning.ts` and `version.ts`. Run again. Expected: FAIL with "No fingerprint is pinned for lifecycle.v1.4 … add 'lifecycle.v1.4': '<hex>'". Pin that value.
- [ ] **Step 4:** Run again. Expected: 3 passed.
- [ ] **Step 5:** Mutate one value (e.g. `risingAtLeast: 66`) and confirm the first test fails. Revert.
- [ ] **Step 6: Commit** — `refactor(lifecycle): one tuning file and a tuning-pin test`.

---

### Task 3: `bands.ts` and `drivers.ts`

**Files:**
- Create: `packages/db/src/lifecycle/bands.ts`, `packages/db/src/lifecycle/drivers.ts`, `packages/db/test/lifecycle-drivers.test.ts`

**Interfaces:**
- `bandScore(value: number, table: Banded): number` returns the contribution of the first row with `value >= atLeast`, else `table.below`.
- `linearContribution(value: number, t: Linear): number` computes `(value - t.centre) * t.weight`, then clamps to `[-cap, cap]` when `cap` is set (`Math.max(-cap, Math.min(cap, raw))`). Keep that order; see Review Focus 2.
- `computeRevenueScaleContribution(latestAnnualRevenueThb: number | null, level: keyof typeof REVENUE_TARGET_THB_BY_LEVEL | string | null): number` keeps the same signature and null rules (≤0 or unknown level → 0) and uses `bandScore` on the ratio.
- `buildLifecycleDrivers(inputs: LifecycleInputs): ProgramLifecycleDriver[]` returns the 11 drivers in **insertion order** (Review Focus 5) with labels and `raw` shapes identical to the legacy code (e.g. `revenue_scale.raw = { latestAnnualRevenueThb, fiscalYear, level, target }`, `delayed_graduation_share.raw = { delayedPct }`). A null input gives contribution `0`, as now. Health sub-driver lookups go through one local helper (the old `extractDriverFromHealth`, renamed `healthDriverValue(health, dim, label): number | null`).
- Also exports `modernityVerdictOf(inputs): string | null` and `labourMarketScoreOf(inputs): number | null` (gates.ts and narrative.ts need them).

- [ ] **Step 1: Write failing tests** in `lifecycle-drivers.test.ts`, using a `baseInputs()` factory with all signals null or neutral:
  - `bandScore` edges for labour market: `70→15, 69.999→5, 50→5, 30→-5, 29.999→-15`.
  - capability: `80→8, 60→3, 40→0, 39.999→-8` (Review Focus 3).
  - delayed share: `0→0, 0.05→-2, 0.15→-5, 0.25→-10`; `totalActive: 0` gives 0.
  - `linearContribution` enrollment: `100→15` (capped), `0→-15`, `60→6`; ai_readiness `0→-25`.
  - `computeRevenueScaleContribution`: `(null,'BACHELOR')→0`, `(0,'BACHELOR')→0`, `(x,'UNKNOWN')→0`, and ratio 1.5/1.0/0.5/0.25/0.2 of the BACHELOR target → `10/5/0/-5/-10`.
  - `major_content_gaps` with 0/2/5 major gaps → `0/-8/-12`. `content_modernity` FRONTIER/IN_BETWEEN/OLD_SCHOOL/absent → `10/0/-10/0`, with `raw.verdict` `'unknown'` when absent.
  - `buildLifecycleDrivers(baseInputs()).map(d => d.label)` equals the 11 labels in insertion order.
- [ ] **Step 2:** Run `pnpm --filter @kku/db test lifecycle-drivers`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `bands.ts` and `drivers.ts`, with every number read from `LIFECYCLE_TUNING`.
- [ ] **Step 4:** Run again. Expected: all pass.
- [ ] **Step 5: Commit** — `refactor(lifecycle): pure drivers read from the tuning file`.

---

### Task 4: `gates.ts`

**Files:**
- Create: `packages/db/src/lifecycle/gates.ts`, `packages/db/test/lifecycle-gates.test.ts`

**Interfaces:**
- `ungatedVerdict(score: number, modernityVerdict: string | null): ProgramLifecycleVerdict`: FRONTIER needs `score >= frontierAtLeast && modernityVerdict === 'FRONTIER'`, then RISING/STABLE/SUNSET by thresholds.
- `interface GateContext { aiReadiness: number; labourMarketScore: number | null; latestAnnualRevenueThb: number | null; modernityVerdict: string | null }`
- `interface LifecycleGate { name: LifecycleGateEffect['name']; capFrom: readonly ProgramLifecycleVerdict[]; capTo: ProgramLifecycleVerdict; fires(ctx: GateContext): boolean; reason(ctx: GateContext): string; shortLabel: string }`
- `LIFECYCLE_GATES: readonly LifecycleGate[]`, in this exact order: `oldSchoolContentCap`, `aiReadinessStableCap`, `aiReadinessFrontierCap`, `lowLabourMarketAlignmentStableCap`, `lowLabourMarketAlignmentFrontierCap`, `lowRevenuePotentialFrontierCap`. Each `capFrom`, `capTo`, condition, `reason` and `shortLabel` reproduce the legacy text **character for character**, with thresholds interpolated from `LIFECYCLE_TUNING.gates` / `FLAGSHIP_REVENUE_FLOOR_THB`. The floor label is "Revenue < 3M THB/yr flagship floor (FRONTIER cap)", with `3` = `(FLAGSHIP_REVENUE_FLOOR_THB / 1_000_000).toFixed(0)`.
- `applyGates(verdict: ProgramLifecycleVerdict, ctx: GateContext): { verdict: ProgramLifecycleVerdict; gatesApplied: LifecycleGateEffect[] }` walks the table in order on the running verdict.

- [ ] **Step 1: Write failing tests:**
  - `ungatedVerdict`: `(80,'FRONTIER')→FRONTIER`, `(80,'IN_BETWEEN')→RISING`, `(79.9,'FRONTIER')→RISING`, `65→RISING`, `45→STABLE`, `44.9→SUNSET`.
  - Chaining (Review Focus 4): FRONTIER with `aiReadiness: 40, labourMarketScore: 20` gives `gatesApplied` names `['aiReadinessFrontierCap','lowLabourMarketAlignmentStableCap']` and final STABLE.
  - All null: FRONTIER with `labourMarketScore: null, latestAnnualRevenueThb: null, aiReadiness: 90, modernity 'FRONTIER'` fires no gates.
  - Revenue zero: FRONTIER with `latestAnnualRevenueThb: 0` fires `lowRevenuePotentialFrontierCap`, and its reason contains `"0.0M THB < 3M flagship floor"`.
  - Exact reason string for `aiReadinessStableCap` at `aiReadiness: 12.4`: `'AI readiness 12/100 < 30 — program faces structural AI threat regardless of trajectory; caps verdict at STABLE.'`
- [ ] **Step 2:** Run `pnpm --filter @kku/db test lifecycle-gates`. Expected: FAIL.
- [ ] **Step 3:** Implement `gates.ts`.
- [ ] **Step 4:** Run again. Expected: pass.
- [ ] **Step 5: Commit** — `refactor(lifecycle): verdict gates as one ordered table`.

---

### Task 5: `narrative.ts`, `compute.ts`, equivalence against legacy

**Files:**
- Create: `packages/db/src/lifecycle/narrative.ts`, `packages/db/src/lifecycle/compute.ts`, `packages/db/test/lifecycle-compute.test.ts`, `packages/db/test/lifecycle-equivalence.test.ts`

**Interfaces:**
- `narrative.ts`: `buildNarrative(args: { verdict; ungatedVerdict; trajectoryScore: number; modernityVerdict: string | null; sortedDrivers: ProgramLifecycleDriver[]; gatesApplied: LifecycleGateEffect[]; hasPeerSelection: boolean }): string`. `verdictHeadline` and `labelToPhrase` are moved verbatim. The gate label comes from `LIFECYCLE_GATES[].shortLabel`, which replaces `labelGateName`.
- `compute.ts`: `computeLifecycle(inputs: LifecycleInputs, now: Date = new Date()): ProgramLifecycleResult`. The score is `clamp(baseline + Σcontribution, min, max)`, with the sum computed by `reduce` in insertion order. Drivers are sorted with a stable `[...drivers].sort((a,b) => Math.abs(b.contribution) - Math.abs(a.contribution))`. `methodologyVersion: LIFECYCLE_VERSION`, `generatedAt: now.toISOString()`.

- [ ] **Step 1: Write failing tests** in `lifecycle-compute.test.ts`:
  - All-neutral inputs give `trajectoryScore` 50 + the ai/health contributions, STABLE, `gatesApplied: []`.
  - A tie: two drivers with |contribution| 10 keep insertion order in `drivers` (Review Focus 5).
  - The narrative includes `'AI peer review not yet generated'` when `hasPeerSelection: false`.
  - `generatedAt` equals `now.toISOString()`.
- [ ] **Step 2: Write the equivalence test** in `lifecycle-equivalence.test.ts`. Build a cartesian grid over the band edges ±0.001 and a few interior points:
  - ai_readiness `{0,29.999,30,49.999,50,75,100}`
  - health overall `{null,0,50,100}`
  - enrollment/tuition slope `{null,0,50,100}`
  - modernity `{absent,FRONTIER,IN_BETWEEN,OLD_SCHOOL}`
  - major gaps `{0,1,4}`
  - labour market `{null,29.999,30,50,70}`
  - resilience `{null,49.999,50,80}`
  - delayed `{0/0, 1/20, 3/20, 5/20}`
  - capability `{null,39.999,40,60,80}`
  - revenue `{null,0,1_000_000,2_999_999,3_000_000,60_000_000}` × level `{BACHELOR,DOCTORAL,null}`
  - `hasPeerSelection` `{true,false}`

  Sample deterministically (seeded LCG, ≥200k combinations) and assert `expect(omitGeneratedAt(computeLifecycle(i))).toStrictEqual(legacyComputeLifecycle(i))`. Construct `HealthScoreRow` minimally with a typed helper that fills only the read fields; no `any`.
- [ ] **Step 3:** Run `pnpm --filter @kku/db test lifecycle-compute lifecycle-equivalence`. Expected: FAIL (module missing).
- [ ] **Step 4:** Implement `narrative.ts` and `compute.ts`.
- [ ] **Step 5:** Run again. Expected: all pass, 0 mismatches. On a mismatch, fix the new code; never the legacy fixture.
- [ ] **Step 6: Commit** — `refactor(lifecycle): pure computeLifecycle, proven equal to the legacy formula`.

---

### Task 6: `load.ts`, `index.ts`, remove the old code

**Files:**
- Create: `packages/db/src/lifecycle/load.ts`, `packages/db/src/lifecycle/index.ts`
- Modify: `packages/db/src/program-deep-dive.ts` (delete the lifecycle block from the `// v1.1 (2026-05-02)` comment through `labelToPhrase`, plus the `types.ts` re-export from Task 1; drop now-unused imports), `packages/db/src/index.ts`, `packages/db/src/program-strategic-narrative-run.ts:19-29`, `packages/db/src/methodology-bundle.ts:~90-101`
- Test: add to `packages/db/test/lifecycle-compute.test.ts`

**Interfaces:**
- `pickLatestAnnualRevenue(rows: Array<{ tuitionRevenue: Prisma.Decimal | null; fiscalYear: number }>): { thb: number | null; fiscalYear: number | null }`. This is the legacy IIFE semantics exactly, with the 0.3 read from `HEALTH_SCORE_TUNING.shared.partialYearBelowShareOfPrior`. `fiscalYear` is `rows[0].fiscalYear` whenever `thb` is non-null, **even when the prior year's figure was picked**; that is a legacy quirk, so keep it.
- `loadLifecycleInputs(programId: string): Promise<LifecycleInputs>` runs the same 8 queries in one `Promise.all` as today.
- `index.ts`: `programLifecycleVerdict(programId: string): Promise<ProgramLifecycleResult>` = load → `computeLifecycle` → the same fire-and-forget `programLifecycleSnapshot.upsert` (moved verbatim, `.catch(() => undefined)`). It re-exports types, `computeLifecycle`, `computeRevenueScaleContribution`, `LIFECYCLE_TUNING`, `LIFECYCLE_INSTITUTION_REVISION`, `UPSTREAM_LIFECYCLE_VERSION`, `LIFECYCLE_VERSION`.
- Circular-import rule: `lifecycle/load.ts` imports `programAiReadiness`, `programStudentCohorts` and `programDemographicOutlook` from `../program-deep-dive`. `program-deep-dive.ts` must **not** import from `./lifecycle`.

- [ ] **Step 1: Write failing tests** for `pickLatestAnnualRevenue`:
  - `[]` gives `{null,null}`.
  - `[{tuitionRevenue:null,fiscalYear:2568}]` gives `{null,null}`.
  - `[{new Decimal(0),2568}]` gives `{thb:0,fiscalYear:2568}` (Review Focus 1).
  - `[{100,2568},{1000,2567}]` gives `{thb:1000,fiscalYear:2568}`.
  - `[{300,2568},{1000,2567}]` gives `{thb:300,…}` (exactly 30% is not partial).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `load.ts` and `index.ts`. Remove the old block from `program-deep-dive.ts`. Add `export * from './lifecycle';` to `packages/db/src/index.ts`. Point the narrative-run import at `./lifecycle`. In `methodology-bundle.ts`, import `LIFECYCLE_VERSION` from `./lifecycle/version` and delete the local const and its v1.x history comment (it moves to the README in Task 7).
- [ ] **Step 4:** Run `pnpm typecheck && pnpm --filter @kku/db test`. Expected: typecheck clean. The db tests pass, apart from the known pre-existing failures listed in CLAUDE.md; compare file/test counts against a `develop` run.
- [ ] **Step 5:** Confirm the moved code is gone: `grep -n "LIFECYCLE_VERSION\|programLifecycleVerdict" packages/db/src/program-deep-dive.ts` gives no output.
- [ ] **Step 6: Commit** — `refactor(lifecycle): move programLifecycleVerdict into packages/db/src/lifecycle`.

---

### Task 7: Whole-DB equivalence, cleanup, docs

**Files:**
- Create: `packages/db/src/lifecycle/README.md`
- Delete: `packages/db/test/lifecycle-equivalence.test.ts`, `packages/db/test/fixtures/lifecycle-legacy.ts`
- Modify: `docs/guides/adapt-a-methodology.md:12`, `docs/superpowers/notes/decisions-log.md`, `CLAUDE.md` (Current status)

- [ ] **Step 1:** Re-run the Task 1 Step 2 command, writing to `<scratchpad>/lifecycle-after.json`.
- [ ] **Step 2:** Compare: `node -e "const a=require(process.argv[1]),b=require(process.argv[2]);const k=Object.keys(a);let d=0;for(const i of k){if(JSON.stringify(a[i])!==JSON.stringify(b[i])){d++;if(d<4)console.log(i)}}console.log(k.length,'programs',d,'differ')" <scratchpad>/lifecycle-before.json <scratchpad>/lifecycle-after.json`. Expected: `<N> programs 0 differ`, with N equal to the Task 1 count. If any differ, check that the input data didn't change (re-run the `before` command from `develop`) before blaming the code.
- [ ] **Step 3:** Delete the legacy fixture and the equivalence test. The anchor tests in Tasks 3–6 and the pin test remain the guard.
- [ ] **Step 4:** Write `lifecycle/README.md`, modelled on `health-score/README.md`:
  - "Changing a number → `tuning.ts`": the four steps, with the pin-test command `pnpm --filter @kku/db test lifecycle-tuning-pin`.
  - Which numbers are shared with health-score.
  - A file table.
  - The 11 drivers and 6 gates with their tuning keys.
  - "Version history", holding the v1.1–v1.4 notes moved from the code comments in `program-deep-dive.ts` and `methodology-bundle.ts`.
- [ ] **Step 5:** In `adapt-a-methodology.md:12`, replace `packages/db/src/program-deep-dive.ts` with `packages/db/src/lifecycle/` (`tuning.ts`). Add a "Recent decisions" entry to the decisions log: what moved, the measured 0/N diff, the pin fingerprint, and the out-of-scope `pickFinancialYear` divergence as an open question for `lifecycle.v1.5`. Add one line to CLAUDE.md "Current status".
- [ ] **Step 6:** Run `pnpm check` and `pnpm docs:build`. Expected: both green, apart from the known pre-existing failures.
- [ ] **Step 7: Commit** — `docs(lifecycle): README, adapt-a-methodology path, decisions log`.
