# Configurable academic-year rollover — design spec

> Date: 2026-06-28 · Status: approved, ready for implementation plan
> Repo: `program-landscape` (KKU Program Landscape)

## Problem

The app distinguishes a **completed** admission/entry year from the **in-progress**
(still-recruiting) one. As of today (2026-06-28) Buddhist-Era academic year **BE 2569 has
started**, so BE 2569's recruitment is finished — it should read as *complete*, and **BE 2570**
should be the in-progress recruiting cohort. Several surfaces still show BE 2569 as in-progress.

Investigation showed **nothing is hardcoded to 2569**. The real issues are:

1. **Wrong rollover boundary.** The "complete vs in-progress" rule exists in ~4 duplicated
   copies, all using a **Jan-1** boundary: `yearBE - 543 < new Date().getUTCFullYear()`. So BE
   2569 (`2026 < 2026` = false → in-progress) won't flip to complete until **Jan 1 2027**, even
   though its academic year already began (~mid-June 2026).
2. **Internal inconsistency.** `packages/db/src/program-deep-dive.ts :: currentAcademicYearBE()`
   already uses a **June** boundary (returns 2569 today), while the recruitment/risk rules use
   Jan-1 (treat 2569 as in-progress). The app disagrees with itself about when a year rolls over.
3. **No configuration.** The boundary is implicit in code; there is no way for an operator to set
   when the academic year turns over.

## Decided semantics

A single configurable **next academic-year start date** drives everything.

- Stored value: `nextAcademicYearStartDate` (an ISO date, e.g. `2026-06-16`).
- `nextAY = yearOf(nextStartDate) + 543` (the academic year that date begins; June start → BE = CE + 543).
- `currentAcademicYearBE = (now >= nextStartDate) ? nextAY : nextAY - 1`
- `latestCompleteEntryYearBE = currentAcademicYearBE` — the academic year that has started counts as a **completed** entry year.
- `inProgressEntryYearBE = currentAcademicYearBE + 1`
- `isStale = (now >= nextStartDate)` — the configured date has passed and should be bumped to next year.

Worked example (now = 2026-06-28):
| nextStartDate | nextAY | currentAY | latestComplete | inProgress | stale? |
|---|---|---|---|---|---|
| 2026-06-16 (seeded) | 2569 | 2569 | **2569** | **2570** | yes → warn |
| 2027-06-16 | 2570 | 2569 | 2569 | 2570 | no |

Both seedings give the correct answer today; the model is robust to which one is set. We seed
**`2026-06-16`** so the corrected rollover is live on prod immediately, with a visible
"please set next year's date" warning.

Rollover is **date-driven, not data-driven** (confirmed): once the academic year starts, its
entry year is complete regardless of whether final enrolment counts are ingested yet.

## Approach (selected: A — unify to one config-driven source of truth)

One setting + one shared derivation module + refactor all duplicated rule sites onto it. This
also resolves the June-vs-Jan inconsistency. (Rejected: B — change boundaries in place but keep
the duplicate copies → re-diverges; C — wire only the two named surfaces → leaves cockpit / risk
dashboard / health-score on the old boundary → app stays inconsistent.)

## Components

### 1. Data model — `SystemSetting` (new, generic key-value)

First settings table in the app. Generic so future settings reuse it without a migration each.

```prisma
model SystemSetting {
  key       String   @id          // "academic_year.next_start_date"
  value     String                // ISO date string "2026-06-16"
  updatedAt DateTime @updatedAt
  updatedBy String?               // userId of last editor (nullable)
  @@map("system_settings")
}
```

- Additive Prisma migration (new table only).
- Seed one row: `key = "academic_year.next_start_date"`, `value = "2026-06-16"`.

### 2. Source of truth — `packages/db/src/academic-year.ts` (new)

**Pure, synchronous, fully unit-testable** (no DB, `now` injected):

```ts
export interface AcademicYearContext {
  nextStartDate: Date;
  currentAcademicYearBE: number;
  latestCompleteEntryYearBE: number;
  inProgressEntryYearBE: number;
  isStale: boolean;
}
export function deriveAcademicYear(nextStartDate: Date, now: Date): AcademicYearContext;
export function isInProgressBE(yearBE: number, ctx: AcademicYearContext): boolean;  // yearBE > latestComplete
export function isYearComplete(yearBE: number, ctx: AcademicYearContext): boolean;  // yearBE <= latestComplete
```

**Cached async reader** (in the same module, depends on `prisma`):

```ts
export async function getAcademicYearContext(now?: Date): Promise<AcademicYearContext>;
```

- Reads `SystemSetting["academic_year.next_start_date"]` via prisma.
- ~60s in-process TTL cache (a module-level `{ value, expiresAt }`) — these helpers run
  per-request and inside funnel loops; must not hit the DB each call. Cache is keyed only on the
  setting (not on `now`); derivation re-runs against `now` each call.
- **Fallback when the row is missing/unparseable:** default `nextStartDate = June 16 of `now`'s CE
  year`. Feeding that through `deriveAcademicYear` reproduces the existing June-boundary
  `currentAcademicYearBE` for every month (within the documented few-days slack around June 1–16),
  so nothing breaks before the row is seeded. Log a one-line warning when falling back.
- Date comparison uses UTC-date semantics; KKU is UTC+7 and academic-year starts are coarse
  (a few days' slack is acceptable for an in-progress flag), so a plain `now >= nextStartDate`
  UTC compare is sufficient. The plan will set the compare explicitly (date-only, no time-of-day
  surprises).

### 3. Refactor rule sites onto the source of truth

All are already in async paths, so each `await getAcademicYearContext()` and calls the pure helpers:

- `apps/api/src/education/admission-campaigns.service.ts` — `isComplete` / `latestCompleteYear`
  for the **Entry year (BE) dropdown** on `/education/recruitment-campaigns`.
- `packages/db/src/program-recruitment.ts` — local `isYearComplete` → delegate.
- `packages/db/src/program-funnel.ts` — local `isYearComplete` → delegate. Drives the
  **Recruitment funnel (TCAS rounds 1–4)** on `/programs/[id]`. **Also** `scopeFunnelLatestYear()`
  in this file carried a *separate* inline Jan-1 boundary (`y - 543 < nowCe`) — discovered during
  implementation — that feeds **health-score** (`health-score.ts:826`) and the **AI analyst**
  (`tool-executor.service.ts:815`); unified onto the module too (a fourth site the initial
  exploration missed).
- `packages/db/src/risk-scoring.ts` — `latestCompleteEntryYearBE()` / `isInProgressBE()` delegate
  to the new module. **Bump `RISK_SCORING_VERSION` `risk-scoring.v1.12` → `v1.13`** (scored output
  shifts because the boundary moves). Feeds risks dashboard, cockpit recruitment panel, KRIs.
- `packages/db/src/program-deep-dive.ts` — `currentAcademicYearBE()` delegates to the new module,
  unifying the previously-divergent June boundary.

`latestCompleteFiscalYearCE()` (financial, CE fiscal-year, unrelated to admissions) is **unchanged**.

Downstream consumers that read these helpers — cockpit recruitment panel
(`apps/web/app/cockpit/client.tsx`), risks sparkline (`apps/api/src/risks/risks.service.ts`),
health-score funnel (`packages/db/src/health-score.ts`), deep-dive funnel UI
(`apps/web/app/programs/[id]/client.tsx`) — inherit the corrected rollover with no change.

Out of scope: TCAS connector hardcoded file list
(`apps/ingestion/src/connectors/sources/tcas/connector.ts`) — that is curated when each year's
TCAS data publishes upstream, a separate data-ops task, not part of the rollover-boundary logic.

### 4. API + admin UI (mirrors the existing `ai-settings` pattern)

- `apps/api/src/admin/academic-year.controller.ts` + `academic-year.service.ts`:
  - `GET /admin/academic-year` → `{ nextStartDate, currentAcademicYearBE, latestCompleteEntryYearBE, inProgressEntryYearBE, isStale, suggestedNextDate }` (`suggestedNextDate` = June 16 of `currentAY - 543 + 1` when stale).
  - `PUT /admin/academic-year` — body `{ nextStartDate: "YYYY-MM-DD" }`, `ZodValidationPipe`,
    `@AuditLog({ action: 'academic_year.set', entityType: 'SystemSetting' })`, writes the row
    (sets `updatedBy` from session), **invalidates the TTL cache**.
  - Gated by a new permission **`settings:configure`** granted to SUPER_ADMIN + SYSTEM_ADMIN
    (admin-grade). (`ai_models:configure` is SUPER_ADMIN-only and AI-specific; a dedicated
    settings permission is clearer and lets a system admin manage the calendar.)
- `apps/web/app/admin/app/academic-year/page.tsx` + client component:
  - Shows the derived current / latest-complete / in-progress years.
  - A date input to set the next start date (optimistic save + toast, per app UX norms).
  - A **stale-warning banner** when `isStale`: "Academic year BE {currentAY} has started — set the
    next start date to {suggestedNextDate}." Design tokens only.

### 5. Testing

- **Unit (pure, no DB)** for `deriveAcademicYear` — locks the 2568→2569 flip and the rules:
  - now just before vs just after `nextStartDate` (boundary).
  - stale date in the past (now ≫ nextStartDate) → still derives correct currentAY + `isStale`.
  - `nextStartDate` in a future year → currentAY = nextAY − 1, not stale.
  - BE/CE arithmetic (CE+543), leap-year date, end-of-year `now`.
  - `isInProgressBE` / `isYearComplete` agree with `latestCompleteEntryYearBE`.
- **Cache reader:** returns the default June-16 fallback when the row is absent; returns the
  parsed row when present; re-reads after invalidation.
- **Existing risk-scoring tests:** update expectations for the new boundary + the version bump to
  `risk-scoring.v1.13`.

## Deployment / data notes

- Additive migration + one seed row → applies cleanly on next deploy; no destructive change.
- Seeding `2026-06-16` makes the corrected rollover **immediately visible on prod** (BE 2569
  complete, BE 2570 in-progress) with the stale-warning prompting the operator to confirm next
  year's date.
- `RISK_SCORING_VERSION` bump means re-running the risk assessment will recompute affected scores;
  old `AiInference` / scored rows remain distinguishable by version (existing convention).

## YAGNI / explicit non-goals

- No env var for the date (DB-only, per decision) — code default fallback covers the unseeded case.
- Generic `SystemSetting` table but only the one key is seeded/used now.
- No timezone-picker UI; UTC-date compare with documented few-days slack.
- TCAS connector year list and `latestCompleteFiscalYearCE` are untouched.
