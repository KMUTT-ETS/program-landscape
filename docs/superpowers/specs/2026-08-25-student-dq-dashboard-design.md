# Student DQ dashboard — design

**Date:** 2026-08-25
**Status:** approved for planning
**Surface:** `/education/student-dq` (new tile on the Education dashboard)

## Goal

Show how KKU undergraduates perform on the university's Digital Intelligence (DQ)
competency test: a Faculty → Program drill-down carrying an overall score, a pass rate
and every module, plus a filterable radar chart that compares any scope's module shape
against the university as a whole.

Source of truth for the framework: `KKUDQ.pdf` (LTIC, *กรอบสมรรถนะความฉลาดทางดิจิทัลสำหรับ
นักศึกษาระดับปริญญาตรี*). Source of truth for results: the DQ export API.

## What the data actually is — verified, not assumed

Everything below was measured against the live endpoint on 2026-08-25 before this design
was written. These numbers are the reason several decisions look the way they do.

| fact | value |
|---|---|
| students in the export | 24,776 (single response, 13.7 MB, 3.4 s) |
| `hasResult: true` | 22,373 |
| **students actually carrying module scores** | **19,601** |
| `hasResult: true` but no `modules` payload | 2,772 |
| `allPassed: true` | 14,961 |
| pass mark | **exactly 70.00** — no `allPassed` student scores below 70 on modules 1–12 |
| module 13 taken (score > 0) | 11,173 of 19,601 (57.0%) |
| module 13 zeros | 8,428 — i.e. not taken, not a score of zero |
| zeros on other modules | ~1,050–1,230 each (~6%) |
| distinct `faculty` strings | 82 raw → 39 after normalising on the first `/` |

### The `allPassed` flag contradicts itself

164 students score ≥ 70 on every module 1–12 but under 70 on module 13, and are marked
`allPassed: false`. **3,183 students with exactly that profile are marked `true`.** The
source applies no single rule — presumably because module 13 was added mid-programme and
the flag depends on which test version a student sat.

**Decision (operator's call): pass `allPassed` through unchanged.** The dashboard reports
DQ's own verdict and never silently substitutes its own. A provenance note records the
inconsistency and its size so a reader who finds two identical-looking students with
different verdicts has an explanation. We do NOT publish a competing computed pass column.

### A zero is missing evidence, not a score

Module 13 arrived after most students sat the test, so 43% of its values are `0` against
~6% elsewhere. Averaging those zeros would show the AI module near 40 instead of ~70 and
read as a competency crisis that is really a rollout artefact.

**Decision: a score of `0` is excluded from every module average and counted as not
taken, on every module — not just 13.** Non-zero scores run as low as 3.0, so a genuine
zero is vanishingly rare, and one rule applied everywhere beats two rules on one chart.
Every module therefore carries its own **coverage** ("taken by N%") wherever its score is
shown; the two are never displayed apart.

## Identity resolution and population

The export carries `faculty` but no program. The bridge is `student_program_record`:

- `hashCitizenId(studentId)` — strip to alphanumerics (so `643020334-9` → `6430203349`),
  SHA-256 — matches `student_program_record.student_code_hash`. **Verified: this is the
  same helper the `unicon-ds1001` connector uses to write that column.**
- 14,765 of 24,776 students (59.6%) resolve to a `program_id`.

Coverage is cohort-shaped, and the shape explains itself:

| admission year (BE) | students | resolve to a program |
|---|---|---|
| 69 | 359 | 0% |
| 68 | 1,106 | 90.4% |
| 67 | 3,179 | 90.2% |
| 66 | 5,435 | 87.7% |
| 65 | 6,076 | 80.9% |
| 64 | 5,712 | 14.5% |
| 63 and older | 2,909 | 7–15% |

`student_program_record` is an **AY 2568 enrolment snapshot** (35,390 students); the DQ
export is **cumulative across every cohort that ever sat the test**. Older cohorts have
graduated or left, and BE 69 has not yet been enrolled into the snapshot. This is
structural and will not improve by trying harder.

**Decision: the dashboard covers all 24,776 students.** The faculty level uses DQ's own
`faculty` field so faculty totals reconcile with what DQ reports; within a faculty,
students who resolve to a program appear under it and the remainder sit in an explicit
**"Program not identified"** row with its own count. Nothing is dropped, and no program
row contains a student we could not place.

### Faculty-name normalisation

The raw field mixes plain names with breadcrumbs (`คณะวิศวกรรมศาสตร์ / ปริญญาตรี ภาคปกติ /
นักศึกษา`). Taking the segment before the first `/` and trimming reduces 82 strings to 39,
of which 24 match `Faculty.nameTh` exactly, leaving **358 students (1.4%)** under names
absent from our `faculties` table — Nong Khai campus faculties, one college, and 28 blank
values. Those keep their raw normalised name as an unlinked faculty row rather than being
discarded, and the count is reported in the coverage panel.

## Storage — two aggregate cubes, no student rows

The education dashboards read pre-aggregated cubes (`education_student_cube` and
siblings), never per-student rows. This design follows that, and doing so also resolves
the PDPA question outright: **the export carries `firstname` and `lastname`, and neither
those nor the student ID are ever written to our database.** Resolution happens in memory
during the refresh; only aggregates are persisted. Same posture as `kku-hr` and
`kku-registry`.

Both cubes are dimensioned `(facultyName, facultyId?, programId?, programName?,
cohortYearBE)`:

**`dq_student_cube`** — one row per dimension tuple:
`studentsTested`, `studentsWithScores`, `studentsAllPassed`.

**`dq_module_cube`** — one row per dimension tuple **per module**:
`moduleKey` (`THEORY_MODULE_7`), `moduleNo`, `moduleKind` (`THEORY` | `WORKSHOP`),
`takenCount`, `scoreSum`, `studentsInScope`.

`scoreSum` + `takenCount` rather than a stored mean is load-bearing: it is what makes a
faculty or university figure a true weighted mean instead of a mean of means. `moduleNo`
+ `moduleKind` are stored alongside the key so the UI can group and order without parsing
strings.

`programId IS NULL` is the "Program not identified" bucket. `cohortYearBE` (the first two
digits of the student code) is carried so a cohort cut is possible later without
re-fetching, even though v1 does not filter on it.

Both cubes carry `ingestionRunId` for provenance and are replaced wholesale per refresh.

## Ingestion — a `kku-dq` connector

New entry in `SOURCE_CATALOG` (`kku-dq`, kind `API`, format `JSON`) with
`CONNECTOR_KKU_DQ_MODE`, which brings `IngestionRun` provenance, the
`/admin/data-sources/kku-dq` stats page and scheduling with no new infrastructure. Env:
`DQ_API_BASE_URL`, `DQ_API_TOKEN`, `DQ_API_REQUEST_TIMEOUT_MS` (already added to
`.env.example`, `.env.prod.example` and the local `.env`).

Cadence: weekly. The export is a single 13.7 MB response served in ~3.4 s, so there is no
pagination to manage and no reason to hammer it more often — results change only as
students sit the test.

The connector's `load()` writes both cubes in one transaction and records in
`IngestionRun.metadata`: students fetched, students with scores, program-match rate,
unmatched faculty names, and the `allPassed`-inconsistency count. Those metadata figures
are what the coverage panel reads, so the page never recomputes them.

**The token is a secret.** It is read server-side only; the payload's names mean the raw
response must never be logged or cached to disk.

## Modules

Twelve modules in three domains, per the framework document, plus module 13:

| # | Thai | English | domain |
|---|---|---|---|
| 1 | การใช้คอมพิวเตอร์พื้นฐาน | Computer Basics | Essential Computer |
| 2 | การใช้อินเทอร์เน็ต | Internet | Essential Computer |
| 3 | การทำงานร่วมกันแบบออนไลน์ | Online Collaboration | Essential Computer |
| 4 | ระบบปฏิบัติการ | Operating System | Essential Computer |
| 5 | การใช้โปรแกรมประมวลคำ | Word Processing | Essential Software |
| 6 | การใช้โปรแกรมตารางคำนวณ | Spreadsheet | Essential Software |
| 7 | การใช้โปรแกรมการนำเสนองาน | Presentation | Essential Software |
| 8 | การสร้างสื่อดิจิทัล | Digital Media | Essential Software |
| 9 | การใช้สื่อสังคมออนไลน์ | Social Media | Technology at Work |
| 10 | การรู้สารสนเทศ | Information Literacy | Technology at Work |
| 11 | ทักษะการค้นหาอาชีพ | Career Search Skills | Technology at Work |
| 12 | ร่องรอยทางดิจิทัล | Digital Footprint | Technology at Work |
| 13 | — | Generative AI | Generative AI |

Workshops exist for modules 5–8 only (the Essential Software domain), matching the
export. Module 13 is **not in the framework PDF supplied** — that document's contents run
1–12 — so its English label comes from the operator and its Thai label is left blank until
the revised framework lands. The module table lives in one exported constant in
`@kku/shared` so the page, the radar and any future export share one ordering and one set
of labels. UI labels are English per the platform's language rule; Thai names appear in
tooltips where they exist.

## API

New controller under the existing education module. All routes
`@Authorized('institution:read:dashboard')` and scope-clamped exactly as the sibling
education endpoints are — a `FACULTY_USER` sees their faculty, a `PROGRAM_USER` their
program.

- `GET /education/student-dq/overview` → KPI figures + coverage metadata from the latest
  `IngestionRun`.
- `GET /education/student-dq/drill` → the Faculty → Program tree with per-module columns.
- `GET /education/student-dq/radar?facultyName=&programId=&cohort=&kind=` → the selected
  scope's per-module means plus the university comparison series.

Every response carries `methodologyVersion: 'student-dq.v1'` and the source refresh
timestamp.

## Page — `/education/student-dq`

**KPI strip:** students tested · with scores · passed (DQ) · module 13 adoption.

**Filter rail** (URL state, shareable): faculty multi-select, cohort multi-select,
theory/workshop toggle for the radar, and a "programs only / include unplaced" switch.

**Drill-down** via the shared `DrillDownPivot` at `maxDepth={2}`:
Faculty → Program, columns **Overall · Passed % · Tested**, then one column per module
in framework order. Faculty rows aggregate from `scoreSum`/`takenCount`, never from child
means. The "Program not identified" row sorts last within its faculty and renders muted,
so it reads as a data-coverage note rather than a programme.

**Radar** below the table: 13 axes in framework order, plotting the selected scope
against the university mean as a second series. Selecting a table row targets the radar
at that scope; the theory/workshop toggle switches to the 4-axis workshop view. Axes
whose coverage is below a stated floor are drawn but marked, so a thinly-taken module
cannot masquerade as a strong one. Built on the existing `packages/ui` radar primitive —
no new charting library, per the platform rule.

**Coverage panel**, in the discipline used by the teaching-talent dashboard: students
tested vs scored, the 2,772 with `hasResult` but no scores, the program-match rate with
its cohort explanation, the 358 students under unrecognised faculty names, and the
`allPassed` inconsistency (164 / 3,183) with a one-line statement that the flag is the
source's own.

## Error handling

- **No cube rows** (connector never run, or run with the token unset) — the page renders
  `DiagnosticEmptyState` with a pointer to `/admin/data-sources/kku-dq`, not an empty
  table.
- **Token missing or rejected** — the connector fails the run with a clear message and
  the previous cube contents stay in place; a stale dashboard with a visible freshness
  timestamp beats a blank one.
- **A module absent from the payload** (framework revision) — the cube simply has no rows
  for it; the table omits the column and the radar omits the axis rather than plotting
  zero.
- **A faculty with zero scored students** — rendered with `—` in every score column, never
  `0`.

## Testing

Pure functions in `packages/shared` (no network, no database):
- `normaliseDqFaculty` — breadcrumb split, whitespace, blank → `(unknown)`.
- `cohortFromStudentId` — two-digit BE prefix, non-numeric ids, short ids.
- `dqModuleMean` — zeros excluded; all-zero group returns null, not 0; weighted rollup
  from `scoreSum`/`takenCount` equals the direct mean over the underlying values.
- The module table — 17 keys map to 13 theory + 4 workshop entries with no gaps, and the
  order matches the framework.

Connector transform tests against a **redacted fixture** (a handful of records with names
stripped and IDs replaced by synthetic ones) covering: a student who resolves to a
program, one who does not, one with `hasResult` but no scores, and one whose faculty is a
breadcrumb.

An integration check that the two cubes reconcile: summing `dq_student_cube.studentsTested`
across all rows equals the connector's fetched count.

## Files

**Create** — `packages/shared/src/dq/modules.ts` (module table + pure helpers) and its
tests; `packages/db/src/student-dq.ts` (cube queries); Prisma migration for the two
cubes; `apps/ingestion/src/connectors/sources/kku-dq/{connector,transforms}.ts` + tests;
`apps/api/src/education/student-dq.{service,controller}.ts`;
`apps/web/app/education/student-dq/{page,client}.tsx`.

**Modify** — `packages/shared/src/ingestion/catalog.ts` (new source);
`apps/ingestion/src/connectors/registry.ts`; `apps/api/src/education/education.module.ts`;
the Education hub page (new tile); `apps/web/app/changelog/page.tsx`.

## Deferred

- **Cohort trend over time.** The cube carries `cohortYearBE`, but a year-on-year view
  needs repeated snapshots; the export is a current-state dump with no test date. Worth
  revisiting once we have retained a few refreshes.
- **Per-student drill.** Deliberately impossible by design — no student rows are stored.
  If an adviser-facing view is ever wanted it needs its own PDPA assessment, not an
  extension of this cube.
- **Reconciling `allPassed`.** Owned by LTIC, not by this dashboard. The coverage panel
  gives them the number.
- **Module 13's Thai label and framework text**, pending the revised document.
