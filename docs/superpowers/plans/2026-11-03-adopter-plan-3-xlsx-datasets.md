# Adopter Plan 3 — Spreadsheet datasets for the remaining institution data

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An adopting university can fill the deep-dive's student-satisfaction, digital-competency, grant-award, employer-feedback and salary-by-funding inputs from spreadsheets, uploaded at `/admin/data-setup`, with no KKU connector.

**Architecture:** Eight new datasets in the existing declaration-driven import framework (`packages/db/src/import/`). Each writes the table the readers already use, so no reader query changes except three hard-coded source-slug checks that must also accept the new `xlsx-*` sources. Registrar-only NOT NULL columns are filled with documented sentinels; only `employer_feedback` gains a column (`ingestion_run_id`), because it has no way to tell imported rows apart today.

**Tech Stack:** TypeScript strict, Prisma, hand-written SQL migration, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-adopter-ready-deep-dive-design.md` (§7.2, D5). Plans 1–2 are done. Framework docs: `docs/data-import.md`; reader map from planning recon is summarised in each task.

## Global Constraints

- Follow the framework exactly (`packages/db/src/import/types.ts`, `registry.ts`, `datasets/*.ts`): one declaration + one `xlsx-<slug>` catalogue entry (`packages/shared/src/ingestion/catalog.ts`, shape of `xlsx-programme-courses`: `kind: 'CSV'`, `inputFormat: 'XLSX'`, `scheduleEnabled: false`, `mocked: false`, `ownerContact: 'Institution administrator'`) per dataset; `import-registry.test.ts` must stay green both directions.
- Every loader stamps `ctx.ingestionRunId` on every row it writes; every `clear(tx, runIds)` deletes only rows whose `ingestionRunId` is in `runIds` — never by programme or faculty — so KKU connector rows in the same tables are never touched.
- No person-level personal data in any sheet: no names, no citizen ids, no instructor identity. People appear only as employee codes (grant team). Headcount/respondent/sample-size columns carry `groupSizeFor: { minimum: 5 }`.
- Years in sheets are Common Era; tables that store Buddhist Era (`acadYearBE`, `cohortYearBe`, `fiscalYearBe`, `staff_compensation_cube.fiscal_year`) convert with the existing `toBuddhistEra` helper, and the guide sheet says so. A Buddhist-era year typed into a CE column is refused (reuse the existing year `check` used by other datasets).
- Rates and scores: refuse values outside the stated scale, naming the scale (e.g. a 0–1 fraction typed as 87 is refused with "write 0.87, not 87").
- Dataset slugs and sheet titles, exact: `course-evaluations` ("Course Evaluations"), `digital-competency-cohorts` ("Digital Competency — Cohorts"), `digital-competency-modules` ("Digital Competency — Modules"), `external-grants` ("External Grants"), `external-grant-team` ("External Grant Team"), `employer-feedback` ("Employer Feedback"), `staff-salary-by-funding` ("Staff Salary by Funding").
- Registry order: after `programme-courses` for evaluations; DQ cohorts then modules after `student-cohorts`; grants then team after `program-faculty`; employer feedback after `graduate-outcomes`; salary after `faculty-compensation`. `dependents`/`references` declared accordingly.
- KKU's readers and connectors keep working unchanged on a KKU install.
- DB-backed tests run only on the scratch DB `program_landscape_adopter_test` through `on-scratch-db.cjs` (see implementer rules). Never the owner's dev DB.
- Docs: each task adds its dataset(s) to `docs/data-import.md` (columns, units, year era, floor, what it feeds on the deep-dive). `pnpm docs:build` passes.

## Review Focus

1. **Start-over on an install that also has KKU connector rows** in the same table (KKU itself, if it ever uses a dataset): clear removes only the import's rows → each task's `clear only deletes this dataset's runs` test with a pre-existing row stamped by another run.
2. **A course code written differently from the course list** (`MEE 221` vs `MEE221`): evaluations must match through `normaliseCourseCode`, or the driver silently reads nothing → Task 1 test.
3. **Programme-scoped replace on DQ**: re-uploading one programme replaces that programme's imported rows only, not other programmes and not `kku-dq` rows → Task 2 test.
4. **Grant team row with an employee code not in the staff dataset**: refused naming the row (a silently unresolved member loses the award) → Task 3 test.
5. **Salary in annual baht typed into a monthly column**: values above a plausible monthly ceiling refused with the unit named → Task 5 test (ceiling: 500,000 THB/month).

---

### Task 1: Course evaluations → `student_satisfaction`

**Files:**
- Create: `packages/db/src/import/datasets/course-evaluations.ts`
- Modify: `packages/db/src/import/datasets/class-offerings.ts` (export `synthesiseClassId` if not already exported; it is at ~line 57), `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`, `docs/data-import.md`
- Test: `packages/db/test/import-datasets-course-evaluations.test.ts`

**Interfaces:**
- Writes `evaluation_response_summaries` (reader: `studentSatisfactionDriver`, `packages/db/src/health-score.ts:~1852`: joins `program_courses` on normalised `course_code`, weights `rating_avg` by `respondent_count`, semesters 1–2, `ds.mocked = false`).
- Sheet columns: `Course Code` (required; identity via `normaliseCourseCode`), `Academic Year` (CE, required → `acadYearBE`), `Semester` (1, 2 or 3; required), `Section` (optional integer, default 0), `Average Rating` (required, 1.000–5.000, stated as "mean of a 1–5 scale"), `Respondents` (required, `groupSizeFor` ≥ 5), `Faculty Code` (optional → `facultyId`; the satisfaction dashboard needs it), `Course Name (Thai)` / `Course Name (English)` (optional).
- Sentinels for registrar-only NOT NULL columns, exact: `facultyRegistryId = 0`, `officerIdRegistrar = 0`, `campusId = 0`, `questionIdRegistrar = 'OVERALL'`, `courseCodeRaw = <the cell as typed>`, `classIdRegistrar = synthesiseClassId(year, semester, normalisedCode, section)`; `questionId`, `classOfferingId`, `facultyMemberId`, `kkumailRaw` null; `methodologyVersion` `'xlsx-import.v1'`.
- Strategy: `upsert`, match `manual` on (Academic Year, Semester, Course Code, Section) — or `unique` on the natural key if the synthesised class id makes it equivalent; implementer's choice, stated in the report.
- Guide note: load the programme course lists first; a course not on any programme's list counts for nothing.

- [ ] **Step 1: Write the failing tests** — `refuses a rating outside 1–5`; `refuses fewer than 5 respondents without quoting the rating`; `refuses a Buddhist-era year`; `matches MEE 221 and MEE221 as one course` (two rows → duplicate-key validation error naming both rows); `load writes sentinels and stamps the run` (scratch DB: insert, read back `questionIdRegistrar === 'OVERALL'`, `classIdRegistrar > 2n**62n`, `acadYearBE === 2568` for CE 2025); `clear only deletes this dataset's runs` (a row stamped by another run survives); `student_satisfaction reads an imported row` (scratch DB fixture programme + programme course + evaluation → driver value not null).
- [ ] **Step 2: Run** the pure tests directly and the DB tests through the wrapper → FAIL.
- [ ] **Step 3: Implement** the declaration, catalogue entry, registry entry, docs section.
- [ ] **Step 4: Run** → PASS; `import-registry.test.ts`, `import-cascade-coverage.test.ts` (wrapper) → PASS; `pnpm --filter @kku/db typecheck` clean.
- [ ] **Step 5: Commit** `feat(import): course evaluations dataset feeds student satisfaction`.

### Task 2: Digital competency — cohorts and modules

**Files:**
- Create: `packages/db/src/import/datasets/digital-competency.ts` (both declarations)
- Modify: `packages/db/src/student-dq.ts` (`latestDqRun` ~895-943 and the `kku-dq` slug constant ~29: accept `kku-dq`, `xlsx-digital-competency-cohorts`, `xlsx-digital-competency-modules`), registry, catalogue, `docs/data-import.md`; deep-dive empty state text that plan 2 set to "digital competency results" → name both new dataset titles.
- Test: `packages/db/test/import-datasets-digital-competency.test.ts`

**Interfaces:**
- Readers: `dqCompetencyByScope` (`student-dq.ts:~808`) needs BOTH `dq_module_cube` (THEORY modules 1–12 for the mean; `SUM(score_sum)/SUM(taken_count)`) and `dq_student_cube` (`students_with_scores` headcount; floor `DQ_MIN_CELL_STUDENTS = 6`); deep-dive pass rate = `studentsAllPassed / studentsWithScores`; bachelor programmes only.
- Cohorts sheet: `Programme Code`, `Entry Year` (CE → `cohortYearBe`), `Students Tested`, `Students With Scores`, `Students Passing All Modules` (all required integers; with-scores ≤ tested; passing ≤ with-scores; `groupSizeFor` ≥ 5 on Students Tested). Loader derives `programId`, `facultyId`, `facultyName` (faculty `nameTh`), `programName` (programme `nameTh`).
- Modules sheet: `Programme Code`, `Entry Year`, `Module` (integer 1–13; the guide lists the 13 module names from `DQ_MODULES` in `packages/shared/src/dq/modules.ts`, module 13 = practical, excluded from the headline mean), `Students Taking`, `Mean Score (0–100)`, `Students In Scope`. Loader: `moduleKey` per `DQ_MODULES`, `moduleKind` from `DQ_MODULES` (THEORY for 1–12), `takenCount`, `scoreSum = mean × taking`, `studentsInScope`.
- Strategy: `programme-scoped` for both (no unique key on either cube); the replace deletes only rows whose `ingestionRunId` belongs to that dataset's own source, for the programmes in the file. Modules `references` cohorts? No — independent; both reference programmes.
- Guide note: the 13 modules are the DQ framework's; a different test must be mapped onto these axes or the radar will be sparse.

- [ ] **Step 1: Write the failing tests** — validation (passing > with-scores refused; module 14 refused; mean 101 refused; BE year refused); `programme-scoped replace leaves other programmes and kku-dq rows alone` (scratch DB: a `kku-dq`-stamped row and another programme's imported row survive a re-upload); `latestDqRun sees the import`; `dq_digital_competency reads imported cubes` (≥ 6 scored students → value not null; 5 → null via floor).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** + registry/cascade tests → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(import): digital competency cohort and module datasets`.

### Task 3: External grants — projects and team → grant award

**Files:**
- Create: `packages/db/src/import/datasets/external-grants.ts` (both declarations)
- Modify: `packages/db/src/grant-award.ts` (`GRANTS_SOURCE` ~18 and `loadGrantSourceSynced` ~79: accept a list — `kku-research-services`, `xlsx-external-grants`), `packages/db/src/research-services.ts` (`GRANTS_SOURCE_SLUG` ~18 and `grantsFreshness` ~235: same list; freshness = latest success of any), registry, catalogue, `docs/data-import.md`
- Test: `packages/db/test/import-datasets-external-grants.test.ts`

**Interfaces:**
- Reader: `grantAward` (`grant-award.ts:~97`): projects with `fiscalYearBe` in the last 3 complete Thai fiscal years, any member with `facultyMemberId` in the programme's active teaching staff, `budgetThb` summed once per project; `realDataWhere()` on project and member.
- Projects sheet: `Project Code` (required, unique within the file), `Title (Thai)` (required), `Title (English)`, `Type` (Research / Academic service / Consulting / Other → enum), `Fiscal Year` (CE; Thai fiscal year that starts 1 October of the previous calendar year; → `fiscalYearBe`), `Budget (THB)` (whole project, optional), `Funder`, `Lead Faculty Code` (required → `facultyId`, `leadFacultyName`, `leadUnitName` = faculty `nameTh`).
- Loader: `id = 'rsp-xlsx-' + code`; `sourceProposalKey = 'xlsx:' + code`; `sourceProposalId` = next value below the current minimum negative id (start at -1), allocated once per new row, kept on update (KKU's ids are positive, so no collision; same idea as the canonical sequence number in `programmes.ts`); `typeRaw` = the cell; `workflowStatus = 'IMPORTED'`.
- Team sheet: `Project Code` (must exist in projects — imported or already stored), `Employee Code` (must resolve to a `FacultyMember.employeeCode`; refused otherwise, naming the row), `Role` (Lead / Co-investigator). `facultyMemberId` resolved; `displayName`, `sourcePersonKey`, `citizenIdHash` null; `facultyId` from the member.
- Strategies: projects `upsert` on Project Code; team `upsert` manual on (Project Code, Employee Code). Team `references` projects and faculty-members; projects `dependents` include team. `clear`: team rows by run, then project rows by run (members of a cleared project cascade).

- [ ] **Step 1: Write the failing tests** — `refuses an unknown employee code naming the row`; `refuses a team row for an unknown project`; `sourceProposalId is negative and stable across re-upload`; `grant award counts an imported project` (scratch DB: staff + programme-faculty + project + team in window → award not null; `source-not-synced` no longer returned); `clear only deletes this dataset's runs`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** + registry/cascade → PASS; typecheck `@kku/db`, `api`.
- [ ] **Step 5: Commit** `feat(import): external grants datasets feed the grant award`.

### Task 4: Employer feedback

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`EmployerFeedback.ingestionRunId String? @map("ingestion_run_id")`, relation to `IngestionRun` with `onDelete: SetNull`, `@@index([ingestionRunId])`)
- Create: `packages/db/prisma/migrations/20261103130000_employer_feedback_run/migration.sql` (additive)
- Create: `packages/db/src/import/datasets/employer-feedback.ts`
- Modify: `packages/db/src/program-deep-dive.ts:~3613-3650` (`programOutcomes` employer query adds `...realDataWhere()` — the table has no writer today, so no legacy rows are hidden), registry, catalogue, `docs/data-import.md`
- Test: `packages/db/test/import-datasets-employer-feedback.test.ts`

**Interfaces:**
- Reader shows `topEmployers: { name, year, satisfactionScore }` and the UI renders `satisfactionScore × 100 %` — so the stored score is a 0–1 fraction.
- Sheet: `Programme Code`, `Survey Year` (CE; stored as `year`), `Employer` (optional; blank → `'All employers'`), `Satisfaction (0–1)` (required; >1 refused: "write 0.87, not 87"), `Respondents` (required, `groupSizeFor` ≥ 5). Loader writes `skillGapsJson = []`, `freshnessDate` = upload date.
- Strategy: `programme-scoped` (a programme in the file has its imported rows replaced).

- [ ] **Step 1: Write the failing tests** — `refuses 87 with the fraction hint`; `blank employer becomes All employers`; `programOutcomes shows an imported row and hides an unstamped one`; `clear only deletes this dataset's runs`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `pnpm db:generate`; apply the migration on the scratch DB through the wrapper (`pnpm db:migrate`). **Step 4: Run** + registry/cascade → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(import): employer feedback dataset`.

### Task 5: Staff salary by funding

**Files:**
- Create: `packages/db/src/import/datasets/staff-salary-by-funding.ts`
- Modify: registry, catalogue, `docs/data-import.md`; `apps/web/app/programs/[id]/client.tsx` salary card copy (~2520-2540) so it names this dataset ("Staff Salary by Funding" spreadsheet or the HR connector), not "Compensation".
- Test: `packages/db/test/import-datasets-staff-salary-by-funding.test.ts`

**Interfaces:**
- Writes `staff_compensation_cube` (reader `programFacultySalaryByFunding`, `program-deep-dive.ts:~2840`: latest `fiscalYear` (Buddhist era), `isAcademic = true`, `level` matched to the member's rank by Thai prefix via `RANK_TO_LEVEL_PREFIXES` ~2792, `meanSalary` is MONTHLY, `salType` = funding source).
- Sheet: `Faculty Code` (required), `Rank` (Lecturer / Assistant Professor / Associate Professor / Professor — same labels as the `faculty-compensation` dataset), `Funding Source` (required free text, e.g. "Government budget", "University revenue"), `Fiscal Year` (CE → BE), `Headcount` (`groupSizeFor` ≥ 5), `Mean Monthly Salary (THB)`, `Min Monthly Salary (THB)`, `Max Monthly Salary (THB)` (all required; min ≤ mean ≤ max; any value > 500,000 refused: "monthly, not annual").
- Loader: `isAcademic = true`; `facultyId`, `facultyName` = faculty `nameTh`; `level` = exact prefix string per rank: Professor `'ศ.'`, Associate Professor `'รศ.'`, Assistant Professor `'ผศ.'`, Lecturer `'อ.'`; `sumSalary = mean × headcount`; `fiscalYear` BE.
- Strategy: `upsert`, match `manual` on (Fiscal Year, Faculty Code, Rank, Funding Source).

- [ ] **Step 1: Write the failing tests** — `refuses an annual figure in a monthly column`; `refuses headcount below 5 without quoting salaries`; `level prefix matches levelMatchesRank for every rank` (pure, import the matcher or its prefixes); `programFacultySalaryByFunding reads an imported row` (scratch DB: staff + programme-faculty + enrolment + cube row → non-null annual cost); `clear only deletes this dataset's runs`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** + registry/cascade + `pnpm --filter web test` (copy change) → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(import): staff salary by funding dataset feeds the salary card`.
