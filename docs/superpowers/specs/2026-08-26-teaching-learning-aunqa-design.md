# Teaching & Learning analysis (AUN-QA v4) — design

**Date:** 2026-08-26
**Status:** approved for planning
**Surface:** new top-level menu `Teaching & Learning` — a faculty readiness overview and a per-programme analysis page

## Goal

Give each programme a deep, evidence-backed view of its teaching and learning
performance, organised along the AUN-QA v4 criteria, so the work of preparing for
accreditation starts from what the platform already knows rather than from a blank page.

The section is deliberately built to grow: today it draws on student evaluations, DQ
competency results, graduate outcomes, class GPA, staff data and curriculum extraction.
Adding a new data source later must be a **registry entry, not a rewrite**.

## A caveat that belongs at the top

**The eight criteria below come from the assistant's own knowledge of AUN-QA v4, not
from a document in this repository.** No AUN-QA guide exists in the codebase; the only
prior reference is a `framework: 'AUN_QA'` enum value in the `program-pedagogy` prompt.
For an accreditation-facing surface, this list must be checked against the official v4
guide before the section is shown to anyone preparing a submission.

The design accommodates that directly: the criteria and sub-criteria are **data in one
table**, not prose spread across components, so correcting a name, adding a sub-criterion
or re-ordering the set is an edit to that table and nothing else.

## What the platform can evidence today — measured

| # | Criterion | Evidence available | Coverage |
|---|---|---|---|
| 1 | Expected Learning Outcomes | `program_skills`, curriculum digests, evaluation themes *ethics*, *english-skills* | 281 / 301 programmes |
| 2 | Programme Structure & Content | `program_courses`, peer reviews (content modernity + gaps), theme *content-design* | 285 / 300 |
| 3 | Teaching & Learning Approach | `program_pedagogy_assessments`, theme *active-learning* | **13 — see below** |
| 4 | Student Assessment | themes *assessment*, *feedback*; class-GPA distributions | 123,329 class offerings |
| 5 | Academic Staff | ranks, student-faculty ratio, teaching workload, research output | 3,839 staff |
| 6 | Student Support Services | — | **none** |
| 7 | Facilities & Infrastructure | — | **none** |
| 8 | Output & Outcomes | graduate outcomes, DQ competency, alumni statuses, cohort progression | 239 / 81 / 11,804 |

Two things this table makes obvious.

**The evaluation instrument is already organised along these lines.** Its question themes
— `content-design` (9 questions), `active-learning` (8), `assessment` (4), `feedback` (4),
`ethics` (2), `english-skills` (8) — map almost one-to-one onto criteria 1–4. That is the
single strongest asset here, and it exists by accident of how the survey was written.

**Criterion 3 is thin by accident, not by nature.** `program_pedagogy_assessments` covers
13 programmes because `program-pedagogy` v1.0 imposed `min(5)` on method names and
rejected the 3–4-character acronyms real disciplines use — PBL, OSCE, EBM, Lab — which
knocked out most medical and science programmes. The fix shipped as v1.1; the bulk re-run
never happened. Re-running it is one AI batch and lifts criterion 3 to roughly 285
programmes.

## Criteria 6 and 7

Omitted from the body, per the operator's instruction not to display criteria with no
data. But the page states once, in a single line, that they are outside the platform's
data — a QA officer must not infer from a page showing six criteria that six is all there
are. Naming the gap is also the honest input to "what should we collect next".

## The evidence registry — the extensible core

One table in `@kku/shared`:

```ts
interface AunqaSubCriterion {
  id: string;              // '3.2'
  title: string;
  /** Declarative pointers to platform metrics. Adding a data source
   *  later means adding a binding here — not touching the page. */
  evidence: EvidenceBinding[];
}

type EvidenceBinding =
  | { kind: 'evaluation-theme'; theme: string }
  | { kind: 'dq-module-profile' }
  | { kind: 'dq-program-score' }
  | { kind: 'graduate-outcome'; field: 'employmentRate' | 'jobRelevance' | 'furtherStudy' | 'salary' }
  | { kind: 'class-gpa-distribution' }
  | { kind: 'staff-metric'; field: 'studentFacultyRatio' | 'rankMix' | 'workload' | 'research' }
  | { kind: 'curriculum'; field: 'courses' | 'skills' | 'credits' }
  | { kind: 'pedagogy-assessment'; field: 'disciplineFit' | 'qaSystem' | 'gaps' }
  | { kind: 'peer-review'; field: 'contentModernity' | 'contentGaps' };
```

A resolver turns a binding into `{ available: boolean; value: unknown; sourceLabel: string; freshness: Date | null }`
for a given programme. **A binding that resolves to unavailable is rendered as unavailable,
never as zero and never silently dropped** — the platform's standing rule, and doubly
important here because "we have no evidence for 3.2" is itself the finding a QA officer
needs.

## Readiness, not rating

Each criterion reports:
- the evidence itself — the actual figures, charted as they are elsewhere in the platform;
- **evidence completeness**: how many of its sub-criteria have any data ("4 of 6");
- a **readiness band** — *well evidenced* / *partly evidenced* / *no evidence*.

**No 1–7 AUN-QA rating is produced.** The assessors award ratings; a platform-generated
number would either be ignored or, worse, quoted back in a self-assessment report as
though it were an assessment. Completeness is a statement about *our data*, which the
platform can honestly make; a rating is a statement about *the programme*, which it cannot.

## AI self-assessment draft

Per criterion, on demand: a short paragraph a QA officer can edit into a self-assessment
report, grounded strictly in the figures rendered beside it.

- New prompt `aunqa-criterion-narrative`, conforming to `docs/prompt-standard.md`:
  English output, verbatim confidence rubric, banned-phrase lint, `// CHANNEL MANIFEST`
  naming every input, and an explicit instruction that a channel with no data is described
  as *not available* rather than inferred.
- Rendered with `<ConfidenceBadge>`, clickable sources, "show reasoning", and the existing
  disagreement capture — the platform's standing requirements for any AI output.
- Labelled unmistakably as **a draft to edit, not a submission**.
- Stored per `(programId, criterionId, methodVersion)` so a prompt-version bump shadows old
  drafts rather than overwriting them — the pattern already used by
  `program_pedagogy_assessments` and `user_expertise_narratives`.
- **Generated on demand per programme, never in bulk.** 301 programmes × 6 criteria is a
  cost with no reader; only programmes actually preparing for assessment need drafts.

## Surfaces

**`/teaching-learning`** — faculty readiness overview. A table of the faculty's programmes
against the six evidenced criteria, showing each programme's completeness, so a dean can
sequence which programmes to put forward. Scope-clamped like every other faculty-aware
dashboard: `FACULTY_USER` sees their own faculty, university-wide roles see all.

**`/teaching-learning/[programId]`** — the analysis. Criterion by criterion, in AUN-QA
order, each with its evidence rendered as it is elsewhere in the platform (evaluation
theme breakdowns, the DQ module radar, class-GPA distributions, staff ratios, graduate
outcomes), its completeness, and the on-demand narrative draft. Criteria with no evidence
for this programme are omitted, with the one-line note described above.

Both are new routes under a new top-level nav entry `Teaching & Learning`
(`apps/web/src/lib/app-nav.tsx`, the faculty-aware dashboards section beside Education and
Staff).

## Access

`institution:read:dashboard`, scope-clamped exactly as the sibling dashboards are. A
programme's own staff should be able to see their programme; that follows from the
existing programme-scope rules and needs no new access concept.

## Non-goals

- **No AUN-QA rating**, as above.
- **No submission document generation.** The section produces evidence and draft prose; a
  formatted SAR is a different deliverable and would need the official template.
- **No new data collection.** Criteria 6 and 7 need student-support and facilities data
  that does not exist in the platform; those are connectors, not analysis, and are out of
  scope here.
- **No change to any existing dashboard.** This section reads the same underlying data
  through the registry.

## Testing

- The registry: every criterion has at least one sub-criterion; every binding kind has a
  resolver; no binding references a metric that does not exist. A pure test, since the
  registry is data.
- Resolvers: an unavailable binding returns `available: false` and never a zero value; a
  programme with no data for a criterion yields completeness `0 of n`, not a crash.
- Readiness banding: boundaries between *well* / *partly* / *no evidence* pinned by test.
- The narrative prompt: conformance to the prompt standard (the existing ratchet test
  covers this automatically once the file lands).
- Live verification: pick a well-evidenced programme, a thin one, and one with no
  evaluation data, and confirm each renders the right criteria and the right completeness.

## Prerequisite

**Re-run `program-pedagogy` at v1.1 across all programmes with a curriculum PDF.** Task 1
of the plan. Without it criterion 3 has 13 programmes; with it, roughly 285. The schema
bug that caused the gap is already fixed — this is purely a regeneration.

## Deferred

- Correcting the criteria model against the official AUN-QA v4 guide (blocked on the
  document).
- Criteria 6 and 7, pending student-support and facilities data.
- A formatted self-assessment report export.
- Cross-programme comparison within a criterion ("how does our assessment practice compare
  with peer programmes") — valuable, but it needs the criteria model settled first.
