# External Grant Engagement Driver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `external_grant_engagement` to the Program Health Score capability dimension. It is the share of a programme's active teaching staff on at least one externally funded project in the last three complete Thai fiscal years, scored as 60 % → 100, and gated on 30 days of green sync history. Health score moves `v5.2 → v5.3`.

**Architecture:**
- **Pure logic and loader:** one new module, `packages/db/src/grant-engagement.ts`, holds the fiscal-year window, scoring, green-history gate, and a cached gate loader. It also exposes `grantEngagementDriver(memberIds)`, which builds the finished driver object.
- **Scorers:** both capability scorers in `health-score.ts` call it with their distinct active staff.
- **Web:** gains a label, a source mark, and plain-text null reasons.

**Spec:** `docs/superpowers/specs/2026-10-02-grant-engagement-driver-design.md` (approved 2026-10-02).

**Tech Stack:** Prisma, Vitest, Next.js 14, TypeScript strict.

**House rules:**
- No `any`, design tokens only.
- No raw SQL or `Prisma.sql`. Health scores are read inside Next.js server components.
- Commit with `git commit -F <file>`, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never add `handoff.md`, `presentation_en.md` or `presentation_th.md`. Never read or grep `.env`.
- Run single test files from the package directory with `npx vitest run test/<file>`. The `pnpm --filter X test -- <pattern>` filter is ignored.

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/src/grant-engagement.ts` (create) | Pure: `fiscalYearBe`, `grantWindow`, `engagementScore`, `greenHistoryGate`. Loaders: `loadGrantGate` (5-min cache), `fundedStaffIds`. Builder: `grantEngagementDriver` |
| `packages/db/test/grant-engagement.test.ts` (create) | Pure-function and loader tests |
| `packages/db/src/health-score.ts` (modify) | Driver label in `DIMENSION_DRIVERS.capability`; driver in `scoreCapabilityProgram` and `scoreCapabilityScope`; `HEALTH_SCORE_VERSION` → `health-score.v5.3` |
| `packages/db/src/index.ts` (modify) | Export the new module |
| `packages/db/test/health-score.test.ts`, `health-score-driver-parity.test.ts`, `methodology-bundle.test.ts`, `dq-health-driver.test.ts` (modify as needed) | Mock the new loader; driver lists; version pins |
| `packages/db/src/methodology-bundle.ts` (or wherever `BUNDLE_CALENDAR_TAG` lives) (modify) | Bump the calendar tag (release-shipping change) |
| `apps/web/app/programs/[id]/client.tsx`, `apps/web/app/programs/[id]/print/page.tsx` (modify) | Driver label; null-reason text |
| `apps/web/src/components/data-source-mark.tsx` (modify) | `DRIVER_SOURCE_MARK` entry |
| `docs/methodologies/health-score.md`, `apps/web/app/docs/methodology/content-{en,th}.tsx`, `docs/evaluation-pipeline.md`, `docs/readiness-checklist.md`, `CLAUDE.md` (modify) | Documentation |

---

### Task 1: Pure functions

**Files:**
- Create: `packages/db/src/grant-engagement.ts`
- Test: `packages/db/test/grant-engagement.test.ts`

- [ ] **Step 1: Write the failing test** `packages/db/test/grant-engagement.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  GRANT_ENGAGEMENT_TARGET,
  engagementScore,
  fiscalYearBe,
  grantWindow,
  greenHistoryGate,
} from '../src/grant-engagement';

const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

describe('fiscalYearBe', () => {
  it('starts a new Thai fiscal year on 1 October, Bangkok time', () => {
    expect(fiscalYearBe(at('2026-09-30T12:00:00+07:00'))).toBe(2569);
    expect(fiscalYearBe(at('2026-10-01T00:00:00+07:00'))).toBe(2570);
    // 30 Sep 18:00 UTC is already 1 Oct 01:00 in Bangkok.
    expect(fiscalYearBe(at('2026-09-30T18:00:00Z'))).toBe(2570);
    expect(fiscalYearBe(at('2026-01-15T00:00:00+07:00'))).toBe(2569);
  });
});

describe('grantWindow', () => {
  it('is the last three complete fiscal years', () => {
    expect(grantWindow(at('2026-10-02T09:00:00+07:00'))).toEqual({ fromFyBe: 2567, toFyBe: 2569 });
    expect(grantWindow(at('2026-09-29T09:00:00+07:00'))).toEqual({ fromFyBe: 2566, toFyBe: 2568 });
  });
});

describe('engagementScore', () => {
  it('scores the funded share linearly against a 60 % target', () => {
    expect(GRANT_ENGAGEMENT_TARGET).toBe(0.6);
    expect(engagementScore(0, 10)).toBe(0);
    expect(engagementScore(36, 100)).toBeCloseTo(60, 5);
    expect(engagementScore(6, 10)).toBe(100);
    expect(engagementScore(9, 10)).toBe(100);
  });

  it('is null when there are no staff', () => {
    expect(engagementScore(0, 0)).toBeNull();
  });
});

describe('greenHistoryGate', () => {
  const NOW = at('2026-11-15T12:00:00+07:00');
  const daily = (days: number, skip: number[] = []) =>
    Array.from({ length: days }, (_, i) => new Date(NOW.getTime() - (i + 0.2) * DAY)).filter((_, i) => !skip.includes(i));

  it('is closed as not-synced with no successful run', () => {
    expect(greenHistoryGate([], NOW)).toEqual({ open: false, reason: 'source-not-synced' });
  });

  it('is closed as stale when the latest success is older than 72 hours', () => {
    const runs = daily(60).map((d) => new Date(d.getTime() - 4 * DAY));
    const g = greenHistoryGate(runs, NOW);
    expect(g.open).toBe(false);
    if (!g.open) expect(g.reason).toBe('source-stale');
  });

  it('is closed while history is under 30 days, reporting progress', () => {
    const g = greenHistoryGate(daily(12), NOW);
    expect(g).toMatchObject({ open: false, reason: 'awaiting-green-history', daysOfHistory: 11 });
  });

  it('is closed when fewer than 25 of the last 30 days had a success', () => {
    const g = greenHistoryGate(daily(60, [1, 3, 5, 7, 9, 11]), NOW);
    expect(g).toMatchObject({ open: false, reason: 'awaiting-green-history', successfulDaysLast30: 24 });
  });

  it('opens with 30+ days of history, 25+ of the last 30 days green, and a recent success', () => {
    const g = greenHistoryGate(daily(45, [2, 4, 6]), NOW);
    expect(g.open).toBe(true);
    if (g.open) expect(g.successfulDaysLast30).toBe(27);
  });

  it('counts several runs on one Bangkok day as one day', () => {
    const runs = [...daily(40), ...daily(40).map((d) => new Date(d.getTime() + 3_600_000))];
    const g = greenHistoryGate(runs, NOW);
    expect(g.open).toBe(true);
    if (g.open) expect(g.successfulDaysLast30).toBe(30);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** From `packages/db`, run `npx vitest run test/grant-engagement.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the pure part** of `packages/db/src/grant-engagement.ts`:

```ts
// External grant engagement — the health-score capability driver added in
// health-score.v5.3 (spec docs/superpowers/specs/2026-10-02-grant-engagement-driver-design.md).
//
// Share of a programme's active teaching staff on at least one externally
// funded research or academic-service project (lead or co-investigator) in the
// last three COMPLETE Thai fiscal years, scored linearly to 100 at 60 %.
//
// Gated on readiness gate 11 (30 days of green sync history for the
// kku-research-services source): until the gate opens the driver is null, never
// 0, and says why. Plain Prisma only — health scores are read inside Next.js
// server components, where nested Prisma.sql fragments break.

export const GRANT_ENGAGEMENT_LABEL = 'external_grant_engagement';
export const GRANT_ENGAGEMENT_TARGET = 0.6;
export const GRANTS_SOURCE = 'kku-research-services';

const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;
const HISTORY_DAYS = 30;
const MIN_GREEN_DAYS = 25;
const STALE_AFTER_MS = 72 * 3_600_000;

function bangkokParts(d: Date): { year: number; month: number; day: string } {
  const b = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return { year: b.getUTCFullYear(), month: b.getUTCMonth() + 1, day: b.toISOString().slice(0, 10) };
}

/** Thai fiscal year (BE) of an instant; the fiscal year starts on 1 October (Bangkok). */
export function fiscalYearBe(d: Date): number {
  const { year, month } = bangkokParts(d);
  return year + 543 + (month >= 10 ? 1 : 0);
}

/** The last three complete fiscal years before the one `now` falls in. */
export function grantWindow(now: Date): { fromFyBe: number; toFyBe: number } {
  const current = fiscalYearBe(now);
  return { fromFyBe: current - 3, toFyBe: current - 1 };
}

/** 0–100, linear to GRANT_ENGAGEMENT_TARGET; null when there is nobody to measure. */
export function engagementScore(funded: number, staff: number): number | null {
  if (staff <= 0) return null;
  return Math.max(0, Math.min(100, (funded / staff / GRANT_ENGAGEMENT_TARGET) * 100));
}

export type GrantGate =
  | { open: true; daysOfHistory: number; successfulDaysLast30: number; lastSuccessAt: string }
  | { open: false; reason: 'source-not-synced' }
  | { open: false; reason: 'source-stale'; lastSuccessAt: string }
  | { open: false; reason: 'awaiting-green-history'; daysOfHistory: number; successfulDaysLast30: number };

/**
 * Readiness gate 11 for the grants source: open only when the first success is
 * ≥ 30 days old, ≥ 25 of the last 30 Bangkok days had a success, and the latest
 * success is within 72 h. Reason precedence: not-synced, stale, awaiting history.
 */
export function greenHistoryGate(successTimes: readonly Date[], now: Date): GrantGate {
  if (successTimes.length === 0) return { open: false, reason: 'source-not-synced' };
  const times = successTimes.map((d) => d.getTime());
  const first = Math.min(...times);
  const last = Math.max(...times);
  const lastSuccessAt = new Date(last).toISOString();
  if (now.getTime() - last > STALE_AFTER_MS) return { open: false, reason: 'source-stale', lastSuccessAt };
  const daysOfHistory = Math.floor((now.getTime() - first) / DAY_MS);
  const windowStart = now.getTime() - HISTORY_DAYS * DAY_MS;
  const greenDays = new Set(
    times.filter((t) => t > windowStart && t <= now.getTime()).map((t) => bangkokParts(new Date(t)).day),
  );
  const successfulDaysLast30 = Math.min(greenDays.size, HISTORY_DAYS);
  if (daysOfHistory < HISTORY_DAYS || successfulDaysLast30 < MIN_GREEN_DAYS) {
    return { open: false, reason: 'awaiting-green-history', daysOfHistory, successfulDaysLast30 };
  }
  return { open: true, daysOfHistory, successfulDaysLast30, lastSuccessAt };
}
```

The test's `daily(n)` puts one run each day at `now − (i + 0.2) days`. So `daily(12)` spans about 11.2 days, which is why `daysOfHistory` is 11. `daily(30+)` fills all 30 Bangkok days in the window. Check the "counts several runs on one Bangkok day" case: adding one hour must keep each pair on the same Bangkok day. `now` is 12:00 Bangkok and the offsets are 0.2 days (≈ 4.8 h), so `+1 h` stays on the same day. If a boundary still splits a pair, adjust the test's offset rather than the gate.

- [ ] **Step 4: Run it and confirm it passes.** From `packages/db`, run `npx vitest run test/grant-engagement.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit.** Message: `feat(db): pure grant-engagement window, score and green-history gate`.

---

### Task 2: Loaders and the driver builder

**Files:**
- Modify: `packages/db/src/grant-engagement.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/grant-engagement.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `grant-engagement.test.ts`. It needs its own module mock, so put it in a **separate file**, `packages/db/test/grant-engagement-loader.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runFindMany: vi.fn(),
  memberFindMany: vi.fn(),
}));

vi.mock('../src/index', () => ({
  prisma: {
    ingestionRun: { findMany: mocks.runFindMany },
    researchServiceProjectMember: { findMany: mocks.memberFindMany },
  },
}));

import { __resetGrantGateCache, fundedStaffIds, grantEngagementDriver, loadGrantGate } from '../src/grant-engagement';

const NOW = new Date('2026-11-15T12:00:00+07:00');
const DAY = 86_400_000;
const daily = (n: number) => Array.from({ length: n }, (_, i) => ({ completedAt: new Date(NOW.getTime() - (i + 0.2) * DAY) }));

beforeEach(() => {
  mocks.runFindMany.mockReset();
  mocks.memberFindMany.mockReset();
  __resetGrantGateCache();
});

describe('loadGrantGate', () => {
  it('reads successful runs of the grants source once and caches the result', async () => {
    mocks.runFindMany.mockResolvedValue(daily(40));
    const a = await loadGrantGate(NOW);
    const b = await loadGrantGate(NOW);
    expect(a.open).toBe(true);
    expect(b).toEqual(a);
    expect(mocks.runFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.runFindMany).toHaveBeenCalledWith({
      where: { status: 'SUCCEEDED', completedAt: { not: null }, dataSource: { slug: 'kku-research-services' } },
      select: { completedAt: true },
    });
  });
});

describe('fundedStaffIds', () => {
  it('returns the distinct staff with a membership in the window, real data only', async () => {
    mocks.memberFindMany.mockResolvedValue([{ facultyMemberId: 'a' }, { facultyMemberId: 'b' }]);
    const ids = await fundedStaffIds(['a', 'b', 'c'], { fromFyBe: 2567, toFyBe: 2569 });
    expect([...ids].sort()).toEqual(['a', 'b']);
    expect(mocks.memberFindMany).toHaveBeenCalledWith({
      where: {
        facultyMemberId: { in: ['a', 'b', 'c'] },
        project: { fiscalYearBe: { gte: 2567, lte: 2569 } },
        ingestionRun: { dataSource: { mocked: false } },
      },
      select: { facultyMemberId: true },
      distinct: ['facultyMemberId'],
    });
  });

  it('does not query for an empty staff list', async () => {
    expect((await fundedStaffIds([], { fromFyBe: 2567, toFyBe: 2569 })).size).toBe(0);
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });
});

describe('grantEngagementDriver', () => {
  it('is null with the gate reason while the gate is closed, without reading memberships', async () => {
    mocks.runFindMany.mockResolvedValue(daily(5));
    const d = await grantEngagementDriver(['a', 'b'], NOW);
    expect(d.label).toBe('external_grant_engagement');
    expect(d.value).toBeNull();
    expect(d.raw).toMatchObject({ reason: 'awaiting-green-history', daysOfHistory: 4 });
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it('scores the funded share when the gate is open, and a real zero when nobody is funded', async () => {
    mocks.runFindMany.mockResolvedValue(daily(40));
    mocks.memberFindMany.mockResolvedValueOnce([{ facultyMemberId: 'a' }]);
    const d = await grantEngagementDriver(['a', 'b', 'c', 'd', 'e'], NOW);
    expect(d.value).toBeCloseTo((1 / 5 / 0.6) * 100, 5);
    expect(d.raw).toMatchObject({ fundedStaff: 1, staff: 5, windowFyBe: [2567, 2569], target: 0.6 });

    mocks.memberFindMany.mockResolvedValueOnce([]);
    const z = await grantEngagementDriver(['a'], NOW);
    expect(z.value).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** From `packages/db`, run `npx vitest run test/grant-engagement-loader.test.ts`. Expected: FAIL (exports missing).

- [ ] **Step 3: Implement.** Append to `grant-engagement.ts`:

```ts
import { prisma } from './index';
import { realDataWhere } from './data-quality';

const GATE_TTL_MS = 5 * 60_000;
let gateCache: { at: number; gate: GrantGate } | null = null;

/** Test hook: drop the cached gate. */
export function __resetGrantGateCache(): void {
  gateCache = null;
}

/** The green-history gate for the grants source, cached per process for 5 minutes
 *  so scoring every programme costs one query. */
export async function loadGrantGate(now: Date = new Date()): Promise<GrantGate> {
  if (gateCache && now.getTime() - gateCache.at < GATE_TTL_MS) return gateCache.gate;
  const runs = await prisma.ingestionRun.findMany({
    where: { status: 'SUCCEEDED', completedAt: { not: null }, dataSource: { slug: GRANTS_SOURCE } },
    select: { completedAt: true },
  });
  const gate = greenHistoryGate(
    runs.map((r) => r.completedAt).filter((d): d is Date => d !== null),
    now,
  );
  gateCache = { at: now.getTime(), gate };
  return gate;
}

/** Staff (of `memberIds`) on at least one project — lead or co-investigator — in the window. */
export async function fundedStaffIds(
  memberIds: readonly string[],
  window: { fromFyBe: number; toFyBe: number },
): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const rows = await prisma.researchServiceProjectMember.findMany({
    where: {
      facultyMemberId: { in: [...memberIds] },
      project: { fiscalYearBe: { gte: window.fromFyBe, lte: window.toFyBe } },
      ...realDataWhere(),
    },
    select: { facultyMemberId: true },
    distinct: ['facultyMemberId'],
  });
  return new Set(rows.map((r) => r.facultyMemberId).filter((id): id is string => id !== null));
}

export interface GrantEngagementDriver {
  label: typeof GRANT_ENGAGEMENT_LABEL;
  value: number | null;
  raw: Record<string, unknown>;
}

/** The finished capability driver for a set of DISTINCT active staff ids. */
export async function grantEngagementDriver(
  memberIds: readonly string[],
  now: Date = new Date(),
): Promise<GrantEngagementDriver> {
  const gate = await loadGrantGate(now);
  if (!gate.open) {
    const { open: _open, ...why } = gate;
    return { label: GRANT_ENGAGEMENT_LABEL, value: null, raw: { ...why, staff: memberIds.length } };
  }
  const window = grantWindow(now);
  const funded = await fundedStaffIds(memberIds, window);
  const fundedStaff = funded.size;
  return {
    label: GRANT_ENGAGEMENT_LABEL,
    value: engagementScore(fundedStaff, memberIds.length),
    raw: {
      fundedStaff,
      staff: memberIds.length,
      share: memberIds.length ? fundedStaff / memberIds.length : null,
      windowFyBe: [window.fromFyBe, window.toFyBe],
      target: GRANT_ENGAGEMENT_TARGET,
      gate: { daysOfHistory: gate.daysOfHistory, successfulDaysLast30: gate.successfulDaysLast30 },
    },
  };
}
```

Move the two `import` lines to the top of the file, as ESLint `import/first` may require. Check how other `packages/db/src` modules import `prisma`, either from `'./index'` or from `'./client'`, and match them, so you don't create an import cycle. `realDataWhere()` returns `{ ingestionRun: { dataSource: { mocked: false } } }`, which is why the test expects that literal.

In `packages/db/src/index.ts`, add `export * from './grant-engagement';` next to `export * from './research-services';`. If `__resetGrantGateCache` should not leak from the barrel, export the module's public names explicitly instead.

- [ ] **Step 4: Run the tests and typecheck.** From `packages/db`, run `npx vitest run test/grant-engagement.test.ts test/grant-engagement-loader.test.ts && npx tsc --noEmit -p .`. Expected: PASS, no type errors.

- [ ] **Step 5: Commit.** Message: `feat(db): grant-engagement driver builder with a cached green-history gate`.

---

### Task 3: Wire the driver into the Health Score (v5.3)

**Files:**
- Modify: `packages/db/src/health-score.ts`
- Modify (tests): `packages/db/test/health-score.test.ts`, `packages/db/test/health-score-driver-parity.test.ts`, `packages/db/test/methodology-bundle.test.ts` and any other test that enumerates capability drivers or pins `health-score.v5.2`. Find them with `grep -rln "health-score.v5.2\|publications_per_faculty\|retirement_horizon_5y" packages apps --include=*.test.ts --include=*.test.tsx`.
- Modify: the methodology bundle's `BUNDLE_CALENDAR_TAG`.

- [ ] **Step 1: Write the failing tests.**
  - **Mocking:** in `health-score.test.ts` and `health-score-driver-parity.test.ts`, mock the new module at the top using the files' existing `vi.mock` style:

```ts
vi.mock('../src/grant-engagement', () => ({
  GRANT_ENGAGEMENT_LABEL: 'external_grant_engagement',
  grantEngagementDriver: vi.fn(async (ids: readonly string[]) => ({
    label: 'external_grant_engagement',
    value: ids.length ? 50 : null,
    raw: { fundedStaff: Math.round(ids.length * 0.3), staff: ids.length },
  })),
}));
```

  - **Capability driver list:** wherever a test asserts the capability driver list or count, expect five drivers, ending with `external_grant_engagement`.
  - **Version:** wherever a test pins `HEALTH_SCORE_VERSION`, expect `'health-score.v5.3'`.
  - **Program scorer test:** with three active staff, the capability drivers include `external_grant_engagement` with value 50, and the mock was called once with the three distinct active staff ids. Inactive staff are excluded.
  - **Scope scorer test:** staff shared by two programmes are passed once (distinct ids).
  - **Gate-closed test:** when the mock returns `value: null`, capability is the mean of the other four drivers and `dataCompletenessPct` drops accordingly.

  Mirror the harness each file already uses. These files deliberately avoid `vi.importActual('../src/index')`; read the comment at the top of `health-score.test.ts` before touching mocks.

- [ ] **Step 2: Run them and confirm they fail.** From `packages/db`, run `npx vitest run test/health-score.test.ts test/health-score-driver-parity.test.ts`. Expected: FAIL (driver missing, version still v5.2).

- [ ] **Step 3: Implement in `health-score.ts`.**
  1. `import { GRANT_ENGAGEMENT_LABEL, grantEngagementDriver } from './grant-engagement';`
  2. Change `export const HEALTH_SCORE_VERSION = 'health-score.v5.2';` to `'health-score.v5.3'`. Add a version-history comment line in the file's existing style: `v5.3 — capability gains external_grant_engagement (share of active teaching staff on an externally funded project, last 3 complete FY, 60 % → 100, gated on 30 days of green kku-research-services history).`
  3. Append `GRANT_ENGAGEMENT_LABEL` to `DIMENSION_DRIVERS.capability`, after `'student_faculty_ratio'`. If the array is `as const` with string literals, use the literal `'external_grant_engagement'` to keep the type narrow.
  4. In `scoreCapabilityProgram`, after `const memberIds = active.map((l) => l.facultyMember.id);`, compute `const grantDriver = await grantEngagementDriver([...new Set(memberIds)]);` and append `grantDriver` to the `drivers` array. Run it alongside the existing publications count in a `Promise.all` if that keeps the code readable.
  5. In `scoreCapabilityScope`, `memberIds` is already distinct (it comes from the `distinctActive` map). Append `await grantEngagementDriver(memberIds)` to its `drivers` array.
  6. **Bundle tag:** find `BUNDLE_CALENDAR_TAG` (`grep -rn "BUNDLE_CALENDAR_TAG =" packages`) and follow the comment beside it for the next tag. If the month changed since the current `landscape-2026-09.vN`, that is `landscape-2026-10.v1`. Update `methodology-bundle.test.ts` if it pins the tag or fingerprint, and make sure the manifest includes `HEALTH_SCORE_VERSION` (it already does).

- [ ] **Step 4: Run the whole db suite and typecheck.** From the repo root, run `pnpm --filter @kku/db test && pnpm --filter @kku/db typecheck`. Expected: all pass. Then grep apps for tests that pin v5.2 (`grep -rn "health-score.v5.2" apps --include=*.ts --include=*.tsx`):
  - update test files;
  - leave **comments** in source files that describe what v5.2 did (for example `program-demand-match/run.ts`, `demand-match-sources.ts`), because they record history;
  - update the topology-data description strings that name the version **in force**: "the jobthai_demand_alignment driver of health-score.v5.2" becomes v5.3.

- [ ] **Step 5: Commit.** Message: `feat(health-score): v5.3 adds the external grant engagement capability driver`.

---

### Task 4: Web — label, source mark, null reasons

**Files:**
- Modify: `apps/web/app/programs/[id]/client.tsx` (`DRIVER_LABEL_LOOKUP` near the "Capability" comment)
- Modify: `apps/web/app/programs/[id]/print/page.tsx` (its own driver label map, ~line 644)
- Modify: `apps/web/src/components/data-source-mark.tsx` (`DRIVER_SOURCE_MARK`)
- Test: `apps/web/test/grant-engagement-driver-ui.test.ts`

- [ ] **Step 1: Write the failing test** `apps/web/test/grant-engagement-driver-ui.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRIVER_SOURCE_MARK } from '../src/components/data-source-mark';
import { grantDriverNullNote } from '../src/lib/grant-driver-note';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('external_grant_engagement in the UI', () => {
  it('has a readable label in the deep-dive and the print view', () => {
    expect(read('app/programs/[id]/client.tsx')).toContain("external_grant_engagement: 'External grant engagement (3 FY)'");
    expect(read('app/programs/[id]/print/page.tsx')).toContain("external_grant_engagement: 'External grant engagement (3 FY)'");
  });

  it('carries the grants source mark', () => {
    expect(DRIVER_SOURCE_MARK.external_grant_engagement).toBe('kku-research-services');
  });

  it('explains each gate reason in plain words', () => {
    expect(grantDriverNullNote({ reason: 'awaiting-green-history', daysOfHistory: 12 })).toBe(
      'Waiting for 30 days of grant-sync history (12 so far).',
    );
    expect(grantDriverNullNote({ reason: 'source-not-synced' })).toBe('Grant data has not been synced on this server yet.');
    expect(grantDriverNullNote({ reason: 'source-stale', lastSuccessAt: '2026-11-10T21:00:00.000Z' })).toBe(
      'Grant data is out of date (last synced 2026-11-11).',
    );
    expect(grantDriverNullNote({ fundedStaff: 1 })).toBeNull();
    expect(grantDriverNullNote(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** From `apps/web`, run `npx vitest run test/grant-engagement-driver-ui.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Labels:** add `external_grant_engagement: 'External grant engagement (3 FY)',` after `student_faculty_ratio` in both label maps.
  - **Source mark:** add `external_grant_engagement: 'kku-research-services',` to `DRIVER_SOURCE_MARK`.
  - **Null-reason helper:** create `apps/web/src/lib/grant-driver-note.ts`:

```ts
// Plain-language reason a null external_grant_engagement driver carries
// (health-score.v5.3). The driver is gated on 30 days of green grant-sync history;
// a null is a data gap, never a low score, and the reader should be told which.

const day = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export function grantDriverNullNote(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || !('reason' in raw)) return null;
  const r = raw as { reason: unknown; daysOfHistory?: unknown; lastSuccessAt?: unknown };
  switch (r.reason) {
    case 'awaiting-green-history':
      return `Waiting for 30 days of grant-sync history (${typeof r.daysOfHistory === 'number' ? r.daysOfHistory : 0} so far).`;
    case 'source-not-synced':
      return 'Grant data has not been synced on this server yet.';
    case 'source-stale':
      return `Grant data is out of date (last synced ${typeof r.lastSuccessAt === 'string' ? day(r.lastSuccessAt) : 'unknown'}).`;
    default:
      return null;
  }
}
```

  - **Rendering:** in `client.tsx`, find where the Health Score Breakdown renders a driver row whose value is null. Search near `humaniseDriverLabel` for how a null driver currently renders, typically "—". For the `external_grant_engagement` row, render `grantDriverNullNote(driver.raw)` as small `text-text-tertiary` text under the label when it returns a string. Do the same in the print page if it renders driver rows. Next to the label, render `<DriverSourceMark label={driver.label} />` if the breakdown already does so for JobThai; otherwise add it there.

- [ ] **Step 4: Run the tests, typecheck and lint.** Run `pnpm --filter web test && pnpm --filter web typecheck`, then from `apps/web` run `npx eslint "app/programs/[id]/client.tsx" "app/programs/[id]/print/page.tsx" src/lib/grant-driver-note.ts src/components/data-source-mark.tsx`. Expected: PASS. Existing lint findings in those large files may predate this change; report them, don't fix unrelated ones.

- [ ] **Step 5: Commit.** Message: `feat(web): label, source mark and gate notes for the grant engagement driver`.

---

### Task 5: Documentation

**Files:** `docs/methodologies/health-score.md`, `apps/web/app/docs/methodology/content-en.tsx`, `apps/web/app/docs/methodology/content-th.tsx`, `docs/evaluation-pipeline.md`, `docs/readiness-checklist.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/methodologies/health-score.md`.** In the capability driver table (search `publications_per_faculty`), add a row with:
  - **label:** `external_grant_engagement`;
  - **source:** `research_service_project_members` (`kku-research-services`);
  - **formula:** `clamp(fundedStaff / activeStaff / 0.60 × 100)`;
  - **window:** last 3 complete Thai FY (1 Oct start);
  - **null:** gate closed (not synced / stale > 72 h / < 30 days or < 25 of last 30 days green).

  Then:
  - in the null-handling section, add one paragraph: "a staff team with no grant is a real 0; a closed gate is null";
  - add the disclosed undercount: about 30 % of co-investigator ids unmatched, so the share is a lower bound;
  - add a v5.3 entry to the version history: date 2026-10-02, what changed, and that capability drivers are now 20 % each;
  - record the measured basis from spec §3.

- [ ] **Step 2: In-app methodology paper, both languages.**
  - Find the capability driver list (`grep -n publications_per_faculty apps/web/app/docs/methodology/content-*.tsx`) and add the driver with a one-sentence explanation.
  - EN: "External grant engagement — the share of the programme's active teaching staff who led or joined at least one externally funded research or academic-service project in the last three complete fiscal years; 60 % or more scores 100. It switches on only after 30 days of reliable daily grant syncs."
  - TH: "การมีส่วนร่วมในทุนภายนอก — สัดส่วนอาจารย์ประจำหลักสูตรที่เป็นหัวหน้าหรือผู้ร่วมโครงการวิจัยหรือบริการวิชาการที่ได้รับทุนภายนอกอย่างน้อยหนึ่งโครงการในสามปีงบประมาณล่าสุดที่ครบปี สัดส่วน 60% ขึ้นไปได้ 100 คะแนน ตัวชี้วัดนี้เริ่มใช้หลังจากซิงก์ข้อมูลทุนสำเร็จต่อเนื่อง 30 วัน"
  - Add a new revision row (next revision number, date 2026-10-02) in both languages.
  - Update every "health-score.v5.2" that names the version **in force** to v5.3. Leave historical revision rows alone.

- [ ] **Step 3: `docs/evaluation-pipeline.md`.** Where the health score's capability drivers are listed, add the driver. Add one line saying that lifecycle verdict and risk see it through the capability dimension. Update the version in force.

- [ ] **Step 4: `docs/readiness-checklist.md`.** Under gate 11, add: "Enforced in code for `kku-research-services` (health-score.v5.3, `packages/db/src/grant-engagement.ts` `greenHistoryGate`): the external_grant_engagement driver stays null until the source has ≥ 30 days of history, ≥ 25 of the last 30 days green, and a success within 72 h."

- [ ] **Step 5: `CLAUDE.md`.** In the Research & academic service grants status entry, replace "**Spec 2 — a health-score driver on this data — is NOT started.**" with a line saying spec 2 is built on main, not released. Name `health-score.v5.3` and the `external_grant_engagement` capability driver. Say the driver is gated on 30 days of green history, so it reads null on any server until then, and point to the spec and plan paths.

- [ ] **Step 6: Commit.** Message: `docs: external grant engagement driver (health-score.v5.3)`.

---

### Task 6: Verification on dev

- [ ] **Step 1: Repo checks.** From the root, run `pnpm typecheck` and `pnpm test`. Expected: green, apart from the known `usage-action-coverage` failure (4 unclassified audit actions). Report anything else.

- [ ] **Step 2: Gate closed (real state on dev).** Dev has only one day of grant history.
  - Start the dev servers, or ask the operator to run `! pnpm dev` (they don't reload `packages/*`; restart if already running).
  - Fetch a programme's health score through the API as an admin. Mint a session token the way `/tmp/claude-1000/-home-denpong-projects-program-landscape/d2067f4b-2efc-4db8-895c-c4490d693ebe/scratchpad/verify-grants.mjs` does; claims need `themePreference`.
  - Confirm `external_grant_engagement` has `value: null` and `raw.reason: 'awaiting-green-history'`.
  - Confirm capability equals the mean of the other four drivers.
  - Confirm `methodologyVersion` is `health-score.v5.3`.

- [ ] **Step 3: Gate forced open (throwaway script, not committed).**
  - Put a script under `apps/ingestion/src/scripts/` with a unique name.
  - Import `grantEngagementDriver` from `@kku/db` and call it for 5 programmes' active staff (`ProgramFaculty`, `isActive`) with a `now` 40 days in the future. Because the gate loader reads real run timestamps, this alone won't open the gate. Instead call the exported pieces directly: `grantWindow(now)` plus `fundedStaffIds(ids, window)` plus `engagementScore`.
  - Print only counts and scores, never names.
  - Confirm the values sit inside spec §3's distribution: share median about 36 %, score about 60.
  - Delete the script.

- [ ] **Step 4: Report.** List what passed, the measured numbers, and anything skipped.
