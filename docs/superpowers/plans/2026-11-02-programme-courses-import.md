# Programme course lists from a spreadsheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `programme-courses` import dataset whose uploaded course lists take precedence over phase 2b's PDF extraction until the dataset is started over.

**Architecture:** One new declaration under `packages/db/src/import/datasets/`, two small framework additions (`ImportColumn.identity`, a `programme-scoped` strategy with `countForScope`), one ownership helper in `@kku/db` consumed by both `program_courses` writers in `apps/ingestion`.

**Tech Stack:** TypeScript strict, Prisma, Vitest (live dev Postgres for `packages/db/test`), NestJS api service.

**Spec:** `docs/superpowers/specs/2026-11-02-programme-courses-import-design.md`

## Global Constraints

- Do not touch `packages/shared/src/ai/prompts/program-courses-extract.ts` regexes, `extractCourseListSection`, or `program-courses-extract.v4`.
- No migration (`program_courses.ingestion_run_id` exists).
- `packages/db/src/import/` must never import `xlsx`.
- `methodVersion` of imported rows: `'xlsx-import.v1'` (constant `PROGRAMME_COURSES_IMPORT_VERSION`).
- DataSource slug: `xlsx-programme-courses`. Dataset slug `programme-courses`, sheet `Programme Courses`.
- Skip reason string, verbatim: `course list supplied by spreadsheet import — not re-extracting`.
- No `any`; Zod not needed (no new HTTP schema).
- The worktree holds unrelated uncommitted edits (8 files + `run-now-button.tsx`). Never `git add -A`; stage only files you changed. Two of them — `docs/data-import.md`, `docs/tutorials/program-deep-dive.md` — you also edit: stage with `git add -p` and take only your hunks.
- Never call the programmes loader in tests (sequence-number race); write fixture programmes directly with NEGATIVE `sequenceNoFromSheet`.

## Review Focus

1. A file with two programmes where one already holds an import and one holds PDF rows → both replaced, a third programme untouched. (Task 3 test)
2. `MEE 221` and `mee221` in one file for one programme → refused, both rows named; same code under two programmes → accepted. (Task 1 + Task 3 tests)
3. Phase 2b on an import-owned programme makes no PDF fetch and no AI call. (Task 4 test asserts `storage.getSignedDownloadUrl` not called)
4. Re-upload of a smaller list for one programme the import already owns → shrink guard compares against that programme's imported rows only; first upload over a 90-row extractor list is not refused. (Task 2 + Task 3 tests)
5. Start-over removes imported rows only, leaves another programme's PDF rows, and phase 2b's ownership check then returns false. (Task 3 + Task 4 tests)

---

### Task 1: `ImportColumn.identity` in the duplicate-key check

**Files:**
- Modify: `packages/db/src/import/types.ts` (ImportColumn)
- Modify: `packages/db/src/import/validate.ts` (keys section, `parts.push(...)` line)
- Test: `packages/db/test/import-validate.test.ts`

**Interfaces:**
- Produces: `ImportColumn.identity?: (value: ImportCellValue) => string`

- [ ] **Step 1: Failing test** `it('compares key cells through identity() when a column declares one')` — a throwaway dataset with key columns `[a, code]`, `code.identity = (v) => String(v).replace(/\s+/g,'').toUpperCase()`; rows `{a:'P', code:'MEE 221'}` (row 2) and `{a:'P', code:'mee221'}` (row 3) → `ok:false`, one error `{ row: 3, column: 'Code', message: 'Duplicate of row 2: these rows identify the same record.' }`. Second case: `{a:'Q', code:'MEE221'}` alongside row 2 → `ok:true`. Third: the accepted row still carries the raw `'MEE 221'` (identity is comparison-only).
- [ ] **Step 2:** `pnpm --filter @kku/db exec vitest run test/import-validate.test.ts` → FAIL.
- [ ] **Step 3:** Add the field (doc comment: comparison only, the stored value is untouched); in validate use `column.identity ? column.identity(value) : String(value)` for non-Date values.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5:** Commit `feat(import): columns can declare how their key cells compare`.

### Task 2: `programme-scoped` strategy + scope-aware shrink guard

**Files:**
- Modify: `packages/db/src/import/types.ts`, `packages/db/src/import/validate.ts`, `packages/db/src/import/index.ts` (export)
- Modify: `apps/api/src/import/import.service.ts` (deps + call site near line 298)
- Test: `packages/db/test/import-validate.test.ts`, `apps/api/test/import-service.test.ts`

**Interfaces:**
- Produces:
  - `ImportStrategy` gains `{ kind: 'programme-scoped'; scopeColumns: readonly string[]; match: ImportMatch }`
  - `ImportDataset.countForScope?: (prisma: PrismaClient, scopes: readonly Readonly<Record<string, ImportCellValue>>[]) => Promise<number>`
  - `ValidationContext.heldRowCountForScope?: number`
  - `readDeclaredScopes(dataset: ImportDataset, parsed: ParsedSheet): Readonly<Record<string, ImportCellValue>>[] | null` in `validate.ts` — distinct scope tuples from rows whose scope cells coerce cleanly; `null` unless programme-scoped.
  - `ImportServiceDeps.heldCountForScope(dataset, scopes): Promise<number | undefined>`

- [ ] **Step 1: Failing tests** (validate):
  - `programme-scoped: rows may name different scopes` — two rows, scope values `P1`, `P2` → `ok:true`, `term: null`.
  - `programme-scoped: shrink baseline is heldRowCountForScope, not heldRowCount` — 3 rows, `heldRowCount: 11_000`, `heldRowCountForScope: 4` → ok; same with `heldRowCountForScope: 10` → error containing `are already stored for it`.
  - `programme-scoped: undefined heldRowCountForScope means no prior rows` — `heldRowCount: 11_000`, field absent → ok (do NOT fall back to the table count for this kind).
  - `readDeclaredScopes returns distinct tuples` — rows P1, P1, P2 → `[{programmeCode:'P1'},{programmeCode:'P2'}]`.
  - (service) `passes the scope count to validation for a programme-scoped dataset` — stub `heldCountForScope` returns 4, `heldCount` 11 000, 3-row file → accepted.
- [ ] **Step 2:** Run both test files → FAIL.
- [ ] **Step 3:** Implement. Scope columns join `identityKeys`. Shrink baseline: term-scoped as now; programme-scoped → `ctx.heldRowCountForScope ?? 0`; else `heldRowCount`. Service: `const scopes = readDeclaredScopes(...)`; `heldRowCountForScope = scopes ? await deps.heldCountForScope(dataset, scopes) : undefined`; default dep calls `dataset.countForScope` or resolves undefined. No change to `runLoad`'s term argument.
- [ ] **Step 4:** Rerun → PASS; also `pnpm --filter @kku/db exec vitest run test/import-` and `pnpm --filter api exec vitest run test/import-` stay green.
- [ ] **Step 5:** Commit `feat(import): programme-scoped strategy replaces each programme a file names`.

### Task 3: the `programme-courses` dataset

**Files:**
- Create: `packages/db/src/import/datasets/programme-courses.ts`
- Create: `packages/db/src/program-course-ownership.ts` (export from `packages/db/src/index.ts`)
- Modify: `packages/db/src/import/registry.ts` (append after `programFacultyDataset`)
- Modify: `packages/shared/src/ingestion/catalog.ts` (entry after `xlsx-program-faculty`, same shape; notes: "Course lists per programme, uploaded through /admin/data-setup. PROGRAMME-SCOPED: a programme named in the file has its whole course list replaced. Takes precedence over phase 2b PDF extraction until started over.")
- Modify: `apps/api/src/admin-data-setup/raw-data.controller.ts` (fetcher `'programme-courses'`, mirror `'program-faculty'`: search programme code / course code / names; order by programme code, course code)
- Modify: `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx` (`'programme-courses': 'Programme course lists'`) and `apps/web/app/admin/data-setup/page.tsx` (a `RawDatasetLink` beside the programme-faculty one)
- Test: `packages/db/test/import-datasets-programme-courses.test.ts` (new, live DB, pattern of `import-datasets-program-faculty.test.ts`); registry/raw-view/cascade tests already exist and must pass.

**Interfaces:**
- Consumes: Task 1 `identity`, Task 2 strategy + `countForScope`.
- Produces:
  - `programmeCoursesDataset: ImportDataset`
  - `PROGRAMME_COURSES_IMPORT_VERSION = 'xlsx-import.v1'`
  - `COURSE_CATEGORY_LABELS: readonly { value: CourseCategory; en: string; th: string }[]` (the spec §3 table)
  - `parseCourseCategory(text: string): CourseCategory | null` (null = unrecognised)
  - In `program-course-ownership.ts`: `PROGRAMME_COURSES_SOURCE_SLUG = 'xlsx-programme-courses'`, `IMPORT_OWNED_SKIP_REASON = 'course list supplied by spreadsheet import — not re-extracting'`, `importOwnedProgramIds(client: Prisma.TransactionClient | PrismaClient, programIds: readonly string[]): Promise<Set<string>>`, `importOwnedCourseWhere(programIds)` (the `where` used by both the helper and `countForScope`).

Columns and checks exactly per spec §3: Course Code `identity: normaliseCourseCode`; Credits check `0 ≤ n ≤ 60` else `'Credits must be a whole number from 0 to 60.'`; Category `type: 'text'` with `check` → `parseCourseCategory` null gives `` `"${v}" is not a category. Use one of: General education, Core, Major required, Major elective, Free elective, Thesis / project, Unknown — or leave blank.` ``. Guide prose for Category must include the sentence about general-education courses and overlap (spec §3). Dataset `description` must say it is the fallback when PDF extraction cannot read the course list, and that a programme in the file has its whole list replaced. `tier: 2`, no `prefill`. Strategy `{ kind: 'programme-scoped', scopeColumns: ['programmeCode'], match: { kind: 'unique', columns: ['programmeCode','courseCode'] } }`.

- [ ] **Step 1: Failing tests** (`import-datasets-programme-courses.test.ts`), fixtures: faculty, programmes `PC-PROG-1` (has 3 PDF rows, `methodVersion 'program-courses-extract.v4'`, null run), `PC-PROG-2`, `PC-PROG-3` (2 PDF rows), one `ProgramRevision` set active on PROG-1:
  - `parseCourseCategory` accepts `'Major elective'`, `' major ELECTIVE '`, `'วิชาเฉพาะเลือก'`, `'MAJOR_ELECTIVE'` → `MAJOR_ELECTIVE`; `'Lab'` → null.
  - `load replaces every row of each programme in the file and nothing else` — load PROG-1 ×2 rows + PROG-2 ×1 → PROG-1 has exactly 2 rows, PROG-2 1, PROG-3 still 2; result `{ inserted: 3, updated: 0, deleted: 3 }`.
  - `stores normalised code, raw code, UNKNOWN for blank category, version, run, active revision` — row `courseCode 'MEE 221'`, category null → `courseCode 'MEE221'`, `courseCodeRaw 'MEE 221'`, `category 'UNKNOWN'`, `methodVersion 'xlsx-import.v1'`, `ingestionRunId === runId`, `programRevisionId === revisionId`.
  - `re-upload replaces the import's own previous rows` — second load of PROG-1 with 1 row → 1 row, new run id.
  - `countForScope counts only imported rows of the named programmes` — after load: PROG-1 → 2, PROG-3 → 0.
  - `importOwnedProgramIds` → `{PROG-1, PROG-2}` for all three ids.
  - `clear removes only rows of the given runs` — PROG-3's PDF rows survive; `importOwnedProgramIds` then empty.
  - `clearing programmes is refused while course rows exist` — `programmesDataset.cascadeBlockers(tx, [programmeRun])` includes label `courses` (fixture programme stamped with a programmes run).
  - validate via `validateSheet(programmeCoursesDataset, …)`: `MEE 221` + `mee221` same programme → duplicate error naming row 2; unknown category → message lists `Major elective`; credits 61 → refused.
- [ ] **Step 2:** `pnpm --filter @kku/db exec vitest run test/import-datasets-programme-courses.test.ts` → FAIL.
- [ ] **Step 3:** Implement the ownership module, the dataset (load: resolve codes → ids + `activeRevisionId`, `deleteMany({ programId: { in } })`, `createMany`), registry, catalogue, raw view, page titles/link.
- [ ] **Step 4:** Run the new test, then `pnpm --filter @kku/db exec vitest run test/import-` and `pnpm --filter api exec vitest run test/import-` → PASS. If api e2e names a missing `xlsx-*` source: `pnpm data-sources:sync --apply`, then rerun.
- [ ] **Step 5:** Commit `feat(import): programme course lists from a spreadsheet`.

### Task 4: phase 2b and the materialise script respect import ownership

**Files:**
- Modify: `apps/ingestion/src/program-courses-extract/run.ts` (after the programme lookup ~line 89; the write ~line 350)
- Modify: `apps/ingestion/src/scripts/materialise-program-courses.ts` (pre-loop lookup ~158, write ~258)
- Test: `apps/ingestion/test/program-courses-import-precedence.test.ts` (new)

**Interfaces:**
- Consumes: `importOwnedProgramIds`, `IMPORT_OWNED_SKIP_REASON` from `@kku/db`.

- [ ] **Step 1: Failing tests** — mock `@kku/db`'s prisma the way existing ingestion tests mock it (check `apps/ingestion/test/` for the pattern first):
  - `phase 2b skips an import-owned programme before fetching the PDF` — ownership returns the id → result `{ status: 'SKIPPED', reason: IMPORT_OWNED_SKIP_REASON }`; `storage.getSignedDownloadUrl` and the AI service never called.
  - `phase 2b writes nothing when the programme became import-owned during extraction` — ownership false at the start, true inside the transaction → no `deleteMany`/`createMany`, `materialisationRefusedReason === IMPORT_OWNED_SKIP_REASON`, `status 'SUCCEEDED'`.
  - `materialise script skips import-owned programmes even with --force` — extract the per-programme decision into an exported pure function if the script is not otherwise testable: `shouldMaterialise({ extractorOwned, importOwned, force }): 'write' | 'skip-extractor' | 'skip-import'`; assert `{importOwned:true, force:true}` → `'skip-import'`.
- [ ] **Step 2:** `pnpm --filter ingestion exec vitest run test/program-courses-import-precedence.test.ts` → FAIL.
- [ ] **Step 3:** Implement. In `run.ts` replace the array `$transaction` with an interactive one that re-checks `importOwnedProgramIds(tx, [program.id])` before deleting. In the script, query ownership alongside `extractorOwnedRows`, re-check inside its transaction, and log `skippedImportOwned`.
- [ ] **Step 4:** Rerun plus `test/program-courses-materialisation-guard.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(pipeline): phase 2b leaves imported course lists alone`.

### Task 5: docs, end-to-end on dev, `pnpm check`, CLAUDE.md

**Files:**
- Modify: `docs/data-import.md` (new dataset section: columns, category labels, GE-for-overlap warning, "fallback when PDF extraction can't read the course list", replace-per-programme, precedence, start-over is the only hand-back, the two workarounds from spec §6, the Deep-Dive course card needs class offerings with matching codes, KKU-specific GE prefix + 3-digit `PROSE_COURSE_CODE_RE` notes, why no description column)
- Modify: `docs/adopters/README.md` phase table (~line 530): add 2b "runs in parallel with 1"; add CR (curriculum revision, after RE, insert-only) and OV (programme overlap, after 7; deferred to one batch run when several programmes are processed); note imported programmes are skipped by 2b. Confirm OV's placement and name in `programs-pipeline.ts` before writing.
- Modify: `docs/tutorials/program-deep-dive.md` step 5 (when the PDF can't be read: upload the course list)
- Modify: `CLAUDE.md` institute-import status line (fifteen→sixteen datasets incl. programme-courses) + a decisions entry
- [ ] **Step 1:** Write the docs; `pnpm docs:build` → exits 0 (no dead links, no retired names).
- [ ] **Step 2:** Dev end to end on programme `cmvhxzs99008wpq2spzjf2lfk` (code 2514001): upload a sheet of real KMUTT codes through `/admin/data-setup` (or the api endpoint); `pnpm programs:pipeline 2514001 --only=phase2b` → log shows SKIPPED with the reason and the row count is unchanged; run phase OV for 2514001 → its log counts these courses (embedded majors > 0); start over in the UI; rerun phase 2b → not skipped for ownership (it may then SKIP on "Could not locate the รายวิชา section" — that is the expected hand-back for this PDF). Record the counts.
- [ ] **Step 3:** `pnpm check` → only the known pre-existing failures listed in CLAUDE.md.
- [ ] **Step 4:** Commit `docs(import): programme course lists, precedence over phase 2b` (stage hunks only).
