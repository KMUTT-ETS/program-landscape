# Workshop Mock Data Generator — Node.js Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Python generator (`scripts/workshop-mock/`, reviewed and working at `f06d0bdd`) with a TypeScript one that participants run with `pnpm workshop:mock <input.json>`. Same behaviour and rules, plus calling the app's own code instead of copying it.

**Architecture:** TypeScript modules in `apps/ingestion/src/scripts/workshop-mock/` (ingestion already has `xlsx`, `pdfjs-dist`, `@kku/db`, `@kku/shared`). Run with `tsx`, like `pnpm curriculum:check`. Tests in `apps/ingestion/test/workshop-mock/`. The api-side round-trip check (`apps/api/scripts/workshop/check-mock.ts`, `apps/api/test/workshop-mock.test.ts`) stays and runs the TS generator in a subprocess instead of Python.

**Tech Stack:** TypeScript strict, Vitest, `xlsx` 0.18.5, `extractNativeText` (`apps/ingestion/src/pdf-intake/pipeline/native-text-extractor.ts`), `@kku/shared` (`buildTcasMatchIndex`, `findOwnProgrammeMatch`, `extractSpecialization`, `courseCodeRegex`), `@kku/db` (`IMPORT_DATASETS` / `getImportDataset`, `validateSheet`).

**Spec:** `docs/superpowers/specs/2026-11-07-workshop-mock-data-design.md` (language changed to Node.js on 2026-11-07; all consistency rules and "Calls made" stand).

**Reference implementation:** the Python package at `scripts/workshop-mock/` (`wsmock/*.py`, `tests/test_*.py`, `fixtures/`). Every behaviour, rule and test there was reviewed. Port it faithfully, including the review fixes recorded in the SDD ledger rulings R5–R10. Where the Python code copied app logic (tcas_match.py, the course-code regex, `SHEETS`, `PAGE_TITLES`), call the app instead.

## Global Constraints

- Everything from the Python plan's Global Constraints still holds: staff tokens `อาจารย์ NNN` / `Lecturer NNN`; `MOCK-` codes; "mock" in invented free text; CE years; rates 0–1; `groupSizeFor` values ≥ 8; no 13-digit mod-11-valid number; bachelor Thai names byte-identical to the latest-year TCAS cell; English names never contain U+0E00–U+0E7F; deterministic (same input + seed → byte-identical files, including across clock seconds).
- **Input file is JSON** (no new dependency): `{ "university": "...", "region": "...", "programmes": [ { "name", "pdf"?, "level"?, "faculty"?, "tcas_code"?, "courses"?, "name_en"? } ] }`. Relative paths resolve against the JSON file's folder.
- **CLI:** `pnpm workshop:mock <input.json> [--size small|medium] [--seed N] [--out DIR] [--cache DIR] [--offline] [--tcas-file PATH:YEAR:ROUND ...]`. Defaults: `--size small --seed 2026 --out ./workshop-mock-out --cache <out>/.cache`. Relative paths from the user resolve against `INIT_CWD` (the folder pnpm was run from). Exit 0 success, 2 expected error (bad input, no confident match, offline without cache, corrupt TCAS file) with a message and no stack trace.
- Determinism: never use `Math.random`; use a seeded PRNG (e.g. mulberry32 seeded from a SHA-256 of a string, the same approach as `apps/api/scripts/workshop/sample-data.ts`). Never iterate a `Set`/`Map` built in non-deterministic order without sorting. Pin every xlsx metadata timestamp and zip entry time.
- Before writing any file, the generator runs each sheet's rows through the app's real `validateSheet` (references from earlier sheets, `heldRowCount: 0`, `allowShrink: false`, `maxRows: 5000`) and exits 2 with the errors if any sheet fails. A generated set that the app would refuse is never written.
- TypeScript strict, no `any`, pathlib-equivalent `path.join`, no shell calls from the script.
- A concurrent session edits this worktree (see the SDD `common.md`). Stage named paths only; never `git add -A`, stash, reset or checkout files.

## Review Focus

1. TCAS header variants for every year 2562–2569 (English 2565 headers, 2566 `คณะ/สำนักวิชา`, plain `ผ่าน`, multi-line headers) — ported tests with each real header row.
2. Typed-name resolution against the latest TCAS year only, with the max-over-views score and the international-twin tie-break (KKU computer vs semiconductor; KMUTT 0507A).
3. Per-year TCAS figures come from `findOwnProgrammeMatch` over all own rows of all years, in slice order.
4. PDF text from `extractNativeText` differs from pypdf's: course codes, credits and heading categories must still come out right on `fixtures/curriculum-sample.pdf`; names with lost Thai marks or control characters become blank.
5. Byte-identical output across two runs more than a second apart.

---

### Task 1: TCAS, inputs and slice (port of tcas.py, inputs.py, thai_en.py, slice.py)

**Files:** create `apps/ingestion/src/scripts/workshop-mock/{tcas,inputs,thai-en,slice,rng}.ts`; tests `apps/ingestion/test/workshop-mock/{tcas,inputs,slice}.test.ts`; move fixtures to `apps/ingestion/test/fixtures/workshop-mock/` (`tcas-sample.xlsx`, `curriculum-sample.pdf`, `README.md`; drop `tcas-match-cases.json` — the app's matcher is used directly).

**Produces (exported, used by Tasks 2–3):** `TcasRow`, `TcasTotals`, `TCAS_FILES`, `loadRows(cacheDir, {offline, files?: Array<{path, entryYearBE, round}>})`, `ownRows`, `closestInstitutions`, `round3Totals`; `ProgrammeInput`, `Inputs`, `InputError`, `Anchor`, `loadInputs(jsonPath)`, `resolveAnchors`; `Faculty`, `Department`, `Programme` (incl. `tcas: Map<number, TcasTotals>` keyed by CE year, sorted), `Slice` (incl. `notes: string[]`, `latestYearCE`, `yearsCE`), `SIZES`, `chooseSlice(anchors, own, size, rng)`; `Rng` (`next()`, `int(lo, hi)`, `uniform(lo, hi)`, `choice`, `shuffle`, `child(label)`), `makeRng(seed: string | number)`.

- [ ] Port each Python test in `test_tcas.py`, `test_inputs.py`, `test_slice.py` (and the matcher-related cases of `test_tcas_match.py` that exercise linkage through the app matcher) to Vitest first; run → RED.
- [ ] Port the modules. Linkage uses `buildTcasMatchIndex` / `findOwnProgrammeMatch` from `@kku/shared`. Read xlsx with `xlsx` (`sheet_to_json` with `header: 1`, `raw: true`, `defval: null`).
- [ ] Tests GREEN; real-data check on `.superpowers/sdd/2026-11-07-workshop-mock-data/tcas-dl/` for KMUTT and KKU (anchors as in the Python reports) printed into the report.
- [ ] Commit `feat(workshop-mock): TypeScript TCAS reader, anchors and slice`.

### Task 2: courses, people and dataset rows (port of courses.py, people.py, datasets.py)

Depends on Task 1's exports. **Files:** `apps/ingestion/src/scripts/workshop-mock/{courses,people,datasets}.ts`; tests `apps/ingestion/test/workshop-mock/{courses,people,datasets}.test.ts`.

**Produces:** `Course`, `coursesFromPdf(path): Promise<{courses, note}>` (via `extractNativeText`; codes via `courseCodeRegex('g')` from `@kku/shared`), `coursesFromCsv`, `inventedCourses(programme, rng, departmentNameEn)`, `shareWithSibling`; `Staff`, `RosterLink`, `Publication`, `makeStaff`, `makePublications(slice, staff, links, rng, today?)` (injectable `today`, clear error when the year window is empty); `UPLOAD_ORDER`, `World`, `buildRows(slug, world): Array<Record<string, string | number | null>>` keyed by the declaration headers — headers, sheet names and titles come from `getImportDataset(slug)`, not a copied literal.

- [ ] Port `test_courses.py`, `test_people.py`, `test_datasets.py` to Vitest (drop tests that only guarded the Python regex port; keep the PDF-fixture, control-character, GE/LI prefix, share, research-readiness, TCAS-equality, nearest-year, alumni, seed and floor tests) → RED.
- [ ] Port the modules → GREEN. Add one test that runs every sheet through `validateSheet` on a medium slice of the fixture.
- [ ] Commit `feat(workshop-mock): TypeScript courses, people and dataset rows`.

### Task 3: CLI, writer, check, tests, CI, and removal of the Python code

**Files:** create `apps/ingestion/src/scripts/workshop-mock/{generate,write}.ts`, `apps/ingestion/src/scripts/workshop-mock/README.md`, `example-input.json`, test `apps/ingestion/test/workshop-mock/generate.test.ts`, fixture input `apps/ingestion/test/fixtures/workshop-mock/fixture-input.json`. Modify root `package.json` (`"workshop:mock": "tsx apps/ingestion/src/scripts/workshop-mock/generate.ts"`, keep `workshop:check-mock`), `apps/api/scripts/workshop/check-mock.ts` (read JSON input instead of the TOML regex; catch unreadable cache files), `apps/api/test/workshop-mock.test.ts` (spawn the TS generator via `pnpm exec tsx`, drop the Python-only drift guards that no longer apply, keep importer + matcher + byte-identical-name checks, no skip needed), `.github/workflows/pr.yml` (remove the setup-python, pip and Python unittest steps). Delete `scripts/workshop-mock/` entirely (`git rm -r`).

- [ ] Port `test_generate.py` (exit codes, 20 files + README.txt + `.gitignore` `*`, `.cache` copy for `--tcas-file`, offline, corrupt TCAS file, control character refusal by the writer, byte-identical output across two runs ≥ 1.1 s apart) → RED.
- [ ] Implement; README.txt content as the Python `write_readme` (paths `/admin/organization` Identity tab, `/admin/data-setup` "Upload filled template", `/admin/data-sources` after uploads, rankings pre-filled template, start-over order, notes, anchor ↔ TCAS rows) but commands for `pnpm workshop:mock`.
- [ ] GREEN: ingestion workshop-mock tests, `pnpm --filter api exec vitest run test/workshop-mock.test.ts test/workshop-sample-data.test.ts`, `pnpm typecheck`, eslint on changed files. Real run for KMUTT on the downloaded files + `pnpm workshop:check-mock` → 0 errors, all bachelor programmes matched.
- [ ] Commit `feat(workshop-mock): pnpm workshop:mock replaces the Python generator`.

### Task 4: Docs (EN + TH)

As the old plan's Task 10, under ruling R11 (edit only `docs/workshop/03-university-data.md`, its `.th.md`, and `docs/data-import.md`, and only while they are clean), with `pnpm workshop:mock <input.json>` instead of Python and no virtual-environment step. Runs in parallel with Task 2 (the CLI contract above is fixed). `pnpm docs:build` must pass.

### Task 5: Clean-install acceptance run

Unchanged from the old plan's Task 11 (ruling R3), using `pnpm workshop:mock`.
