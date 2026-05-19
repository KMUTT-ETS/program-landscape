# Class GPA Methodology — `class-gpa.v1`

> Current version: `class-gpa.v1` · First shipped: 2026-05-19 ·
> Maintainer: VP Education + Digital
> Locked references:
> - `apps/ingestion/src/scripts/link-class-offerings.ts` — ingestion + per-class precompute
> - `apps/api/src/education/education.service.ts` (class-GPA methods) — rollups
> - `apps/web/app/education/performance/class-gpa-section.tsx` — UI

## Purpose

Average grade earned per **class section**, weighted by credits ×
gradedCount, rolled up to course / program / faculty / overall scopes.
Powers the trend + drill view in `/education/performance` (added v1.2.9).

**Not** the same as the student cumulative GPA shown in the rest of
that page. They answer different questions:

- **Student GPA** (existing) — "what is the average grade the average
  KKU undergraduate has accumulated across all their courses?" Source:
  `EducationPerformanceCube` from `VIEW_STUDENT_DETAIL_ALL`.
- **Class GPA** (this doc) — "what is the average grade students earn
  in this faculty's / program's class sections?" Source:
  `ClassOffering` grade-distribution columns from
  `POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER`.

A student appears in Student GPA once per term across all their
courses; a section appears in Class GPA once with the grade
distribution earned by its enrolled cohort. The two metrics can
diverge — e.g. a service course taken by 1,000 students from 50
programs has a single Class GPA but contributes to 50 Student GPA
populations.

## KKU 4.0 grade scale

Letter weights (single source of truth in
`link-class-offerings.ts:GPA_WEIGHTS`):

| Letter | Weight |
|---|---|
| A | 4.0 |
| B+ | 3.5 |
| B | 3.0 |
| C+ | 2.5 |
| C | 2.0 |
| D+ | 1.5 |
| D | 1.0 |
| F | 0.0 |

Non-graded letters (excluded from GPA, surfaced separately):

| Letter | Meaning |
|---|---|
| I | Incomplete |
| W | Withdrawn |
| AU | Audit |
| S | Satisfactory (pass) — pass/fail courses |

## Formulae

### Per-section (precomputed at ingestion)

```
gradedCount = A + BPLUS + B + CPLUS + C + DPLUS + D + F
classGpa = (A·4 + BPLUS·3.5 + B·3 + CPLUS·2.5 + C·2 + DPLUS·1.5 + D·1 + F·0) / gradedCount
                                                              when gradedCount > 0
classGpa = NULL                                               when gradedCount = 0
```

`classGpa` and `gradedCount` are stored on each `ClassOffering` row.
0.0 is a legitimate value (everyone failed) — never substitute for NULL.

### Aggregation up the hierarchy

Credit × gradedCount weighted. Contribution of section *s* to a rollup:

```
weight_s   = gradedCount_s × COALESCE(creditTotal_s, 1)
classGpa^_rollup = Σ_s (classGpa_s × weight_s) / Σ_s weight_s
```

`COALESCE(creditTotal, 1)` defends against an extremely small number
of registrar rows where `CREDITTOTAL` is null (~0.2% of sections —
mostly internship / clinical placements where the course-unit field
is malformed).

A class taught by a course shared across N programs **contributes
to all N program rollups** — this is the right reading of "what's
the GPA my curriculum's classes produce" because each program owns
the courses it requires.

### KPIs surfaced on the dashboard

```
passRate       = 1 - (F / gradedCount)                                 (over the filter window)
withdrawalRate = W / (gradedCount + I + W)                             (excludes AU/S — pass/fail)
gradeDistribution = { A, B+, B, C+, C, D+, D, F }                      (raw counts)
```

## Trend

Per `(acadYearBE × semester)` cell. The trend chart on
`/education/performance` plots **one line per semester** with year as
the x-axis:
- Semester 1 (main term)
- Semester 2 (main term)
- Semester 3 (summer)
- Semester 4 (intersession)

Why four lines: KKU's summer + intersession terms have very different
GPA distributions (smaller cohorts, intensive courses) — averaging
them with main terms would mask both signals. Each line uses
`connectNulls=false` so a missing semester renders as a gap, not an
interpolation.

## Data sources

| Source | Used for |
|---|---|
| `POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER` columns A / BPLUS / B / CPLUS / C / DPLUS / D / F / I / W / AU / S | Per-section grade counts |
| `class_offerings` (ingested via `pnpm programs:link-class-offerings`) | Persisted with precomputed classGpa + gradedCount |
| `program_courses` (curriculum-extraction output) | Program rollup join (programId ↔ courseCode) |

The view's grade columns are populated nightly by the registrar.
Current-term values stay 0 until grades are submitted; the dashboard
correctly shows missing semesters as gaps rather than zero-GPA dots.

## Null handling

| Field | Null behaviour |
|---|---|
| `classGpa` | NULL when `gradedCount = 0`. Rollups exclude these sections from numerator + denominator. |
| `passRate` | NULL when `gradedCount = 0`. The dashboard renders `—`. |
| `withdrawalRate` | NULL when `gradedCount + I + W = 0`. |
| `creditTotal` | Defaults to 1 in the weight (~0.2% of sections affected). |

## Known limitations

- **Same-section grade revisions are not tracked.** The view returns
  the *current* grade distribution. If grades are revised post-issuance
  (e.g., an `I` is resolved to `B`), the next ingestion overwrites the
  prior counts. Historical reconciliation is not preserved.
- **Audit (AU) and Satisfactory (S) treatments differ from KKU's own
  GPA policy.** AU = audit (no credit), S = pass on pass/fail courses.
  Both are correctly excluded from GPA, but a pure-pass/fail course
  registers `classGpa = NULL` (no graded letters), which the UI
  renders as "no graded data" — analyst should not interpret this as
  data missing.
- **Service courses inflate large faculties' rollups.** A 1,000-student
  GE class taught BY the GE Institute contributes 1,000 students to
  the GE Institute's gradedCount but only one section. This is
  semantically correct for the GE Institute view but the GE filter
  toggle (`geOnly=true`) lets analysts isolate or exclude.
- **Term-in-progress is opaque.** When the registrar's current
  semester is still active, the view shows `gradedCount = 0` for all
  its sections. The trend chart correctly hides this semester until
  the registrar publishes; there is no "preliminary GPA" estimate.

## API surface

```
GET /education/performance/class-gpa/overall?facultyName=&levelName=&acadYearBE=&semester=&geOnly=
GET /education/performance/class-gpa/trend?...
GET /education/performance/class-gpa/by-program?...
GET /education/performance/class-gpa/sections/:programId/:acadYearBE/:semester
```

All four routes scope-clamp via `clampFacultyNameFilter`:
admin / UNIVERSITY_USER see everything; FACULTY_USER's faculty grant
narrows to their faculty's class sections only.

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| `class-gpa.v1` | 2026-05-19 | Methodology bundle | Initial implementation. Per-section classGpa precomputed at ingestion using the KKU 4.0 weights. Credit × gradedCount weighted rollups to program / faculty / overall. Four-line trend chart (1 line per semester). Drill-down to per-section table on `/education/performance`. |
