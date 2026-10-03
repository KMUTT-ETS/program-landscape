# External-grant award on the Financial dimension: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v5.3 `external_grant_engagement` capability driver and its 30-day gate with an award of up to +10 points on the Financial dimension (`health-score.v5.4`).

**Architecture:** A new pure-plus-loader module, `packages/db/src/grant-award.ts`, computes the award points. `health-score.ts` keeps its existing Financial scorers as "base" functions and wraps both of them with one `applyGrantAward` step that runs after `summariseDrivers`. The award is exposed as an optional `award` field on the Financial `HealthScore`. It is never a driver, so completeness and the driver-parity guard are unaffected. The web Deep-Dive and print views render one award line under Financial.

**Tech stack:** TypeScript strict, Prisma (plain queries only; no `$queryRaw`, no nested `Prisma.sql`), Zod, Vitest, Next.js 14 (web), NestJS (api).

**Spec:** `docs/superpowers/specs/2026-10-03-external-grant-financial-award-design.md`

**Ground rules for every task**
- Run package tests from the package directory: `cd packages/db && pnpm vitest run <file>`, `cd apps/web && pnpm vitest run <file>`.
- Commit with `git commit -F <msgfile>`, not `-m`. A dev-guard hook rejects some phrases inside command text. Write the message to a file in your scratchpad and end it with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Never `git add` `handoff.md`, `presentation_en.md` or `presentation_th.md`.
- Never run `pnpm build:release`.
- Tailwind trap: `border-border-*` classes emit no CSS. Use `border-subtle` / `border-default` for new markup. Leave existing markup alone.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/src/grant-award.ts` (create) | Constants; `fiscalYearBe` and `grantWindow` (moved); pure `awardPoints` and `withAward`; loaders `loadGrantSourceSynced` and `grantAward`. |
| `packages/db/src/grant-engagement.ts` (delete) | Replaced by `grant-award.ts`. |
| `packages/db/test/grant-award.test.ts` (create) | Pure tests. |
| `packages/db/test/grant-award-loader.test.ts` (create) | Loader tests with mocked Prisma. |
| `packages/db/test/grant-engagement.test.ts`, `grant-engagement-loader.test.ts` (delete) | Old gate tests. |
| `packages/db/src/health-score.ts` (modify) | Remove the capability driver; add `award` to `HealthScoreSchema`; wrap the Financial scorers; bump the version. |
| `packages/db/test/health-score.test.ts`, `health-score-driver-parity.test.ts` (modify) | Swap the grant mocks; new award tests. |
| `packages/db/src/methodology-bundle.ts` (modify) | Calendar tag. |
| `packages/db/src/index.ts` (check) | Re-export `grant-award` if `grant-engagement` was re-exported. |
| `apps/web/src/lib/grant-award-note.ts` (create) and `grant-driver-note.ts` (delete) | Award line text. |
| `apps/web/test/grant-award-ui.test.ts` (create) and `grant-engagement-driver-ui.test.ts` (delete) | UI tests. |
| `apps/web/app/programs/[id]/types.ts`, `client.tsx`, `print/page.tsx` (modify) | Award type and award line. |
| `apps/web/src/components/data-source-mark.tsx` (modify) | Mark mapping. |
| `apps/api/src/programs/program-detail-data.ts` (modify) | Remove the old label. |
| `apps/api/src/cockpit/cockpit.controller.ts` (modify) | Provenance version and caveat. |
| `apps/web/app/admin/application-topology/topology-data.ts` (modify) | Edge comments and Cockpit description. |
| Docs (modify) | `docs/methodologies/health-score.md`, the methodology paper (EN/TH), `docs/evaluation-pipeline.md`, `docs/readiness-checklist.md`, the v5.3 spec, `CLAUDE.md`. |

---

### Task 1: Pure award functions

**Files:**
- Create: `packages/db/src/grant-award.ts`
- Create: `packages/db/test/grant-award.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/grant-award.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  GRANT_AWARD_CAP_THB,
  GRANT_AWARD_FLOOR_THB,
  GRANT_AWARD_LABEL,
  GRANT_AWARD_MAX_POINTS,
  awardPoints,
  fiscalYearBe,
  grantWindow,
  withAward,
} from '../src/grant-award';

const at = (iso: string) => new Date(iso);

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
    expect(grantWindow(at('2026-10-03T09:00:00+07:00'))).toEqual({ fromFyBe: 2567, toFyBe: 2569 });
    expect(grantWindow(at('2026-09-29T09:00:00+07:00'))).toEqual({ fromFyBe: 2566, toFyBe: 2568 });
  });
});

describe('awardPoints', () => {
  it('uses the agreed anchors', () => {
    expect(GRANT_AWARD_LABEL).toBe('external_grant_award');
    expect(GRANT_AWARD_FLOOR_THB).toBe(100_000);
    expect(GRANT_AWARD_CAP_THB).toBe(3_000_000);
    expect(GRANT_AWARD_MAX_POINTS).toBe(10);
  });

  it('is 0 at or below the floor', () => {
    expect(awardPoints(0)).toBe(0);
    expect(awardPoints(50_000)).toBe(0);
    expect(awardPoints(100_000)).toBe(0);
  });

  it('follows the log curve between the anchors', () => {
    expect(awardPoints(300_000)).toBeCloseTo(3.23, 2);
    expect(awardPoints(1_000_000)).toBeCloseTo(6.77, 2);
  });

  it('caps at 10 from the cap upward', () => {
    expect(awardPoints(3_000_000)).toBeCloseTo(10, 10);
    expect(awardPoints(50_000_000)).toBe(10);
  });

  it('treats a non-finite input as no award', () => {
    expect(awardPoints(Number.NaN)).toBe(0);
    expect(awardPoints(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('withAward', () => {
  const base = { score: 61.4, dataCompletenessPct: 75, drivers: [] as Array<{ label: string; value: number | null; raw: unknown }> };

  it('adds the points to a non-null base and records the base', () => {
    const out = withAward(base, { label: GRANT_AWARD_LABEL, points: 6.2, raw: { staff: 4 } });
    expect(out.score).toBeCloseTo(67.6, 10);
    expect(out.award).toEqual({ label: GRANT_AWARD_LABEL, points: 6.2, baseScore: 61.4, raw: { staff: 4 } });
  });

  it('never changes data completeness or drivers', () => {
    const out = withAward(base, { label: GRANT_AWARD_LABEL, points: 10, raw: {} });
    expect(out.dataCompletenessPct).toBe(75);
    expect(out.drivers).toBe(base.drivers);
  });

  it('caps the score at 100', () => {
    const out = withAward({ ...base, score: 96 }, { label: GRANT_AWARD_LABEL, points: 10, raw: {} });
    expect(out.score).toBe(100);
  });

  it('leaves a null base null and reports no points', () => {
    const out = withAward({ ...base, score: null }, { label: GRANT_AWARD_LABEL, points: 7, raw: { staff: 3 } });
    expect(out.score).toBeNull();
    expect(out.award?.points).toBeNull();
    expect(out.award?.baseScore).toBeNull();
  });

  it('leaves the score unchanged when points are null (not synced)', () => {
    const out = withAward(base, { label: GRANT_AWARD_LABEL, points: null, raw: { reason: 'source-not-synced' } });
    expect(out.score).toBe(61.4);
    expect(out.award?.points).toBeNull();
    expect(out.award?.baseScore).toBe(61.4);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/db && pnpm vitest run test/grant-award.test.ts`
Expected: FAIL, because `../src/grant-award` cannot be resolved.

- [ ] **Step 3: Write the pure part of the module**

Create `packages/db/src/grant-award.ts`:

```ts
// External-grant award — health-score.v5.4
// (spec docs/superpowers/specs/2026-10-03-external-grant-financial-award-design.md).
//
// Up to +10 points added to the Financial dimension AFTER its drivers are
// averaged: grant baht per active teaching staff member per year, over the last
// three COMPLETE Thai fiscal years, on a log curve from ฿0.1 M (0) to ฿3 M (+10).
// An award, never a penalty: no grant is +0, and the award never touches data
// completeness. Plain Prisma only — health scores are read inside Next.js server
// components, where nested Prisma.sql fragments break.

export const GRANT_AWARD_LABEL = 'external_grant_award';
export const GRANT_AWARD_FLOOR_THB = 100_000;
export const GRANT_AWARD_CAP_THB = 3_000_000;
export const GRANT_AWARD_MAX_POINTS = 10;
export const GRANTS_SOURCE = 'kku-research-services';
export const GRANT_AWARD_CAVEAT =
  'Lower bound: about 30% of co-investigator ids match no HR record, so some programmes are understated.';

const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** Thai fiscal year (BE) of an instant; the fiscal year starts on 1 October (Bangkok). */
export function fiscalYearBe(d: Date): number {
  const b = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return b.getUTCFullYear() + 543 + (b.getUTCMonth() + 1 >= 10 ? 1 : 0);
}

/** The last three complete fiscal years before the one `now` falls in. */
export function grantWindow(now: Date): { fromFyBe: number; toFyBe: number } {
  const current = fiscalYearBe(now);
  return { fromFyBe: current - 3, toFyBe: current - 1 };
}

/** Award points (0–10) for grant baht per active teaching staff member per year. */
export function awardPoints(bahtPerStaffPerYear: number): number {
  const x = bahtPerStaffPerYear;
  if (!Number.isFinite(x) || x <= GRANT_AWARD_FLOOR_THB) return 0;
  const span = Math.log(GRANT_AWARD_CAP_THB / GRANT_AWARD_FLOOR_THB);
  return Math.min(GRANT_AWARD_MAX_POINTS, (GRANT_AWARD_MAX_POINTS * Math.log(x / GRANT_AWARD_FLOOR_THB)) / span);
}

export interface GrantAward {
  label: typeof GRANT_AWARD_LABEL;
  points: number | null;
  baseScore: number | null;
  raw: Record<string, unknown>;
}

export type GrantAwardInput = Omit<GrantAward, 'baseScore'>;

/**
 * Apply the award to a finished Financial score. A null base stays null and earns
 * nothing; null points (source not synced, no staff) leave the score unchanged.
 * Completeness and drivers are never touched.
 */
export function withAward<T extends { score: number | null }>(
  score: T,
  award: GrantAwardInput,
): T & { award: GrantAward } {
  if (score.score === null) {
    return { ...score, award: { ...award, points: null, baseScore: null } };
  }
  const next = award.points === null ? score.score : Math.min(100, score.score + award.points);
  return { ...score, score: next, award: { ...award, baseScore: score.score } };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/db && pnpm vitest run test/grant-award.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/grant-award.ts packages/db/test/grant-award.test.ts
git commit -F <msgfile>   # feat(db): pure external-grant award curve (health-score.v5.4)
```

---

### Task 2: Award loaders

**Files:**
- Modify: `packages/db/src/grant-award.ts` (append)
- Create: `packages/db/test/grant-award-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/grant-award-loader.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCount: vi.fn(),
  projectFindMany: vi.fn(),
}));

vi.mock('../src/index', () => ({
  prisma: {
    ingestionRun: { count: mocks.runCount },
    researchServiceProject: { findMany: mocks.projectFindMany },
  },
}));

import { __resetGrantSourceCache, grantAward, loadGrantSourceSynced } from '../src/grant-award';

const NOW = new Date('2026-10-03T12:00:00+07:00');

beforeEach(() => {
  mocks.runCount.mockReset();
  mocks.projectFindMany.mockReset();
  __resetGrantSourceCache();
});
afterEach(() => vi.useRealTimers());

describe('loadGrantSourceSynced', () => {
  it('is true once the grants source has one successful run', async () => {
    mocks.runCount.mockResolvedValue(1);
    await expect(loadGrantSourceSynced()).resolves.toBe(true);
    const where = mocks.runCount.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ status: 'SUCCEEDED', dataSource: { slug: 'kku-research-services' } });
  });

  it('is false with no successful run', async () => {
    mocks.runCount.mockResolvedValue(0);
    await expect(loadGrantSourceSynced()).resolves.toBe(false);
  });

  it('caches for 5 minutes and shares one query between concurrent callers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.runCount.mockResolvedValue(1);
    await Promise.all([loadGrantSourceSynced(), loadGrantSourceSynced()]);
    expect(mocks.runCount).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + 4 * 60_000));
    await loadGrantSourceSynced();
    expect(mocks.runCount).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000));
    await loadGrantSourceSynced();
    expect(mocks.runCount).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    mocks.runCount.mockRejectedValueOnce(new Error('db down'));
    await expect(loadGrantSourceSynced()).rejects.toThrow('db down');
    mocks.runCount.mockResolvedValue(1);
    await expect(loadGrantSourceSynced()).resolves.toBe(true);
  });
});

describe('grantAward', () => {
  it('reports not-synced without querying projects', async () => {
    mocks.runCount.mockResolvedValue(0);
    const a = await grantAward(['s1'], NOW);
    expect(a).toEqual({ label: 'external_grant_award', points: null, raw: { reason: 'source-not-synced' } });
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });

  it('reports no-active-staff for an empty staff list', async () => {
    mocks.runCount.mockResolvedValue(1);
    const a = await grantAward([], NOW);
    expect(a.points).toBeNull();
    expect(a.raw).toEqual({ reason: 'no-active-staff' });
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });

  it('queries in-window projects of those staff and sums each project once', async () => {
    mocks.runCount.mockResolvedValue(1);
    mocks.projectFindMany.mockResolvedValue([
      { id: 'rsp-1', budgetThb: 6_000_000n },
      { id: 'rsp-2', budgetThb: null },
    ]);
    const a = await grantAward(['s1', 's2'], NOW);

    const args = mocks.projectFindMany.mock.calls[0]?.[0];
    expect(args.where.fiscalYearBe).toEqual({ gte: 2567, lte: 2569 });
    expect(args.where.members.some.facultyMemberId).toEqual({ in: ['s1', 's2'] });

    // ฿6 M over 3 years over 2 staff = ฿1 M per staff per year.
    expect(a.raw).toMatchObject({
      bahtPerYear: 2_000_000,
      bahtPerStaffPerYear: 1_000_000,
      staff: 2,
      projects: 2,
      windowFyBe: [2567, 2569],
      floorThb: 100_000,
      capThb: 3_000_000,
      maxPoints: 10,
    });
    expect(a.points).toBeCloseTo(6.77, 2);
  });

  it('gives +0 when the staff have no project in the window', async () => {
    mocks.runCount.mockResolvedValue(1);
    mocks.projectFindMany.mockResolvedValue([]);
    const a = await grantAward(['s1'], NOW);
    expect(a.points).toBe(0);
    expect(a.raw).toMatchObject({ projects: 0, bahtPerYear: 0 });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/db && pnpm vitest run test/grant-award-loader.test.ts`
Expected: FAIL, because `__resetGrantSourceCache`, `grantAward` and `loadGrantSourceSynced` are not exported.

- [ ] **Step 3: Implement the loaders**

Add these imports at the top of `packages/db/src/grant-award.ts`, below the header comment:

```ts
import { prisma } from './index';
import { realDataWhere } from './data-quality';
```

Append to the end of the file:

```ts
const SOURCE_TTL_MS = 5 * 60_000;
let sourceCache: { at: number; promise: Promise<boolean> } | null = null;

/** Test hook: drop the cached source check. */
export function __resetGrantSourceCache(): void {
  sourceCache = null;
}

/** True once the grants source has at least one successful run on this server.
 *  Cached per process for 5 minutes; concurrent cold callers share one query and
 *  a failure is never cached. */
export function loadGrantSourceSynced(): Promise<boolean> {
  const t = Date.now();
  if (sourceCache && t - sourceCache.at < SOURCE_TTL_MS) return sourceCache.promise;
  const entry = {
    at: t,
    promise: prisma.ingestionRun
      .count({ where: { status: 'SUCCEEDED', dataSource: { slug: GRANTS_SOURCE } } })
      .then((n) => n > 0),
  };
  sourceCache = entry;
  entry.promise.catch(() => {
    if (sourceCache === entry) sourceCache = null;
  });
  return entry.promise;
}

/** The award for a set of DISTINCT active teaching staff ids. Each in-window
 *  project with any of them on it counts once, whole budget. */
export async function grantAward(memberIds: readonly string[], now?: Date): Promise<GrantAwardInput> {
  if (!(await loadGrantSourceSynced())) {
    return { label: GRANT_AWARD_LABEL, points: null, raw: { reason: 'source-not-synced' } };
  }
  if (memberIds.length === 0) {
    return { label: GRANT_AWARD_LABEL, points: null, raw: { reason: 'no-active-staff' } };
  }
  const window = grantWindow(now ?? new Date());
  const projects = await prisma.researchServiceProject.findMany({
    where: {
      fiscalYearBe: { gte: window.fromFyBe, lte: window.toFyBe },
      members: { some: { facultyMemberId: { in: [...memberIds] }, ...realDataWhere() } },
      ...realDataWhere(),
    },
    select: { id: true, budgetThb: true },
  });
  const years = window.toFyBe - window.fromFyBe + 1;
  const total = projects.reduce((s, p) => s + (p.budgetThb === null ? 0 : Number(p.budgetThb)), 0);
  const bahtPerYear = total / years;
  const bahtPerStaffPerYear = bahtPerYear / memberIds.length;
  return {
    label: GRANT_AWARD_LABEL,
    points: awardPoints(bahtPerStaffPerYear),
    raw: {
      bahtPerStaffPerYear,
      bahtPerYear,
      staff: memberIds.length,
      projects: projects.length,
      windowFyBe: [window.fromFyBe, window.toFyBe],
      floorThb: GRANT_AWARD_FLOOR_THB,
      capThb: GRANT_AWARD_CAP_THB,
      maxPoints: GRANT_AWARD_MAX_POINTS,
      caveat: GRANT_AWARD_CAVEAT,
    },
  };
}
```

- [ ] **Step 4: Run both award test files and confirm they pass**

Run: `cd packages/db && pnpm vitest run test/grant-award.test.ts test/grant-award-loader.test.ts`
Expected: PASS. (`grant-award.test.ts` doesn't mock `./index`. If importing the real Prisma client throws at import time, add the same `vi.mock('../src/index', () => ({ prisma: {} }))` line at the top of that file.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/grant-award.ts packages/db/test/grant-award.test.ts packages/db/test/grant-award-loader.test.ts
git commit -F <msgfile>   # feat(db): external-grant award loader (source check + per-staff baht)
```

---

### Task 3: Wire the award into health-score (v5.4) and remove the capability driver

**Files:**
- Modify: `packages/db/src/health-score.ts` (import at line 12; version comment and constant at lines 209–215; `DIMENSION_DRIVERS.capability` at ~line 343; `HealthScoreSchema` at ~line 357; `scoreFinancialProgram` at ~line 1173; `scoreFinancialScope` at ~line 1277; capability scorers at ~lines 1388–1400, 1452 and 1616)
- Modify: `packages/db/test/health-score.test.ts` (grant mock at lines 100–121, beforeEach at lines 139–140, the grant `describe` at lines 366–457)
- Modify: `packages/db/test/health-score-driver-parity.test.ts` (grant mock at lines 78–91, `describe` at lines 501–527)
- Delete: `packages/db/src/grant-engagement.ts`, `packages/db/test/grant-engagement.test.ts`, `packages/db/test/grant-engagement-loader.test.ts`
- Check: `packages/db/src/index.ts`

- [ ] **Step 1: Replace the grant mock in `health-score.test.ts`**

Replace lines 100–121 (from the comment `// The grant-engagement driver reads its own tables…` to the end of `defaultGrantDriver`) with:

```ts
// The award loader reads its own tables and a cached source check; the
// scorers only need to hand it the right staff ids. The pure parts
// (awardPoints, withAward) stay real. Kept outside `mocks` so the beforeEach
// mockReset loop does not strip the default implementation.
const grantAwardMock = vi.hoisted(() => vi.fn());
vi.mock('../src/grant-award', async () => {
  const actual = await vi.importActual<typeof import('../src/grant-award')>('../src/grant-award');
  return { ...actual, grantAward: grantAwardMock };
});
function defaultGrantAward(ids: readonly string[]): Promise<{
  label: 'external_grant_award';
  points: number | null;
  raw: Record<string, unknown>;
}> {
  return Promise.resolve({
    label: 'external_grant_award',
    points: ids.length ? 5 : null,
    raw: ids.length ? { staff: ids.length } : { reason: 'no-active-staff' },
  });
}
```

In `beforeEach`, replace the two `grantDriverMock` lines with:

```ts
  grantAwardMock.mockReset();
  grantAwardMock.mockImplementation(defaultGrantAward);
```

- [ ] **Step 2: Replace the grant `describe` in `health-score.test.ts` with the v5.4 tests**

Replace everything from `// ── external_grant_engagement (v5.3) ──…` to the end of the `describe('capability — external_grant_engagement', …)` block with:

```ts
// ── external-grant award on Financial (v5.4) ─────────────────────────────

function staffLink(id: string, isActive = true, rank = 'LECTURER'): {
  programId: string;
  facultyMember: { id: string; rank: string; isActive: boolean; retirementDate: Date | null };
} {
  return { programId: 'p1', facultyMember: { id, rank, isActive, retirementDate: null } };
}

// A complete prior year with positive contribution → a non-null Financial base.
function financialRows(): Array<Record<string, number>> {
  const ctx = deriveAcademicYear(defaultNextStartDate());
  const prior = ctx.currentAcademicYearBE - 543 - 1;
  return [prior - 1, prior].map((fiscalYear) => ({
    fiscalYear,
    tuitionRevenue: 3_000_000,
    directCost: 1_000_000,
    allocatedFacilityCost: 0,
    allocatedOverhead: 0,
    netContribution: 2_000_000,
  }));
}

const programRow = {
  id: 'p1', nameEn: 'P', nameTh: 'ป', departmentId: null, level: 'BACHELOR',
  kmitlCareerIds: [], faculty: { code: null },
};

describe('v5.4 — capability is back to four drivers', () => {
  it('drops external_grant_engagement and stamps v5.4', () => {
    expect(HEALTH_SCORE_VERSION).toBe('health-score.v5.4');
    expect(DIMENSION_DRIVERS.capability).toEqual([
      'senior_rank_share',
      'publications_per_faculty',
      'retirement_horizon_5y',
      'student_faculty_ratio',
    ]);
    expect(Object.values(DIMENSION_DRIVERS).flat()).not.toContain('external_grant_award');
  });

  it('capability completeness is 100% when its four inputs are present', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.enrollmentMetricFindFirst.mockResolvedValue({ enrolled: 60 });
    mocks.researchOutputCount.mockResolvedValue(6);
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1', true, 'PROF'), staffLink('s2'), staffLink('s3')]);
    const cap = (await computeHealthScores('program', 'p1'))[0]!.dimensions.capability;
    expect(cap.drivers).toHaveLength(4);
    expect(cap.dataCompletenessPct).toBe(100);
  });
});

describe('financial — external-grant award', () => {
  it('adds the award on top of the base and leaves completeness alone', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue(financialRows());
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1'), staffLink('s2'), staffLink('s2'), staffLink('s3', false)]);

    grantAwardMock.mockImplementation(() =>
      Promise.resolve({ label: 'external_grant_award', points: null, raw: { reason: 'source-not-synced' } }),
    );
    const base = (await computeHealthScores('program', 'p1'))[0]!.dimensions.financial;
    expect(base.score).not.toBeNull();

    grantAwardMock.mockImplementation(defaultGrantAward);
    const fin = (await computeHealthScores('program', 'p1'))[0]!.dimensions.financial;
    expect(fin.award?.label).toBe('external_grant_award');
    expect(fin.award?.points).toBe(5);
    expect(fin.award?.baseScore).toBeCloseTo(base.score!, 10);
    expect(fin.score).toBeCloseTo(Math.min(100, base.score! + 5), 10);
    expect(fin.dataCompletenessPct).toBe(base.dataCompletenessPct);
    expect(fin.drivers.map((d) => d.label)).not.toContain('external_grant_award');

    // Distinct ACTIVE staff only: s2 once, inactive s3 excluded.
    const ids = grantAwardMock.mock.calls.at(-1)?.[0] as string[];
    expect([...ids].sort()).toEqual(['s1', 's2']);
  });

  it('not synced: score equals the base and the award says why', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue(financialRows());
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1')]);
    grantAwardMock.mockImplementation(() =>
      Promise.resolve({ label: 'external_grant_award', points: null, raw: { reason: 'source-not-synced' } }),
    );
    const fin = (await computeHealthScores('program', 'p1'))[0]!.dimensions.financial;
    expect(fin.award?.points).toBeNull();
    expect(fin.score).toBe(fin.award?.baseScore);
    expect(fin.award?.raw).toEqual({ reason: 'source-not-synced' });
  });

  it('null base: no award, no grant query, score stays null', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue([]);
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1')]);
    const fin = (await computeHealthScores('program', 'p1'))[0]!.dimensions.financial;
    expect(fin.score).toBeNull();
    expect(fin.award).toEqual({
      label: 'external_grant_award',
      points: null,
      baseScore: null,
      raw: { reason: 'no-base-financial-score' },
    });
    expect(grantAwardMock).not.toHaveBeenCalled();
  });

  it('does not touch other dimensions', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue(financialRows());
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1')]);
    const row = (await computeHealthScores('program', 'p1'))[0]!;
    for (const key of ['attractiveness', 'capability', 'outcomes', 'relevance'] as const) {
      expect(row.dimensions[key].award).toBeUndefined();
    }
  });
});
```

- [ ] **Step 3: Update the parity test's grant mock and `describe`**

In `packages/db/test/health-score-driver-parity.test.ts`, replace lines 78–91 (the grant comment, `grantDriverMock` and its `vi.mock`) with:

```ts
// The award loader reads its own tables; here it only has to return something.
const grantAwardMock = vi.hoisted(() =>
  vi.fn(async (ids: readonly string[]) => ({
    label: 'external_grant_award' as const,
    points: ids.length ? 5 : null,
    raw: { staff: ids.length },
  })),
);
vi.mock('../src/grant-award', async () => {
  const actual = await vi.importActual<typeof import('../src/grant-award')>('../src/grant-award');
  return { ...actual, grantAward: grantAwardMock };
});
```

Replace the whole `describe('external_grant_engagement parity', …)` block with:

```ts
describe('external-grant award is not a driver', () => {
  it('never appears in any dimension driver list at either scope', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.programFindMany.mockResolvedValue([
      { id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' },
    ]);
    mocks.programFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] }),
    );
    mocks.programFacultyFindMany.mockResolvedValue([
      { programId: 'prog-1', facultyMember: { id: 's1', rank: 'LECTURER', isActive: true, retirementDate: null } },
    ]);
    const faculty = (await computeHealthScores('university', null))[0]!;
    const program = (await computeHealthScores('faculty', faculty.scopeId))[0]!;
    for (const row of [faculty, program]) {
      for (const dim of Object.values(row.dimensions)) {
        expect(dim.drivers.map((d) => d.label)).not.toContain('external_grant_award');
        expect(dim.drivers.map((d) => d.label)).not.toContain('external_grant_engagement');
      }
    }
  });
});
```

If the parity file's `prisma` mock lacks `programFaculty.findMany` with the `select` shape used below, it already returns `facultyMember` objects. The new helper filters `isActive` in JavaScript, so no mock change is needed.

- [ ] **Step 4: Run both suites and confirm they fail**

Run: `cd packages/db && pnpm vitest run test/health-score.test.ts test/health-score-driver-parity.test.ts`
Expected: FAIL. The version is still v5.3, capability still has five drivers, and `award` is undefined.

- [ ] **Step 5: Implement in `health-score.ts`**

1. **Import (line 12).** Replace `import { GRANT_ENGAGEMENT_LABEL, grantEngagementDriver } from './grant-engagement';` with:

```ts
import { GRANT_AWARD_LABEL, grantAward, withAward } from './grant-award';
```

2. **Version comment and constant (lines 209–215).** Keep the v5.3 paragraph, append the paragraph below after it, and set the constant:

```ts
//
// v5.4 (2026-10-03) — external grants move from Capability to an AWARD on
//   Financial. The external_grant_engagement driver and its 30-day gate are
//   removed (Capability is back to four drivers at 25 %). Financial gains up
//   to +10 points AFTER its drivers are averaged: grant baht per active
//   teaching staff member per year, last 3 complete Thai FY, log curve
//   ฿0.1 M → 0 to ฿3 M → +10 (packages/db/src/grant-award.ts). Never lowers
//   a score, never touches completeness, null base earns nothing.
export const HEALTH_SCORE_VERSION = 'health-score.v5.4';
```

3. **`DIMENSION_DRIVERS.capability`.** Remove the `GRANT_ENGAGEMENT_LABEL,` line so the list ends at `'student_faculty_ratio',`.

4. **`HealthScoreSchema`.** Add after the `drivers` array:

```ts
  // v5.4: Financial only — the external-grant award added after the drivers
  // are averaged. Optional so stored snapshots from earlier versions parse.
  award: z
    .object({
      label: z.literal(GRANT_AWARD_LABEL),
      points: z.number().min(0).max(10).nullable(),
      baseScore: z.number().min(0).max(100).nullable(),
      raw: z.unknown(),
    })
    .nullable()
    .optional(),
```

5. **Capability program scorer (~lines 1388–1400 and 1452).** Replace the `Promise.all` with a plain count, and delete the trailing `grantDriver,` entry from `drivers`:

```ts
  const pubCount =
    memberIds.length > 0
      ? await prisma.researchOutput.count({
          where: {
            facultyMemberId: { in: memberIds },
            year: { gte: currentYear - 3 },
            ...realDataWhere(),
          },
        })
      : 0;
```

Also delete the two-line comment above it (`// Grant engagement counts PEOPLE…`).

6. **Capability scope scorer (~line 1616).** Delete the comment `// memberIds is already distinct…` and the line `await grantEngagementDriver(memberIds),`.

7. **Financial scorers.** Rename `async function scoreFinancialProgram(` to `async function scoreFinancialProgramBase(` and `async function scoreFinancialScope(` to `async function scoreFinancialScopeBase(`, leaving their bodies unchanged. Then add directly above the `scoreFinancialProgramBase` declaration (after `PROGRAM_FINANCIAL_OMITTED`):

```ts
// v5.4: the external-grant award is applied to the FINISHED Financial score —
// after summariseDrivers — so it can only raise the score and never moves
// completeness. A null base earns nothing and costs no grant query.
async function applyGrantAward(
  base: HealthScore,
  staffIds: () => Promise<string[]>,
): Promise<HealthScore> {
  if (base.score === null) {
    return withAward(base, {
      label: GRANT_AWARD_LABEL,
      points: null,
      raw: { reason: 'no-base-financial-score' },
    });
  }
  return withAward(base, await grantAward(await staffIds()));
}

/** Distinct ACTIVE teaching staff across the given programmes. */
async function activeStaffIdsForPrograms(programIds: readonly string[]): Promise<string[]> {
  if (programIds.length === 0) return [];
  const links = await prisma.programFaculty.findMany({
    where: { programId: { in: [...programIds] } },
    select: { facultyMember: { select: { id: true, isActive: true } } },
  });
  return [...new Set(links.filter((l) => l.facultyMember.isActive).map((l) => l.facultyMember.id))];
}

async function scoreFinancialProgram(programId: string, enrollment: MetricRow[]): Promise<HealthScore> {
  const base = await scoreFinancialProgramBase(programId, enrollment);
  return applyGrantAward(base, () => activeStaffIdsForPrograms([programId]));
}

async function scoreFinancialScope(
  row: MetricRow | null,
  scope: ScopeLevel,
  scopeId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  const base = await scoreFinancialScopeBase(row, scope, scopeId, enrollment);
  return applyGrantAward(base, async () => activeStaffIdsForPrograms(await collectProgramIdsForScope(scopeId, scope)));
}
```

The call sites in `computeHealthScores` already call `scoreFinancialProgram` and `scoreFinancialScope` with these signatures, so they need no change.

- [ ] **Step 6: Delete the old module and tests, and check the index**

```bash
git rm packages/db/src/grant-engagement.ts packages/db/test/grant-engagement.test.ts packages/db/test/grant-engagement-loader.test.ts
grep -rn "grant-engagement" packages apps --include=*.ts --include=*.tsx | grep -v node_modules
```

If `packages/db/src/index.ts` re-exports `./grant-engagement`, change it to `./grant-award`. The grep must print nothing afterwards.

- [ ] **Step 7: Run the db suites**

Run: `cd packages/db && pnpm vitest run test/health-score.test.ts test/health-score-driver-parity.test.ts test/grant-award.test.ts test/grant-award-loader.test.ts`
Expected: PASS.

Then run the whole db package: `cd packages/db && pnpm vitest run`. Expected: PASS, except `methodology-bundle.test.ts`, which Task 4 fixes if it fails here. Then run `cd packages/db && pnpm tsc --noEmit -p .` and expect no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/health-score.ts packages/db/src/index.ts packages/db/test/health-score.test.ts packages/db/test/health-score-driver-parity.test.ts
git commit -F <msgfile>   # feat(db): health-score.v5.4 — external-grant award on Financial, capability driver removed
```

---

### Task 4: Methodology bundle tag

**Files:**
- Modify: `packages/db/src/methodology-bundle.ts:114`
- Check: `packages/db/test/methodology-bundle.test.ts`

- [ ] **Step 1: Bump the tag**

Change line 114 to:

```ts
export const BUNDLE_CALENDAR_TAG = 'landscape-2026-10.v2';
```

- [ ] **Step 2: Run the bundle test**

Run: `cd packages/db && pnpm vitest run test/methodology-bundle.test.ts`
Expected: PASS. If a hard-coded fingerprint constant fails, update it to the value the test reports, following the comment at the top of that test file.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/methodology-bundle.ts packages/db/test/methodology-bundle.test.ts
git commit -F <msgfile>   # chore(db): methodology bundle landscape-2026-10.v2 for health-score.v5.4
```

---

### Task 5: Award line in the Deep-Dive, print and API

**Files:**
- Create: `apps/web/src/lib/grant-award-note.ts`
- Delete: `apps/web/src/lib/grant-driver-note.ts`
- Create: `apps/web/test/grant-award-ui.test.ts`
- Delete: `apps/web/test/grant-engagement-driver-ui.test.ts`
- Modify: `apps/web/app/programs/[id]/types.ts:192-199`
- Modify: `apps/web/app/programs/[id]/client.tsx` (import at line 49; label at line 4880; `HealthBreakdownRow` at line 4906; driver list at lines 4977–4999)
- Modify: `apps/web/app/programs/[id]/print/page.tsx` (label at line 647; `HealthDimRow` at lines 575–633)
- Modify: `apps/web/src/components/data-source-mark.tsx:52-55`
- Modify: `apps/api/src/programs/program-detail-data.ts:67`

- [ ] **Step 1: Write the failing UI test**

Create `apps/web/test/grant-award-ui.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRIVER_SOURCE_MARK } from '../src/components/data-source-mark';
import { grantAwardCaveat, grantAwardLine } from '../src/lib/grant-award-note';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('external-grant award in the UI', () => {
  it('describes a positive award with the measure, window and base', () => {
    expect(
      grantAwardLine({
        label: 'external_grant_award',
        points: 6.23,
        baseScore: 61.4,
        raw: { bahtPerStaffPerYear: 1_040_000, windowFyBe: [2567, 2569] },
      }),
    ).toBe('External-grant award: +6.2 (฿1.04 M per teaching staff per year, FY 2567–2569) · base 61.4 → 67.6');
  });

  it('says +0 when there was no grant in the window', () => {
    expect(
      grantAwardLine({
        label: 'external_grant_award',
        points: 0,
        baseScore: 55,
        raw: { bahtPerStaffPerYear: 0, windowFyBe: [2567, 2569] },
      }),
    ).toBe('External-grant award: +0 (no external grant in FY 2567–2569)');
  });

  it('explains each null reason in plain words', () => {
    const line = (reason: string) =>
      grantAwardLine({ label: 'external_grant_award', points: null, baseScore: 50, raw: { reason } });
    expect(line('source-not-synced')).toBe('External-grant award: grant data has not been synced on this server yet.');
    expect(line('no-active-staff')).toBe('External-grant award: no active teaching staff on record.');
    expect(line('no-base-financial-score')).toBeNull();
    expect(grantAwardLine(null)).toBeNull();
    expect(grantAwardLine(undefined)).toBeNull();
  });

  it('shows the caveat only for a computed award', () => {
    expect(grantAwardCaveat({ label: 'external_grant_award', points: 3, baseScore: 50, raw: { caveat: 'Lower bound: x' } })).toBe(
      'Lower bound: x',
    );
    expect(grantAwardCaveat({ label: 'external_grant_award', points: null, baseScore: 50, raw: { reason: 'source-not-synced' } })).toBeNull();
    expect(grantAwardCaveat(null)).toBeNull();
  });

  it('carries the grants source mark under the award label', () => {
    expect(DRIVER_SOURCE_MARK.external_grant_award).toBe('kku-research-services');
    expect(DRIVER_SOURCE_MARK.external_grant_engagement).toBeUndefined();
  });

  it('no surface still names the removed driver', () => {
    for (const f of ['app/programs/[id]/client.tsx', 'app/programs/[id]/print/page.tsx', '../api/src/programs/program-detail-data.ts']) {
      expect(read(f)).not.toContain('external_grant_engagement');
    }
  });

  it('renders the award line in the Deep-Dive and print views', () => {
    expect(read('app/programs/[id]/client.tsx')).toContain('grantAwardLine(');
    expect(read('app/programs/[id]/print/page.tsx')).toContain('grantAwardLine(');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && pnpm vitest run test/grant-award-ui.test.ts`
Expected: FAIL, because `../src/lib/grant-award-note` cannot be resolved.

- [ ] **Step 3: Create the note module and delete the old one**

Create `apps/web/src/lib/grant-award-note.ts`:

```ts
// Plain-language line for the external-grant award on the Financial dimension
// (health-score.v5.4). An award, never a penalty: a null award is a data gap
// and the reader is told which; +0 means no grant in the window.

export interface HealthAwardLike {
  label: string;
  points: number | null;
  baseScore: number | null;
  raw?: unknown;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function windowText(raw: Record<string, unknown>): string {
  const w = raw.windowFyBe;
  return Array.isArray(w) && w.length === 2 ? `FY ${w[0]}–${w[1]}` : 'the last 3 fiscal years';
}

function baht(v: number): string {
  return v >= 1_000_000 ? `฿${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} M` : `฿${Math.round(v / 1000)}k`;
}

export function grantAwardLine(award: HealthAwardLike | null | undefined): string | null {
  if (!award) return null;
  const raw = (award.raw && typeof award.raw === 'object' ? award.raw : {}) as Record<string, unknown>;
  if (award.points === null) {
    switch (raw.reason) {
      case 'source-not-synced':
        return 'External-grant award: grant data has not been synced on this server yet.';
      case 'no-active-staff':
        return 'External-grant award: no active teaching staff on record.';
      default:
        return null;
    }
  }
  if (award.points === 0) return `External-grant award: +0 (no external grant in ${windowText(raw)})`;
  const perStaff = num(raw.bahtPerStaffPerYear);
  const measure = perStaff === null ? windowText(raw) : `${baht(perStaff)} per teaching staff per year, ${windowText(raw)}`;
  const base = award.baseScore;
  const tail = base === null ? '' : ` · base ${base.toFixed(1)} → ${Math.min(100, base + award.points).toFixed(1)}`;
  return `External-grant award: +${award.points.toFixed(1)} (${measure})${tail}`;
}

/** The disclosed-undercount caveat, only for a computed award. */
export function grantAwardCaveat(award: HealthAwardLike | null | undefined): string | null {
  if (!award || award.points === null || !award.raw || typeof award.raw !== 'object') return null;
  const c = (award.raw as { caveat?: unknown }).caveat;
  return typeof c === 'string' && c.length > 0 ? c : null;
}
```

Check the `baht` helper against the test: 1,040,000 → `(1.04).toFixed(2)` = "1.04", and the regex strips nothing, so "฿1.04 M". 1,000,000 → "1.00" → "1", so "฿1 M". Then:

```bash
git rm apps/web/src/lib/grant-driver-note.ts apps/web/test/grant-engagement-driver-ui.test.ts
```

- [ ] **Step 4: Update the mark map**

In `apps/web/src/components/data-source-mark.tsx`, replace `external_grant_engagement: 'kku-research-services',` with:

```ts
  external_grant_award: 'kku-research-services',
```

- [ ] **Step 5: Update the web types**

In `apps/web/app/programs/[id]/types.ts`, replace `export interface HealthCell { … }` (lines 192–199) with:

```ts
export interface HealthAward {
  label: string;
  points: number | null;
  baseScore: number | null;
  raw?: unknown;
}

export interface HealthCell {
  score: number | null;
  dataCompletenessPct: number;
  /** Per-driver breakdown. `raw` carries the underlying numbers/payload
   *  used to compute the driver's score — surfaced in the deep-dive
   *  Health Score Breakdown panel so Council can audit the calculation. */
  drivers: Array<{ label: string; value: number | null; raw?: unknown }>;
  /** v5.4: Financial only — the external-grant award added after the
   *  drivers are averaged. Optional: older cached responses lack it. */
  award?: HealthAward | null;
}
```

- [ ] **Step 6: Update the Deep-Dive (`client.tsx`)**

1. Line 49: replace the `grant-driver-note` import with
   `import { grantAwardCaveat, grantAwardLine } from '@/lib/grant-award-note';`
2. Line 4880: delete `external_grant_engagement: 'External grant engagement (3 FY)',`.
3. In `interface HealthBreakdownRow`, change the `cell` type to:
   ```ts
   cell: {
     score: number | null;
     dataCompletenessPct: number;
     drivers: Array<{ label: string; value: number | null; raw?: unknown }>;
     award?: { label: string; points: number | null; baseScore: number | null; raw?: unknown } | null;
   };
   ```
4. In the driver `map` (lines 4977–4999), remove the `grantNote` constant and the two `external_grant_engagement` paragraphs, so each `<li>` renders exactly as the other drivers do. Make the arrow body a plain `return ( … )` again or leave the braces; either is fine.
5. Directly after the closing `</ul>` of that driver list (still inside the `isOpen &&` block), add:
   ```tsx
                {grantAwardLine(row.cell.award) && (
                  <div className="mt-2 rounded border border-subtle bg-surface-2/50 p-2">
                    <p className="flex items-center gap-1.5 font-medium text-text-primary">
                      <DriverSourceMark label="external_grant_award" size={14} />
                      {grantAwardLine(row.cell.award)}
                    </p>
                    {grantAwardCaveat(row.cell.award) && (
                      <p className="mt-0.5 text-[11px] text-text-tertiary">{grantAwardCaveat(row.cell.award)}</p>
                    )}
                  </div>
                )}
   ```
6. In the explanatory paragraph above the list (the one ending with the relevance 75:25 sentence), append for Financial:
   ```tsx
                  {row.key === 'financial' &&
                    ' An external-grant award of up to +10 is added after the average; it never lowers the score.'}
   ```

- [ ] **Step 7: Update the print view (`print/page.tsx`)**

1. Line 647: delete `external_grant_engagement: 'External grant engagement (3 FY)',`.
2. Add `import { grantAwardCaveat, grantAwardLine } from '@/lib/grant-award-note';` beside the other `@/lib` imports.
3. In `HealthDimRow`, after the `populated.length > 0 && ( <ul …> … </ul> )` block and before the closing `</div>`, add:
   ```tsx
      {grantAwardLine(cell.award) && (
        <p className="mt-2 flex items-center gap-1 text-[0.7rem] text-text-secondary">
          <DriverSourceMark label="external_grant_award" size={11} />
          <span>{grantAwardLine(cell.award)}</span>
        </p>
      )}
      {grantAwardCaveat(cell.award) && (
        <p className="mt-0.5 text-[0.65rem] text-text-tertiary">{grantAwardCaveat(cell.award)}</p>
      )}
   ```
   `cell` is typed off `DeepDiveOverview['health']`, which now includes `award?` through `HealthCell`, so this type-checks.

- [ ] **Step 8: Update the API label map**

In `apps/api/src/programs/program-detail-data.ts`, delete line 67 (`external_grant_engagement: 'External grant engagement (3 FY)',`).

- [ ] **Step 9: Run the web tests and the type checks**

Run: `cd apps/web && pnpm vitest run test/grant-award-ui.test.ts`. Expected: PASS.
Run: `cd apps/web && pnpm tsc --noEmit`. Expected: no errors.
Run: `cd apps/api && pnpm tsc --noEmit`. Expected: no errors.
Run: `grep -rn "grant-driver-note\|external_grant_engagement" apps --include=*.ts --include=*.tsx | grep -v node_modules`. Expected: no output, except methodology paper files, which Task 7 handles.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/grant-award-note.ts apps/web/test/grant-award-ui.test.ts apps/web/src/components/data-source-mark.tsx apps/web/app/programs/[id]/types.ts apps/web/app/programs/[id]/client.tsx apps/web/app/programs/[id]/print/page.tsx apps/api/src/programs/program-detail-data.ts
git commit -F <msgfile>   # feat(web): external-grant award line on the Financial dimension (Deep-Dive + print)
```

---

### Task 6: Cockpit provenance and topology

**Files:**
- Modify: `apps/api/src/cockpit/cockpit.controller.ts` (the four `@Provenance` blocks at lines ~154–227 that cite `health-score.v2.1`)
- Modify: `apps/web/app/admin/application-topology/topology-data.ts` (line ~1980 and lines 2190–2191)

- [ ] **Step 1: Cockpit provenance**

In `cockpit.controller.ts`, add `HEALTH_SCORE_VERSION` to the existing `@kku/db` import (line 11: `import { HEALTH_SCORE_VERSION, LANDSCAPE_METHODOLOGY_BUNDLE } from '@kku/db';`). First confirm it is exported from the `@kku/db` barrel:
`grep -n "health-score" packages/db/src/index.ts`. If it is not exported, import `HEALTH_SCORE_VERSION` from wherever `program-deep-dive.ts` gets it.

Above the class, add:

```ts
const HEALTH_SOURCE = { id: 'health-score', name: `Health score methodology ${HEALTH_SCORE_VERSION}` };
const HEALTH_CAVEATS = [
  'Financial includes an external-grant award of up to +10 points (grant baht per teaching staff per year, last 3 complete fiscal years); it never lowers a score.',
];
```

In each of the four health `@Provenance` blocks (`kpis`, `heatmap`, `matrix`, `rollup`):
- replace `{ id: 'health-score', name: 'Health score methodology v2.1' }` with `HEALTH_SOURCE`;
- replace `methodologyVersion: 'health-score.v2.1'` with `methodologyVersion: HEALTH_SCORE_VERSION`;
- add `caveats: HEALTH_CAVEATS,`.

- [ ] **Step 2: Topology**

In `topology-data.ts`:
- line ~1980: replace the trailing `Health-score methodology v1.` with `Health-score methodology v5.4 (Financial includes the external-grant award).`;
- lines 2190–2191: change both trailing comments from `// capability via health-score.v5.3` to `// Financial award via health-score.v5.4`.

- [ ] **Step 3: Type-check and run existing tests**

Run: `cd apps/api && pnpm tsc --noEmit && pnpm vitest run test/cockpit` (if a cockpit test folder or file exists; otherwise `pnpm vitest run`).
Run: `cd apps/web && pnpm vitest run test/application-topology` (or the topology test file `grep -rln topology apps/web/test` finds).
Expected: PASS and no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/cockpit/cockpit.controller.ts apps/web/app/admin/application-topology/topology-data.ts
git commit -F <msgfile>   # fix(cockpit): provenance cites the live health-score version and the grant award
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/methodologies/health-score.md`
- Modify: `apps/web/app/docs/methodology/content-en.tsx`, `apps/web/app/docs/methodology/content-th.tsx`
- Modify: `docs/evaluation-pipeline.md` (lines 109, 113)
- Modify: `docs/readiness-checklist.md` (lines 181–184)
- Modify: `docs/superpowers/specs/2026-10-02-grant-engagement-driver-design.md` (top)
- Modify: `CLAUDE.md` (status entry)

- [ ] **Step 1: `docs/methodologies/health-score.md`**
- Line 3: `**Version:** \`health-score.v5.4\``.
- Insert above the v5.3 paragraph (line 7) a new paragraph:
  **v5.4 (2026-10-03): external grants become an award on Financial.** Explain:
  - the `external_grant_engagement` driver and its gate are removed, so Capability is back to four drivers at 25 %;
  - Financial gains an award of up to +10, added after the drivers are averaged;
  - the formula: grant baht per active teaching staff member per year, last 3 complete Thai FY, `0` at ≤ ฿100k and `min(10, 10·ln(x/100k)/ln 30)` above it;
  - the rationale: revenue diversification away from tuition and public funding, an award not a penalty, and grants do not measure teaching quality;
  - the dev distribution: 253 programmes with a Financial score; award p25 +2.0, median +6.2, p75 +8.3, p90 +10.0; 26 at the cap; 23 at +0;
  - a project counts once per programme or scope;
  - the lower-bound caveat;
  - completeness is unchanged, and a null base earns nothing;
  - the only check is "the source has synced once".
- Mark the v5.3 paragraph and the "External grant engagement (`external_grant_engagement`, v5.3)" section (line ~487) with `> **Superseded by v5.4 (2026-10-03).**`, and remove the row at line ~485 from the live Capability driver table.
- Line ~429 (Capability row of the summary table): remove `external_grant_engagement` from the driver list. On the Financial row, add "+ external-grant award (≤ +10)".
- Line ~848: prefix that paragraph with the same superseded note.

- [ ] **Step 2: Methodology paper (EN, `content-en.tsx`)**
- Lines 41, 250 and 1895: `health-score.v5.3` → `health-score.v5.4`.
- Lines 394–395: delete the `external_grant_engagement` table row from the Capability driver table.
- In the Financial section, after the Financial driver table (find it with `grep -n "net_contribution_per_student" content-en.tsx`), add a short subsection in the same JSX style as its neighbours, titled "External-grant award". It states the formula, the anchors, the window, the count-once rule, that it never lowers a score or changes completeness, and the lower-bound caveat.
- Line 732: change the sentence about the 30-day green-history gating so it no longer claims the grant driver is gated. It should say the external-grant award has no history gate, by owner decision on 2026-10-03.
- Revision table (line ~2167): add a row above `1.9`:
  `<TR><TD mono>1.10</TD><TD>2026-10-03</TD><TD>Re-issued for <Code>health-score.v5.4</Code>: external grants move from a Capability driver to an award of up to +10 on Financial.</TD></TR>` (match the column count of the existing rows).
- Version-history table (line ~2193): add a `health-score.v5.4` row above the v5.3 row with a one-sentence summary.

- [ ] **Step 3: Methodology paper (TH, `content-th.tsx`)**

Make the same five edits at lines 41, 284, 1488, 1746 and 1772, plus a Financial subsection in Thai. Use these phrases:
- the award: "รางวัลทุนภายนอก";
- the measure: "งบประมาณทุนภายนอกต่ออาจารย์ผู้สอนต่อปี";
- the rule: "เพิ่มได้สูงสุด +10 คะแนนหลังเฉลี่ยตัวชี้วัด ไม่ทำให้คะแนนลดลง";
- the revision row date: "3 ต.ค. 2569".

- [ ] **Step 4: `docs/evaluation-pipeline.md`**
- Line 109: remove `· external_grant_engagement` from the Capability row. On the Financial row, append `+ external-grant award (≤ +10, after averaging)`.
- Line 113: replace with: `Version in force: \`health-score.v5.4\`. The external-grant award raises the Financial dimension, so the overall score, the BCG/KKU matrix, the lifecycle verdict and the risk score all see it through Financial; it can never lower any of them.`

- [ ] **Step 5: `docs/readiness-checklist.md`**

Replace lines 181–184 (the "Enforced in code for `kku-research-services`" paragraph) with:

```markdown
**Owner-approved exception — `kku-research-services` (2026-10-03).** The
source is the Research Office's own system of record and keeps a cumulative
history, so the length of our sync history says nothing about its reliability.
From `health-score.v5.4` the external-grant award on Financial needs only one
successful sync on the server; there is no 30-day green-history condition.
```

- [ ] **Step 6: Mark the v5.3 spec superseded**

Add as the second line of `docs/superpowers/specs/2026-10-02-grant-engagement-driver-design.md`:

```markdown
> **Superseded by** `docs/superpowers/specs/2026-10-03-external-grant-financial-award-design.md` (health-score.v5.4, 2026-10-03).
```

- [ ] **Step 7: CLAUDE.md**

Under *Research & academic service grants* in "Recent decisions", add a bullet:

> **Spec 3 (2026-10-03, `health-score.v5.4`, committed, NOT built or deployed):** external grants are now an **award on Financial**, no longer a Capability driver.
> - The award is up to +10 points after averaging: grant baht per active teaching staff member per year, last 3 complete Thai FY, log curve from ฿0.1 M (0) to ฿3 M (+10).
> - It never lowers a score and never changes completeness. A null base earns nothing.
> - The 30-day gate is removed by owner exception; the only check is "synced once".
> - Capability is back to four drivers, so prod Capability completeness returns to 100 %.
> - Dev distribution: median +6.2, 26 of 253 programmes at the cap.
> - Spec `docs/superpowers/specs/2026-10-03-external-grant-financial-award-design.md`, plan `docs/superpowers/plans/2026-10-03-external-grant-financial-award.md`.

In the v2.0.1 status line, change the sentence about the driver opening around 2026-11-01 so it notes that v5.4 supersedes it once deployed.

- [ ] **Step 8: Check the web methodology page still compiles, then commit**

Run: `cd apps/web && pnpm tsc --noEmit`. Expected: no errors.
Run: `grep -rn "external_grant_engagement" apps docs/methodologies docs/evaluation-pipeline.md docs/readiness-checklist.md | grep -v node_modules`. Expected: hits only inside lines explicitly marked superseded or in revision/version-history rows.

```bash
git add docs/methodologies/health-score.md apps/web/app/docs/methodology/content-en.tsx apps/web/app/docs/methodology/content-th.tsx docs/evaluation-pipeline.md docs/readiness-checklist.md docs/superpowers/specs/2026-10-02-grant-engagement-driver-design.md CLAUDE.md
git commit -F <msgfile>   # docs: health-score.v5.4 — external-grant award on Financial
```

---

### Task 8: Full check and live verification on dev

**Files:** none (verification only).

- [ ] **Step 1: Full checks**

Run: `pnpm check` (lint + typecheck + test) from the repo root.
Expected: green, apart from failures that already exist on `main`. Known: `usage-action-coverage.test.ts` has 4 unclassified audit actions. Compare any other failure against `git stash; pnpm test; git stash pop` before attributing it to this work.

- [ ] **Step 2: Restart the dev servers**

`packages/db` changes don't hot-reload. Ask the operator to restart `pnpm dev`, or restart it yourself by resolving PIDs with `ss -ltnp | grep -E ':3000|:4000'`. Never `pkill -f "pnpm dev"`.

- [ ] **Step 3: Re-measure the award distribution**

Write a scratchpad script `measure-award.ts` that calls `computeHealthScores('program', id)` for every canonical active programme. Use the `m.fn ? m : m.default` import workaround for `@kku/db` under `tsx`. It collects `dimensions.financial.award` and `dimensions.capability.dataCompletenessPct`. Run it from `packages/db` with `pnpm tsx <path>`.

Expected, matching spec §3:
- about 253 programmes with a non-null `award.points`;
- award median about +6.2 and p90 about +10;
- about 26 at 10 and about 23 at 0;
- no programme's Financial score lower than its `award.baseScore`;
- the Capability driver count is 4 everywhere.

Report the actual numbers in the final summary. If they differ from §3 by more than about 10 %, investigate before claiming success. The dev data may have changed since 2026-10-03.

- [ ] **Step 4: Visual check**

Open one programme's Deep-Dive at `http://localhost:3000/programs/<id>`, expand Financial, and confirm the award line and caveat render. Then open `/programs/<id>/print`. Use a programme with a mid-range award from Step 3.

- [ ] **Step 5: Report**

Summarise:
- the commits;
- the measured distribution;
- anything that failed or was skipped.

Do not push or build unless the operator asks.
