# Institute XLSX import, Phase 2 (Core metrics): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an adopting university fill the Deep-Dive's Students, Financials and Outcomes sections by uploading three spreadsheets, using the framework Phase 1 built.

**Architecture:** Three more `ImportDataset` declarations. No new framework concepts — the parser, validator, template writer, upload service, provenance and start-over all already work. The one new capability is `prefill`: Phase 1 declared the hook and the template writer already consumes it, but no dataset implemented it. These three do, because all three are keyed on (programme, year) and an adopter should not be hand-typing programme codes.

**Tech Stack:** TypeScript strict, Prisma 5 / PostgreSQL 16, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-institute-xlsx-import-design.md` — §5.2 tier 1, §6.10 pre-fill. This plan also records four decisions that change what the spec said; they are in "Decisions taken here" below and should be folded back into the spec when it is next touched.

## Global Constraints

Everything in the Phase 1 plan's Global Constraints still applies. Repeated here only where Phase 2 adds to it:

- **No `any`.** TypeScript strict. Explicit return types on every exported function in `packages/*`.
- **`packages/db/src/import/**` must not import `xlsx`.** The Phase 1 registry test enforces it.
- **Each new dataset needs a matching `xlsx-<slug>` entry in `SOURCE_CATALOG`** (`packages/shared/src/ingestion/catalog.ts`), `mocked: false`, `inputFormat: 'XLSX'`. The Phase 1 registry test fails in both directions if the catalogue and `IMPORT_DATASETS` disagree, so this is not optional.
- **`realDataWhere()` applies to all three of these tables**, unlike the tier-0 ones. A row whose `ingestionRunId` is null, or whose DataSource is mocked, is invisible to the Deep-Dive. This is the failure that looks like success.
- **Migrations:** none expected. If one proves necessary, hand-write the SQL; never run `prisma migrate dev`, `reset`, `db push`, or pass `--shadow-database-url`.
- **Commits:** conventional, message via `git commit -F <file>`, ending `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Single-file test run: `pnpm --filter @kku/db exec vitest run test/<file>.test.ts`.

## Decisions taken here

Four calls that depart from, or go beyond, what the spec says. Each is mine unless marked.

**D1 — Student demographics is dropped from this phase.** The spec lists it as tier 1. It has **no reader**: `grep` finds `studentDemographic` only in the kku-registry connector that writes it, the admin raw-data viewer, and the data-quality audit list. No Deep-Dive section and no dashboard reads it. It is also the only one of the four whose shape does not fit a flat sheet — `breakdownJson` holds gender, home-province and nationality histograms, which would need one sheet row per (programme, year, dimension, value) and therefore a framework capability that aggregates many sheet rows into one database row. Building the hardest import for data nothing displays is the wrong order. Revisit if a surface starts reading it.

**D2 — The finance template carries revenue only.** `FinancialMetric` has five non-null cost columns (`directCost`, `allocatedFacultyCost`, `allocatedFacilityCost`, `allocatedOverhead`, `netContribution`). They are **not** import columns. Cost allocation is an unsettled methodology — `docs/methodologies/cost-allocation.md` is v0 pending Finance Committee sign-off, and the `kku-finance` connector deliberately writes only `tuitionRevenue`, seeding costs to 0 on create and omitting them on update. An import that invited an adopter to type numbers into those columns would put un-methodologised figures in front of Council. The loader does exactly what the connector does.

**D3 — `FinancialMetric.fiscalYear` is misnamed and the template must not repeat the mistake.** The schema comment is explicit: despite the column name it holds an **academic** year (Jun–May), not a fiscal year (Oct–Sep), and `FacultyBudget.fiscalYear` shares the name while being a true Oct–Sep year. The column header is **"Academic Year"**, and the guide text says which one it is and warns that it is not the budget year. An adopter who enters fiscal years here silently shifts every financial figure by one axis.

**D4 — A blank optional cell leaves the stored value alone on update, and is 0 on insert.** This is the connectors' partial-upsert semantics (`kku-registry` omits `applications`/`admitted`/`retainedYear2`/`graduatedLate` on update so seed and TCAS values survive). For an import it also matters that an adopter who only has enrolment counts can upload them without zeroing figures another source supplied. Stated in each guide sheet.

## Review Focus

Five things the spec does not name that will bite a real operator. Each has a test in the task that owns it.

1. **Buddhist-era years.** A Thai registrar's export says 2568, not 2025. Every year column in this phase is Common Era, and a BE year is 543 years in the future — it will pass any range check that only looks for "a plausible year". Each year column rejects anything above `currentYear + 2` with a message naming BE explicitly. Tested in Task 2.
2. **A rate written as a percentage.** `employmentRate`, `jobRelevanceScore` and `furtherStudyRate` are stored 0–1, and an adopter will type 87 for 87%. Values above 1 are refused with a message saying so rather than silently stored. Tested in Task 4.
3. **Counts that contradict each other.** `admitted` above `applications`, or `enrolled` above `admitted`, is a transcription error, and the funnel renders nonsense from it. Refused, naming both columns. Tested in Task 2.
4. **A programme code that exists but is not canonical.** Phase 1 assigns `sequenceNoFromSheet` on insert, but a programme created by an older path may have none, and a metric row attached to it is invisible for a reason the operator cannot see. The reference check accepts it and the guide warns; tested in Task 2 so the behaviour is pinned rather than accidental.
5. **A survey year before the graduation year.** `GraduateOutcome` carries both; reversed, the row is meaningless. Refused. Tested in Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/src/import/datasets/enrollment.ts` (create) | `enrollmentDataset` |
| `packages/db/src/import/datasets/financials.ts` (create) | `financialsDataset` |
| `packages/db/src/import/datasets/graduate-outcomes.ts` (create) | `graduateOutcomesDataset` |
| `packages/db/src/import/datasets/prefill.ts` (create) | `programmeYearPrefill` — shared by all three |
| `packages/db/src/import/validate.ts` (modify) | cross-column rules (`rowRules`) |
| `packages/db/src/import/types.ts` (modify) | `ImportDataset.rowRules` |
| `packages/db/src/import/registry.ts` (modify) | register the three |
| `packages/shared/src/ingestion/catalog.ts` (modify) | three `xlsx-*` entries |
| `apps/api/src/admin-data-setup/raw-data.controller.ts` (modify) | reuse the existing `enrollment-metrics` / `financial-metrics` entries; add `graduate-outcomes` |
| `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx` (modify) | add `graduate-outcomes` to `DATASET_TITLES` |
| `apps/web/app/admin/data-setup/page.tsx` (modify) | import affordance noted on the three existing cards |
| `docs/data-import.md` (modify) | the three datasets, load order, year conventions |

Note the slug reuse: `enrollment-metrics` and `financial-metrics` already exist as raw-view datasets with those exact slugs. The import dataset slugs **must match them** so one page serves both, as Phase 1 established for the tier-0 three.

---

### Task 1: Cross-column validation rules

The three datasets all need checks that look at more than one cell in a row. The validator has no such hook; this adds the smallest one that serves all three.

**Files:**
- Modify: `packages/db/src/import/types.ts`, `packages/db/src/import/validate.ts`
- Test: `packages/db/test/import-validate.test.ts`

**Interfaces:**
- Produces: `ImportRowRule = { message: string; check: (row: ImportRow) => boolean }` and `ImportDataset.rowRules?: readonly ImportRowRule[]`. A rule returning `false` fails the row; `check` sees a row whose cells have already been coerced and individually validated. The error is reported against the row with `column: null`.

- [ ] **Step 1: Write the failing test**

Add to the fixture dataset in `import-validate.test.ts` a `rowRules` entry, then:

```
✓ a row failing a rowRule is reported with the rule's message
✓ the error carries the row's spreadsheet number and a null column
✓ a rowRule is not run for a row whose cells already failed
✓ a dataset with no rowRules behaves exactly as before
```

The third case matters: running a cross-column rule over cells that failed coercion produces a second, confusing error about the same mistake.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/db exec vitest run test/import-validate.test.ts`
Expected: FAIL — `rowRules` is not a property of `ImportDataset`.

- [ ] **Step 3: Add `rowRules` to `ImportDataset` and apply it in `validateSheet`**

Run the rules after the per-cell loop for a row, only when that row contributed no errors.

- [ ] **Step 4: Run the suite**

Run: `pnpm --filter @kku/db exec vitest run test/import-validate.test.ts`
Expected: PASS, including the 40 cases already there.

- [ ] **Step 5: Commit**

---

### Task 2: Enrolment

**Files:**
- Create: `packages/db/src/import/datasets/enrollment.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`
- Test: `packages/db/test/import-datasets-enrollment.test.ts`

**Interfaces:**
- Consumes: Task 1's `rowRules`.
- Produces: `enrollmentDataset: ImportDataset`, slug `enrollment-metrics`, sheet `Enrolment`, `strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['programmeCode', 'academicYear'] } }`.

Columns. `Programme Code` → `programmeCode`, text, required, `references: { dataset: 'programmes', column: 'code' }`. `Academic Year` → `academicYear`, integer, required. Then seven optional integers: `Applications`, `Admitted`, `Enrolled`, `Retained to Year 2`, `Graduated on Time`, `Graduated Late`, `Dropouts`.

`load` resolves programme codes in one `findMany`, then upserts on `programId_academicYear`. **On create**, a blank optional cell is 0. **On update**, a blank cell is omitted from the `data` object so the stored value survives (D4). `freshnessDate` is the upload date; `methodologyVersion` is `'xlsx-import.v1'`.

Year rule: reject `< 1950` or `> currentYear + 2`, message naming Buddhist era.

`rowRules`: admitted ≤ applications; enrolled ≤ admitted — each skipped when either cell is blank.

- [ ] **Step 1: Write the failing test**

```
✓ registered under the slug enrollment-metrics
✓ inserts a row with the run id stamped and blanks defaulted to 0
✓ updates an existing (programme, year) without duplicating
✓ a blank cell on update leaves the stored value alone          // D4
✓ rejects a Buddhist-era year, naming BE                        // Review Focus 1
✓ rejects admitted above applications, naming both columns      // Review Focus 3
✓ rejects enrolled above admitted
✓ accepts a row whose contradicting cell is blank
✓ accepts a programme that exists but is not canonical, and the guide says why  // Review Focus 4
✓ clear removes only rows the given runs created
✓ the row is visible through realDataWhere()
```

The last one is the point of the whole phase: assert the loaded row survives `{ ingestionRun: { dataSource: { mocked: false } } }`.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the declaration and register it; add the catalogue entry**

- [ ] **Step 4: Run the dataset suite and the registry suite**

Run: `pnpm --filter @kku/db exec vitest run test/import-datasets-enrollment.test.ts test/import-registry.test.ts`
Expected: PASS. The registry suite proves the catalogue and the registry agree.

- [ ] **Step 5: Commit**

---

### Task 3: Finance

**Files:**
- Create: `packages/db/src/import/datasets/financials.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`
- Test: `packages/db/test/import-datasets-financials.test.ts`

**Interfaces:**
- Produces: `financialsDataset: ImportDataset`, slug `financial-metrics`, sheet `Finance`, keyed `['programmeCode', 'academicYear']`.

Columns: `Programme Code` (references programmes), `Academic Year` (integer, required — **not** "Fiscal Year", D3), `Tuition Revenue (THB)` → `tuitionRevenue`, decimal, required, and `Other Revenue (THB)` → `otherRevenue`, decimal, optional.

No cost columns (D2). The guide sheet says plainly that cost figures are produced by the cost-allocation methodology and are not uploaded.

`load` upserts on `programId_fiscalYear` — the Prisma field is still called `fiscalYear` even though the column means an academic year. **On create** seed `directCost`, `allocatedFacultyCost`, `allocatedFacilityCost`, `allocatedOverhead` to 0 and `netContribution` to `tuitionRevenue + otherRevenue`. **On update** write only the revenue fields, `freshnessDate` and `ingestionRunId`, exactly as the `kku-finance` connector does — so an existing cost allocation is not destroyed.

- [ ] **Step 1: Write the failing test**

```
✓ registered under the slug financial-metrics
✓ the year column is headed "Academic Year", not "Fiscal Year"   // D3
✓ the guide warns it is not the budget year
✓ offers no cost columns                                          // D2
✓ inserts with costs seeded to 0 and netContribution = revenue
✓ an update leaves an existing directCost untouched               // D2
✓ accepts a decimal with thousands separators
✓ rejects a Buddhist-era year
✓ the row is visible through realDataWhere()
✓ clear removes only rows the given runs created
```

The "leaves an existing directCost untouched" case is the one that protects a KKU installation from an adopter-shaped import.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the declaration and register it; add the catalogue entry**

- [ ] **Step 4: Run the suites**

- [ ] **Step 5: Commit**

---

### Task 4: Graduate outcomes

**Files:**
- Create: `packages/db/src/import/datasets/graduate-outcomes.ts`
- Modify: `packages/db/src/import/registry.ts`, `packages/shared/src/ingestion/catalog.ts`, `apps/api/src/admin-data-setup/raw-data.controller.ts`, `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx`
- Test: `packages/db/test/import-datasets-outcomes.test.ts`

**Interfaces:**
- Produces: `graduateOutcomesDataset: ImportDataset`, slug `graduate-outcomes`, sheet `Graduate Outcomes`, keyed `['programmeCode', 'graduationYear', 'surveyYear']`.

Columns: `Programme Code` (references programmes); `Graduation Year` and `Survey Year`, integers, required; `Employment Rate` → decimal 0–1, required; `Average Salary (THB/month)` → decimal, required; `Job Relevance Score` → decimal 0–1, required; `Further Study Rate` → decimal 0–1, required; `Sample Size` → integer, required.

Rate columns reject anything above 1 with a message naming the percentage mistake (Review Focus 2). `rowRules`: survey year ≥ graduation year (Review Focus 5).

This dataset has **no raw-view entry yet**, so it needs one in `raw-data.controller.ts` and in `DATASET_TITLES` — otherwise its page 404s and the import panel is unreachable, which is exactly how Phase 1 shipped unusable.

- [ ] **Step 1: Write the failing test**

```
✓ registered under the slug graduate-outcomes
✓ inserts a row keyed on all three parts
✓ two survey years for one graduation year are separate rows
✓ rejects an employment rate of 87, naming the 0-1 convention     // Review Focus 2
✓ accepts 0.87
✓ rejects a survey year before the graduation year                // Review Focus 5
✓ rejects a Buddhist-era year
✓ the row is visible through realDataWhere()
✓ clear removes only rows the given runs created
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the declaration, register it, add the catalogue entry, and add the raw-view fetcher and title**

The raw-view fetcher follows the pattern of the three added in Phase 1 — `page`/`pageSize` in the result, an `imported` column derived from `ingestionRunId !== null`.

- [ ] **Step 4: Run the suites, then check the page renders**

Run the dataset and registry suites, then load `/admin/data-setup/raw/graduate-outcomes` and confirm the import panel appears.

- [ ] **Step 5: Commit**

---

### Task 5: Pre-fill

The hook Phase 1 declared and nothing implemented. Until now every template has shipped empty, so an adopter hand-types programme codes — which is where the reference errors come from.

**Files:**
- Create: `packages/db/src/import/datasets/prefill.ts`
- Modify: the three dataset files
- Test: `packages/db/test/import-prefill.test.ts`

**Interfaces:**
- Produces: `programmeYearPrefill(opts: { yearKey: string; extraKeys?: readonly string[] }): ImportDataset['prefill']`

Returns rows for the cross product of **canonical active programmes** (`withCanonical({ status: 'ACTIVE' })`) and a year range: `fromYear`/`toYear` when given, else the five academic years ending at `getAcademicYearContext()`'s `currentAcademicYearBE - 543`. Each row carries `programmeCode` and the year key, value columns absent.

`graduateOutcomesDataset` passes `extraKeys: ['surveyYear']` and leaves it blank — a survey year cannot be guessed, and pre-filling a wrong one is worse than an empty cell.

- [ ] **Step 1: Write the failing test**

```
✓ one row per canonical active programme per year
✓ five years by default, ending at the current academic year
✓ honours fromYear and toYear
✓ excludes a non-canonical programme          // it would be invisible anyway
✓ excludes a SUNSET programme
✓ fills only the key columns, leaving values blank
✓ returns no rows when no programme exists    // a fresh install
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement `programmeYearPrefill` and wire it into the three declarations**

- [ ] **Step 4: Run the suite, then check a real template**

Run the suite, then download `/admin/data-setup/raw/enrollment-metrics` → template and confirm the data sheet carries programme codes and years with blank value columns.

- [ ] **Step 5: Commit**

---

### Task 6: End-to-end check and documentation

**Files:**
- Modify: `apps/api/test/import-e2e.test.ts`, `scripts/e2e-import/make-fixtures.mjs`, `scripts/e2e-import/drive.mjs`, `scripts/e2e-import/reset.mjs`
- Modify: `docs/data-import.md`, `apps/web/app/admin/data-setup/page.tsx`, `apps/web/app/changelog/page.tsx`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extend the e2e test**

Add to the existing loop: upload a programme, then an enrolment row, a finance row and an outcomes row against it, and assert each is returned by a `realDataWhere()`-filtered read. Then assert the Deep-Dive endpoint for that programme returns the financial figure — the only assertion that proves the whole chain, since that is what an adopter is actually buying.

- [ ] **Step 2: Run it**

Run: `pnpm --filter api exec vitest run test/import-e2e.test.ts`
Expected: PASS.

- [ ] **Step 3: Extend the browser fixtures and drive**

Three more valid fixtures and two refusals — a Buddhist-era year and a percentage-shaped rate, since those are the two an adopter will actually hit. Extend `reset.mjs` to clear them.

- [ ] **Step 4: Run the browser drive**

Run the three scripts per `scripts/e2e-import/README.md`.
Expected: every check passes.

- [ ] **Step 5: Update the docs**

`docs/data-import.md` gains the three datasets, the load order, and a short section on year conventions: all years are Common Era; the finance year is academic, not budget; rates are 0–1. Mention that demographics is deliberately absent and why (D1). Note the import affordance on the three existing data-setup cards. Add a changelog entry. Update `CLAUDE.md`'s status entry and decisions log.

- [ ] **Step 6: Build the docs and run the full check**

Run: `pnpm docs:build`, then `pnpm --filter @kku/db test`, `pnpm --filter api test`, `pnpm --filter web test`.
Expected: docs build clean; the only failures are the two pre-existing sets recorded in `CLAUDE.md` (4 in `packages/shared` usage-action-coverage, 5 in `packages/db` gap-map).

- [ ] **Step 7: Commit**

---

## Self-review notes

- **Spec coverage.** §5.2 tier 1: enrolment → Task 2, finance → Task 3, outcomes → Task 4, demographics → **deliberately dropped, D1**. §6.10 pre-fill → Task 5. The spec's §6.9 `ImportMatch` already covers all three (every key is a real compound unique, so all use `kind: 'unique'`); no `manual` match is needed in this phase.
- **Not in this plan.** Tier 2 (cohorts, alumni, admission campaigns, staff, compensation, budgets, publications, class offerings) and the `term-scoped` strategy, which only class offerings needs.
- **New framework surface is one property**, `rowRules`. Everything else is declarations. If a task finds itself extending the validator or the loader further, that is a signal the dataset does not fit the framework and is worth raising rather than working around.
- **The riskiest task is 3**, because the finance table is shared with a connector whose cost columns must survive an import. Its "leaves an existing directCost untouched" test is the one to write first and most carefully.
