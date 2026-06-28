# Academic-Year Rollover Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "completed vs in-progress" admission/entry-year boundary driven by a single configurable academic-year-start date (DB setting + admin UI), so BE 2569 reads complete and BE 2570 in-progress now that the 2569 academic year has started.

**Architecture:** One generic `SystemSetting` key-value row holds the next academic-year start date. A new pure module `packages/db/src/academic-year.ts` derives the academic-year context from that date; a 60s-cached async reader serves request paths and a sync accessor (whose default June-16 boundary already yields the corrected answer) serves the deep, synchronous risk-scoring engine. All ~5 duplicated/divergent year-boundary sites delegate to this module. An admin API + page lets an operator set the date.

**Tech Stack:** Prisma (PostgreSQL), NestJS (api), Next.js App Router (web), Zod, Vitest. Monorepo: `@kku/db`, `@kku/shared`, `apps/api`, `apps/web`.

---

## File Structure

**Create:**
- `packages/db/prisma/migrations/20260628120000_system_settings/migration.sql` — new `system_settings` table.
- `packages/db/src/academic-year.ts` — source of truth: pure derivation + cached/sync readers.
- `packages/db/test/academic-year.test.ts` — unit tests for the pure + cache logic.
- `apps/api/src/admin/academic-year.controller.ts` — `GET`/`PUT /admin/academic-year`.
- `apps/api/src/admin/academic-year.service.ts` — read/write the setting + derive.
- `apps/web/app/admin/app/academic-year/page.tsx` — server page (role gate + initial fetch).
- `apps/web/app/admin/app/academic-year/client.tsx` — client UI (date input + stale banner).
- `apps/web/app/api/admin-academic-year/route.ts` — web proxy for the client PUT.

**Modify:**
- `packages/db/prisma/schema.prisma` — add `SystemSetting` model.
- `packages/db/src/index.ts` — export `./academic-year`.
- `packages/db/prisma/seed.ts` — seed the `academic_year.next_start_date` row.
- `packages/db/src/risk-scoring.ts` — `latestCompleteEntryYearBE`/`isInProgressBE` delegate to the new module; bump `RISK_SCORING_VERSION`.
- `packages/db/src/program-deep-dive.ts` — `currentAcademicYearBE` delegates; warm cache in `programStudentCohorts`.
- `packages/db/src/program-recruitment.ts` — local `isYearComplete` → module.
- `packages/db/src/program-funnel.ts` — local `isYearComplete` → module.
- `apps/api/src/education/admission-campaigns.service.ts` — dropdown `isComplete`/`latestCompleteYear` → module.
- `apps/api/src/risks/risks.service.ts` — warm cache before using `isInProgressBE`.
- `apps/ingestion/src/scripts/risks-assess.ts` — warm cache at start.
- `packages/shared/src/auth/permissions.ts` — add `settings:configure`.
- `apps/api/src/admin/admin.module.ts` — register controller + service.

---

## Task 1: `SystemSetting` model + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260628120000_system_settings/migration.sql`

- [ ] **Step 1: Add the model to the schema**

Append to `packages/db/prisma/schema.prisma` (after the last model):

```prisma
/// Generic key-value application settings (operator-tunable, DB-backed).
/// First use: academic_year.next_start_date. Keep keys dotted + namespaced.
model SystemSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
  updatedBy String?

  @@map("system_settings")
}
```

- [ ] **Step 2: Generate the migration SQL non-interactively**

This repo generates migration SQL with `prisma migrate diff` (no TTY), per CLAUDE.md. Run:

```bash
cd packages/db
mkdir -p prisma/migrations/20260628120000_system_settings
pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/20260628120000_system_settings/migration.sql
```

Open the generated file and **delete every statement except** the `system_settings` `CREATE TABLE` (the diff is from the live DB datasource to the datamodel, so it should only contain the new table; remove any Prisma banner lines). The file must contain exactly:

```sql
-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);
```

- [ ] **Step 3: Apply + regenerate client**

```bash
cd packages/db
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
Expected: "1 migration applied" (or "No pending" if already applied), client regenerated. `prisma.systemSetting` is now typed.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260628120000_system_settings
git commit -m "feat(db): add SystemSetting key-value table"
```

---

## Task 2: Pure academic-year derivation module + tests

**Files:**
- Create: `packages/db/src/academic-year.ts`
- Create: `packages/db/test/academic-year.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/academic-year.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  deriveAcademicYear,
  defaultNextStartDate,
  academicYearContextSync,
  invalidateAcademicYearCache,
  entryYearComplete,
  entryYearInProgress,
} from '../src/academic-year';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('deriveAcademicYear', () => {
  it('seeded 2026-06-16, now 2026-06-28 → AY 2569 complete, 2570 in progress, stale', () => {
    const ctx = deriveAcademicYear(d('2026-06-16'), d('2026-06-28'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.latestCompleteEntryYearBE).toBe(2569);
    expect(ctx.inProgressEntryYearBE).toBe(2570);
    expect(ctx.isStale).toBe(true);
  });

  it('next-start 2027-06-16, now 2026-06-28 → AY 2569, not stale', () => {
    const ctx = deriveAcademicYear(d('2027-06-16'), d('2026-06-28'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.latestCompleteEntryYearBE).toBe(2569);
    expect(ctx.isStale).toBe(false);
  });

  it('day before start is not yet rolled over', () => {
    const ctx = deriveAcademicYear(d('2026-06-16'), d('2026-06-15'));
    expect(ctx.currentAcademicYearBE).toBe(2568);
    expect(ctx.isStale).toBe(false);
  });

  it('exactly on start date counts as started', () => {
    const ctx = deriveAcademicYear(d('2026-06-16'), d('2026-06-16'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.isStale).toBe(true);
  });

  it('entryYearComplete / entryYearInProgress agree with latestComplete', () => {
    const ctx = deriveAcademicYear(d('2026-06-16'), d('2026-06-28'));
    expect(entryYearComplete(2569, ctx)).toBe(true);
    expect(entryYearComplete(2570, ctx)).toBe(false);
    expect(entryYearInProgress(2570, ctx)).toBe(true);
    expect(entryYearInProgress(2569, ctx)).toBe(false);
  });
});

describe('defaultNextStartDate', () => {
  it('after June 16 → next year June 16 (so derive is not stale)', () => {
    expect(defaultNextStartDate(d('2026-06-28')).toISOString()).toBe('2027-06-16T00:00:00.000Z');
  });
  it('before June 16 → this year June 16', () => {
    expect(defaultNextStartDate(d('2026-03-01')).toISOString()).toBe('2026-06-16T00:00:00.000Z');
  });
  it('default derive yields correct current AY and is never stale', () => {
    const ctx = deriveAcademicYear(defaultNextStartDate(d('2026-06-28')), d('2026-06-28'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.isStale).toBe(false);
  });
});

describe('academicYearContextSync (cold cache → default)', () => {
  it('with no warmed cache, uses the default June-16 boundary', () => {
    invalidateAcademicYearCache();
    const ctx = academicYearContextSync(d('2026-06-28'));
    expect(ctx.currentAcademicYearBE).toBe(2569);
    expect(ctx.latestCompleteEntryYearBE).toBe(2569);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kku/db exec vitest run test/academic-year.test.ts
```
Expected: FAIL — `Cannot find module '../src/academic-year'`.

- [ ] **Step 3: Write the module**

Create `packages/db/src/academic-year.ts`:

```ts
import { prisma } from './index';

export const ACADEMIC_YEAR_SETTING_KEY = 'academic_year.next_start_date';

const BE_OFFSET = 543;
const START_MONTH = 6; // June (1-based)
const START_DAY = 16;
const CACHE_TTL_MS = 60_000;

export interface AcademicYearContext {
  /** The configured (or default) date the next academic year begins. */
  nextStartDate: Date;
  /** BE academic year that has begun as of `now`. */
  currentAcademicYearBE: number;
  /** Latest entry year whose recruitment is finished (== currentAcademicYearBE). */
  latestCompleteEntryYearBE: number;
  /** Entry year still recruiting (== current + 1). */
  inProgressEntryYearBE: number;
  /** True when the configured nextStartDate has already passed — UI prompts a bump. */
  isStale: boolean;
}

function utcDate(yearCE: number, month1: number, day: number): Date {
  return new Date(Date.UTC(yearCE, month1 - 1, day));
}

/**
 * Default next-start date when no setting is stored: the NEXT June-16
 * boundary strictly relative to `now`, so the derived context is correct
 * AND never flagged stale (a computed default needs no operator bump).
 */
export function defaultNextStartDate(now: Date = new Date()): Date {
  const y = now.getUTCFullYear();
  const thisYearStart = utcDate(y, START_MONTH, START_DAY);
  return now.getTime() >= thisYearStart.getTime()
    ? utcDate(y + 1, START_MONTH, START_DAY)
    : thisYearStart;
}

export function deriveAcademicYear(
  nextStartDate: Date,
  now: Date = new Date(),
): AcademicYearContext {
  const nextAY = nextStartDate.getUTCFullYear() + BE_OFFSET;
  const started = now.getTime() >= nextStartDate.getTime();
  const currentAcademicYearBE = started ? nextAY : nextAY - 1;
  return {
    nextStartDate,
    currentAcademicYearBE,
    latestCompleteEntryYearBE: currentAcademicYearBE,
    inProgressEntryYearBE: currentAcademicYearBE + 1,
    isStale: started,
  };
}

export function entryYearComplete(yearBE: number, ctx: AcademicYearContext): boolean {
  return yearBE <= ctx.latestCompleteEntryYearBE;
}
export function entryYearInProgress(yearBE: number, ctx: AcademicYearContext): boolean {
  return yearBE > ctx.latestCompleteEntryYearBE;
}

// ── DB-backed cache ─────────────────────────────────────────────────────
let cache: { nextStartDate: Date; expiresAt: number } | null = null;

export function invalidateAcademicYearCache(): void {
  cache = null;
}

function parseStored(value: string): Date | null {
  const dt = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function loadNextStartDate(now: Date): Promise<Date> {
  if (cache && cache.expiresAt > now.getTime()) return cache.nextStartDate;
  let parsed: Date | null = null;
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: ACADEMIC_YEAR_SETTING_KEY },
    });
    if (row) parsed = parseStored(row.value);
  } catch {
    // DB unreachable / table missing pre-migration — fall back to default.
  }
  const nextStartDate = parsed ?? defaultNextStartDate(now);
  if (!parsed) {
    // eslint-disable-next-line no-console
    console.warn('[academic-year] no valid setting row — using default June-16 boundary');
  }
  cache = { nextStartDate, expiresAt: now.getTime() + CACHE_TTL_MS };
  return nextStartDate;
}

/** Async, cached (60s). Use from request handlers / scripts. Applies the
 *  operator-set date. Call once near the top of an async path to warm the
 *  cache for any downstream sync accessor use. */
export async function getAcademicYearContext(
  now: Date = new Date(),
): Promise<AcademicYearContext> {
  return deriveAcademicYear(await loadNextStartDate(now), now);
}

/** Synchronous. Uses the warmed cache if present, else the computed default
 *  (whose June-16 boundary already yields the corrected current year). For
 *  deep, synchronous code paths (risk-scoring engine) that cannot await. */
export function academicYearContextSync(now: Date = new Date()): AcademicYearContext {
  const nextStartDate = cache?.nextStartDate ?? defaultNextStartDate(now);
  return deriveAcademicYear(nextStartDate, now);
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/db/src/index.ts`, add after the other `export *` lines (e.g. after line 47):

```ts
export * from './academic-year';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @kku/db exec vitest run test/academic-year.test.ts
```
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/academic-year.ts packages/db/test/academic-year.test.ts packages/db/src/index.ts
git commit -m "feat(db): academic-year derivation module (pure + cached + sync)"
```

---

## Task 3: Seed the setting row

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Add the seed upsert inside `main()`**

In `packages/db/prisma/seed.ts`, near the start of `async function main()` (after the `costMethodology` upsert ~line 272), add:

```ts
  // Academic-year rollover boundary. Seed 2026-06-16 so BE 2569 reads
  // complete + BE 2570 in-progress immediately, with a stale-warning that
  // prompts the operator to set 2027-06-16 next. See
  // docs/superpowers/specs/2026-06-28-academic-year-rollover-config-design.md
  await prisma.systemSetting.upsert({
    where: { key: 'academic_year.next_start_date' },
    update: {},                       // never clobber an operator-set value on reseed
    create: { key: 'academic_year.next_start_date', value: '2026-06-16' },
  });
```

- [ ] **Step 2: Run the seed against the dev DB**

```bash
pnpm db:seed
```
Expected: completes without error.

- [ ] **Step 3: Verify the DB-backed read path (`getAcademicYearContext`)**

This exercises the cached reader against the real seeded row (the spec's cache-reader check):

```bash
pnpm --filter @kku/db exec tsx -e "import {prisma, getAcademicYearContext} from './src/index'; getAcademicYearContext(new Date('2026-06-28T00:00:00Z')).then(c=>{console.log(c); if(c.currentAcademicYearBE!==2569||c.nextStartDate.toISOString().slice(0,10)!=='2026-06-16'){throw new Error('unexpected: '+JSON.stringify(c));} return prisma.\$disconnect();})"
```
Expected: prints a context with `currentAcademicYearBE: 2569`, `nextStartDate` 2026-06-16, `isStale: true`; exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): seed academic_year.next_start_date = 2026-06-16"
```

---

## Task 4: Refactor risk-scoring onto the module + bump version

**Files:**
- Modify: `packages/db/src/risk-scoring.ts:29` (version), `:116-122` (the two functions)
- Modify: `apps/ingestion/src/scripts/risks-assess.ts` (warm cache)
- Modify: `apps/api/src/risks/risks.service.ts` (warm cache)

- [ ] **Step 1: Replace the two functions to delegate to the module**

In `packages/db/src/risk-scoring.ts`, add an import near the top (after existing imports):

```ts
import { academicYearContextSync } from './academic-year';
```

Replace the existing `latestCompleteEntryYearBE` + `isInProgressBE` (lines ~116-122) with:

```ts
// Latest BE entry year whose recruitment is COMPLETE. Delegates to the
// configurable academic-year boundary (academic-year.ts) — previously a
// hardcoded Jan-1 rollover (now.getFullYear()+543-1). Synchronous accessor:
// uses the warmed setting if an async entry point loaded it, else the
// June-16 default (which already yields the corrected current year).
export function latestCompleteEntryYearBE(now: Date = new Date()): number {
  return academicYearContextSync(now).latestCompleteEntryYearBE;
}

export function isInProgressBE(yearBE: number, now: Date = new Date()): boolean {
  return yearBE > latestCompleteEntryYearBE(now);
}
```

(The 4 internal call sites at lines ~321/657/1033/1405 and the external callers keep working unchanged — signatures are identical.)

- [ ] **Step 2: Bump the methodology version**

In `packages/db/src/risk-scoring.ts:29`, change:

```ts
export const RISK_SCORING_VERSION = 'risk-scoring.v1.12';
```
to:
```ts
export const RISK_SCORING_VERSION = 'risk-scoring.v1.13';
```

- [ ] **Step 3: Warm the cache at the risk entry points**

In `apps/ingestion/src/scripts/risks-assess.ts`, it already imports from `@kku/db`. Add `getAcademicYearContext` to that import, and call it once at the very start of the script's `main()` (before any scoring), e.g.:

```ts
  // Apply the operator-set academic-year boundary before scoring.
  await getAcademicYearContext();
```

In `apps/api/src/risks/risks.service.ts`, the method that calls `isInProgressBE` (around line 857) — add `getAcademicYearContext` to the `@kku/db` import and `await getAcademicYearContext();` near the top of that method (before the `.map` that calls `isInProgressBE`).

- [ ] **Step 4: Update the risk-scoring tests for the new boundary + version**

Find risk-scoring tests:
```bash
grep -rln "risk-scoring.v1.12\|latestCompleteEntryYearBE\|isInProgressBE" packages/db/test apps/ingestion/test apps/api/test
```
For each hit: update any literal `risk-scoring.v1.12` → `risk-scoring.v1.13`, and any test asserting `latestCompleteEntryYearBE()` equals `<currentCE>+543-1` (the old Jan-1 value) → the new academic-year value. With the default (un-warmed) boundary at June-16, `latestCompleteEntryYearBE(new Date('2026-06-28T00:00:00Z'))` is **2569** (was 2568). Pass an explicit `now` in tests rather than relying on the clock.

- [ ] **Step 5: Run the affected tests**

```bash
pnpm --filter @kku/db exec vitest run
pnpm --filter ingestion exec vitest run 2>/dev/null || true
pnpm --filter api exec vitest run 2>/dev/null || true
```
Expected: PASS. Fix any remaining `v1.12`/old-boundary assertions surfaced.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/risk-scoring.ts apps/ingestion/src/scripts/risks-assess.ts apps/api/src/risks/risks.service.ts packages/db/test apps/ingestion/test apps/api/test
git commit -m "feat(risk): academic-year boundary drives recruitment completeness (v1.13)"
```

---

## Task 5: Refactor the recruitment-campaigns dropdown

**Files:**
- Modify: `apps/api/src/education/admission-campaigns.service.ts:378-382`

- [ ] **Step 1: Replace the inline Jan-1 rule with the module**

Add `getAcademicYearContext, entryYearComplete` to the `@kku/db` import at the top of `apps/api/src/education/admission-campaigns.service.ts`. Replace lines ~378-382:

```ts
    const years = [...new Set(scoped.map((r) => r.acadYearBE))].sort((a, b) => b - a);
    const nowCe = new Date().getUTCFullYear();
    const isComplete = (y: number): boolean => y - 543 < nowCe;
    const latestCompleteYear = years.find((y) => isComplete(y)) ?? null;
    const selectedYear = filters.acadYearBE ?? latestCompleteYear ?? years[0] ?? null;
```
with:
```ts
    const years = [...new Set(scoped.map((r) => r.acadYearBE))].sort((a, b) => b - a);
    const ay = await getAcademicYearContext();
    const latestCompleteYear = years.find((y) => entryYearComplete(y, ay)) ?? null;
    const selectedYear = filters.acadYearBE ?? latestCompleteYear ?? years[0] ?? null;
```
(The enclosing method is already `async`. If a `meta.latestCompleteYear` is returned, it now reflects the academic-year boundary.)

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter api typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/education/admission-campaigns.service.ts
git commit -m "feat(education): entry-year dropdown uses academic-year boundary"
```

---

## Task 6: Refactor program-recruitment + program-funnel

**Files:**
- Modify: `packages/db/src/program-recruitment.ts:74-77, 129-130`
- Modify: `packages/db/src/program-funnel.ts:69-71`

- [ ] **Step 1: program-recruitment.ts — resolve context once, drop the local helper**

In `packages/db/src/program-recruitment.ts`: add `getAcademicYearContext, entryYearComplete` to the `./` (barrel) or direct imports — it already lives in `@kku/db`, so `import { getAcademicYearContext, entryYearComplete } from './academic-year';`. Delete the local function (lines ~74-77):

```ts
function isYearComplete(yearBE: number, now: Date = new Date()): boolean {
  return yearBE - 543 < now.getUTCFullYear();
}
```
At the top of `programRecruitment()` (after `const allRows = await programFunnelRoundRows(programId);`), add:

```ts
  const ay = await getAcademicYearContext();
```
Change the per-year `isComplete: isYearComplete(yearBE),` to `isComplete: entryYearComplete(yearBE, ay),` and the two `byYear.find((y) => y.isComplete)` / `!y.isComplete` selectors keep working (they read the computed `isComplete` field).

- [ ] **Step 2: program-funnel.ts — same swap**

In `packages/db/src/program-funnel.ts`: `import { getAcademicYearContext, entryYearComplete } from './academic-year';`. Delete the local `isYearComplete` (lines ~69-71). At the top of the exported async function that uses it, add `const ay = await getAcademicYearContext();` and replace `isYearComplete(yearBE)` calls with `entryYearComplete(yearBE, ay)`.

- [ ] **Step 3: Typecheck + run db tests**

```bash
pnpm --filter @kku/db typecheck
pnpm --filter @kku/db exec vitest run
```
Expected: no type errors; tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/program-recruitment.ts packages/db/src/program-funnel.ts
git commit -m "feat(db): recruitment + funnel completeness via academic-year module"
```

---

## Task 7: Unify `currentAcademicYearBE`

**Files:**
- Modify: `packages/db/src/program-deep-dive.ts:593-599, 616, 701`

- [ ] **Step 1: Delegate the function to the module**

In `packages/db/src/program-deep-dive.ts`: add `import { academicYearContextSync, getAcademicYearContext } from './academic-year';`. Replace the body of `currentAcademicYearBE` (lines ~593-599):

```ts
export function currentAcademicYearBE(now: Date = new Date()): number {
  const ceYear = now.getUTCFullYear();
  const monthZeroIndexed = now.getUTCMonth();
  const startsInJune = monthZeroIndexed >= 5;
  const beYear = ceYear + 543;
  return startsInJune ? beYear : beYear - 1;
}
```
with:
```ts
/** Active academic year (BE). Delegates to the configurable academic-year
 *  boundary so deep-dive, recruitment, and risk all roll over together. */
export function currentAcademicYearBE(now: Date = new Date()): number {
  return academicYearContextSync(now).currentAcademicYearBE;
}
```

- [ ] **Step 2: Warm the cache so the operator override applies**

In `programStudentCohorts()` (the async function using `currentAcademicYearBE` at lines ~616), add as its first statement:

```ts
  await getAcademicYearContext(now);
```
This warms the cache before the sync `currentAcademicYearBE(now)` calls at lines ~616/701 read it. (Same for any other async exported function in this file that calls `currentAcademicYearBE` — add the warm-up at its top.)

- [ ] **Step 3: Typecheck + db tests**

```bash
pnpm --filter @kku/db typecheck && pnpm --filter @kku/db exec vitest run
```
Expected: pass. With seed `2026-06-16` and today's clock the value stays 2569 (no visible regression), but it now honours an operator-set date.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/program-deep-dive.ts
git commit -m "refactor(db): currentAcademicYearBE delegates to academic-year module"
```

---

## Task 8: Add `settings:configure` permission

**Files:**
- Modify: `packages/shared/src/auth/permissions.ts`

- [ ] **Step 1: Add the permission to the catalog**

In `packages/shared/src/auth/permissions.ts`, inside the `PERMISSIONS` array, just before the `institution:read:university` block, add:

```ts
  // Operator-tunable application settings (e.g. the academic-year rollover
  // date). Admin-grade: SUPER_ADMIN + SYSTEM_ADMIN. Not super-only because
  // managing the academic calendar is routine ops, unlike model dispatch.
  'settings:configure',
```

`SUPER_ADMIN_PERMS` (`[...PERMISSIONS]`) and `SYSTEM_ADMIN_PERMS` (`PERMISSIONS.filter(p => p !== 'queues:manage' && p !== 'ai_models:configure')`) both include it automatically; UNIVERSITY/FACULTY/PROGRAM users do not (their expected sets in the grid test don't list it, so no test change is needed).

- [ ] **Step 2: Typecheck shared + run its tests**

```bash
pnpm --filter @kku/shared typecheck && pnpm --filter @kku/shared test
```
Expected: PASS (the `Permission` union now includes `settings:configure`; the role-grid test still passes because the three scoped roles correctly lack it).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/auth/permissions.ts
git commit -m "feat(auth): add settings:configure permission (admin-grade)"
```

---

## Task 9: Admin API — service + controller

**Files:**
- Create: `apps/api/src/admin/academic-year.service.ts`
- Create: `apps/api/src/admin/academic-year.controller.ts`
- Modify: `apps/api/src/admin/admin.module.ts`

- [ ] **Step 1: Write the service**

Create `apps/api/src/admin/academic-year.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  prisma,
  ACADEMIC_YEAR_SETTING_KEY,
  getAcademicYearContext,
  invalidateAcademicYearCache,
} from '@kku/db';

export interface AcademicYearView {
  nextStartDate: string; // YYYY-MM-DD
  currentAcademicYearBE: number;
  latestCompleteEntryYearBE: number;
  inProgressEntryYearBE: number;
  isStale: boolean;
  suggestedNextDate: string; // YYYY-MM-DD — June 16 of (current CE year + 1)
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class AcademicYearService {
  async get(): Promise<AcademicYearView> {
    const ctx = await getAcademicYearContext();
    // suggested next = June 16 of the CE year AFTER the current academic year
    const suggestedCE = ctx.currentAcademicYearBE - 543 + 1;
    return {
      nextStartDate: toYmd(ctx.nextStartDate),
      currentAcademicYearBE: ctx.currentAcademicYearBE,
      latestCompleteEntryYearBE: ctx.latestCompleteEntryYearBE,
      inProgressEntryYearBE: ctx.inProgressEntryYearBE,
      isStale: ctx.isStale,
      suggestedNextDate: `${suggestedCE}-06-16`,
    };
  }

  async set(nextStartDate: string, userId: string): Promise<AcademicYearView> {
    await prisma.systemSetting.upsert({
      where: { key: ACADEMIC_YEAR_SETTING_KEY },
      update: { value: nextStartDate, updatedBy: userId },
      create: { key: ACADEMIC_YEAR_SETTING_KEY, value: nextStartDate, updatedBy: userId },
    });
    invalidateAcademicYearCache();
    return this.get();
  }
}
```

- [ ] **Step 2: Write the controller**

Create `apps/api/src/admin/academic-year.controller.ts`:

```ts
import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuditLog, AuthSession, Authorized, Provenance, ZodValidationPipe } from '../common';
import type { SessionUser } from '@kku/shared';
import { AcademicYearService } from './academic-year.service';

const SetSchema = z.object({
  // strict YYYY-MM-DD; must be a real calendar date
  nextStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), 'invalid date'),
});
type SetBody = z.infer<typeof SetSchema>;

@Controller('/admin/academic-year')
export class AcademicYearController {
  constructor(private readonly service: AcademicYearService) {}

  @Get()
  @Authorized('settings:configure')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get() {
    return this.service.get();
  }

  @Put()
  @Authorized('settings:configure')
  @AuditLog({ action: 'academic_year.set', entityType: 'SystemSetting' })
  async set(
    @Body(new ZodValidationPipe(SetSchema)) body: SetBody,
    @AuthSession() user: SessionUser,
  ) {
    return this.service.set(body.nextStartDate, user.userId);
  }
}
```

> Note: confirm the exact decorator import names against `apps/api/src/admin/ai-settings.controller.ts` (it imports `AuditLog, AuthSession, Authorized, Provenance, ZodValidationPipe` from `../common`). Match whatever that file uses for the session decorator.

- [ ] **Step 3: Register in the admin module**

In `apps/api/src/admin/admin.module.ts`: import `AcademicYearController` + `AcademicYearService`, add the controller to the `controllers:` array and the service to `providers:`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter api typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin/academic-year.service.ts apps/api/src/admin/academic-year.controller.ts apps/api/src/admin/admin.module.ts
git commit -m "feat(api): GET/PUT /admin/academic-year (settings:configure)"
```

---

## Task 10: Admin web page + proxy

**Files:**
- Create: `apps/web/app/api/admin-academic-year/route.ts`
- Create: `apps/web/app/admin/app/academic-year/page.tsx`
- Create: `apps/web/app/admin/app/academic-year/client.tsx`

- [ ] **Step 1: Web proxy for the client PUT**

Create `apps/web/app/api/admin-academic-year/route.ts` (mirrors `apps/web/app/api/admin-trend-documents/route.ts`):

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

function authHeaders(token: string | undefined): Headers {
  const h = new Headers();
  h.set('content-type', 'application/json');
  if (token) h.set('authorization', `Bearer ${token}`);
  return h;
}

function cookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

export async function PUT(req: Request) {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;
  const token = (await cookies()).get(cookieName())?.value;
  const body = await req.text();
  const upstream = await fetch(`${API_BASE}/api/v1/admin/academic-year`, {
    method: 'PUT',
    headers: authHeaders(token),
    body,
    cache: 'no-store',
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
```

> Confirm `requireSession`'s `minRole: 'admin'` value against `apps/web/app/api/admin-trend-documents/route.ts` and use the same.

- [ ] **Step 2: Server page (gate + initial fetch)**

Create `apps/web/app/admin/app/academic-year/page.tsx` (mirrors the ai-settings page; uses `isAdminGrade`):

```tsx
import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AcademicYearClient, type AcademicYearResponse } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Academic year — Admin' };

export default async function AdminAcademicYearPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');

  let data: AcademicYearResponse | null = null;
  let loadError: string | null = null;
  try {
    data = await apiFetch<AcademicYearResponse>('/admin/academic-year');
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <AuthedAppShell user={user}>
      <AcademicYearClient initial={data} loadError={loadError} />
    </AuthedAppShell>
  );
}
```

> Confirm `isAdminGrade` is exported from `@kku/shared` (it is used in `apps/web/app/admin/trend-documents/page.tsx`). Confirm `apiFetch` import path against the ai-settings page.

- [ ] **Step 3: Client UI (date input + stale banner)**

Create `apps/web/app/admin/app/academic-year/client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button, Badge } from '@kku/ui';
import { CalendarClock, AlertTriangle } from 'lucide-react';

export interface AcademicYearResponse {
  nextStartDate: string;
  currentAcademicYearBE: number;
  latestCompleteEntryYearBE: number;
  inProgressEntryYearBE: number;
  isStale: boolean;
  suggestedNextDate: string;
}

export function AcademicYearClient({
  initial,
  loadError,
}: {
  initial: AcademicYearResponse | null;
  loadError: string | null;
}) {
  const [data, setData] = useState<AcademicYearResponse | null>(initial);
  const [date, setDate] = useState(initial?.nextStartDate ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(loadError);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin-academic-year', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nextStartDate: date }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const next = (await res.json()).data as AcademicYearResponse;
      setData(next);
      setDate(next.nextStartDate);
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <header className="flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-semibold">Academic year</h1>
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {data && (
        <>
          {data.isStale && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
              <span>
                Academic year BE {data.currentAcademicYearBE} has started — set the next
                start date to <strong>{data.suggestedNextDate}</strong>.
              </span>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-muted-foreground">Current academic year</dt>
            <dd><Badge>BE {data.currentAcademicYearBE}</Badge></dd>
            <dt className="text-muted-foreground">Latest complete entry year</dt>
            <dd>BE {data.latestCompleteEntryYearBE}</dd>
            <dt className="text-muted-foreground">In-progress (recruiting) year</dt>
            <dd>BE {data.inProgressEntryYearBE}</dd>
          </dl>

          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Next academic-year start date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-border bg-surface-1 px-2 py-1"
              />
            </label>
            <Button onClick={save} disabled={saving || date === data.nextStartDate}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {savedAt && <p className="text-xs text-muted-foreground">Saved.</p>}
        </>
      )}
    </div>
  );
}
```

> Token/util check: confirm `Badge`, `Button` are exported from `@kku/ui`, and that token class names (`text-accent`, `border-danger`, `bg-warning/10`, `text-muted-foreground`, `bg-surface-1`, `border-border`) exist in the design tokens. Grep `packages/design/src/css/tokens.css` and an existing client (e.g. `apps/web/app/admin/app/ai-settings/client.tsx`) and swap any name that doesn't resolve. **No raw hex** (ESLint enforces).

- [ ] **Step 4: Lint + typecheck the new web files**

```bash
pnpm exec eslint apps/web/app/admin/app/academic-year/page.tsx apps/web/app/admin/app/academic-year/client.tsx apps/web/app/api/admin-academic-year/route.ts
pnpm --filter web typecheck
```
Expected: clean. Fix any token/import mismatches flagged.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/app/academic-year apps/web/app/api/admin-academic-year
git commit -m "feat(web): admin academic-year settings page"
```

---

## Task 11: Full verification + PR

- [ ] **Step 1: Run the whole gate**

```bash
pnpm --filter @kku/db exec prisma generate
pnpm typecheck
pnpm exec eslint $(git diff --name-only main...HEAD | grep -E '^(apps|packages)/.*\.(ts|tsx)$' | tr '\n' ' ')
pnpm test
```
Expected: typecheck clean; eslint clean on changed files; tests pass. Fix anything surfaced.

- [ ] **Step 2: Manual smoke (dev server running)**

- `/education/recruitment-campaigns`: the **Entry year (BE)** dropdown's default/“latest complete” is **2569** (not 2568); 2570 appears as in-progress.
- `/programs/[id]` with TCAS data: **Recruitment funnel** shows 2569 as a completed year and 2570 as the in-progress one.
- `/admin/app/academic-year`: shows current BE 2569 / in-progress 2570, the stale banner suggesting `2027-06-16`; setting it to `2027-06-16` clears the banner and persists after reload.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/academic-year-rollover-config
gh pr create --base main --title "feat: configurable academic-year rollover" \
  --body "Implements docs/superpowers/specs/2026-06-28-academic-year-rollover-config-design.md. Configurable academic-year-start date (SystemSetting + /admin/app/academic-year) drives complete-vs-in-progress entry years; unifies the duplicated Jan-1 rules + divergent June boundary; bumps RISK_SCORING_VERSION to v1.13. Seeded 2026-06-16 so BE 2569 reads complete now."
```

- [ ] **Step 4: Confirm CI green** (PR checks now lint changed files only + run the full DB pipeline). Address any failures.

---

## Notes for the implementer

- **Sync-vs-async pattern:** the risk engine is deep + synchronous. It calls `academicYearContextSync()`, which is correct even un-warmed (default June-16 boundary already yields BE 2569 complete). Async entry points (`risks-assess.ts`, `risks.service.ts`, `programStudentCohorts`) call `await getAcademicYearContext()` first so an operator-set date overrides the default. Never make the pure scorers async.
- **No barrel name clash:** the module exports `entryYearComplete`/`entryYearInProgress`; risk-scoring keeps its own `isInProgressBE`/`latestCompleteEntryYearBE`. Don't export a second `isInProgressBE` from the module.
- **Out of scope (do not touch):** TCAS connector hardcoded file list; `latestCompleteFiscalYearCE()` (CE fiscal, unrelated).
- **Dates are UTC date-only.** Store/compare `YYYY-MM-DD` at `T00:00:00Z`. KKU is UTC+7; a few days' slack around the boundary is acceptable for an in-progress flag (documented in the spec).
