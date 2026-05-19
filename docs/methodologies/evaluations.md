# Student Evaluations Methodology — `kku-evaluations.v1`

> Current version: `kku-evaluations.v1` · First shipped: 2026-05-19 ·
> Maintainer: VP Education + VP Personnel
> Locked references:
> - `apps/ingestion/src/connectors/sources/kku-evaluations/` — ingestion connector
> - `packages/db/src/evaluations.ts` — query helpers
> - `apps/api/src/education/evaluations.service.ts` + controller — /education/satisfaction endpoints
> - `apps/api/src/staff-dashboard/staff-evaluations.controller.ts` — /staff/teaching endpoints
> - `apps/web/app/education/satisfaction/` — course-aggregated UI
> - `apps/web/app/staff/teaching/` — instructor-individual UI
> - `docs/data-sources/kku-evaluations.md` — source spec + Phase 0 findings

## Purpose

Surface student-evaluation ratings of teaching & learning. Two dashboards:

- **`/education/satisfaction`** — *course-aggregated*. Faculty → Course
  pivot with year columns, semester trend, question-level gap drill.
  No per-instructor names exposed here.
- **`/staff/teaching`** — *instructor-individual*. Roster of instructors
  with tiered visibility, drill into per-question + per-course
  breakdown.

Source: `POWERBI.EVALUATE_INSTRUCTOR` — 1.4M pre-aggregated cells
spanning BE 2564–2569, 40 questions, 27 faculties, 2,456 instructors.

## Visibility model

| Surface | PROGRAM_USER | FACULTY_USER | UNIVERSITY+ |
|---|---|---|---|
| /education/satisfaction | scope-clamped to programs' courses | scope-clamped to faculty's courses | all |
| /staff/teaching/overall + roster | **own only** | all individuals in faculty | all individuals |
| /staff/teaching/instructor/:id | own only (403 otherwise) | scope-clamped (403 otherwise) | all |
| /profile → "My evaluations" | own only | own only | own only |

Enforcement lives in three places:
1. `assertCanSeeFacultyDashboards(user)` — coarse "can see SOME faculty dashboard"
2. `clampFacultyNameFilter(q, user)` — narrows faculty list to granted scope
3. `assertInstructorAccessible(facultyMemberId, user)` — per-instructor 403
4. `resolveOwnFacultyMember(user)` — resolves own FacultyMember via `User.employeeId` → `FacultyMember.employeeId` (or `User.email` → `FacultyMember.kkuEmail`)

The course-aggregated views NEVER carry per-instructor names — even an
ADMIN sees course-level numbers on `/education/satisfaction`. Per-instructor
names live only on `/staff/teaching` with the tiered visibility above.

## Score scale

Source uses a **1–5 Thai likert**, with `POINT_AVG` already pre-aggregated
per `(class × question × instructor)` cell. Observed range: [0.64, 5.0].

Distribution is heavily ceiling-biased:

| Bucket | % of cells |
|---|---|
| 5.0 (perfect) | 21.3% |
| [4.5, 5.0) | 41.0% |
| [4.0, 4.5) | 29.7% |
| [3.5, 4.0) | 5.3% |
| < 3.5 | 2.7% |

**87% of cells score ≥ 4.0.** This is why every UI surface defaults to
relative ranking (within-faculty percentile heat) and the question-gap
drill uses **bottom-decile per faculty × question × semester** rather
than an absolute threshold like "< 4.0". The narrow heatmap palette
covers [3.5, 5.0] across the hue arc; anything < 3.5 saturates red.

## Anonymity (PDPA gate)

The connector applies `HAVING TOTAL_STUDENT >= 5` server-side in the
Oracle aggregation. **Cells with fewer than 5 respondents never reach
our DB.** At threshold 5, ~69% of source cells are kept (986K of 1.43M);
the 31% suppressed are mostly thesis advising, independent studies, and
graduate seminars (n=1–4). Documented in
`docs/data-sources/kku-evaluations.md` §PDPA posture.

## Team-teaching caveat

The registrar replicates each `(class × question)` score once per
instructor who taught the section. The score itself is **class-level**
(students rated the *class experience*), not per-instructor — every
co-teacher gets credited (or blamed) with the same rating.

| Team size | Groups | Share |
|---|---|---|
| 1 instructor | 427K | 62.8% |
| 2 instructors | 132K | 19.4% |
| 3-5 instructors | 84K | 12.4% |
| 6+ instructors | 37K | 5.4% |

UI surfaces this caveat explicitly. **Do not use per-instructor scores
for tenure / promotion decisions** without weighing this carefully.

## Question catalog

40 distinct registrar QIDs across 4 stability tiers (per Phase 0
discovery):

| Tier | Count | (year,sem) presence |
|---|---|---|
| Core | 10 (QIDs 01–10) | 21 of 21 buckets — every semester |
| Extended | 15 (QIDs 11–25) | 20 of 21 buckets |
| Recent | 4 (QIDs 26–29) | 5–11 buckets — rolled out last 2-3 sems |
| Specialised | 11 (QIDs 30–40) | 5 buckets — rubric items + English-skills set |

**Question text drift** — same QID can carry slightly different prompts
across versions (registrar's data-quality issue; e.g., QIDs 20/21/22
share identical text; QID 26 shares wording with QID 25). Drift is
detected via `EvaluationQuestion.questionTextHash` (16-char SHA-256 of
whitespace-normalised TH text); each new version lands as a separate
row keyed on `(questionIdRegistrar, questionTextHash)`. Roll-up queries
**group by `questionIdRegistrar`** for trend continuity, with the drift
flagged in the provenance drawer.

## English translations

The registrar does not ship English questionnaire text. The
`evaluation-question-translate.v1` AI prompt translates the 40 questions
into English in one call (~$0.02). Output lands in
`EvaluationQuestion.questionTextEn` with a `(EN — AI translation, pending
review)` UI watermark. DEAN / ADMIN can override per row via
`questionTextEnOverride`, which the UI prefers when present.

Re-run via `pnpm evaluations:translate-questions` (or `--force` to
re-translate everything; preserves DEAN overrides).

## "Find gaps" definition

A **gap** is a `(course × question × semester)` cell where the rating
falls into the **bottom decile of its peer set**. Peer set = `(faculty,
question, semester)`. The 10th-percentile threshold is computed
per-peer-set so a "gap" means scoring worse than 90% of comparable
cells — not a raw threshold like "< 4.0" which would mark very few
cells given the ceiling bias.

The Question-gap UI on `/education/satisfaction` ranks questions by:
1. Count of gap-cells (desc) — questions that produced many bottom-decile cells
2. Average rating across all cells (asc) — tiebreaker

The drill on each gap question lists the 5 lowest-rated sample courses.

## Aggregation rules

All rollups use **respondent-weighted mean rating** rather than naïve
average over cells:

```
weighted_rating = Σ(rating_avg × respondent_count) / Σ(respondent_count)
```

This gives a class of 200 students with rating 4.2 ten times the weight
of a class of 20 with rating 4.6. Aligns with the "this is a measure of
student experience" reading of the data.

## Where this methodology feeds into other scorers

- **`health-score.v3.7`** (2026-05-19) — outcomes dimension's new
  `student_satisfaction` driver pulls the scope's weighted-mean
  rating from `evaluation_response_summaries`, joined through
  `program_courses` → `programs` at faculty/dept/uni rollups. The
  driver normalises 1-5 likert into 0-100 via anchored linear
  `[3.5, 5.0] → [0, 100]` — a narrow band that captures meaningful
  differentiation given the ceiling bias documented in §"Score scale".
  See `docs/methodologies/health-score.md` §Outcomes for the formula.

## What this methodology does NOT do (yet)

- **Per-instructor "individual teaching quality" score** — the team-
  teaching caveat makes this risky without further attribution work.
  Per-instructor scores on `/staff/teaching` are descriptive, not
  prescriptive.
- **Trend-based risk KRI** — a "persistent low evaluation" trigger
  would be a natural addition to `risk-management.v1`, but needs new
  thresholds + Council sign-off. Deferred.
- **AI-generated narrative summary** — the dashboard reads the numbers
  cleanly enough; a Council-facing Thai narrative would be a nice
  follow-up but not blocking.

## Versioning policy

Bump `kku-evaluations.v1` → `v2` when:
- The aggregation rule changes (e.g., switch to median, or unweighted)
- The PDPA threshold changes (e.g., raise n from 5 to 10)
- The "gap" definition changes (e.g., bottom-quintile instead of decile)
- The visibility model changes

The old `methodologyVersion` stays stamped on existing rows so audit
queries can distinguish.

## Open data-quality items

- **7,823 unresolved CLASSIDs** — older registrar classes that pre-date
  our `ClassOffering` ingestion. Re-running the class-offerings linker
  with a wider year window would close most of these.
- **444 unresolved KKUMAILs** — external lecturers + retired faculty +
  HCM-not-yet-ingested. Worklist surfaced in `IngestionRun.metadata.
  unresolvedFacultyMembers`.

## Session log

- **2026-05-19** — v1 shipped end-to-end (Phase 0 through Phase 5).
  986,052 cells loaded from 5 years of data; 40 questions translated
  via AI; both dashboards live; methodology doc shipped.
