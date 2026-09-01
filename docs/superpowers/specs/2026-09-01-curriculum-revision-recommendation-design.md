# Research-informed curriculum revision — design

**Date:** 2026-09-01
**Status:** approved for planning
**Surface:** new "Curriculum revision" section in Program Deep-Dive (`/programs/[id]`), below the existing research-expertise section

## Goal

Turn a programme's faculty research strength into **specific, course-level curriculum
advice** a department could act on at its next revision: which named course to extend and
with what, which course to create where a research strength has no home, and which
elective deserves promotion to required.

## What ships today, and why it isn't enough

The Deep-Dive research section already has a `recommendations.curriculum` lane
(`program-research-expertise.v3`). This is its real output for KKU-SEQ-0030
(ศิลปศาสตรบัณฑิต ภาษาตะวันออก), read from the database on 2026-09-01:

> **action:** "Integrate structured intercultural buddy training modules into the existing
> study-abroad preparation curriculum."
> **rationale:** "Aligns curriculum with documented research in student intercultural
> sensitivity development during international programs."

It names no course code, cites nothing about what any course currently teaches, and points
at "the existing study-abroad preparation curriculum" — a course nobody can look up. A
department head cannot act on it.

The gap is not that recommendations are missing. It is that they are **programme-level and
ungrounded** when the data to make them course-level and grounded already exists.

## Data availability — measured, not assumed

Queried against the dev database on 2026-09-01:

| Fact | Count |
|---|---|
| Canonical programmes | 301 |
| Programmes with a research-expertise analysis | 251 |
| Programmes with an extracted course list (`ProgramCourse`) | 285 |
| **Programmes with both research analysis and courses** | **251** |
| Digest courses carrying a real Thai `descriptionTh` | **2,400 of 2,400** |

Every extracted course carries its full คำอธิบายรายวิชา *and* `learningOutcomesTh`. That is
the substrate this feature needs, and it is already on disk. Nothing has to be extracted
first for three of the four output lanes.

## Two components

Component A unlocks one lane. Component B is the feature. **B does not block on A** — its
other three lanes ship regardless, and the promotion lane renders only where category data
exists.

---

## Component A — Course category

### The problem

**No core/elective signal exists anywhere in the system.** Verified by reading both course
extractors' schemas:

- `ProgramCourseExtractionSchema` (inside `program-digest`): `code`, `nameTh`, `nameEn`,
  `credits`, `descriptionTh`, `learningOutcomesTh`.
- `CourseSchema` (inside `program-courses-extract`): `code`, `nameTh`, `nameEn`, `credits`.
- `ProgramCourse` table: no category column.
- `Course.type` (`CourseType` enum: CORE / ELECTIVE / GENERAL) exists but has **zero rows
  behind it** — `Course` is empty in any real deployment.

The หมวด structure *is* present in the source PDFs. `program-courses-extract` even slices
the exact รายวิชา section where those headers live — its own code comment describes the
section as "organised into the 3 หมวด (ศึกษาทั่วไป / เฉพาะ / เลือกเสรี)". The schema simply
discards them.

### The fix

Bump `program-courses-extract` **v1 → v2**, adding a `category` per course, and re-run for
the 285 programmes with a course list.

Categories — richer than the existing three-value `CourseType`, because promotion depends
on the บังคับ-vs-เลือก distinction *within* หมวดวิชาเฉพาะ, which `CourseType` cannot express:

| Value | Thai | Note |
|---|---|---|
| `GENERAL_EDUCATION` | หมวดวิชาศึกษาทั่วไป | |
| `CORE` | วิชาแกน / วิชาพื้นฐาน | |
| `MAJOR_REQUIRED` | วิชาเฉพาะบังคับ | promotion **target** |
| `MAJOR_ELECTIVE` | วิชาเฉพาะเลือก | promotion **source** |
| `FREE_ELECTIVE` | หมวดวิชาเลือกเสรี | |
| `THESIS_PROJECT` | วิทยานิพนธ์ / การศึกษาอิสระ / โครงงาน | load-bearing for graduate programmes |
| `UNKNOWN` | — | the model could not place it; renders as "category unknown", never guessed |

`UNKNOWN` is a first-class value, not a failure. A course the extractor cannot place must
say so rather than be defaulted into a category — a wrong category would produce a
confidently wrong promotion recommendation.

### Persistence

Additive migration: `category` column on `ProgramCourse` (nullable — rows extracted by v1
have no category and must stay valid). The existing materialiser
(`apps/ingestion/src/scripts/materialise-program-courses.ts`) carries it through.

Its per-programme delete-and-replace is already transactional, so re-running is safe. Rows
whose programme has only a v1 extraction keep `category = NULL` until re-run.

### Cost

`program-courses-extract` measured over 38 real calls: **$0.178/call, 91,609 input tokens
average** (it consumes the whole รายวิชา section). 285 programmes ≈ **$51**.

This is 4–6× the cost of the feature it supports, and was chosen deliberately over a free
deterministic header-scan because Thai PDF layouts vary enough that a heuristic would leave
coverage gaps in exactly the graduate programmes where the distinction matters most.

---

## Component B — The curriculum-revision recommendation

### New prompt: `program-curriculum-revision.v1`

**Input channels:**

- **Programme meta** — code, nameTh/nameEn, level, faculty, `totalCredits`, `durationYears`.
- **Course list** — every `ProgramCourse` for the programme: `courseCode`, names, `credits`,
  `category` (when Component A has run), plus `descriptionTh` and `learningOutcomesTh`
  recovered from the programme's latest approved `PROGRAM_DIGEST` payload by exact
  normalised-code match. *(That match is deterministic, not fuzzy: `ProgramCourse.courseCode`
  is itself produced by normalising a digest entry's code with `normaliseCourseCode()`, so
  the two agree by construction.)*
- **Research themes** — from the latest `ProgramResearchExpertise` payload: theme name,
  `paperCount`, example paper titles, `yearSpan`, `trend`, `evidenceNote`.
- **Faculty roster** — name, rank, specialisation, for the "who could teach it" field on new
  course proposals.
- **Current `ProgramSkill` names** — what the programme already claims to build.

**Deliberately omitted:** labour-market demand (that is the Gap Analyzer's job; mixing it in
here would blur "what our researchers know" with "what employers want" — two different
arguments a Council needs to weigh separately), and peer-institution curricula (Benchmarking
module's job).

**Output shape:**

```
coverageSummary: {
  themesTotal, themesReflectedInCurriculum,
  themesAbsent: string[],              // theme names with no course home at all
  narrative: string,                   // 2-4 sentences
}
enhanceCourses: [{                     // the core lane
  courseCode, courseNameTh,
  currentlyCoversQuote,                // VERBATIM from that course's descriptionTh
  themeRefs: string[],
  addition, additionDetail,            // concrete: a topic / module / revised CLO
  effort: 'MINOR' | 'MODERATE' | 'MAJOR',
  evidencePaperTitles: string[],
}]
newCourseProposals: [{
  titleTh, titleEn, credits,
  placementYear, placementSemester,
  themeRefs: string[], rationale,
  couldBeTaughtBy: [{ name, rank }],
  evidencePaperTitles: string[],
}]
promotionCandidates: [{                // empty when category data is absent
  courseCode, courseNameTh,
  currentCategory, proposedCategory,
  themeRefs: string[], rationale,
}]
confidence: number
caveats: string[]
```

**Prompt-standard conformance is mandatory from the first commit.** A ratchet test
(`packages/shared/test/prompt-standard-conformance.test.ts`) asserts every non-allowlisted
prompt file carries a CHANNEL MANIFEST, the verbatim CONFIDENCE RUBRIC, an explicit English
output rule, and the BANNED PHRASES block — and its allowlist "never" accepts new entries.
Thai survives only in data-label and verbatim-quote fields (`courseNameTh`, `titleTh`,
`currentlyCoversQuote`), which is the standard's existing exemption.

### Anti-fabrication gate — enforced in code, not requested of the model

After parsing and before persisting:

- Any `enhanceCourses[]` or `promotionCandidates[]` entry whose `courseCode` is **not in that
  programme's real course list** is **dropped**, and the count is recorded.
- Any `themeRefs` entry not present in the input themes is **dropped**; an item left with
  zero valid theme refs is dropped entirely.
- `currentlyCoversQuote` must be a substring of that course's real `descriptionTh` (after
  whitespace normalisation); if not, the field is blanked rather than the item dropped — the
  recommendation may still be sound even if the model paraphrased its quote.

Drop counts land in the stored input-stats snapshot. A nonzero drop rate is a prompt-quality
signal worth watching, not something to hide.

This matters because the whole value of the feature is that a reader can look up the course
it names. A recommendation citing a course that doesn't exist is worse than no recommendation.

### Readiness gating and confidence discipline

Mirrors `packages/db/src/program-research-expertise-run.ts`, which already solves this
problem well.

**Readiness — computed before any AI call:**

| Readiness | Condition | Behaviour |
|---|---|---|
| `no-research` | no `ProgramResearchExpertise` row for the programme | **SKIPPED, zero AI calls** |
| `no-courses` | no `ProgramCourse` rows for the programme | **SKIPPED, zero AI calls** |
| `thin` | underlying research is `thin` — fewer than 10 distinct papers in the 10-year window (`THIN_PAPER_THRESHOLD`, `packages/db/src/program-research-expertise.ts:74`) | generated, confidence **ceiled** |
| `ok` | otherwise | generated |

Short-circuiting before the model is the established pattern — spending a call to conclude
"there was nothing to analyse" is waste, and it keeps `AiInference` free of empty analyses.

**Confidence ceiling — reuse the existing scale, do not invent a parallel one.** The
recommendation rests on exactly the same publication evidence the research section already
grades, so it reuses `researchExpertiseConfidenceCeiling(readiness, totalDistinct)` from
`@kku/shared` unchanged:

| Readiness / evidence | Ceiling |
|---|---|
| `thin` (< 10 papers) | 0.49 |
| `ok`, 10–49 papers | 0.69 |
| `ok`, 50–149 papers | 0.89 |
| `ok`, ≥ 150 papers | 1.00 |

Inventing a second scale here would let one Deep-Dive page show a confident curriculum
recommendation directly beneath a low-confidence research analysis built from *identical*
evidence — a contradiction a Council member would rightly not trust. The sampled programme's
themes carry one paper each, so it lands at the 0.49 ceiling. The clamp is logged
(`confidenceClamped`) exactly as the research-expertise runner does.

**Banned-tell lint retry** via the existing `lintBannedTells` → one corrective retry, same as
the research-expertise runner.

### Persistence

New table `ProgramCurriculumRevision`, mirroring `ProgramResearchExpertise` field for field:

```
id, programId, payloadJson, inputStatsJson, methodVersion,
aiInferenceId, generatedAt          @@index([programId, generatedAt])
```

**Insert-only** — history accretes; readers take the latest by `generatedAt`. Same posture as
`ProgramResearchExpertise`, so a methodology bump leaves prior output auditable rather than
overwriting it.

### Generation

- Runner `generateProgramCurriculumRevision()` in `packages/db`, structurally mirroring
  `generateProgramResearchExpertise()`.
- Bulk script `pnpm curriculum:revision-generate [--program <code>] [--limit N]`, mirroring
  `generate-research-expertise.ts`: sequential, per-programme try/catch, JSONL audit log,
  summary bucketed by readiness.
- `POST /programs/:id/curriculum-revision` regenerate action, `@AuditLog`-decorated, matching
  the existing narrative-regenerate endpoint.
- `GET /programs/:id/curriculum-revision` with `@Provenance` naming its sources and
  `methodologyVersion` **taken from the prompt constant, not a literal** — a hardcoded
  provenance literal has already bitten this controller once.

### UI

New `<CurriculumRevisionSection>` in `apps/web/app/programs/[id]/client.tsx`, below the
existing research-expertise section. The existing three-lane strip (Curriculum / Positioning
/ Research strategy) is **left untouched** as the programme-level summary it already is.

Layout: coverage summary as a headline card → "Enhance existing courses" list (course code +
Thai title, the verbatim quote of what it covers today, the proposed addition, effort chip,
theme badges, expandable paper evidence) → "New course proposals" → "Promotion candidates"
(hidden entirely when empty). `<ProvenanceButton>`, `<ConfidenceBadge>` and `<FreshnessBadge>`
per the council-readiness rules.

**Three distinct empty states**, following the precedent already set by the research section
(which distinguishes `no-roster` / `thin` / `not-yet-generated` because they read
differently to a Council member):

- `no-research` — "This programme has no research analysis yet" + how to generate one.
- `no-courses` — "No course list has been extracted for this programme."
- `not-yet-generated` — names the command that produces it.

**Framing:** a draft for a curriculum committee to edit, never a decision. The section states
that it reports where research strength and course content diverge — it does not assert that
a course is deficient.

## Cost

| Item | Calls | Unit | Total |
|---|---|---|---|
| Component A — category re-extraction | 285 | $0.178 (measured) | **~$51** |
| Component B — curriculum revision | 251 | ~$0.02–0.05 (comparable prompt measured at $0.020) | **~$8–13** |

**≈ $60–65.** One migration, one prompt bump, one new prompt, one new table, one new section.

## Verification

- `program-courses-extract` v2 populates `ProgramCourse.category` for the great majority of
  the 285 programmes; the `UNKNOWN` rate is reported and is a data-quality signal, not a
  silent default.
- `ProgramCurriculumRevision` rows exist for close to 251 programmes; `no-research` /
  `no-courses` skips account for the remainder and are reported separately from failures.
- **Anti-fabrication gate proves itself:** across the run, every persisted `courseCode`
  resolves to a real `ProgramCourse` row for that same programme. This is asserted by query
  after the bulk run, not assumed.
- Spot-read five programmes by hand: each `enhanceCourses` item names a course that exists,
  quotes something genuinely in its description, and proposes an addition traceable to a
  real paper title.
- The thin-evidence case behaves: a programme whose themes carry one paper each renders with
  a clamped confidence and a caveat, not confident prose.
- Re-running the bulk script adds new rows rather than mutating old ones (insert-only).

## Non-goals

- **Retire / consolidate recommendations.** Deliberately excluded. Naming courses as
  removable on research-volume grounds affects staff livelihoods, and research output is the
  wrong sole basis for that judgement.
- **Course-skill materialisation.** A separate, already-audited plan
  (`docs/superpowers/plans/2026-09-01-course-skill-materialisation.md`) exists and is
  deliberately **not** a prerequisite. It would make theme-to-curriculum gap detection a
  computed set operation rather than an AI judgement, and would align this feature with the
  Gap Analyzer's skill taxonomy — worth doing, but after this ships.
- **Labour-market or peer-institution input.** Belongs to the Gap Analyzer and Benchmarking
  modules respectively.
- **Editing the curriculum from this screen.** Output is advisory; there is no write-back
  into `ProgramCourse` or any curriculum record.
- **Replacing the existing programme-level curriculum lane.**
