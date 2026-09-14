# Acknowledgements page, access log and usage dashboard — design

**Date:** 2026-09-14 · **Status:** approved by the operator in brainstorming, pending spec review
**Scope:** two projects in one spec because they were designed together; they are
implemented as separate plans.

- **(A)** An in-app Acknowledgements page under the REFERENCE nav group, built so
  future contributors are added by appending to a registry.
- **(B)** Page-view and sign-in recording, a usage/access dashboard with per-user
  drill-down, and three usage tiles on the `/admin` hero.

Decisions the operator made during brainstorming, recorded so they are not re-opened:

| Decision | Choice |
|---|---|
| What counts as "access" | Page views + sign-ins (not API calls) |
| Raw retention | **120 days**, then daily roll-ups |
| Who sees what | Admin-grade: everything. University users: aggregates only, no names |
| Drill-downs | By user, by programme/faculty, by module — all three |
| `/admin` hero | Three stat tiles + 30-day DAU sparkline |
| Adding acknowledgements | A TypeScript registry, one commit per entry |
| Capture mechanism | Client beacon on route change |
| Review gaps | All 16 recommendations adopted (see §7) |

---

## Part A — Acknowledgements page

### A.1 Route and navigation

- Route **`/docs/acknowledgements`**, visible to every signed-in user.
- Nav: `apps/web/src/lib/app-nav.tsx`, `referenceSection`, new item between
  Methodology and What's new: label **Acknowledgements**, icon `Handshake`
  (lucide), `moduleKey: 'neutral'`.
- Language: `?lang=th` via the same server-page + client-wrapper pattern as
  `/docs/methodology` (`page.tsx` reads `searchParams.lang`, default `en`).

### A.2 Registry

`apps/web/app/docs/acknowledgements/registry.tsx`:

```ts
export type AcknowledgementKind = 'data-provider' | 'partner' | 'funder';

export interface Acknowledgement {
  slug: string;                              // stable anchor id, e.g. 'jobthai'
  kind: AcknowledgementKind;
  name: string;                              // display name, e.g. 'JobThai'
  logo?: DataSourceMarkSlug;                 // reuses DATA_SOURCE_MARKS when present
  since: string;                             // ISO date the contribution began
  contributes: { en: string; th: string };   // one line for the list
  body: { en: ReactNode; th: ReactNode };    // acknowledgement + what it enables
  detailUrl?: string;                        // long-form markdown on GitHub
}

export const ACKNOWLEDGEMENTS: readonly Acknowledgement[];
```

Ordering: most recent `since` first. No pagination, search or editor.

**First entry — JobThai:** `kind: 'data-provider'`, `logo: 'jobthai'`,
`since: '2026-09-13'`, body = the §1 acknowledgement from
`docs/acknowledgements/jobthai.md` in both languages, a short "what it enables"
paragraph (domestic demand in the relevance score, the Deep-Dive JobThai view),
and the note that JobThai intends to make data available to other universities
under a future MOU with the Council of University Presidents of Thailand (CUPT,
ที่ประชุมอธิการบดีแห่งประเทศไทย — ทปอ.), not yet concluded. `detailUrl` points at
the GitHub markdown.

### A.3 Page

Server component, `AuthedAppShell`, `PageHeader` "Acknowledgements". Intro
paragraph (EN/TH): Program Landscape is built on data and support contributed by
partner organisations; this page records them. Then one `Card` per entry with
`id={slug}`: logo (24 px `DataSourceMark`) + name + kind chip + "since {date}",
the one-line contribution, the body in the selected language, and a "Full
document ↗" link when `detailUrl` is set. Both languages of the body are in the
TSX; only the selected one renders.

### A.4 Discoverability

`DataSourceMark` gains an optional `href` prop; the JobThai mark links to
`/docs/acknowledgements#jobthai` wherever it renders as a standalone icon (tile,
page titles, Skills coverage cards). Inside a button/link it stays non-linked to
avoid nested anchors — the component renders `<a>` only when `href` is given
*and* an `inline` prop is not set.

### A.5 Adding a future acknowledgement

1. Append to `ACKNOWLEDGEMENTS`.
2. If it has a logo, add it to `DATA_SOURCE_MARKS` and drop the image in
   `apps/web/public/brand/` (never hotlinked — CSP `img-src 'self'`).
3. Optionally add `docs/acknowledgements/<slug>.md` and set `detailUrl`.

### A.6 Tests

`apps/web/test/acknowledgements-registry.test.ts`: every entry has non-empty
`en` and `th` for `contributes` and `body`; slugs are unique and URL-safe;
`detailUrl`, when set, matches `^https://github.com/khon-kaen-university/program-landscape/blob/main/docs/acknowledgements/`;
`logo`, when set, exists in `DATA_SOURCE_MARKS`; entries are sorted by `since`
descending.

---

## Part B — Access log and usage dashboard

### B.1 Data model (two additive migrations, hand-written)

**`page_views`** — model `PageView`. One row per recorded view.

| column | type | notes |
|---|---|---|
| `id` | cuid | |
| `user_id` | text, nullable, FK users `SetNull` | |
| `role` | text | effective role at the time; under impersonation, the **impersonated** role |
| `impersonated` | boolean default false | |
| `viewer_faculty_id` | text, nullable | snapshot of `users.facultyId` at the time |
| `path` | text | normalised route pattern, e.g. `/programs/[id]` |
| `module` | text | see B.3 |
| `program_id` | text, nullable | from `/programs/[id]` |
| `faculty_id`, `department_id` | text, nullable | from `?scope=&scopeId=` |
| `created_at` | timestamptz, default now | |

Indexes: `(created_at)`, `(user_id, created_at)`, `(program_id, created_at)`,
`(module, created_at)`. No IP column, no raw URL, no query string.

**`page_view_daily`** — model `PageViewDaily`. Roll-up beyond 120 days.

| column | notes |
|---|---|
| `day` | date, **in Asia/Bangkok** |
| `user_id` | nullable, FK `SetNull` |
| `role`, `viewer_faculty_id`, `module`, `path`, `program_id`, `faculty_id` | as above |
| `views` | int |
| `sessions` | int — sessions that touched this key that day |
| `signins` | int — from `audit_logs` `auth.signin.ok`, written to one dedicated row per `(day, user_id)` with `module = 'signin'`, `path = '/signin'`, `views = 0`; 0 on every other row |

Unique on `(day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id)`
(nulls treated as equal via a generated key column, so upserts are idempotent).
A structural test asserts the model has no timestamp or IP column.

`page_views` and `page_view_daily` are never read by any Council-facing metric,
so `realDataWhere()` does not apply and there is no `ingestion_run_id`. This is a
deliberate decision, recorded here per the new-row-writer rule.

### B.2 Capture — client

`apps/web/src/components/usage-recorder.tsx`, a client component with no UI,
mounted once in `AuthedAppShell` (so it never runs before sign-in or on
`/signin`, `/no-access`, 404 pages).

- Watches `usePathname()` **and** `useSearchParams()` for `scope`, `scopeId`
  and the programme id segment. Fires when any of those change.
- Payload `{ path, scope?, scopeId?, programId? }` — the raw pathname; the
  server normalises. The client sends **no** user information.
- Sends with `navigator.sendBeacon('/api/v1/usage/page-views', new Blob([json], { type: 'application/json' }))`;
  falls back to `fetch(..., { method: 'POST', keepalive: true })`.
- Dedupe: remembers the last `(path, scope, scopeId, programId)` and the time;
  skips an identical event within 5 s. Absorbs React StrictMode's double effect
  in dev and shell re-mounts.
- Never throws; failures are ignored.

Security: same-origin request; the session cookie is `SameSite=Lax`, so a
cross-site page cannot forge views. The `kku-impersonate` cookie is honoured by
the API guard exactly as for every other call, which is what makes
`impersonated` and the impersonated role correct.

### B.3 Capture — API

New NestJS module `apps/api/src/usage/` (`usage.module.ts`, `usage.controller.ts`,
`usage.service.ts`).

`POST /api/v1/usage/page-views` → `204`.

- Authenticated (JWT guard); user id, role, impersonation flag and faculty
  taken from the session — never from the body.
- Body validated with Zod: `path` string ≤ 512, optional `scope` enum, `scopeId`
  and `programId` as cuids.
- Throttled `60/min/user` via the existing named buckets.
- **Not** `@AuditLog` — a view is not a mutation.
- Server-side normalisation (`packages/shared/src/usage/normalise-path.ts`, pure,
  unit-tested):
  - split on `/`; replace any segment matching `^c[a-z0-9]{24}$` or
    `^KKU-SEQ-\d+$` or a UUID with `[id]`; drop query strings; collapse trailing
    slashes; lower-case.
  - `module` from the first segment: `cockpit`, `programs→deep-dive`,
    `gap-analysis→gap`, `benchmarking`, `scenarios`, `decisions`, `analyst`,
    `trends`, `risk`, `education`, `staff`, `skills`, `admin`, `docs`,
    `profile`, `inbox`, `changelog→docs`, `''→home`, otherwise `other`.
  - A test enumerates every route folder under `apps/web/app` and asserts each
    maps to a module other than `other`, so a new page fails CI until classified.
- Write failures are logged and swallowed.

### B.4 Sessions and dwell (derived, not captured)

- **Session:** a run of one user's views with no gap greater than **30 minutes**.
  Computed in SQL (window function over `created_at` per user) at query time for
  raw rows, and stored as a count in the daily roll-up.
- **Dwell:** time to the next view within the same session; the last view of a
  session has no dwell and is excluded. Reported as a **median per module** with
  that caveat stated on the chart.

### B.5 Retention and roll-up

A new rule in `@kku/db/retention` (pure planner + executor, like the existing
rules), run by the nightly `scripts/pdpa/retention-sweep.ts`:

1. For every Bangkok day older than **120 days** that still has raw rows:
   aggregate `page_views` (views, sessions) and `audit_logs` sign-ins for that
   day into `page_view_daily` (upsert).
2. Only after (1) succeeds for that day, delete that day's `page_views` rows.
3. `audit_logs` rows are **not** touched by this rule — their retention stays
   where it is; the roll-up merely preserves the sign-in counts.

Dry-run mode reports days and row counts. Unit tests cover: day bucketing in
Bangkok across the UTC midnight boundary; idempotent re-run; delete never
precedes aggregate.

**Prod check (deploy step):** confirm the retention sweep timer on prod runs
`scripts/pdpa/retention-sweep.ts`. If it does not, installing it is a documented
deploy step for this release, not an assumption.

### B.6 Read API and permissions

Two permissions in `packages/shared/src/auth/permissions.ts`:

- `usage:read:aggregate` — `SUPER_ADMIN`, `SYSTEM_ADMIN`, `UNIVERSITY_USER`
- `usage:read:detail` — `SUPER_ADMIN`, `SYSTEM_ADMIN`

All endpoints `GET`, `@Authorized(...)`, backed by `packages/db/src/usage.ts`
(shared with the hero). Common query params: `days` ∈ {7, 30, 90, 365}
(default 30), `excludeAdmins` (default `true`), `facultyId?`. Every response
carries `{ windowDays, from, to, recordedSince, rollupFrom }` where `rollupFrom`
is the first day served from daily rows (null if the window is entirely raw).

| Endpoint | Returns | Permission |
|---|---|---|
| `/usage/summary` | active users, views, sessions, sign-ins, AI calls (`ai_inferences`) for the window and the previous window; 30-day daily-active-users and sign-ins series | aggregate |
| `/usage/modules` | per module: views, users, median dwell; daily series | aggregate |
| `/usage/programs` | top 50 programmes: code, name (left-joined; code shown if the programme is gone), faculty, views, users | aggregate |
| `/usage/roles` | per role: users, views, sessions | aggregate |
| `/usage/faculties` | per viewer faculty: users, views (adoption by faculty) | aggregate |
| `/usage/actions` | per audit action family (export, brief, scenario, decision, pipeline, upload): count, series — from `audit_logs` | aggregate |
| `/usage/users` | table: name, role, faculty, last seen, views, sessions, sign-ins, actions; `sort`, `q` | **detail** |
| `/usage/users/:id` | timeline: sessions grouped by Bangkok day, each with its views (human label per path, e.g. "Program Deep-Dive · {programme name}"), interleaved with sign-ins and audit actions | **detail** |
| `/usage/programs/:id/viewers` | who viewed a programme: name, role, views, last seen | **detail** |

Aggregate endpoints never return user ids or names. Responses of aggregate
endpoints are cached 5 minutes in `CacheService`, keyed by params; detail
endpoints are not cached.

### B.7 Dashboard `/usage`

Top-level route (not under `/admin`), page gate: `usage:read:aggregate`; the
access-log section renders only with `usage:read:detail`. Nav: under
**Dashboards** as "Platform usage" for roles holding the permission; `/admin`
gets a tile "Usage & access" in the Application group linking here.

Layout follows the approved evidence-page language (quiet data cards, sticky
rail with scroll-spy, caveats in `<details>`). Window (`days`), `excludeAdmins`
and any module/faculty filter live in the URL.

1. **Summary strip** — the `/usage/summary` stats with change vs the previous
   window; AI calls links to `/admin/ai-cost`. A line states "Page views recorded
   since {recordedSince}; sign-ins since April 2026" so an empty first week is
   not read as no adoption.
2. **Daily active users** — `<TrendLine>` with sign-ins overlaid.
3. **By module** — horizontal bars (views, users) + median dwell; click filters
   the log.
4. **By programme** — top 20; row click → viewers panel (detail) or the
   programme's Deep-Dive (everyone).
5. **By faculty** — adoption by viewer faculty.
6. **By role** — table.
7. **Actions** — counts by family with a small series.
8. **Access log** (detail only) — per-user table, search, sortable; row click →
   `RightPanel` with the user's timeline from `/usage/users/:id`.

Every chart has `<ProvenanceButton>` (source tables, retention, session and
dwell definitions, the admin-exclusion toggle) and `<FreshnessBadge>` (cache
time). No CSV export (would need `@RequireExportReason`; deferred).

### B.8 `/admin` hero

`buildHeroStats` adds, from `/usage/summary?days=7`: **Active users (7d)**,
**Page views (7d)**, **Sign-ins today**, each with change vs the previous 7 days,
and a 30-day DAU `<Sparkline>` in the active-users tile. The tiles link to
`/usage`. The call has a 2 s timeout and is best-effort: on failure the hero
shows the existing tiles only.

### B.9 Privacy

- `docs/pdpa.md`: new section — what is recorded (route pattern, ids, role,
  faculty, time; no IP, no query string), purpose (platform adoption and
  support), 120-day raw retention then daily counts, who can see it, and the
  `SetNull` behaviour on account deletion.
- The in-app privacy notice (`apps/web/src/components/legal/`) gets one
  paragraph saying the same in EN/TH.

### B.10 Tests

- **Pure units:** `normalisePath` (≥ 15 cases: ids, KKU-SEQ codes, Thai-encoded
  query strings, trailing slash, unknown route → `other`); route-folder
  classification test; dedupe window; session and dwell derivation on fixed
  fixtures; Bangkok day bucketing across UTC midnight; retention planner
  idempotency and ordering; permission matrix for nine endpoints; daily-table
  structural test; acknowledgements registry test.
- **API integration (existing api test style, mocked Prisma):** body `userId` is
  ignored; 61st request in a minute → 429; `UNIVERSITY_USER` → 403 on
  `/usage/users`; aggregate responses contain no `userId`/`name` keys.
- **Manual on dev** (no browser automation on this box): open five pages and a
  scope change, check six rows with correct patterns and ids; impersonate and
  confirm `impersonated=true` with the impersonated role; run the sweep
  `--dry-run`.

### B.11 Production readiness (audited now, not after the build)

- Two additive migrations; no schema-destructive change.
- **No** new env keys, buckets, compose changes or operator scripts.
- Depends on the prod retention timer (B.5) — verify before release.
- Counts begin at deploy; nothing to backfill for views. Sign-in history is
  already present in `audit_logs`.
- The hero adds one cached API call to `/admin`; the dashboard's heaviest
  query (top programmes over 365 days) unions raw + daily rows — expected to be
  sub-second at this scale; if not, add a `(program_id, day)` index on the daily
  table.

### B.12 Out of scope

API-call logging, CSV export of the access log, inactivity alerting, IP or
geographic analysis, a public (pre-sign-in) acknowledgements footer.

---

## 7. Gap review outcomes (all adopted)

1. Dashboard at `/usage`, not under `/admin` (B.7).
2. Bangkok days everywhere (B.1, B.5).
3. Scope changes trigger a view (B.2).
4. Sign-in counts rolled up so audit retention cannot break the trend (B.5).
5. Generic path normalisation + route-folder classification test (B.3).
6. Actions from `audit_logs` on the dashboard and in the user timeline (B.6, B.7).
7. Admin accounts excluded from adoption figures by default (B.6).
8. `viewer_faculty_id` snapshot (B.1).
9. Sessions derived server-side; no client session key (B.4).
10. Privacy notice and PDPA doc (B.9).
11. Dwell derived from view gaps, median per module with caveat (B.4).
12. JobThai mark links to the acknowledgement (A.4).
13. `kind` on acknowledgements (A.2).
14. AI calls in the summary strip (B.6).
15. `sendBeacon` as JSON Blob; SameSite=Lax; StrictMode dedupe (B.2).
16. Left-join deleted programmes, show code (B.6).

## 8. Implementation order

Two plans: **Plan A** (acknowledgements — half a day) first, since it is
independent and ships with the next release regardless; **Plan B** (usage —
migrations → capture → read API → dashboard → hero → retention → privacy docs),
each step behind tests, with the manual dev check before the release build.
