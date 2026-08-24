# Teaching and Learning Talent dashboard — design

**Date:** 2026-08-24
**Status:** approved for planning
**Surface:** `/staff/teaching-talent` (new tile on the Staff dashboard hub)

## Goal

Identify the instructors students consistently rate highly. A talent is defined as
someone whose student-evaluation score cleared a bar (default 4.00 / 5.00) in **every
one of the last three completed academic years** — sustained quality, not one good
semester.

The dashboard is a two-level drill-down (Faculty → staff member) over raw
`evaluation_response_summaries` data, plus an XLSX export of the qualifying staff for
HR / awards / development-programme use.

## Population — who is in scope, and why it differs from `/staff/teaching`

**This dashboard is roster-complete over evaluated instructors. `/staff/teaching` is
not, and that is the main reason its queries cannot be reused.**

`instructorsByProgram()` — the query behind the `/staff/teaching` table — joins
`program_courses pc ON pc.course_code = e.course_code`. Any instructor whose courses
are not mapped to a program simply does not exist in that result. Measured on the
BE 2566–2568 window:

| population | count |
|---|---|
| instructors with evaluations resolvable to a `FacultyMember` | **1,695** |
| of those, visible in `/staff/teaching`'s program pivot | 1,130 |
| **dropped by the `program_courses` join** | **565 (33%)** |

All 1,695 are in scope here. The only reuse from `/staff/teaching` is its *access
control* helpers and the weighted-mean formula — not its row set. The rollup query is
written fresh against `evaluation_response_summaries → faculty_members → faculties`
with **no `program_courses` join and no `ProgramFaculty` join**, so curriculum mapping
can never gate who appears. This is the load-bearing property of the whole feature; the
implementation plan must include a test that asserts it.

### Teachers with no HR record — surfaced, not silently dropped

A second population sits below even that. 27% of evaluation rows in the window
(154,574 of 569,812) carry `faculty_member_id IS NULL`: the registrar credited a
`@kku.ac.th` address that matches no `FacultyMember`. That is **271 distinct teachers,
102 of whom have all three years and 98 of whom would qualify at 4.00**.

This is not a matching bug — none of the 271 match any `faculty_members.kku_email`,
even on the local part alone. They are KKU teachers genuinely absent from the
HR-sourced roster.

They are **excluded from the table and from the talent export** — we hold their email
and the owning faculty of the class, but no name, rank or department, so an HR-facing
roster row would be blank where it matters, and some may be guest lecturers or staff
from other institutions.

They are **not hidden**. The page carries a reconciliation panel (design below) and the
export carries an `Unmatched` sheet, so the gap is visible to whoever can fix it at
source. A dashboard that quietly discards a third of its evidence is worse than one
that reports the discard.

A further 34,566 rows in the window carry neither a resolved id nor an email. They
cannot be attributed to any person and are excluded from every count; the methodology
note states how many.

## Non-goals

- **No curriculum mapping.** Staff are grouped by their home faculty
  (`FacultyMember.facultyId`), not by the programs whose courses they teach. This is
  deliberately different from `/staff/teaching`, whose pivot attributes each instructor
  to every program that teaches their course — and whose join drops a third of the
  evaluated roster (above).
- **No new evaluation ingestion.** The dashboard reads what the `kku-evaluations`
  connector already lands.
- **No per-question or per-course drill.** That already exists on `/staff/teaching`;
  this page answers "who, and how consistently", not "why".
- **No AI narrative.** The verdict is a deterministic rule; adding an LLM layer would
  add a hallucination surface to a list of named people.

## Metric definition — `teaching-talent.v1`

### The assessment window

The three most recent academic years that are **both**:

1. completed — `acadYearBE <= currentAcademicYearBE - 1`, where
   `currentAcademicYearBE` comes from `academicYearContext()` in
   `packages/db/src/academic-year.ts`; and
2. actually present in `evaluation_response_summaries` (rows passing the provenance
   gate below).

Today that resolves to **BE 2566, 2567, 2568** (`academic_year.next_start_date` is
`2027-06-22`, so the current academic year is BE 2569).

Condition 2 exists because the registrar's refresh lags the calendar. Without it, a
delayed refresh would render three empty columns and zero talents rather than the most
recent three years of real evidence. The resolved years are shown in the page header
and written into the export, so the window is never implicit.

If fewer than three completed years carry data, the page renders the years it has and
states that the three-year rule cannot yet be evaluated; no one is badged.

### Provenance gate

Every query filters `data_sources.mocked = false`, joined through `ingestion_runs` —
the standard real-data posture. The main rollup additionally requires
`faculty_member_id IS NOT NULL`; the reconciliation aggregate takes exactly the
complement (`faculty_member_id IS NULL AND kkumail_raw IS NOT NULL`). Between them the
two queries account for every attributable row, which is what lets the page state its
own coverage honestly.

### Scores

- **Per-year score** = respondent-weighted mean over all of that instructor's rows in
  that academic year:
  `SUM(rating_avg * respondent_count) / NULLIF(SUM(respondent_count), 0)`.
- **All semesters count** — 1, 2 and the summer/special terms 3 and 4. (`/staff/teaching`
  defaults to semesters 1–2; this dashboard deliberately counts everything a staff
  member taught.)
- **Overall** = the same weighted formula applied across the whole three-year window —
  *not* the mean of the three year figures. Overall, the three year columns and the
  badge therefore describe exactly the same evidence.
- **Respondents** = `SUM(respondent_count)` across the window.

### The talent rule

A staff member is a talent when:

1. they have a score in **all three** years of the window, and
2. `min(year scores) >= threshold`.

The comparison runs on the **2-decimal rounded** value — the number the UI prints. A
displayed `4.00` next to a missing badge would be indefensible in front of a dean.

Threshold options: **4.00** (default), 4.25, 4.50, 4.75. Reference counts on current
dev data — 1,695 instructors have evaluations in the window, 1,339 have all three
years:

| threshold | talents |
|---|---|
| 4.00 | 1,243 |
| 4.25 | 1,078 |
| 4.50 | 592 |
| 4.75 | 139 |

Staff with one or two years of data are listed with their available years and a
`2/3 years` marker, never badged. The distinction between "new arrival" and
"did not clear the bar" stays visible.

## Architecture

```
packages/db/src/teaching-talent.ts     ← SQL rollup + pure rule functions
        ↑
apps/api/src/staff-dashboard/
  teaching-talent.service.ts           ← thin DI wrapper + workbook builder
  teaching-talent.controller.ts        ← 2 routes, tiered access
        ↑
apps/web/app/staff/teaching-talent/
  page.tsx                             ← server component, fetch + gate
  client.tsx                           ← filters, KPI strip, table
apps/web/app/api/staff-talent-export/route.ts   ← streams the xlsx bytes
```

A new `packages/db` file rather than an extension of `evaluations.ts` (already 1,762
lines) or of `teaching-section.tsx` (1,581 lines). The rule functions are pure and
tested without a database, following `packages/db/src/financial-year.ts`.

### `packages/db/src/teaching-talent.ts`

```ts
export const TEACHING_TALENT_METHODOLOGY_VERSION = 'teaching-talent.v1';
export const TALENT_THRESHOLD_OPTIONS = [4.0, 4.25, 4.5, 4.75] as const;
export const TALENT_DEFAULT_THRESHOLD = 4.0;
export const TALENT_WINDOW_YEARS = 3;

/** Pure: pick the assessment window from the years present in the data. */
export function resolveTalentYears(
  yearsWithDataDescending: number[],
  currentAcademicYearBE: number,
): number[];

/** Pure: apply the rule to one instructor's per-year scores. */
export function classifyTalent(
  byYear: Record<string, number | null>,
  years: number[],
  threshold: number,
): { isTalent: boolean; yearsWithData: number; minYearRating: number | null };

/** Pure: "สมชาย ใจดี" → { first: 'ศิริลักษณ์', last: 'อนันต์ณัฐศิริ' } */
export function splitPersonName(fullName: string): { first: string; last: string };

export interface TalentInstructorRow {
  facultyMemberId: string;
  nameTh: string;
  nameEn: string;
  rank: string;              // FacultyRank enum value
  kkuEmail: string | null;
  facultyId: string;
  facultyName: string;       // Faculty.nameTh — the drill-down's top level
  isActive: boolean;
  overallRating: number | null;
  totalRespondents: number;
  courseCount: number;
  byYear: Record<string, { ratingAvg: number | null; respondentCount: number }>;
  yearsWithData: number;
  minYearRating: number | null;
}

/** Registrar-credited teacher with no FacultyMember row. Identified only by
 *  the email the registrar recorded; `facultyName` is the owning faculty of
 *  the classes they taught, not a home faculty. */
export interface UnmatchedTeacherRow {
  kkuEmail: string;                 // lower(trim(kkumail_raw))
  facultyName: string | null;       // via ClassOffering → Faculty, null for 35 of them
  overallRating: number | null;
  totalRespondents: number;
  byYear: Record<string, { ratingAvg: number | null; respondentCount: number }>;
  yearsWithData: number;
  minYearRating: number | null;
}

export interface TeachingTalentResult {
  methodologyVersion: string;
  years: number[];           // e.g. [2566, 2567, 2568], ascending
  windowComplete: boolean;   // false when fewer than 3 completed years carry data
  rows: TalentInstructorRow[];
  /** Coverage disclosure — see "Teachers with no HR record". */
  unmatched: {
    teachers: UnmatchedTeacherRow[];
    /** Rows with neither a resolved id nor an email — attributable to nobody. */
    unattributableRowCount: number;
  };
}

export async function teachingTalentRoster(
  filter: { facultyName?: string[] } | undefined,
  opts?: { includeContact?: boolean; includeUnmatched?: boolean },
): Promise<TeachingTalentResult>;
```

`includeContact` defaults to **false**, in which case `kkuEmail` comes back `null` on
`TalentInstructorRow`. Only the export path sets it — the dashboard has no use for
staff email addresses, so they never travel to the browser. (`UnmatchedTeacherRow.kkuEmail`
is different: there the email *is* the only identifier, and it is the point of the
panel.)

`includeUnmatched` defaults to **false** — the roster route sets it for every role
except `PROGRAM_USER`, and the export sets it always.

Four `$queryRaw` calls inside one function:

0. a `SELECT DISTINCT acad_year_be` that resolves the window before anything can be
   filtered by it — run globally, never faculty-clamped, so every user sees the same
   columns;
1. the `(faculty_member_id × acad_year_be)` rollup for the resolved window, joined
   `evaluation_response_summaries → faculty_members → faculties` — **no
   `program_courses`, no `program_faculties`**;
2. the complement aggregate keyed on `lower(trim(kkumail_raw))`, left-joined to
   `faculties` through `evaluation_response_summaries.faculty_id` (the class's owning
   faculty, populated independently of `faculty_member_id`);
3. a single `COUNT(*)` of unattributable rows.

Per-instructor rollup, `overallRating` (recomputed from the weighted sums, not averaged
from year figures) and the classification fields are assembled in TypeScript.

**The threshold is not baked into the roster response.** `minYearRating` and
`yearsWithData` travel to the client, which re-badges instantly when the selector
moves — no refetch. The export applies the threshold server-side through
`classifyTalent()`, so one rule serves both surfaces.

### API

Both routes live on a new controller and reuse the `/staff/teaching` access helpers
verbatim (`assertCanSeeFacultyDashboards`, `clampFacultyNameFilter`,
`resolveOwnFacultyMember`), so the visibility tiers are identical and no new access
logic is introduced:

| role | sees |
|---|---|
| `UNIVERSITY_USER` / `EXECUTIVE` / `COUNCIL` / `ADMIN` | every instructor, and the full unmatched panel |
| `FACULTY_USER` | instructors whose home faculty is granted to them, and unmatched teachers whose *class* faculty is granted to them |
| `PROGRAM_USER` | their own row only; no unmatched panel |

Unmatched teachers have no `FacultyMember` and therefore no home faculty to clamp on.
Their clamp runs on the owning faculty of the classes they taught
(`evaluation_response_summaries.faculty_id`, resolved via `ClassOffering`). The 35
unmatched teachers whose rows carry no faculty at all are visible only to
university-wide roles — a `FACULTY_USER` cannot be shown a person who may belong to
another faculty.

**`GET /staff/teaching-talent?facultyName=…`** → `TeachingTalentResult`. Guarded with
`@Authorized('institution:read:dashboard')`.

**`POST /staff/teaching-talent/export`** with body `{ facultyName: string[], threshold: number }`
→ `{ filename: string, base64: string, rowCount: number, byteSize: number }`.

POST rather than GET for two reasons: the `AuditLogInterceptor` records
`request.body`, so the audit row captures exactly which filter and threshold produced
the file; and it matches the existing export precedent
(`POST /programs/:id/export-detail-pdf`). Decorated
`@AuditLog({ action: 'export.teaching_talent', entityType: 'StaffExport' })` — this is
named-person data leaving the system.

The body is validated with Zod: `threshold` must be one of `TALENT_THRESHOLD_OPTIONS`
(rejecting a crafted `threshold: 0` that would export the whole roster),
`facultyName` is clamped to the caller's grants exactly as the roster route does.
`PROGRAM_USER` receives 403 on this route — a single-row talent export has no use and
the button is hidden for them anyway.

Base64 inside the standard response envelope rather than a raw byte stream: the file
is small (~1,300 rows ≈ 120 KB), the envelope discipline stays intact, and the service
returns a `Buffer` that tests can read back with `XLSX.read`.

## Web page

**Route** `/staff/teaching-talent`, `dynamic = 'force-dynamic'`, gated by
`canSeeProgramAwareDashboards(role)` like its siblings. A tile is added to the
`/staff` hub (`programAware: true`) with a new `TeachingTalentThumb` in
`apps/web/app/staff/thumbnails.tsx`.

**KPI strip** — talents · eligible (staff with all three years) · instructors with any
evaluation · the active threshold and the resolved window (`BE 2566–2568`).

**Filter rail** (all URL state, shareable):
- Faculty — `MultiSelectField`, options derived from the returned rows (no extra
  endpoint), same component the compensation and workforce dashboards use.
- Threshold — segmented selector over `TALENT_THRESHOLD_OPTIONS`, `?threshold=4.25`.
  Applied client-side; no refetch.
- Talents only — toggle, `?talentsOnly=1`.

**Table** — the shared `DrillDownPivot` (`apps/web/app/staff/drill-down-pivot.tsx`)
with `maxDepth={2}`:

- Level 1 · Faculty — metrics: talents, eligible, instructors, faculty overall,
  respondents. The faculty Overall is the respondent-weighted mean across that
  faculty's instructors over the whole window (same formula, one level up), so it does
  not shift when the threshold selector moves.
- Level 2 · staff member — label is `<rank abbrev> <nameTh>`, metrics: Overall,
  Respondents, then one column per window year (`BE 2566`, `BE 2567`, `BE 2568`).

Talent rows carry `emphasis: 'success'` (the tint already supported) plus a badge. This
requires one small addition to `DrillDownPivot`: an optional
`badge?: { text: string; tone: 'success' | 'muted' }` on `DrillRow`, rendered after the
label. Ten lines in the shared component, reusable by the other staff dashboards, and
cheaper than a second table implementation that would drift from the first.

Missing year cells render `—` (the existing `fmt()` null path). Non-talent rows with
fewer than three years get `badge: { text: '2/3 years', tone: 'muted' }`.

Rank labels reuse the existing Thai abbreviation map pattern
(`apps/web/src/lib/display-name.ts`: `ผศ.` / `รศ.` / `ศ.`).

**Coverage panel** — a collapsed `Card` beneath the table, hidden for `PROGRAM_USER`:

> **Coverage** — 1,695 evaluated instructors are in this table. A further **271
> teachers** were evaluated but have no HR record, **98 of whom would qualify** at the
> current threshold; they cannot be named or exported. 34,566 evaluation rows are
> credited to no identifiable person.

Expanding it lists the unmatched teachers — email, class faculty, per-year scores,
respondents, would-qualify flag — sorted by would-qualify then Overall descending. The
qualifying count recomputes with the threshold selector, like every other count on the
page. The panel restates that fixing this means adding the person to the HR-sourced
roster (`kku-hr`), not editing this dashboard.

The numbers above are today's; every figure renders from the response, never hard-coded.

**Methodology note** under the table: the rule in one sentence, the resolved window,
`teaching-talent.v1`, and a link to `/staff/teaching` for the per-question detail —
matching how the other staff dashboards surface `methodologyVersion` (they do not use
`ProvenanceButton`; this page follows the local convention rather than inventing a
new one).

## XLSX export

Button in the filter rail, hidden when the roster response is own-scope
(`PROGRAM_USER`), enabled only when at least one talent is in view. Clicking it hits
the Next route handler `apps/web/app/api/staff-talent-export/route.ts`, which
authenticates the session, POSTs to the API, decodes the base64 and streams the bytes
with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
and a `Content-Disposition: attachment` filename. This is the proxy pattern
`apps/web/app/api/admin-program-export/[id]/route.ts` already uses — the browser never
needs to reach the API origin directly, which matters in the WSL2 dev setup.

Built with the `xlsx@0.18.5` package already present in `apps/api`.

**Sheet 1 — `Talent`.** Talents only, honouring the faculty filter and threshold,
sorted by faculty (Thai collation) then Overall descending:

| column | source |
|---|---|
| Faculty | `Faculty.nameTh` |
| Academic rank | `FacultyRank` → Thai full label (`ผู้ช่วยศาสตราจารย์` …) via a `RANK_LABEL_TH` map defined in the export builder — the existing maps live in `apps/web`, which the API cannot import |
| First name | first token of `nameTh` |
| Last name | remainder of `nameTh` |
| Email | `FacultyMember.kkuEmail` (blank when null) |
| Overall score | window overall, 2 decimals, numeric cell |
| Full name (EN) | `nameEn` — carried so nothing is lost in the Thai split |

`splitPersonName` handles the edge cases: a single-token name puts everything in
First name and leaves Last name blank; three or more tokens keep token 1 as First name
and the rest as Last name. Names are stored without an honorific prefix in this data
set, and the rank column carries the title separately.

**Sheet 2 — `Unmatched`.** The reconciliation worklist: email, class faculty, one
column per window year, respondents, overall, and `Would qualify` (yes/no at the
requested threshold). Same rows the coverage panel shows, clamped identically. A
header note states these teachers have no HR record and must be added to the `kku-hr`
roster before they can appear in `Talent`. Shipping the worklist in the same file
means whoever receives the talent list also receives its coverage gap.

**Sheet 3 — `About`.** Key/value rows: methodology version, assessment window,
threshold, semesters included, faculty filter applied, talent row count, unmatched
teacher count, unattributable row count, generated-at timestamp, and the one-line rule
statement. An exported list of named staff that travels without its criteria — or
without its coverage — is a liability.

Filename: `kku-teaching-talent-BE2566-2568-min4.00.xlsx`.

## Error handling

- **No evaluation data at all** (or a scope that clamps to nothing) — the page renders
  `DiagnosticEmptyState` with `surface="teaching talent"`, the same component the
  sibling dashboards use, which surfaces the underlying fetch error to admins instead
  of a blank card.
- **Fewer than three completed years with data** — table renders with the available
  year columns, the KPI strip shows the talent count as `—`, and a banner states that
  the three-year rule needs three completed years. No one is badged.
- **Export with zero talents** — the button is disabled client-side; if called anyway
  the API returns a workbook whose `Talent` sheet holds only the header row and whose
  `About` sheet records `rowCount: 0`, rather than erroring.
- **Invalid threshold** — Zod rejects it at the API boundary with the standard error
  envelope.

## Testing

**`packages/db/test/teaching-talent.test.ts`** (pure, no database — the
`financial-year.test.ts` model):
- `resolveTalentYears` — picks the three most recent completed years; excludes the
  in-progress year even when it has data; returns fewer than three when data is thin;
  skips gaps (e.g. `[2568, 2567, 2565]` when 2566 is missing).
- `classifyTalent` — badges only with all three years present; rejects on a single
  year below the bar; boundary cases at exactly 4.00, at 3.995 (rounds to 4.00 →
  talent, matching the displayed value) and at 3.994 (rounds to 3.99 → not talent);
  respects each threshold option.
- `splitPersonName` — two tokens, one token, three tokens, extra whitespace, empty
  string.

**Population guard — the test that protects the whole point of this feature.** A
source-level assertion over `packages/db/src/teaching-talent.ts` that its SQL contains
no `program_courses` and no `program_faculties` reference. Crude, and deliberately so:
the failure mode being defended against is a future contributor "reusing" the
`/staff/teaching` pivot for consistency and silently deleting a third of the roster.
The test names that consequence in its failure message.

**`apps/api/test/teaching-talent-export.test.ts`:**
- Workbook round-trip via `XLSX.read` on the returned buffer — the three sheet names in
  order, header rows, column order, a known talent row, numeric (not string) score
  cells.
- Talents-only filtering and threshold sensitivity: the same fixture at 4.00 and 4.50
  yields different row counts in `Talent` **and** different `Would qualify` values in
  `Unmatched`.
- An unmatched teacher never leaks into the `Talent` sheet, and a matched instructor
  never appears in `Unmatched`.
- Zero-talent export produces header-only sheets, not an error.
- `About` sheet carries window, threshold, both row counts and the unattributable count.

**Existing suites must stay green** — in particular nothing in `evaluations.ts` or the
`/staff/teaching` endpoints is modified by this work.

## Files

**Create**
- `packages/db/src/teaching-talent.ts`
- `packages/db/test/teaching-talent.test.ts`
- `apps/api/src/staff-dashboard/teaching-talent.service.ts`
- `apps/api/src/staff-dashboard/teaching-talent-workbook.ts` — the workbook builder as a
  pure function over a `TeachingTalentResult`, so it is testable without a database or
  an HTTP request
- `apps/api/src/staff-dashboard/teaching-talent.controller.ts`
- `apps/api/test/teaching-talent-export.test.ts`
- `apps/web/app/staff/teaching-talent/page.tsx`
- `apps/web/app/staff/teaching-talent/client.tsx`
- `apps/web/app/api/staff-talent-export/route.ts`

**Modify**
- `packages/db/src/index.ts` — export the new module
- `apps/api/src/staff-dashboard/staff.module.ts` — register controller + service
- `apps/web/app/staff/page.tsx` — new tile
- `apps/web/app/staff/thumbnails.tsx` — `TeachingTalentThumb`
- `apps/web/app/staff/drill-down-pivot.tsx` — optional `badge` on `DrillRow`
- `apps/web/app/changelog/page.tsx` — release entry when this ships

## Deferred

- **Closing the 271-teacher HR gap.** This dashboard reports the gap; it cannot fix it.
  The fix belongs with the `kku-hr` connector (or a targeted backfill of registrar
  emails that resolve to no `FacultyMember`, in the shape of the earlier
  `backfill-faculty-from-publications` script). Worth scheduling once the coverage panel
  shows the operator how large it is.
- **Relative (per-faculty percentile) thresholds.** Rating cultures differ by faculty;
  an absolute bar favours the generous ones. Revisit if deans push back on the
  absolute rule.
- **Trajectory signal** — flagging staff who improved sharply across the window rather
  than only those already high. Different question, different page.
- **Cross-linking a talent row into `/staff/teaching`'s per-question drill.** That page
  opens its drill from client state, not from a URL parameter; wiring a deep link means
  changing its state model, which is out of scope here.
