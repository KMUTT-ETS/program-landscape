# Institute XLSX import — Phase 3 (tier 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the remaining eight institution-specific datasets importable from a spreadsheet, and add the `term-scoped` strategy the framework has declared since Phase 1 but never implemented.

**Architecture:** Each dataset is one declaration in `packages/db/src/import/datasets/` plus one `xlsx-<slug>` catalogue entry, exactly as tier 1. Three things are new: the `term-scoped` strategy (delete-the-term, bulk-insert), the first real use of `ImportMatch.kind: 'manual'` (three datasets whose key has a nullable component or no constraint), and the first datasets that hang off `Faculty` rather than `Program`, which extends the start-over cascade guard to a second parent.

**Tech Stack:** TypeScript strict, Prisma, Vitest, pnpm workspaces. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-institute-xlsx-import-design.md` — §5.2 tier 2, §6.11 term-scoped, §7 privacy, §8.3 ResearchOutput matching.

**Prior plans:** `docs/superpowers/plans/2026-10-17-institute-xlsx-import-phase1-framework.md`, `docs/superpowers/plans/2026-10-18-institute-xlsx-import-phase2-metrics.md`. Read the Phase 2 plan's Task 2 before writing any declaration — every one here follows its shape.

## Global Constraints

- **Every year column in a template is Common Era.** `yearColumn()` (`packages/db/src/import/datasets/enrollment.ts`) enforces it and names the Buddhist era in the refusal. Two tier-2 tables store Buddhist era (`entryYearBE`, `acadYearBE`); the loader converts, the operator never sees BE. `docs/data-import.md` already publishes this rule.
- **`packages/db/src/import/` must never import `xlsx`.** A test enforces it; that package reaches `apps/web`.
- **An upload never re-attributes a row another source created.** Use `claimsRow` / `PROVENANCE_SELECT` from `packages/db/src/import/datasets/provenance.ts` in every loader's update branch.
- **A row stating no figures is skipped**, for datasets that pre-fill. `validateSheet` handles it; declarations do nothing.
- **Unknown columns are an error**, and no error message ever echoes a cell value that tripped a privacy rule (§7).
- **No raw national-ID column exists in any template.** Where a table stores a hashed identifier, the template offers the adopter's own employee code instead (§7.4).
- **Explicit return types on every exported function** — `declaration: true` is on in `tsconfig.base.json`.
- Dataset slug == raw-view slug. A dataset whose `/admin/data-setup/raw/<slug>` page does not exist is unreachable; Phase 1 shipped that way once.

## Review Focus

1. **A compensation row covering fewer than five people.** `groupSizeFor` has never run against a real declaration. The file must fail, naming the rows, without quoting salary figures (§7.2). Task 4.
2. **A class-offerings file carrying two terms.** Term-scoped loading deletes the term the file declares; a file mixing 2024/1 and 2024/2 would delete one term and insert both. Validation must refuse it and name the rows that disagree. Task 8.
3. **A synthesised `classId` colliding** — either with another row in the same file, or with a real Oracle id on a KKU installation. Task 8.
4. **Start-over on faculties after staff exist.** Three tier-2 datasets cascade from `Faculty`, which until now only blocked on departments and programmes. Clearing faculties must refuse rather than silently delete the staff roster. Task 3.
5. **A research output matching the wrong person.** The `manual` fallback matches on `(title, year, facultyMemberId)`; two staff with a paper of the same title and year must not collapse onto one row. Task 6.

---

### Task 1: The `term-scoped` strategy

**Files:**
- Modify: `packages/db/src/import/validate.ts`
- Test: `packages/db/test/import-validate.test.ts`

**Interfaces:**
- Consumes: `ImportStrategy`'s existing `{ kind: 'term-scoped'; termColumns; match }` variant (`packages/db/src/import/types.ts`), unchanged.
- Produces: `validateSheet` returns a non-null `term` for a term-scoped dataset — `Readonly<Record<string, ImportCellValue>>` keyed by `termColumns` — and refuses a sheet whose rows disagree.

`validateSheet` already carries a `term` in its result and a block that computes it; Phase 1 wrote it and no dataset exercised it. Verify it against the tests below before changing anything — if it already passes, say so in the ledger and move to Step 5.

The rule: every non-skipped row must agree on every column in `termColumns`. The first disagreeing row produces one error naming the columns and both values; later disagreements are not re-reported, so a file uploaded against the wrong term yields one clear message rather than 5,000.

- [ ] **Step 1: Write the failing tests**

In the existing `describe('validateSheet — term-scoped')` block, using its `termed` fixture dataset:

```
✓ returns the term when every row agrees
✓ refuses a sheet whose rows carry two different terms, naming both   // Review Focus 2
✓ reports the disagreement once, not once per row
✓ refuses a row whose term column is blank
✓ ignores a skipped blank row when deciding the term
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @kku/db exec vitest run test/import-validate.test.ts`

- [ ] **Step 3: Make them pass**

Keep the existing single-report behaviour if it is already there; otherwise add it.

- [ ] **Step 4: Run the whole import suite**

Run: `pnpm --filter @kku/db exec vitest run test/import-`
Expected: PASS, no regression in the 159 cases Phase 3 starts from.

- [ ] **Step 5: Commit**

---

### Task 2: Cohort progression and alumni status

**Files:**
- Create: `packages/db/src/import/datasets/cohorts.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`, `apps/api/src/admin-data-setup/raw-data.controller.ts`, `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx`
- Test: `packages/db/test/import-datasets-cohorts.test.ts`

**Interfaces:**
- Produces: `studentCohortsDataset` (slug `student-cohorts`, sheet `Student Cohorts`) and `alumniCohortsDataset` (slug `alumni-cohorts`, sheet `Alumni Cohorts`), both `ImportDataset`.
- Produces: `buddhistYearColumn(header, key, guide): ImportColumn` and `toBuddhistEra(commonEraYear: number): number` — exported from this file, used by Task 7 and Task 8.

Both tables store **Buddhist era** (`entryYearBE`). `buddhistYearColumn` wraps `yearColumn` unchanged — the operator writes 2024 — and `toBuddhistEra` adds 543 in the loader. The guide text says the stored figure is converted, because a reader comparing the sheet with the admin raw view will otherwise think the import is wrong.

**`student-cohorts`** — key `['programmeCode', 'entryYear']`, `kind: 'unique'` on `programId_entryYearBE`. Columns: `Programme Code` (references programmes), `Entry Year`, `Students Still Enrolled` → `studentCount`, integer, required.

**`alumni-cohorts`** — key `['programmeCode', 'entryYear', 'statusBucket']`, `kind: 'unique'` on `programId_entryYearBE_statusBucket`. Columns: `Programme Code`, `Entry Year`, `Status` → `statusBucket`, enum, required, and `Count`, integer, required. The enum values, which are what `programsDeepDive`'s switch reads (`packages/db/src/program-deep-dive.ts:365`):

`GRADUATED`, `RENOUNCED`, `NO_REPORT`, `DROPPED_FINANCIAL`, `DROPPED_ACADEMIC`, `DROPPED_VOLUNTARY`, `TRANSFERRED`, `OTHER`

Both carry `prefill: programmeYearPrefill({ yearKey: 'entryYear' })`; alumni adds `extraKeys: ['statusBucket']`.

Both need an `xlsx-<slug>` catalogue entry, a raw-view fetcher following the `enrollment-metrics` shape, and a `DATASET_TITLES` entry.

- [ ] **Step 1: Write the failing test**

```
✓ both are registered under the slugs the raw views use
✓ an operator writing 2024 stores entry year 2567                    // the conversion
✓ refuses a Buddhist-era year, naming BE
✓ every alumni status the Deep-Dive switch reads is an allowed value
✓ refuses a status outside the list
✓ a second status for one cohort is a separate row, not an overwrite
✓ both are visible through realDataWhere()
✓ clear removes only rows the given runs created
```

The fourth case asserts against the literal list above, so a bucket renamed in one place and not the other fails here.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write both declarations, register them, add catalogue entries, raw-view fetchers and titles**

- [ ] **Step 4: Run the dataset and registry suites**

Run: `pnpm --filter @kku/db exec vitest run test/import-datasets-cohorts.test.ts test/import-registry.test.ts test/import-cascade-coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

---

### Task 3: Staff roster

**Files:**
- Create: `packages/db/src/import/datasets/staff.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`, `packages/db/src/import/datasets/faculties.ts`
- Test: `packages/db/test/import-datasets-staff.test.ts`, `packages/db/test/import-cascade-coverage.test.ts`

**Interfaces:**
- Produces: `staffDataset` (slug `faculty-members`, sheet `Staff`), key `['employeeCode']`, `kind: 'unique'`.
- Produces: `FACULTY_CASCADE_CHILDREN` and `FACULTY_CASCADE_CHILDREN_UNREACHABLE` exported from `faculties.ts`, same shape as `CASCADE_CHILDREN` in `programmes.ts`.

Columns: `Employee Code` (required, the key — the adopter's own code, which is not sensitive alone, §7.4); `Name (Thai)` required; `Name (English)` required; `Faculty Code` required, references faculties; `Department Code` optional, references departments; `Rank` enum required — `LECTURER`, `ASST_PROF`, `ASSOC_PROF`, `PROF`; `Academic Qualification` optional; `Specialization` optional; `Hire Date` optional date; `Retirement Date` optional date; `Active` boolean, optional, default true.

**No date of birth, and no national-ID column of any kind** (owner decision, 2026-10-18; §7.4). The guide on `Retirement Date` says it is what the succession-risk view reads, so an adopter knows why it is worth filling.

`FacultyMember.ingestionRunId` exists already — Phase 1's migration `20261017120000_import_batches` added it. No migration here.

**The cascade guard gains a second parent.** `facultiesDataset` currently declares `dependents` only. Three tier-2 datasets hang off `Faculty`; enumerate its `onDelete: Cascade` children the way `programmes.ts` does, and extend `import-cascade-coverage.test.ts` to check `Faculty`'s children against the schema exactly as it checks `Program`'s. Factor the schema-reading helper so both parents use one implementation.

- [ ] **Step 1: Write the failing tests**

```
✓ registered under the slug the raw view already uses
✓ inserts a staff member against a faculty and department
✓ a blank Department Code is accepted
✓ refuses a rank outside the four the schema allows
✓ offers no date-of-birth column, and no national-id column   // §7.4
✓ refuses a cell holding a national ID, without echoing it     // §7.3
✓ an update does not re-attribute a row a connector created
✓ clear removes only rows the given runs created
```

Plus, in `import-cascade-coverage.test.ts`:

```
✓ finds Faculty's cascade children in the schema at all
✓ accounts for every one of them
✓ names nothing that is not a cascade child
✓ clearing faculties is refused once staff exist, naming them   // Review Focus 4
```

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Write the declaration, register it, add the catalogue entry, and extend the cascade guard**

The raw view `faculty-members` already exists; check its columns render an imported row sensibly and add an `imported` column if it has none.

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter @kku/db exec vitest run test/import-`
Expected: PASS.

- [ ] **Step 5: Commit**

---

### Task 4: Staff compensation

**Files:**
- Create: `packages/db/src/import/datasets/compensation.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`
- Test: `packages/db/test/import-datasets-compensation.test.ts`

**Interfaces:**
- Produces: `compensationDataset` (slug `faculty-compensation`, sheet `Compensation`), strategy `{ kind: 'upsert', match: { kind: 'manual', columns: ['facultyCode', 'departmentCode', 'rank', 'fiscalYear'] } }`.

**The first `manual` match.** `FacultyCompensation`'s unique is `(facultyId, departmentId, rank, fiscalYear)` with `departmentId` nullable, and Postgres treats NULL ≠ NULL in a unique index — so a faculty-wide row (no department) has no enforced uniqueness and Prisma's compound `where` rejects a null component. The loader does `findFirst` → `update | create`, the pattern `kku-hr`'s connector uses and documents.

Columns: `Faculty Code` required, references faculties; `Department Code` optional, references departments; `Rank` enum required (the four above); `Fiscal Year` required; `Headcount` integer required, **`groupSizeFor: { minimum: 5 }`**; `Total Salary (THB)`, `Mean Salary (THB)`, `Min Salary (THB)`, `Max Salary (THB)` — decimals, all required, all refusing negatives.

The group-size gate is this dataset's reason to exist in the privacy section: a four-person row is refused, naming the row, never quoting the salaries.

- [ ] **Step 1: Write the failing test**

```
✓ registered under the slug the raw view already uses
✓ inserts a faculty-wide row whose department is blank
✓ updates that row rather than duplicating it                 // the manual match
✓ keeps a department row and a faculty-wide row apart
✓ refuses a row covering four people, naming the row          // Review Focus 1
✓ the refusal does not quote any salary figure                // §7.2
✓ accepts a row covering exactly five
✓ refuses a negative salary
✓ clear removes only rows the given runs created
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the declaration, register it, add the catalogue entry**

- [ ] **Step 4: Run the suites**

- [ ] **Step 5: Commit**

---

### Task 5: Faculty budgets

**Files:**
- Create: `packages/db/src/import/datasets/budgets.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`
- Test: `packages/db/test/import-datasets-budgets.test.ts`

**Interfaces:**
- Produces: `budgetsDataset` (slug `faculty-budgets`, sheet `Budgets`), strategy `{ kind: 'upsert', match: { kind: 'manual', columns: ['divisionName', 'fundCategory', 'fiscalYear'] } }`.

`FacultyBudget` has no unique constraint at all, hence `manual`. `facultyId` is nullable by design — KKU's connector leaves it null for divisions that are not faculties (the President's Office, a hospital), and the same must hold for an adopter.

Columns: `Division Name` required (free text, the key — a faculty, an institute, a central office); `Faculty Code` optional, references faculties, the link that makes the figure roll up; `Fund Category` required; `Fiscal Year` required; `Total Budget (THB)` required decimal; `Total Commitment`, `Total Obligation`, `Total Expenditure`, `Funds Available` — optional decimals, 0 on insert.

- [ ] **Step 1: Write the failing test**

```
✓ registered under the slug the raw view already uses
✓ inserts a division with no faculty code
✓ links a division to a faculty when the code is given
✓ updates on (division, fund, year) rather than duplicating
✓ a blank optional figure is 0 on insert and untouched on update
✓ clear removes only rows the given runs created
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the declaration, register it, add the catalogue entry**

- [ ] **Step 4: Run the suites**

- [ ] **Step 5: Commit**

---

### Task 6: Research outputs

**Files:**
- Create: `packages/db/src/import/datasets/research.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`, `packages/db/src/import/datasets/staff.ts`
- Test: `packages/db/test/import-datasets-research.test.ts`

**Interfaces:**
- Produces: `researchDataset` (slug `research-outputs`, sheet `Publications`), strategy `{ kind: 'upsert', match: { kind: 'manual', columns: ['doi', 'employeeCode'], fallback: ['title', 'year', 'employeeCode'] } }` (§8.3).

`doi` is indexed but not unique, and making it unique would conflict with connector-written rows — hence `manual` with a fallback. Matching is always **scoped to the staff member**: a paper is one row per author, so a row is found only among that person's outputs. Two staff with the same paper are two rows, which is what the table already holds.

Columns: `Employee Code` required, references `faculty-members`; this task adds `dependents: ['research-outputs']` to `staffDataset` — it cannot be written in Task 3, because the registry's invariant test fails on a dependent that does not exist yet (Phase 1 hit this and merged two tasks to avoid it); `Year` required; `Type` enum required — `JOURNAL`, `CONFERENCE`, `PATENT`, `BOOK`; `Title` required; `Venue` optional; `Citations` optional integer, 0 on insert; `DOI` optional.

- [ ] **Step 1: Write the failing test**

```
✓ registered under the slug the raw view already uses
✓ inserts a publication against a staff member
✓ matches an existing row by DOI and updates its citation count
✓ falls back to (title, year) when the row has no DOI
✓ does not match another person's paper of the same title and year   // Review Focus 5
✓ two authors of one paper are two rows
✓ refuses a type outside the four the schema allows
✓ clear removes only rows the given runs created
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the declaration, register it, add the catalogue entry**

- [ ] **Step 4: Run the suites**

- [ ] **Step 5: Commit**

---

### Task 7: Admission campaigns

**Files:**
- Create: `packages/db/src/import/datasets/campaigns.ts`, `packages/db/prisma/migrations/20261018120000_admission_campaign_import/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`, `apps/api/src/admin-data-setup/raw-data.controller.ts`, `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx`
- Test: `packages/db/test/import-datasets-campaigns.test.ts`

**Interfaces:**
- Produces: `campaignsDataset` (slug `admission-campaigns`, sheet `Admission Campaigns`), strategy `{ kind: 'upsert', match: { kind: 'manual', columns: ['programmeCode', 'academicYear', 'round', 'campaignName'] } }`.

**Migration.** `AdmissionCampaignStat` is keyed on `wProgramId` — Oracle's surrogate — and `recruitmentProgramId` and `facultyNameTh` are also NOT NULL, all three unsupplyable by an adopter. The migration makes the first two nullable and leaves the unique on `wProgramId` in place (Postgres permits many NULLs in a unique index). `facultyNameTh` is resolved from the referenced faculty rather than asked for.

No new unique constraint: `campaignName` is `@db.Text` and the natural key includes a nullable `programId`, so a composite unique is both awkward and wrong. `manual` is the fit, which is why the strategy exists.

Columns: `Programme Code` required, references programmes; `Academic Year` required (stored as BE, see Task 2); `Round` required; `Campaign Name` required; `Planned Seats` → `planPerYear`, `Total Applicants`, `Total Passed`, `Confirmed` → `confirmClearinghouse`, `Reported` → `regReported` — all optional integers.

The KKU-only columns (`wProgramId`, `currId`, `recruitmentProgramId`, `sourceFacultyId`, `enrollSeats`, `sendClearinghouse`, `sendRegReported`) are **not** offered. The guide says so, so an operator comparing with the admin raw view is not left wondering.

- [ ] **Step 1: Write the failing test**

```
✓ registered under the slug the raw view uses
✓ inserts a campaign with no Oracle surrogate id
✓ updates on (programme, year, round, campaign) rather than duplicating
✓ two rounds of one programme-year are separate rows
✓ resolves the faculty name from the programme's faculty
✓ offers no column for an identifier only KKU's registrar has
✓ visible through realDataWhere()
✓ clear removes only rows the given runs created
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the migration, the declaration, the catalogue entry, the raw-view fetcher and the title**

Generate the SQL with `prisma migrate diff --from-schema-datasource --to-schema-datamodel` — **never** the `--from-migrations` form, which resets whatever `--shadow-database-url` points at (see `CLAUDE.md`, 2026-09-08).

- [ ] **Step 4: Apply and run the suites**

Run: `pnpm --filter @kku/db exec prisma migrate deploy`, then `pnpm --filter @kku/db exec vitest run test/import-`
Expected: PASS.

- [ ] **Step 5: Commit**

---

### Task 8: Class offerings

**Files:**
- Create: `packages/db/src/import/datasets/class-offerings.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`, `apps/api/src/admin-data-setup/raw-data.controller.ts`, `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx`
- Test: `packages/db/test/import-datasets-class-offerings.test.ts`

**Interfaces:**
- Produces: `classOfferingsDataset` (slug `class-offerings`, sheet `Class Offerings`), strategy `{ kind: 'term-scoped', termColumns: ['academicYear', 'semester'], match: { kind: 'unique', columns: ['classId'] } }`.
- Produces: `synthesiseClassId(academicYearBE: number, semester: number, courseCode: string, section: number): bigint`.

**`classId` is supplied when the adopter has it and synthesised when they do not** (owner decision, 2026-10-18). `ClassOffering.classId` is `BigInt @unique` NOT NULL and the table's only unique key, so there is always a value and **no migration is needed**.

`synthesiseClassId` returns a deterministic BigInt in a reserved range that cannot collide with a registrar's own ids: take a SHA-256 of `` `${academicYearBE}|${semester}|${courseCode}|${section}` ``, read the first 7 bytes as an integer, and add `2n ** 62n`. Oracle `CLASSID` values on a real installation are ten digits; 2^62 is nineteen. Two rows that collide inside one file fail the insert loudly on the unique index, which is the correct outcome — a duplicate (year, semester, course, section) is a defect in the file.

Loading, in one transaction: delete every row for the declared term, then `createMany` the file's rows.

Columns: `Academic Year` required (stored as BE); `Semester` required integer; `Course Code` required; `Section` required integer; `Class Id` **optional** — the guide says to supply it if the registrar provides one and leave it blank otherwise; `Course Name (Thai)`, `Course Name (English)` optional; `Credits` → `creditTotal`, `Lecture Hours/Week`, `Lab Hours/Week` optional integers; `Enrolled` → `enrollSeat` and `Total Seats` → `totalSeat`, required integers; the twelve grade counts `Grade A` … `Grade F`, `Incomplete`, `Withdrawn`, `Audit`, `Satisfactory` — optional integers, 0 on insert.

- [ ] **Step 1: Write the failing test**

```
✓ registered under the slug the raw view uses
✓ loads a term and reports the rows inserted
✓ re-uploading a term replaces it, so a cancelled section disappears
✓ loading one term leaves another term's rows alone
✓ refuses a file carrying two different terms, naming both      // Review Focus 2
✓ synthesises a class id when the column is blank
✓ keeps a supplied class id unchanged
✓ a synthesised id is deterministic and sits above 2^62         // Review Focus 3
✓ two rows for one (year, semester, course, section) fail the file
✓ visible through realDataWhere()
✓ clear removes only rows the given runs created
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the declaration, register it, add the catalogue entry, the raw-view fetcher and the title**

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter @kku/db exec vitest run test/import-`
Expected: PASS.

- [ ] **Step 5: Commit**

---

### Task 9: End-to-end check and documentation

**Files:**
- Modify: `apps/api/test/import-e2e.test.ts`, `apps/api/test/import-prefilled-template.test.ts`, `scripts/e2e-import/make-fixtures.mjs`, `scripts/e2e-import/drive.mjs`, `scripts/e2e-import/reset.mjs`
- Modify: `docs/data-import.md`, `apps/web/app/admin/data-setup/page.tsx`, `apps/web/app/changelog/page.tsx`, `CLAUDE.md`

- [ ] **Step 1: Extend the e2e test**

Upload a staff member, then a compensation row, a budget row and a publication against them; assert each is returned by a `realDataWhere()`-filtered read. Then upload a class-offerings term twice, the second time with one section removed, and assert the removed section is gone — the assertion that proves term-scoped loading does what the connector it replaces does.

- [ ] **Step 2: Run it**

Run: `pnpm --filter api exec vitest run test/import-e2e.test.ts test/import-prefilled-template.test.ts`
Expected: PASS.

- [ ] **Step 3: Extend the browser fixtures and drive**

Valid fixtures for the eight datasets, plus two refusals an adopter will actually hit: a compensation row covering three people, and a class-offerings file mixing two terms. Extend `reset.mjs` — note staff, compensation and budgets cascade from `Faculty`, not `Program`, so deleting the fixture programmes no longer cleans everything up.

- [ ] **Step 4: Run the browser drive**

Per `scripts/e2e-import/README.md`. Expected: every check passes.

- [ ] **Step 5: Update the docs**

`docs/data-import.md` gains the eight datasets and their load order, a note that cohort and class-offering years are written in Common Era and stored converted, and a line on class offerings replacing a whole term rather than merging — the one dataset whose behaviour differs from every other, and the one an operator must understand before uploading. Add a changelog entry. Update `CLAUDE.md`'s status entry and decisions log.

- [ ] **Step 6: Build the docs and run the full check**

Run: `pnpm docs:build`, then `pnpm --filter @kku/db test`, `pnpm --filter api test`, `pnpm --filter web test`.
Expected: docs build clean; the only failures are the two pre-existing sets recorded in `CLAUDE.md` (4 in `packages/shared` usage-action-coverage, 5 in `packages/db` gap-map).

- [ ] **Step 7: Commit**

---

## Self-review notes

- **Spec coverage.** §5.2 tier 2's eight datasets map to Tasks 2–8. §6.11 term-scoped → Tasks 1 and 8. §7 privacy → Task 3 (no DOB, no raw ID) and Task 4 (group-size gate). §8.3 ResearchOutput matching → Task 6, with the spec's `manual` + fallback adopted but keyed on `employeeCode` rather than `facultyMemberId`, since an adopter supplies a code and not a cuid.
- **Three decisions taken after the spec was written** (owner, 2026-10-18), recorded here because the spec does not carry them: campaigns are **included, re-keyed** rather than dropped, which costs one migration; class ids are **supplied or synthesised**, which costs none; staff carry **retirement date but no date of birth**.
- **Not in this plan.** Tier 3 stays deferred for the reasons §5.2 records. Export/round-trip (§10) remains deferred past Phase 3, as the spec says.
- **New framework surface is one strategy branch**, already declared in the types since Phase 1. Everything else is declarations. A task that finds itself widening the validator or the loader again is a signal worth raising rather than working around.
- **The riskiest task is 8**, because term-scoped loading is the only destructive write in the whole importer: it deletes rows before inserting any. Its "re-uploading a term replaces it" and "leaves another term's rows alone" tests are the two to write first and most carefully.
