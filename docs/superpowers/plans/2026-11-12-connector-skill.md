# Connector Skill + `connector:verify` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give adopters' AI agents a skill that walks them through creating and maintaining dataset API connectors, backed by a read-only `pnpm connector:verify <slug>` command that proves a connector's data reaches the app.

**Architecture:** `connector:verify` is a tsx script under `apps/ingestion/src/scripts/connector-verify/`, split into pure check logic (runs against a `VerifyReader` interface, unit-tested with a fake), a Prisma-backed reader plus a per-dataset visibility table (scratch-DB tested), and a thin CLI. The skill is plain markdown in `.claude/skills/managing-connectors/` that routes the agent through triage → create / maintain, and treats `verify` as the definition of done. Docs are updated to point at both.

**Tech Stack:** TypeScript strict, tsx, Prisma, Zod, Vitest (`describeScratchDb` for DB tests), VitePress docs (`pnpm docs:build`).

**Spec:** `docs/superpowers/specs/2026-11-12-connector-skill-design.md`

## Global Constraints

- TypeScript strict, **no `any`**; Zod-validate anything parsed from JSON (`IngestionRun.metadata`).
- `connector:verify` is **read-only**: no DB writes, never runs a connector, never calls the upstream API.
- **Never print env values or row values** — env var *names* only; counts only for rows.
- Cross-platform: `path.join`, no POSIX shell in scripts, no `rimraf` needed.
- Scope: **dataset API connectors only** (entries in `INSTITUTION_CONNECTORS`, classes extending `DatasetApiConnector`).
- Exit codes: `0` no FAIL, `1` at least one FAIL, `3` invocation error (bad args, no DB) — mirrors `connector:run`'s `3`.
- Rows from a dataset API connector are stamped with the **per-dataset import run** (`metadata.datasets[<slug>].importRunId`), which belongs to the `xlsx-<dataset>` DataSource — not with the connector's own run.
- Do not modify `prompts/*`. Do not modify `packages/db` dataset declarations.
- Docs: Thai twins under `docs/th/` mirror their English page's headings; `pnpm docs:build` must pass.
- Commits: conventional, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; use `git commit -F <file>` (the dev guard may block inline messages).

## Review Focus

1. **Secret / value leakage** — a `CONNECTOR_<SLUG>_TOKEN` value or a row value appears in human or `--json` output. Expected: names and counts only. (Task 1 test `never prints env values`.)
2. **Slug typed without the `api-` prefix** (`practice-intake` instead of `api-practice-intake`). Expected: FAIL that names the likely slug. (Task 1 test `suggests the api- prefix`.)
3. **No database / `DATABASE_URL` unset or unreachable** — expected: one-line message and exit 3, no stack trace. (Task 3 test `exits 3 when the database is unreachable`.)
4. **Multi-dataset connector where one dataset was refused and another loaded** — expected: per-dataset results, the loaded one PASSes, the refused one FAILs with its first error's dataset/record/column. (Task 1 test `reports each dataset separately`.)
5. **A run is in progress** (latest run `RUNNING`/`QUEUED`) — expected: WARN "run in progress", checks 5–7 SKIP, not FAIL. (Task 1 test `run in progress is a warning`.)

---

## File Structure

```
apps/ingestion/src/scripts/connector-verify/
  types.ts        CheckId, CheckStatus, CheckResult, VerifyReader, RunSummary, RowCounts
  checks.ts       runChecks(): the seven checks, pure over VerifyReader
  format.ts       formatReport(), exitCodeFor()
  visibility.ts   DATASET_VISIBILITY table (dataset slug → row counters)
  prisma-reader.ts  createPrismaReader(): VerifyReader
  verify.ts       CLI entry (args, .env, --json, exit codes)
apps/ingestion/test/connector-verify/
  checks.test.ts         fake-reader unit tests
  prisma-reader.test.ts  scratch-DB test
  cli.test.ts            arg / exit-code tests
.claude/skills/managing-connectors/
  SKILL.md
  field-mapping.md
  troubleshooting.md
  pii.md
```

---

### Task 1: Check logic and report formatting

**Files:**
- Create: `apps/ingestion/src/scripts/connector-verify/{types,checks,format}.ts`
- Test: `apps/ingestion/test/connector-verify/checks.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type CheckId = 'registered' | 'env' | 'sources' | 'latest-run' | 'provenance' | 'visible' | 'reaches-programme';
  export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  export interface CheckResult { id: CheckId; status: CheckStatus; dataset?: string; reason: string; next?: string }
  export interface RunSummary {
    id: string; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'; // match IngestionRunStatus enum
    startedAt: Date | null; errorCode: string | null; errorMessage: string | null;
    recordsFetched: number; recordsLoaded: number; recordsFailed: number; metadata: unknown;
  }
  export interface RowCounts { stamped: number; visible: number; linked: number | null } // linked null → dataset has no programme/faculty key
  export interface VerifyReader {
    dataSources(slugs: readonly string[]): Promise<ReadonlyArray<{ slug: string; mocked: boolean; baseUrl: string | null }>>;
    latestRun(sourceSlug: string): Promise<RunSummary | null>;
    rowCounts(dataset: string, importRunId: string): Promise<RowCounts | null>; // null → no visibility entry for this dataset
  }
  export interface VerifyTarget { slug: string; datasets: readonly string[] } // resolved connector
  ```
- Produces (`checks.ts`): `resolveTarget(slug: string, entries: readonly ConnectorEntry[]): VerifyTarget | CheckResult` (returns a FAIL `registered` result when unresolved) and `runChecks(slug: string, deps: { entries: readonly ConnectorEntry[]; catalog: readonly SourceCatalogEntry[]; env: Readonly<Record<string, string | undefined>>; reader: VerifyReader }): Promise<CheckResult[]>`.
- Produces (`format.ts`): `formatReport(slug: string, results: readonly CheckResult[]): string` and `exitCodeFor(results: readonly CheckResult[]): 0 | 1`.
- Consumes: `INSTITUTION_CONNECTORS`/`ConnectorEntry` (`apps/ingestion/src/connectors/sources/institution/index.ts`, `registry.ts`), `DatasetApiConnector` (instantiate `entry.real ?? entry.mock`, `instanceof DatasetApiConnector`, read `.datasets`), `INSTITUTION_SOURCES` / `SourceCatalogEntry`, `importDataSourceSlug()` from `@kku/db`.

Check semantics (order; a check whose prerequisite FAILed is `SKIP` with reason "skipped: <id> failed"):
1. `registered` — slug in `INSTITUTION_CONNECTORS` **and** `INSTITUTION_SOURCES`, and the factory yields a `DatasetApiConnector`. Otherwise FAIL. If `api-${slug}` would match, the reason names it.
2. `env` — BASE_URL: PASS if `CONNECTOR_<SLUG>_BASE_URL` set **or** the connector's DataSource `baseUrl` is set; else FAIL (`next`: set `CONNECTOR_<SLUG>_BASE_URL`). TOKEN unset → WARN (some APIs need none). Report env **names** only.
3. `sources` — DataSource rows exist for the connector slug and for every `xlsx-<dataset>`, all `mocked=false`. Missing → FAIL, `next: 'pnpm data-sources:sync --apply'`. Mocked → FAIL naming the slug and the catalogue file.
4. `latest-run` — `reader.latestRun(slug)`. None → FAIL, `next: 'pnpm connector:run <slug>'`. `QUEUED`/`RUNNING` → WARN. `FAILED`/`SKIPPED` → FAIL with `errorCode` + `errorMessage` and, when metadata has `errors[0]`, its `dataset`, `record`, `column`. `SUCCEEDED` → PASS with `recordsFetched/Loaded`. Parse `metadata` with a Zod schema matching `DatasetApiConnector`'s `{ datasets: Record<slug, {importRunId?, rows, inserted, updated, deleted, status}>, warnings, errors, totalErrors }`; unparseable → FAIL "run metadata is not from a dataset API connector".
5–7 run **per dataset** (`dataset` field set), only when check 4 is PASS or FAIL-with-metadata:
5. `provenance` — dataset status not `LOADED` → FAIL (status + first matching error). `rows === 0` → WARN "the API returned no rows". `rowCounts` null → SKIP "no visibility check for this dataset yet". `stamped === 0` → FAIL. Else PASS with count.
6. `visible` — needs 5 PASS. `visible === stamped` → PASS; else FAIL "rows are hidden by realDataWhere()", `next` names `pnpm data-sources:audit`.
7. `reaches-programme` — needs 6 PASS. `linked === null` → SKIP "dataset is not keyed by programme or faculty". `linked === 0` → WARN "loaded rows link to no programme/faculty — check code mapping". Else PASS.

`formatReport`: one line per result `STATUS  id[ (dataset)]  reason`, plus an indented `→ <next>` line when present, then a summary line `N passed, N failed, N warnings, N skipped`. Exact spacing is the implementer's call.

- [ ] **Step 1: Write the failing tests** in `checks.test.ts` using a fake `VerifyReader` and hand-built `ConnectorEntry` fixtures (a tiny `DatasetApiConnector` subclass with `datasets = ['enrollment-metrics', 'faculties']`). Tests:
  - `unknown slug fails registered and skips the rest` — results[0] `{id:'registered', status:'FAIL'}`; every other result `SKIP`; `exitCodeFor` → 1.
  - `suggests the api- prefix` — slug `demo` when `api-demo` exists → reason contains `api-demo`.
  - `never prints env values` — env `CONNECTOR_API_DEMO_TOKEN='s3cr3t-value'`, `..._BASE_URL='https://x.example/abc'`; `formatReport(...)` and `JSON.stringify(results)` contain neither value but contain `CONNECTOR_API_DEMO_BASE_URL`.
  - `missing base url fails env, missing token warns`.
  - `missing xlsx source points to data-sources:sync` — `next === 'pnpm data-sources:sync --apply'`.
  - `mocked source fails sources`.
  - `no run yet points to connector:run and skips 5-7` — `next === 'pnpm connector:run api-demo'`.
  - `run in progress is a warning` — status `RUNNING` → `latest-run` WARN, checks 5–7 SKIP, exit 0.
  - `reports each dataset separately` — metadata: `enrollment-metrics` LOADED (importRunId `r1`), `faculties` REFUSED with `errors[0] = {dataset:'faculties', record:3, column:'Faculty Code', message:'...'}`; run FAILED/`VALIDATION`. Expect `provenance (enrollment-metrics)` PASS and `provenance (faculties)` FAIL whose reason contains `record 3` and `Faculty Code`.
  - `hidden rows fail visible` — `rowCounts` `{stamped:10, visible:0, linked:0}` → `visible` FAIL, `reaches-programme` SKIP.
  - `unsupported dataset skips` — `rowCounts` null → `provenance` SKIP.
  - `non-programme dataset skips reaches-programme` — `linked: null` → SKIP.
  - `zero linked rows warn` — `linked: 0` → WARN, exit 0.
  - `all good exits 0` — everything PASS.

- [ ] **Step 2: Run to confirm failure**
  Run: `pnpm --filter ingestion exec vitest run test/connector-verify/checks.test.ts`
  Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `types.ts`, `checks.ts`, `format.ts`** per the interfaces and semantics above.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `pnpm --filter ingestion exec vitest run test/connector-verify/checks.test.ts`
  Expected: all PASS (count matches the tests written).

- [ ] **Step 5: Commit** — `feat(ingestion): connector:verify check logic`

---

### Task 2: Prisma reader and per-dataset visibility table

**Files:**
- Create: `apps/ingestion/src/scripts/connector-verify/visibility.ts`, `apps/ingestion/src/scripts/connector-verify/prisma-reader.ts`
- Test: `apps/ingestion/test/connector-verify/prisma-reader.test.ts`

**Interfaces:**
- Consumes: `VerifyReader`, `RunSummary`, `RowCounts` (Task 1); `prisma`, `realDataWhere` from `@kku/db`.
- Produces:
  ```ts
  // visibility.ts
  export interface DatasetVisibility {
    count(prisma: PrismaClient, where: Record<string, unknown>): Promise<number>;
    /** Extra where-clause meaning "row links to a programme or faculty"; omitted → not programme/faculty keyed. */
    linkedWhere?: Record<string, unknown>;
  }
  export const DATASET_VISIBILITY: Readonly<Record<string, DatasetVisibility>>;
  // prisma-reader.ts
  export function createPrismaReader(prisma: PrismaClient): VerifyReader;
  ```

`DATASET_VISIBILITY` initial entries — the model is the one each dataset's own `count()` uses in `packages/db/src/import/datasets/<file>.ts`: `programmes` (program), `faculties` (faculty), `departments` (department), `faculty-members` (facultyMember), `enrollment-metrics` (enrollmentMetric, linked: `programId` not null), `financial-metrics` (financialMetric), `class-offerings` (classOffering), `graduate-outcomes` (graduateOutcome), `admission-campaigns`. For each, set `linkedWhere` only if the model has a `programId`/`facultyId` column that a mapping error could leave null or point at no canonical programme; otherwise omit. Any `where`-typing friction is solved with per-entry typed closures, not `any`.

`rowCounts(dataset, runId)`: no entry → `null`; else `stamped = count({ ingestionRunId: runId })`, `visible = count({ ingestionRunId: runId, ...realDataWhere() })`, `linked = linkedWhere ? count({ ingestionRunId: runId, ...linkedWhere }) : null`.
`latestRun(sourceSlug)`: newest `IngestionRun` for that DataSource by `createdAt` desc.
`dataSources(slugs)`: `findMany` selecting `slug, mocked, baseUrl`.

- [ ] **Step 1: Write the failing test** with `describeScratchDb` (`apps/ingestion/test/helpers/scratch-db.ts`). Seed in `beforeAll` (guarded by `SCRATCH_DB`): a real (`mocked:false`) `xlsx-enrollment-metrics` source and a mocked one for a second dataset, one connector DataSource, an `IngestionRun` per source, and a few `enrollmentMetric` rows stamped with the real import run. Clean up in `afterAll`. Tests:
  - `latestRun returns the newest run` — two runs; returns the later one's id.
  - `rowCounts counts stamped and visible rows` — `{stamped:n, visible:n}` for the real source.
  - `rowCounts shows hidden rows for a mocked source` — `visible: 0`, `stamped > 0`.
  - `rowCounts returns null for a dataset without an entry` — e.g. `population-projections`.
  - `every DATASET_VISIBILITY key is an import dataset` — each key passes `getImportDataset(key)` (no DB needed; put it outside the scratch-db describe so it always runs).

- [ ] **Step 2: Run to confirm failure**
  Run: `pnpm --filter ingestion exec vitest run test/connector-verify/prisma-reader.test.ts`
  Expected: FAIL — module not found (DB tests skip unless `DATABASE_URL` ends in `_test`; run them against the scratch DB as other scratch suites are run here).

- [ ] **Step 3: Implement `visibility.ts` and `prisma-reader.ts`.**

- [ ] **Step 4: Run tests** — same command; Expected: PASS (and confirm the scratch-DB tests actually ran, not skipped).

- [ ] **Step 5: Commit** — `feat(ingestion): connector:verify reads runs and row visibility`

---

### Task 3: CLI, pnpm script, scaffolder hint

**Files:**
- Create: `apps/ingestion/src/scripts/connector-verify/verify.ts`
- Modify: root `package.json` (add `"connector:verify": "tsx apps/ingestion/src/scripts/connector-verify/verify.ts"` beside `connector:run`), `apps/ingestion/src/scripts/connector-new/generate.ts:245` (Next steps list gains `pnpm connector:verify api-<name>` after the run step)
- Test: `apps/ingestion/test/connector-verify/cli.test.ts`, update `apps/ingestion/test/connector-new.test.ts` if it asserts the next-steps text

**Interfaces:**
- Consumes: `runChecks`, `formatReport`, `exitCodeFor` (Task 1); `createPrismaReader` (Task 2); `INSTITUTION_CONNECTORS`, `INSTITUTION_SOURCES`.
- Produces: `export async function main(argv: readonly string[], io: { out(s: string): void; err(s: string): void }, deps?: Partial<{ reader: VerifyReader }>): Promise<0 | 1 | 3>`; the module only auto-runs when it is the entry point.

Behaviour: `pnpm connector:verify <slug> [--json]`. Loads `.env` from cwd the same way `run-connector.ts` does (copy its `loadDotEnv`, don't refactor the ten existing copies). Calls `loadOrganization()` as `run-connector.ts` does. No slug / `--help` → usage text, exit 3. DB connection failure → `io.err` one line ("could not reach the database — is it running? (pnpm db:up)"), exit 3. `--json` prints `JSON.stringify({ slug, results }, null, 2)`.

- [ ] **Step 1: Write the failing tests** (`cli.test.ts`, fake reader via `deps`):
  - `no slug prints usage and exits 3`.
  - `exits 3 when the database is unreachable` — reader whose methods reject with a Prisma connection error → returns 3, `err` called once, output has no stack trace (`not.toContain('    at ')`).
  - `--json prints parseable results` — `JSON.parse(out)` has `slug` and `results[]`.
  - `exit code follows results` — all-PASS fake → 0; FAIL fake → 1.
  - In `connector-new.test.ts`: next-steps output contains `pnpm connector:verify api-demo`.

- [ ] **Step 2: Run to confirm failure**
  Run: `pnpm --filter ingestion exec vitest run test/connector-verify/cli.test.ts test/connector-new.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `verify.ts`, add the script, update `generate.ts`.**

- [ ] **Step 4: Run tests** — same command → PASS. Then run `pnpm --filter ingestion exec vitest run test/bundled-script-coverage.test.ts`; if it flags `connector:verify` (it will once Task 5 names it in docs), add the script to `TARGETS` in `apps/ingestion/scripts/bundle-pipeline-scripts.ts` as `connector:run` is handled.

- [ ] **Step 5: Manual smoke (dev DB, read-only):** `pnpm connector:verify api-does-not-exist` → FAIL `registered`, exit 1. `pnpm connector:verify` → usage, exit 3.

- [ ] **Step 6: Commit** — `feat(ingestion): pnpm connector:verify`

---

### Task 4: The skill

**Files:**
- Create: `.claude/skills/managing-connectors/{SKILL.md,field-mapping.md,troubleshooting.md,pii.md}`

**Interfaces:**
- Consumes: the command names and check ids from Tasks 1–3 (`registered`, `env`, `sources`, `latest-run`, `provenance`, `visible`, `reaches-programme`).

Use **superpowers:writing-skills** for authoring. Required content (wording is the implementer's):

- `SKILL.md` frontmatter: `name: managing-connectors`; `description` starting "Use when adding, fixing, extending or retiring a connector that loads an institution's own data from an HTTP/JSON API into Program Landscape import datasets…" — triggers include "connect our API", "load data from our system", "connector run failed", "Deep-Dive is empty after a load".
- Body sections, in order:
  1. **Scope** — dataset API connectors only. DB-only access → export to XLSX, upload per `docs/data-import.md`, stop. Other connector kinds → `docs/guides/write-a-connector.md`.
  2. **Hard rules** — code over docs (name the source-of-truth files from the spec's Constraints); no real personal data in fixtures/logs/metadata/chat/commits (point to `pii.md`); never print `.env` values (`cut -d= -f1 .env` for names); destructive DB commands go to the operator; never set `CONNECTOR_<SLUG>_ALLOW_SHRINK` without the human's explicit say-so, and unset it after; not done until `pnpm connector:verify <slug>` has no FAIL.
  3. **Triage** — what does the human have (docs / sample JSON / DB only)? new vs existing (`pnpm connector:new --list`, `packages/shared/src/ingestion/institution-catalog.ts`)? → route.
  4. **Create flow** — the eight steps from the spec §1 (plan with `field-mapping.md`; probe with one `curl -H "Authorization: Bearer $CONNECTOR_<SLUG>_TOKEN"` — shown so the token is read from env, never pasted; scaffold with `--dry-run` first; implement `fetchAll`/`toRows`, `ctx.log` only; fixture + test asserting the outgoing request; env; `data-sources:sync --apply` → `connector:run` → `connector:verify` loop; record in `docs/data-sources/<slug>.md` from `_template.md` + docs-impact check).
  5. **Maintain flow** — one subsection each: API changed; token expired/rotated (401/403, restart worker); shrink guard; add/split a dataset; retire (`scheduleEnabled:false`, `deprecated:true`, never delete DataSource or runs).
  6. **Reading `connector:verify`** — one line per check id → what to do; link `troubleshooting.md`.
- `field-mapping.md` — reading a dataset declaration (`packages/db/src/import/datasets/<file>.ts`: headers, `required`, enums, `rowRules`, strategy), mapping-table format, traps: Buddhist Era vs CE, academic vs fiscal year, programme/faculty code matching against already-loaded `programmes`/`faculties`, `nameTh`/`nameEn`, dependency order (`IMPORT_DATASETS` order).
- `troubleshooting.md` — symptom → cause → fix table keyed to check ids and run error codes (`CONFIG`, `VALIDATION`, `LOAD`, `EMPTY_DATA`, `MOCK_NOT_ALLOWED`, `UNHEALTHY`, `NOT_IMPLEMENTED`, 401/403, row cap / `MAX_ROWS`, shrink refusal, empty Deep-Dive).
- `pii.md` — what counts as personal data (national ID, passport, name+student/staff ID together, phone, personal email, address, health, religion, financial); turning a sample response into a fixture with invented values; aggregate or drop personal fields in `toRows`; run logs are masked but never log rows anyway.

- [ ] **Step 1:** Draft the four files.
- [ ] **Step 2:** Check every path, command and error code the skill names exists: `grep` each in the repo; fix mismatches.
- [ ] **Step 3:** Commit — `feat(skills): managing-connectors skill for dataset API connectors`

---

### Task 5: Docs

**Files:**
- Modify: `docs/data-sources/README.md` ("Adding a new source" section, lines ~69–76)
- Modify: `docs/guides/write-a-connector.md` and `docs/th/guides/write-a-connector.md` (dataset-API section, near the `connector:run` step ~line 131)
- Modify: `docs/tutorials/load-data-from-an-api.md` and `docs/th/tutorials/load-data-from-an-api.md` (after the run step)
- Modify: `docs/superpowers/notes/decisions-log.md` (new entry at top of "Recent decisions"), `CLAUDE.md` (one line under the API dataset connectors status item)

- [ ] **Step 1:** README "Adding a new source": first bullet — *institution API* → follow `.claude/skills/managing-connectors/SKILL.md` (scaffold with `pnpm connector:new`, finish with `pnpm connector:verify`). Then the other-kinds steps, corrected: catalog entry → connector class under `sources/<slug>/` → registry entry → `pnpm data-sources:sync --apply` → spec page from `_template.md` → status table. Drop "drop a mock connector class". Leave "Flipping a connector from mocked to real" unchanged.
- [ ] **Step 2:** Guide (EN + TH, same heading structure): after the run step add a `pnpm connector:verify api-myuni-classes` step and one sentence on what it checks; add one sentence pointing AI-agent users to the skill.
- [ ] **Step 3:** Tutorial (EN + TH): add a verify step after the run step, showing the expected all-PASS summary line shape.
- [ ] **Step 4:** Decisions-log entry (what, why, check list, the "read-only" and "dataset API only" scope, spec + plan paths) and the CLAUDE.md status line.
- [ ] **Step 5:** Run `pnpm docs:build` → exits 0. Run `pnpm --filter ingestion exec vitest run test/bundled-script-coverage.test.ts` → PASS (fix per Task 3 Step 4 if not).
- [ ] **Step 6:** Commit — `docs: connector:verify and the managing-connectors skill`

---

### Task 6: Acceptance — fresh agent against the mock API

**Files:** none committed except fixes found; a short result note appended to the decisions-log entry.

- [ ] **Step 1:** Prepare: `pnpm workshop:mock` data folder + `pnpm workshop:mock-api <folder>` running; dev DB up; note base URL and token (do not paste the token into chat — set it in `.env`).
- [ ] **Step 2:** Dispatch a fresh subagent (model: sonnet) in a throwaway worktree with only: "Our institution API is at <base URL>; the token is in `.env` as `CONNECTOR_API_WORKSHOP_INTAKE_TOKEN`. Load programme intake into the enrolment dataset; name the connector `workshop-intake`." It must find and follow the skill unprompted.
- [ ] **Step 3:** Pass criteria: the agent's final `pnpm connector:verify api-workshop-intake` shows no FAIL (SKIPs justified), and it did not ask a human for anything the skill answers.
- [ ] **Step 4:** 401 flow: change the token in `.env` to a wrong value; ask the same agent "the connector stopped working". Pass: it identifies 401 from `connector:verify`/run log and tells the human which env var to fix, without printing the value.
- [ ] **Step 5:** Fix any skill gaps found (back to Task 4 files), re-run the failing step, record the outcome in the decisions-log entry, commit — `docs(skills): managing-connectors fixes from acceptance run`.
