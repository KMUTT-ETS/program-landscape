# Health-Score Scope Driver Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Methodology version:** `health-score.v4.0` → `health-score.v5.0` (major: every score above program scope changes).

**Goal:** Make faculty/department/university health scores use the same driver set as program scores — rolling up per-program drivers that have no scope-level analogue — and make `dataCompletenessPct` count drivers that are absent, not just drivers that are null.

**Architecture:** `computeHealthScores` branches on `isProgram` and calls `score<Dim>Scope` instead of `score<Dim>Program`. The scope variants were written at v3.0 and never kept up as drivers were added through v3.6/v3.7/v4.0, so they silently score on 2–4 of the 5–7 drivers the program scorers use. We introduce (a) a canonical per-dimension driver registry so `summariseDrivers` can pad and penalise absent drivers, and (b) one memoised program-score index that lets each scope scorer average the program-level value of any driver it cannot compute from the materialised view. Genuinely-aggregate drivers stay as ratio-of-sums; per-program-calibrated drivers get rolled up.

**Tech Stack:** TypeScript strict, Prisma, Vitest, `packages/db`.

---

## Background — the measured defect

`pnpm consistency:check --no-write` on 2026-09-12:

- All 24 faculties score **lower** at faculty scope than their program mean. Never higher.
- Mean gap 11.6 pts; worst 28.5 (วิทยาลัยบัณฑิตศึกษาการจัดการ 47.7 vs 76.3).
- 15 of 24 exceed the script's 10-pt flag threshold.

Per-dimension means across faculties (faculty-scope value vs mean of that faculty's program values):

| Dimension | Faculty scope | Program mean | Delta | Program drivers | Faculty drivers |
|---|---|---|---|---|---|
| attractiveness | 90.0 | 64.2 | **+25.8** | 6 | 3 |
| financial | 54.2 | 67.6 | −13.3 | 4 | 2 (different ones) |
| capability | 78.3 | 77.9 | **+0.4** | 4 | **4 — identical** |
| outcomes | 81.5 | 72.2 | +9.3 | 5 (+2 shared) | 2 (+2 shared) |
| relevance | 19.6 | 76.0 | **−56.4** | 5 | 4, two hardcoded `null` |

**Capability is the control case** — the only dimension whose driver set is identical at both scopes, and the only one that agrees. That confirms driver-set drift as the cause rather than a legitimate difference of statistic.

Relevance dominates the composite gap because the dropped drivers are the high-scoring ones. For วิทยาลัยการคอมพิวเตอร์:

```
labour_market_alignment     faculty=8.3    progMean=8.3     <- the only survivor
demand_match_filled         faculty=null   progMean=null
demographic_resilience      faculty=null   progMean=96.4    <- hardcoded null @ health-score.ts:1832
strategic_sector_alignment  faculty=null   progMean=100.0   <- hardcoded null @ health-score.ts:1833
pedagogical_fit             ABSENT         progMean=87.2    <- never implemented at scope
```

Second, compounding defect: `summariseDrivers` computes completeness as `nonNull / drivers.length` over **only the drivers that scorer constructs**. A driver omitted from the array is invisible, so faculty attractiveness / financial / outcomes all report `dataCompletenessPct: 100%` while missing 3–4 inputs. Relevance honestly reports 25% only because its two gaps were explicitly set to `null` rather than left out.

## Driver mapping — the decision table this plan implements

`AGG` = compute at scope from the materialised view (ratio-of-sums; correct because the scale is scope-invariant).
`ROLLUP` = mean of the non-null program-level driver values across the scope's canonical+active programs (used where the driver's calibration is per-program: absolute THB/yr slopes, per-level targets, policy floors, peer-subject matching).

| Dimension | Driver | At scope | Note |
|---|---|---|---|
| attractiveness | `tcas_competition_ratio` | AGG (exists) | |
| | `tcas_fill_rate` | AGG (exists) | |
| | `tcas_registration_yield` | AGG (exists) | |
| | `tcas_competition_vs_peers` | **ROLLUP (new)** | needs per-program subject signature |
| | `enrollment_trend_slope` | **ROLLUP (new)** | calibrated ±5 students/yr — per-program scale |
| | `kku_intake_policy` | **ROLLUP (new)** | per-level floor (bachelor 30 / postgrad 8) |
| financial | `net_contribution_per_program` | AGG (exists) | scope-only, no program analogue |
| | `revenue_coverage_ratio` | AGG (exists) | **this IS the scope analogue of `revenue_coverage_program_direct`** — do NOT also roll that up, it would weight cost coverage twice |
| | `net_contribution_per_student` | **AGG (new)** | `netContributionTotal / enrolledTotal`, same ฿100k scale; per-student is scope-invariant so ratio-of-sums beats a mean of per-program ratios |
| | `tuition_trend_slope` | **ROLLUP (new)** | calibrated ±฿500k/yr — a faculty growing ฿500k/yr is not "excellent", so the absolute scale cannot be reused at scope |
| | `revenue_scale` | **ROLLUP (new)** | `REVENUE_TARGET_THB_BY_LEVEL` is per-level; a faculty has no single level |
| capability | all 4 | AGG (exists) | **no change** — already at parity |
| outcomes | `employment_rate` | AGG (exists) | respondent-weighted |
| | `average_salary` | AGG (exists) | respondent-weighted |
| | `student_satisfaction` | scope-aware (exists) | |
| | `dq_digital_competency` | scope-aware (exists) | stays deliberately OMITTED for non-bachelor — see the `omittedLabels` mechanism in Task 1 |
| | `job_relevance` | **ROLLUP (new)** | no MV aggregate column exists |
| | `further_study_rate` | **ROLLUP (new)** | no MV aggregate column exists |
| | `tcas_min_score_percentile` | **ROLLUP (new)** | per-program peer percentile |
| relevance | `labour_market_alignment` | mean of program values (exists) | |
| | `demand_match_filled` | mean of program values (exists) | |
| | `demographic_resilience` | **ROLLUP (replaces hardcoded null)** | |
| | `strategic_sector_alignment` | **ROLLUP (replaces hardcoded null)** | |
| | `pedagogical_fit` | **ROLLUP (new)** | |

## Files

- Modify: `packages/db/src/health-score.ts` — registry, `summariseDrivers`, program-score index, `rolledUpDriver`, four scope scorers, `collectProgramIdsForScope`, version bump.
- Modify: `packages/db/src/methodology-bundle.ts` — bump `BUNDLE_CALENDAR_TAG`.
- Test: `packages/db/test/health-score.test.ts` — existing suite, extended.
- Test: `packages/db/test/health-score-driver-parity.test.ts` — new guard suite.
- Docs: `docs/methodologies/health-score.md`, `apps/web/app/docs/methodology/content-en.tsx`, `apps/web/app/docs/methodology/content-th.tsx`, `apps/web/app/changelog/page.tsx`.

## Risk to watch during execution

Building the program-score index fans out `computeHealthScores('program', id)` over all ~301 canonical+active programs. It is memoised for 30 minutes and it **replaces** the identical fan-out `computeProgramDimensionAverages` already pays, so steady-state cost is unchanged — but a cold university-scope cockpit load now pays it where it previously did not. Do not remove the memo. Do not call the index from the program branch.

---

### Task 1: Canonical driver registry + honest completeness

**Files:**
- Modify: `packages/db/src/health-score.ts` (add registry near `HEALTH_DIMENSIONS` ~line 199; rewrite `summariseDrivers` at line 2045)
- Test: `packages/db/test/health-score-driver-parity.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/health-score-driver-parity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DIMENSION_DRIVERS, summariseDriversForTest } from '../src/health-score';

describe('summariseDrivers — absent drivers count against completeness', () => {
  it('pads a canonical driver that the scorer never constructed', () => {
    // relevance canonically has 5 drivers; supply only 1 non-null.
    const result = summariseDriversForTest('relevance', [
      { label: 'labour_market_alignment', value: 8.3, raw: null },
    ]);
    expect(result.score).toBe(8.3);
    // 1 of 5, NOT 1 of 1.
    expect(result.dataCompletenessPct).toBeCloseTo(20, 5);
    expect(result.drivers.map((d) => d.label)).toEqual([...DIMENSION_DRIVERS.relevance]);
    const padded = result.drivers.find((d) => d.label === 'pedagogical_fit');
    expect(padded).toBeDefined();
    expect(padded!.value).toBeNull();
  });

  it('an explicitly omitted driver leaves the denominator smaller, not the score lower', () => {
    // dq_digital_competency is deliberately omitted for non-bachelor
    // programs (v4.0) — completeness must not be penalised for an
    // instrument that cannot apply.
    const result = summariseDriversForTest(
      'outcomes',
      [
        { label: 'employment_rate', value: 90, raw: null },
        { label: 'average_salary', value: 60, raw: null },
        { label: 'student_satisfaction', value: 50, raw: null },
        { label: 'job_relevance', value: 80, raw: null },
        { label: 'further_study_rate', value: 70, raw: null },
        { label: 'tcas_min_score_percentile', value: 40, raw: null },
      ],
      ['dq_digital_competency'],
    );
    // 6 non-null of 6 applicable (7 canonical − 1 omitted).
    expect(result.dataCompletenessPct).toBeCloseTo(100, 5);
    expect(result.drivers.some((d) => d.label === 'dq_digital_competency')).toBe(false);
  });

  it('returns a null score but honest completeness when every driver is null', () => {
    const result = summariseDriversForTest('capability', []);
    expect(result.score).toBeNull();
    expect(result.dataCompletenessPct).toBe(0);
    expect(result.drivers).toHaveLength(DIMENSION_DRIVERS.capability.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db test -- health-score-driver-parity`
Expected: FAIL — `DIMENSION_DRIVERS` and `summariseDriversForTest` are not exported.

- [ ] **Step 3: Add the registry**

In `packages/db/src/health-score.ts`, immediately after the `HealthDimension` type (~line 206), add:

```ts
// ──────────────────────────────────────────────────────────────────────────
// Canonical driver registry (v5.0)
//
// The authoritative list of drivers each dimension can carry, at ANY
// scope. `summariseDrivers` pads canonical labels a scorer did not
// construct with an explicit null entry and counts them against
// dataCompletenessPct.
//
// WHY THIS EXISTS: before v5.0 completeness was nonNull/constructed, so
// a scorer that simply never built a driver reported 100% complete while
// missing half its inputs. The faculty-scope scorers had drifted 2-4
// drivers behind the program scorers since v3.0 and nothing surfaced it.
// A driver added here but forgotten in a scorer now shows up as a
// completeness drop instead of vanishing silently.
//
// Adding a driver: add the label here AND to every scorer for that
// dimension (program + scope), or pass it in `omittedLabels` where it
// genuinely cannot apply.
export const DIMENSION_DRIVERS = {
  attractiveness: [
    'tcas_competition_ratio',
    'tcas_fill_rate',
    'tcas_registration_yield',
    'tcas_competition_vs_peers',
    'enrollment_trend_slope',
    'kku_intake_policy',
  ],
  financial: [
    'net_contribution_per_student',
    'revenue_coverage_program_direct',
    'revenue_coverage_ratio',
    'net_contribution_per_program',
    'tuition_trend_slope',
    'revenue_scale',
  ],
  capability: [
    'senior_rank_share',
    'publications_per_faculty',
    'retirement_horizon_5y',
    'student_faculty_ratio',
  ],
  outcomes: [
    'tcas_min_score_percentile',
    'employment_rate',
    'job_relevance',
    'average_salary',
    'further_study_rate',
    'student_satisfaction',
    'dq_digital_competency',
  ],
  relevance: [
    'labour_market_alignment',
    'demand_match_filled',
    'demographic_resilience',
    'strategic_sector_alignment',
    'pedagogical_fit',
  ],
} as const satisfies Record<HealthDimension, readonly string[]>;
```

Note `financial` carries both coverage labels because the program scorer emits `revenue_coverage_program_direct` and the scope scorer emits `revenue_coverage_ratio`; each scope omits the other. Task 5 wires the `omittedLabels` for that.

- [ ] **Step 4: Rewrite `summariseDrivers`**

Replace `summariseDrivers` at `packages/db/src/health-score.ts:2045` with:

```ts
function summariseDrivers(
  dimension: HealthDimension,
  drivers: HealthScore['drivers'],
  omittedLabels: readonly string[] = [],
): HealthScore {
  const canonical = DIMENSION_DRIVERS[dimension];
  const omitted = new Set(omittedLabels);
  const present = new Map(drivers.map((d) => [d.label, d]));

  // Canonical order, padding anything the scorer never built. An omitted
  // label is dropped entirely — it is not "missing data", it is an
  // instrument that cannot apply at this scope/level.
  const resolved: HealthScore['drivers'] = [];
  for (const label of canonical) {
    if (omitted.has(label)) continue;
    resolved.push(present.get(label) ?? { label, value: null, raw: null });
  }
  // Anything a scorer emitted that is not canonical is a bug; keep it
  // visible rather than swallowing it.
  for (const d of drivers) {
    if (!(canonical as readonly string[]).includes(d.label)) resolved.push(d);
  }

  const applicable = resolved.length;
  const nonNull = resolved.filter((d) => d.value !== null);
  const completeness = applicable > 0 ? (nonNull.length / applicable) * 100 : 0;
  if (nonNull.length === 0) return { score: null, dataCompletenessPct: completeness, drivers: resolved };
  const score = nonNull.reduce((s, d) => s + (d.value ?? 0), 0) / nonNull.length;
  return { score: clamp(score), dataCompletenessPct: completeness, drivers: resolved };
}

/** Test-only seam — `summariseDrivers` is module-private by design. */
export const summariseDriversForTest = summariseDrivers;
```

- [ ] **Step 5: Update every `summariseDrivers` call site to pass its dimension**

There are 10 call sites (5 program scorers, 4 scope scorers, plus `scoreRelevanceScope`). Run `grep -n "return summariseDrivers(drivers)" packages/db/src/health-score.ts` and give each its dimension, e.g. `return summariseDrivers('attractiveness', drivers);`. Leave `emptyScore` alone for now — Task 6 retires it.

- [ ] **Step 6: Run the new test and the existing suite**

Run: `pnpm --filter @kku/db test -- health-score`
Expected: the new parity suite PASSES. Existing `health-score.test.ts` assertions about `dataCompletenessPct` may now report lower, honest values — update those expectations to the canonical denominator and note the reason in a comment. Do not change a score expectation to make a test pass.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/health-score.ts packages/db/test/health-score-driver-parity.test.ts packages/db/test/health-score.test.ts
git commit -F - <<'MSG'
fix(health-score): completeness now counts drivers a scorer never built

dataCompletenessPct was nonNull/constructed, so a scorer that simply
omitted a driver reported 100% complete while missing half its inputs.
Faculty-scope attractiveness, financial and outcomes all claimed 100%
while running on 2-4 of 6-7 drivers.

Adds DIMENSION_DRIVERS as the canonical per-dimension driver list;
summariseDrivers pads absent labels with an explicit null and counts
them. Labels that genuinely cannot apply are passed as omittedLabels so
they shrink the denominator instead of scoring as a gap (preserves the
v4.0 non-bachelor dq_digital_competency rule).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 2: Memoised program-score index + `rolledUpDriver` helper

**Files:**
- Modify: `packages/db/src/health-score.ts` (replace `_computeProgramDimensionAveragesImpl` ~line 447; add index + helper)
- Test: `packages/db/test/health-score-driver-parity.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/db/test/health-score-driver-parity.test.ts`:

```ts
import { rolledUpDriverForTest } from '../src/health-score';

describe('rolledUpDriver', () => {
  const index = new Map([
    ['p1', { programId: 'p1', facultyId: 'f1', dimensions: {
      relevance: { score: 50, dataCompletenessPct: 100, drivers: [
        { label: 'pedagogical_fit', value: 90, raw: null },
      ] },
    } } as never],
    ['p2', { programId: 'p2', facultyId: 'f1', dimensions: {
      relevance: { score: 50, dataCompletenessPct: 100, drivers: [
        { label: 'pedagogical_fit', value: 70, raw: null },
      ] },
    } } as never],
    ['p3', { programId: 'p3', facultyId: 'f1', dimensions: {
      relevance: { score: null, dataCompletenessPct: 0, drivers: [
        { label: 'pedagogical_fit', value: null, raw: null },
      ] },
    } } as never],
  ]);

  it('averages non-null program driver values and records the sample', () => {
    const d = rolledUpDriverForTest(index, ['p1', 'p2', 'p3'], 'relevance', 'pedagogical_fit');
    expect(d.label).toBe('pedagogical_fit');
    expect(d.value).toBe(80); // (90 + 70) / 2 — p3's null excluded, never counted as 0
    expect(d.raw).toEqual({ rolledUp: true, fromPrograms: 2, ofPrograms: 3 });
  });

  it('is null — never 0 — when no program has the driver', () => {
    const d = rolledUpDriverForTest(index, ['p3'], 'relevance', 'pedagogical_fit');
    expect(d.value).toBeNull();
    expect(d.raw).toEqual({ rolledUp: true, fromPrograms: 0, ofPrograms: 1 });
  });

  it('is null for an empty program set', () => {
    const d = rolledUpDriverForTest(index, [], 'relevance', 'pedagogical_fit');
    expect(d.value).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db test -- health-score-driver-parity`
Expected: FAIL — `rolledUpDriverForTest` is not exported.

- [ ] **Step 3: Add the index type, builder, and helper**

In `packages/db/src/health-score.ts`, replace the body of `_computeProgramDimensionAveragesImpl` (line ~447) and add above it:

```ts
// ──────────────────────────────────────────────────────────────────────────
// Program-score index (v5.0)
//
// One fan-out, two consumers: the deep-dive radar's dimension averages
// and the scope scorers' driver rollups. Built over canonical+ACTIVE
// programs only — the same population resolveChildren lists under a
// faculty, so a faculty score rolls up exactly the programs shown
// beneath it.
//
// MUST NOT be called from the program branch of computeHealthScores —
// the index is built BY that branch.
export interface ProgramScoreIndexEntry {
  programId: string;
  facultyId: string | null;
  dimensions: HealthScoreRow['dimensions'];
}
export type ProgramScoreIndex = Map<string, ProgramScoreIndexEntry>;

let _programIndexCache: { at: number; index: ProgramScoreIndex } | null = null;

async function getProgramScoreIndex(): Promise<ProgramScoreIndex> {
  const now = Date.now();
  if (_programIndexCache && now - _programIndexCache.at < PROGRAM_AVG_TTL_MS) {
    return _programIndexCache.index;
  }
  const programs = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, facultyId: true },
  });
  const index: ProgramScoreIndex = new Map();
  for (let i = 0; i < programs.length; i += PROGRAM_AVG_CONCURRENCY) {
    const slice = programs.slice(i, i + PROGRAM_AVG_CONCURRENCY);
    const scored = await Promise.all(
      slice.map((p) =>
        computeHealthScores('program', p.id)
          .then((rows) => ({ p, row: rows[0] ?? null }))
          .catch(() => ({ p, row: null as HealthScoreRow | null })),
      ),
    );
    for (const { p, row } of scored) {
      if (!row) continue;
      index.set(p.id, { programId: p.id, facultyId: p.facultyId, dimensions: row.dimensions });
    }
  }
  _programIndexCache = { at: now, index };
  return index;
}

/**
 * Drop the memoised index. MUST be called in test `beforeEach` — the memo
 * is per-process, so without this a later test reads the program set a
 * previous test mocked, and the failure looks like a scorer bug.
 */
export function invalidateProgramScoreIndexCache(): void {
  _programIndexCache = null;
  _programAvgCache = null;
}

// Mean of the non-null program-level values of one driver across a
// program set. Null (never 0) when no program carries it — a data gap
// is not a bad score, the same rule the scorers use.
function rolledUpDriver(
  index: ProgramScoreIndex,
  programIds: readonly string[],
  dimension: HealthDimension,
  label: string,
): HealthScore['drivers'][number] {
  const values: number[] = [];
  for (const id of programIds) {
    const entry = index.get(id);
    if (!entry) continue;
    const v = entry.dimensions[dimension].drivers.find((d) => d.label === label)?.value;
    if (v !== null && v !== undefined) values.push(v);
  }
  const value = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    label,
    value: value === null ? null : clamp(value),
    raw: { rolledUp: true, fromPrograms: values.length, ofPrograms: programIds.length },
  };
}

/** Test-only seam. */
export const rolledUpDriverForTest = rolledUpDriver;
```

- [ ] **Step 4: Rewrite `_computeProgramDimensionAveragesImpl` to consume the index**

Replace its body with:

```ts
async function _computeProgramDimensionAveragesImpl(): Promise<ProgramDimensionAverages> {
  const index = await getProgramScoreIndex();
  const uni = freshAcc();
  const byFaculty = new Map<string, DimAcc>();
  for (const entry of index.values()) {
    accAdd(uni, entry.dimensions);
    if (entry.facultyId) {
      const facAcc = byFaculty.get(entry.facultyId) ?? freshAcc();
      accAdd(facAcc, entry.dimensions);
      byFaculty.set(entry.facultyId, facAcc);
    }
  }
  return {
    methodologyVersion: HEALTH_SCORE_VERSION,
    programCount: index.size,
    university: accMeans(uni),
    byFaculty: Object.fromEntries([...byFaculty.entries()].map(([fid, acc]) => [fid, accMeans(acc)])),
  };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @kku/db test -- health-score`
Expected: PASS. The `programCount` semantic narrows from "every Program row" to "canonical+active" — check no test asserts the old number; if one does, update it and comment why.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/health-score.ts packages/db/test/health-score-driver-parity.test.ts
git commit -F - <<'MSG'
feat(health-score): memoised program-score index + driver rollup helper

One fan-out feeding two consumers: the deep-dive radar's dimension
averages (existing) and the scope scorers' per-driver rollups (next
tasks). Built over canonical+ACTIVE programs, the same population
resolveChildren lists under a faculty.

rolledUpDriver averages the non-null program-level values of one driver
and records fromPrograms/ofPrograms so the provenance drawer can say the
value was rolled up and from how many programmes. Null, never 0, when no
programme carries it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 3: Canonical+active population for scope program sets

**Files:**
- Modify: `packages/db/src/health-score.ts:1950` (`collectProgramIdsForScope`)

- [ ] **Step 1: Write the failing test**

This asserts on the `where` clause the scorer sends, using the suite's
existing `prisma.program.findMany` mock. Copy the `vi.hoisted` + `vi.mock`
harness block from `packages/db/test/health-score.test.ts:8-100` into the
parity suite (or extract it to a shared helper if you prefer — but do not
`importActual('../src/index')`, see the comment at line 31 of that file for
why that silently reaches the live database).

```ts
describe('collectProgramIdsForScope — canonical+active only', () => {
  it('filters to ACTIVE programmes carrying a sheet sequence number', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([]);

    await computeHealthScores('university', null);

    // The relevance + financial + outcomes + attractiveness scope scorers
    // all resolve their programme set through this call.
    const scopeCalls = mocks.programFindMany.mock.calls.filter(
      ([args]) => args?.select?.id === true && args?.where !== undefined,
    );
    expect(scopeCalls.length).toBeGreaterThan(0);
    for (const [args] of scopeCalls) {
      expect(args.where).toMatchObject({
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
      });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db test -- health-score-driver-parity`
Expected: FAIL — no `status` / `sequenceNoFromSheet` filter in the where clause.

- [ ] **Step 3: Add the filter**

In `collectProgramIdsForScope`, add `status: 'ACTIVE', sequenceNoFromSheet: { not: null }` to all three multi-program branches:

```ts
async function collectProgramIdsForScope(scopeId: string, scope: ScopeLevel): Promise<string[]> {
  if (scope === 'program') return [scopeId];
  // Canonical+ACTIVE only, matching resolveChildren — so a scope score
  // rolls up exactly the programmes listed beneath it. Before v5.0 this
  // helper counted retired and non-canonical rows that the heatmap never
  // showed, so the relevance scope drivers averaged a different
  // population than the row they appeared on.
  const canonical = { status: 'ACTIVE' as const, sequenceNoFromSheet: { not: null } };
  if (scope === 'department') {
    const ps = await prisma.program.findMany({
      where: { departmentId: scopeId, ...canonical },
      select: { id: true },
    });
    return ps.map((p) => p.id);
  }
  if (scope === 'faculty') {
    const ps = await prisma.program.findMany({
      where: { OR: [{ facultyId: scopeId }, { department: { facultyId: scopeId } }], ...canonical },
      select: { id: true },
    });
    return ps.map((p) => p.id);
  }
  const ps = await prisma.program.findMany({ where: canonical, select: { id: true } });
  return ps.map((p) => p.id);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @kku/db test -- health-score`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/health-score.ts packages/db/test/health-score-driver-parity.test.ts
git commit -F - <<'MSG'
fix(health-score): scope program sets match the programmes the row shows

collectProgramIdsForScope counted every Program row while resolveChildren
lists only canonical+ACTIVE ones, so the relevance scope drivers averaged
a different population than the faculty row they rendered on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 4: Relevance scope — the −56 pt dimension

**Files:**
- Modify: `packages/db/src/health-score.ts:1796` (`scoreRelevanceScope`)

- [ ] **Step 1: Write the failing test**

Append to `packages/db/test/health-score-driver-parity.test.ts`:

```ts
describe('scoreRelevanceScope — no longer drops the per-programme drivers', () => {
  it('carries all five canonical relevance drivers', async () => {
    const rows = await computeHealthScores('university', null);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const labels = row.dimensions.relevance.drivers.map((d) => d.label);
      expect(labels).toEqual([
        'labour_market_alignment',
        'demand_match_filled',
        'demographic_resilience',
        'strategic_sector_alignment',
        'pedagogical_fit',
      ]);
    }
  });
});
```

Add a second test that pins the rolled-up VALUE, not just the label — a
label-only assertion would still pass if every rolled-up driver came back
null:

```ts
  it('rolls pedagogical_fit up as the mean of its programmes', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    // Two canonical programmes under fac-1.
    mocks.programFindMany.mockResolvedValue([
      { id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' },
      { id: 'prog-2', nameEn: 'B', nameTh: 'ข', facultyId: 'fac-1' },
    ]);
    mocks.programFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] }),
    );
    // 90 for prog-1, 70 for prog-2 → rolled up to 80.
    mocks.programPedagogyAssessmentFindUnique.mockImplementation(
      ({ where }: { where: { programId: string } }) =>
        Promise.resolve({
          overallScore: where.programId === 'prog-1' ? 90 : 70,
          disciplineFitScore: null,
          qaScore: null,
        }),
    );

    const rows = await computeHealthScores('university', null);
    const fit = rows[0]!.dimensions.relevance.drivers.find((d) => d.label === 'pedagogical_fit');
    expect(fit!.value).toBe(80);
    expect(fit!.raw).toMatchObject({ rolledUp: true, fromPrograms: 2, ofPrograms: 2 });
  });
```

Import `computeHealthScores` at the top of the file if it is not already there.

Add to the parity suite's `beforeEach`, alongside the existing resets:

```ts
  invalidateProgramScoreIndexCache();
```

Without it the second test reads the program set the first test mocked and
fails looking like a scorer bug.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kku/db test -- health-score-driver-parity`
Expected: FAIL — `pedagogical_fit` absent, the other two null.

- [ ] **Step 3: Replace the driver array in `scoreRelevanceScope`**

Replace the `emptyScore(...)` early return and the `drivers` array at the end of `scoreRelevanceScope` with:

```ts
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  if (programIds.length === 0) {
    return summariseDrivers('relevance', []);
  }
```

…and, at the end of the function, replace the four-entry `drivers` array with:

```ts
  // v5.0: the three per-programme drivers are rolled up from the
  // programme scores rather than hardcoded null. Before this, faculty
  // relevance was the mean of ONE surviving low driver
  // (labour_market_alignment) while the three high ones — demographic
  // resilience ~97, strategic sector ~100, pedagogical fit ~85 — were
  // discarded, putting every faculty at 8-32 against a programme mean
  // of 68-83.
  const index = await getProgramScoreIndex();
  const drivers = [
    { label: 'labour_market_alignment', value: alignment === null ? null : clamp(alignment), raw: alignment },
    { label: 'demand_match_filled', value: demandMatch === null ? null : clamp(demandMatch), raw: demandMatch },
    rolledUpDriver(index, programIds, 'relevance', 'demographic_resilience'),
    rolledUpDriver(index, programIds, 'relevance', 'strategic_sector_alignment'),
    rolledUpDriver(index, programIds, 'relevance', 'pedagogical_fit'),
  ];
  return summariseDrivers('relevance', drivers);
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @kku/db test -- health-score`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/health-score.ts packages/db/test/health-score-driver-parity.test.ts
git commit -F - <<'MSG'
fix(health-score): faculty relevance rolls up its per-programme drivers

demographic_resilience and strategic_sector_alignment were hardcoded
null at scope level and pedagogical_fit was never implemented there, so
faculty relevance was the mean of one surviving low driver: 8-32 against
a programme mean of 68-83, a -56 pt dimension gap that dominated the
cockpit's faculty composites.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 5: Attractiveness, financial and outcomes scope scorers

Three dimensions, one commit each. Same shape as Task 4: extend the driver array, keep the aggregate drivers, roll up the rest.

- [ ] **Step 1: Attractiveness — add the three rolled-up drivers**

In `scoreAttractivenessScope` (line ~849), after the three existing TCAS drivers, extend the array and change the return:

```ts
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    // Per-programme calibration — a subject-peer percentile, a ±5
    // students/yr slope and a per-level intake floor have no meaning
    // against a faculty-wide total, so they roll up from the programmes.
    rolledUpDriver(index, programIds, 'attractiveness', 'tcas_competition_vs_peers'),
    rolledUpDriver(index, programIds, 'attractiveness', 'enrollment_trend_slope'),
    rolledUpDriver(index, programIds, 'attractiveness', 'kku_intake_policy'),
  );
  return summariseDrivers('attractiveness', drivers);
```

Declare `drivers` with `const drivers: HealthScore['drivers'] = [ ... ]` so `push` typechecks.

- [ ] **Step 2: Run and commit**

Run: `pnpm --filter @kku/db test -- health-score` → PASS.

```bash
git add packages/db/src/health-score.ts
git commit -F - <<'MSG'
fix(health-score): faculty attractiveness carries all six drivers

The scope scorer had only the three aggregate TCAS ratios — the high
ones — and dropped tcas_competition_vs_peers, enrollment_trend_slope and
kku_intake_policy, which run 49-76. Faculty attractiveness therefore read
+25.8 pts above its programme mean.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

- [ ] **Step 3: Financial — make it async, add one aggregate + two rolled-up drivers**

`scoreFinancialScope` is currently synchronous and takes only the financial MV row. It needs the enrolment row for the per-student aggregate, plus the scope for rollups. Change the signature and the call site at line ~309.

New signature and body additions:

```ts
async function scoreFinancialScope(
  row: MetricRow | null,
  scope: ScopeLevel,
  scopeId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  // Enrolment for the financial head year, falling back to the latest
  // enrolment row — the MV pivots per family, so the financial row can
  // carry a null enrolledTotal. Mirrors scoreFinancialProgram.
  const enrolledHead =
    (row ? enrollment.find((e) => e.year === row.year)?.enrolledTotal : null) ??
    enrollment.at(-1)?.enrolledTotal ??
    null;

  const drivers: HealthScore['drivers'] = [
    // ... the two existing aggregate drivers unchanged ...
    {
      // v5.0: ratio-of-sums, not a mean of per-programme ratios — the
      // ฿100k/student scale is scope-invariant, so aggregating weights
      // by programme size instead of letting a 7-student programme
      // count as much as a 700-student one.
      label: 'net_contribution_per_student',
      value: (() => {
        if (row?.netContributionTotal === null || row?.netContributionTotal === undefined) return null;
        if (!enrolledHead || enrolledHead === 0) return null;
        const perStudent = row.netContributionTotal / enrolledHead;
        return clamp(50 + (perStudent / 100_000) * 50);
      })(),
      raw: { netContributionTotal: row?.netContributionTotal ?? null, enrolled: enrolledHead },
    },
  ];

  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    // Absolute-THB calibration: ±฿500k/yr means "excellent" for one
    // programme and noise for a faculty, and revenue_scale is scored
    // against a per-LEVEL target a faculty does not have. Both roll up.
    rolledUpDriver(index, programIds, 'financial', 'tuition_trend_slope'),
    rolledUpDriver(index, programIds, 'financial', 'revenue_scale'),
  );

  // revenue_coverage_program_direct is deliberately NOT rolled up:
  // revenue_coverage_ratio above is the same metric as ratio-of-sums,
  // and carrying both would weight cost coverage twice in a six-driver
  // mean.
  return summariseDrivers('financial', drivers, ['revenue_coverage_program_direct']);
}
```

Also add `'revenue_coverage_ratio'` and `'net_contribution_per_program'` to the program scorer's `omittedLabels` — those two are scope-only:

in `scoreFinancialProgram`, change both `emptyScore([...])` early returns and the final return to
`return summariseDrivers('financial', drivers, ['revenue_coverage_ratio', 'net_contribution_per_program']);`

Update the call site at line ~309:

```ts
    const financial = isProgram
      ? await scoreFinancialProgram(child.id, enrollment)
      : await scoreFinancialScope(latestFinancial, childScope, child.id, enrollment);
```

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @kku/db test -- health-score` → PASS.

```bash
git add packages/db/src/health-score.ts
git commit -F - <<'MSG'
fix(health-score): faculty financial gains per-student, trend and scale

The scope scorer ran on two drivers the programme scorer does not have
and omitted all four that it does. Adds net_contribution_per_student as
ratio-of-sums (the per-student scale is scope-invariant) and rolls up
tuition_trend_slope and revenue_scale, whose calibration is per-
programme. revenue_coverage_program_direct stays omitted at scope
because revenue_coverage_ratio is the same metric aggregated, and
carrying both would double-weight cost coverage.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

- [ ] **Step 5: Outcomes — add the three rolled-up drivers**

In `scoreOutcomesScope` (line ~1475), after the `dq` push, add:

```ts
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    // No MV aggregate exists for job relevance or further study, and the
    // TCAS min-score percentile is a per-programme peer-subject
    // comparison. All three roll up from the programme scores.
    rolledUpDriver(index, programIds, 'outcomes', 'job_relevance'),
    rolledUpDriver(index, programIds, 'outcomes', 'further_study_rate'),
    rolledUpDriver(index, programIds, 'outcomes', 'tcas_min_score_percentile'),
  );

  // Preserve the v4.0 rule: where DQ cannot apply it shrinks the
  // denominator rather than scoring as a gap.
  return summariseDrivers('outcomes', drivers, dq ? [] : ['dq_digital_competency']);
```

Apply the same `omittedLabels` treatment in `scoreOutcomesProgram` for its own DQ omission branch.

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @kku/db test -- health-score` → PASS.

```bash
git add packages/db/src/health-score.ts
git commit -F - <<'MSG'
fix(health-score): faculty outcomes carries job relevance and further study

Neither has an MV aggregate column and tcas_min_score_percentile is a
per-programme peer comparison, so all three were absent at scope while
the dimension still reported 100% complete. Faculty outcomes read +9.3
pts above its programme mean.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 6: Parity guard test + retire `emptyScore`

**Files:**
- Modify: `packages/db/src/health-score.ts` (delete `emptyScore`, line ~2053)
- Test: `packages/db/test/health-score-driver-parity.test.ts`

- [ ] **Step 1: Write the guard test**

This is the regression that would have caught the original drift. Append:

```ts
// The drift this whole change fixes was invisible for four minor
// versions because nothing compared the two driver sets. This test is
// that comparison. When a driver is added to one scorer and not the
// other, this fails.
describe('driver parity between program and scope scorers', () => {
  // Documented, intentional asymmetries only. Adding an entry here is a
  // methodology decision — say why.
  const SCOPE_ONLY = new Set([
    'revenue_coverage_ratio',      // ratio-of-sums analogue of revenue_coverage_program_direct
    'net_contribution_per_program', // "what does the average programme contribute" — undefined for one programme
  ]);
  const PROGRAM_ONLY = new Set([
    'revenue_coverage_program_direct', // see revenue_coverage_ratio above
  ]);

  it('every canonical driver is reachable at both scopes', async () => {
    const facultyRows = await computeHealthScores('university', null);
    expect(facultyRows.length).toBeGreaterThan(0);
    const faculty = facultyRows[0]!;
    const programRows = await computeHealthScores('faculty', faculty.scopeId);
    expect(programRows.length).toBeGreaterThan(0);
    const program = programRows[0]!;

    for (const dim of HEALTH_DIMENSIONS) {
      const facLabels = new Set(faculty.dimensions[dim].drivers.map((d) => d.label));
      const progLabels = new Set(program.dimensions[dim].drivers.map((d) => d.label));
      for (const label of DIMENSION_DRIVERS[dim]) {
        if (!SCOPE_ONLY.has(label)) {
          expect(progLabels, `${dim}.${label} missing at program scope`).toContain(label);
        }
        if (!PROGRAM_ONLY.has(label)) {
          expect(facLabels, `${dim}.${label} missing at faculty scope`).toContain(label);
        }
      }
    }
  });
});
```

Import `HEALTH_DIMENSIONS` alongside `DIMENSION_DRIVERS`.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @kku/db test -- health-score-driver-parity`
Expected: PASS (Tasks 4–5 made it true). If it fails, a driver was missed — fix the scorer, not the test.

- [ ] **Step 3: Delete `emptyScore`**

`summariseDrivers(dim, [])` now does the same job while producing the canonical label list and honest completeness. Remove the function and replace every remaining call with `summariseDrivers('<dimension>', [])`.

Run: `grep -n "emptyScore" packages/db/src/health-score.ts` → expect no hits.

- [ ] **Step 4: Full package suites + typecheck**

```bash
pnpm --filter @kku/db test
pnpm --filter @kku/shared test
pnpm typecheck
```
Expected: `@kku/db` 422+ passing (count must not DROP — a narrowed glob silently orphans tests), `@kku/shared` 967, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/health-score.ts packages/db/test/health-score-driver-parity.test.ts
git commit -F - <<'MSG'
test(health-score): guard driver parity between programme and scope

The four-version drift was invisible because nothing compared the two
driver sets. This test is that comparison, with the two documented
asymmetries listed explicitly. Also retires emptyScore, which
summariseDrivers now subsumes with an honest denominator.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 7: Version bump, re-measure, and documentation

**Files:**
- Modify: `packages/db/src/health-score.ts:132` (`HEALTH_SCORE_VERSION`)
- Modify: `packages/db/src/methodology-bundle.ts:110` (`BUNDLE_CALENDAR_TAG`)
- Modify: `docs/methodologies/health-score.md` (the divergence claim at lines 687-689)
- Modify: `apps/web/app/docs/methodology/content-en.tsx`, `content-th.tsx` (version tables + the `health-score.v4.0` references)
- Modify: `apps/web/app/changelog/page.tsx`

- [ ] **Step 1: Bump the version**

```ts
export const HEALTH_SCORE_VERSION = 'health-score.v5.0';
```

And in `methodology-bundle.ts`: `export const BUNDLE_CALENDAR_TAG = 'landscape-2026-09.v1';`

The manifest reads `HEALTH_SCORE_VERSION` by reference, so the fingerprint recomputes automatically; `packages/db/test/methodology-bundle.test.ts` asserts they stay consistent.

- [ ] **Step 2: Re-measure the divergence**

```bash
pnpm consistency:check --no-write
```

Record the before/after table in the commit body. Expect the mean gap to fall sharply and the direction to stop being uniform. **Divergence will not reach zero and should not** — the aggregate drivers are deliberately ratio-of-sums. If any faculty still exceeds ~10 pts, dump its drivers before assuming it is fine:

```bash
npx tsx /tmp/claude-1000/-home-denpong-projects-program-landscape/dfbd1955-f4ad-4144-88c6-716721b9260a/scratchpad/driver-dump.ts
```

- [ ] **Step 3: Fix the false claim in the methodology doc**

`docs/methodologies/health-score.md:687-689` currently says the cross-scope divergence "is typically small". Replace with the measured position:

```markdown
  of its departments' composites — each is computed at its own scope.
  Before `health-score.v5.0` the scope scorers had drifted 2-4 drivers
  behind the program scorers, which made the gap large and one-sided:
  measured 2026-09-12, all 24 faculties scored BELOW their program mean,
  by 11.6 pts on average and up to 28.5. v5.0 brings the driver sets to
  parity by rolling up the per-program drivers, leaving only the
  intended difference: drivers whose scale is scope-invariant are
  computed as ratio-of-sums, which weights by program size rather than
  counting a 7-student program equally with a 700-student one. Run
  `pnpm consistency:check` for the current per-faculty position.
```

Add a `health-score.v5.0` row to the version tables in both `content-en.tsx` and `content-th.tsx`, describing the driver-parity change and the completeness fix, and update the "current computations stamp" references from v4.0 to v5.0.

- [ ] **Step 4: Add the changelog entry**

Add an entry to `apps/web/app/changelog/page.tsx` stating that faculty and university health scores now use the same drivers as program scores, that faculty composites move upward as a result, and that `dataCompletenessPct` now counts absent drivers so some dimensions honestly report lower completeness than before.

- [ ] **Step 5: Full verification**

```bash
pnpm --filter @kku/db test
pnpm --filter @kku/shared test
pnpm --filter web test
pnpm --filter api test
pnpm typecheck
pnpm lint
```
Expected: all green; test counts at or above the handoff baseline (`@kku/shared` 967 · `@kku/db` 422 · web 151 · api 135 · ingestion 193).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/health-score.ts packages/db/src/methodology-bundle.ts docs/methodologies/health-score.md apps/web/app/docs/methodology/content-en.tsx apps/web/app/docs/methodology/content-th.tsx apps/web/app/changelog/page.tsx
git commit -F - <<'MSG'
feat(health-score)!: v5.0 — scope driver parity + honest completeness

Faculty, department and university composites change. The scope scorers
now carry the same drivers as the program scorers, rolling up the
per-program ones, and dataCompletenessPct counts drivers a scorer never
built.

Measured before (2026-09-12): all 24 faculties scored below their
program mean, mean gap 11.6 pts, worst 28.5. Relevance was the dominant
cause at -56.4 pts.

Bumps BUNDLE_CALENDAR_TAG; the manifest fingerprint recomputes from the
version constant.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

## Out of scope — flag, do not fix here

- **`tcas_competition_ratio` uses different scoring curves at program vs scope** (banded at scope, linear-ish at program). Pre-existing, orthogonal to driver parity, and changing it would move numbers for a second reason inside the same version bump.
- **`CrossScopeDivergenceSnapshot` rows** written before v5.0 describe the old methodology. They carry `bundleTag` + `bundleFingerprint`, so they remain interpretable; do not delete them.
- **The 807 dead border-colour utilities** and the other open items in `handoff.md`.
