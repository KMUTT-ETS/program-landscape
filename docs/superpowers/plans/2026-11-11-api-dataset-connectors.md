# API Dataset Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an institution fill any of the 25 spreadsheet-import datasets from its own HTTP/JSON API by writing only the fetch and the field mapping, with the same validation, provenance, start-over and visibility rules as a file upload.

**Architecture:** The upload path's "count → validate → load" sequence moves out of `ImportService` into `@kku/db` (`prepareImportRows`, `runImportLoad`). A new `DatasetApiConnector` base class in `apps/ingestion` runs under the existing connector runner, turns the fetched records into header-keyed rows per dataset, and hands each dataset's rows to those same two functions. API rows load under the dataset's existing `xlsx-<slug>` DataSource with run metadata `{ via: 'api' }`, so every read path, start-over and own-run rule that already keys on `xlsx-<slug>` keeps working unchanged.

**Tech Stack:** TypeScript strict, NestJS (api, ingestion), Prisma, Zod, Vitest, Next.js 14 (dataset admin page), VitePress docs.

**Spec:** The design agreed in the planning conversation of 2026-11-08 → 11, recorded in "Design decisions" below. Executors read that section before any task.

**Branch:** `feat/api-dataset-connectors`, from `develop`. Leave the untracked `workshop/import-templates/` alone — it is not part of this work.

## Design decisions

1. **Tiers.** Tier 0: export to XLSX and upload (exists). Tier 1: `DatasetApiConnector` (this plan). Tier 2: data that fits no dataset — out of scope.
2. **HTTP/JSON only.** No SOAP, GraphQL, database views, SFTP. Non-HTTP sources use Tier 0.
3. **Any dataset.** The connector names target datasets by slug; nothing is specific to one dataset. One run may fill several datasets (e.g. `external-grants` + `external-grant-team`); they load in `IMPORT_DATASETS` order.
4. **Provenance: same DataSource, different `via`.** At least ten read paths filter on `xlsx-<slug>` by name (`student-dq.ts`, `dq-skill-lens.ts`, `demand-match-sources.ts`, `program-course-ownership.ts`, `research-services.ts`, `grant-award.ts`, `deep-dive.controller.ts`, and dataset loaders' own-run queries). API rows therefore load under `xlsx-<slug>` too. The import run's `IngestionRun.metadata` records `{ via: 'api', connector: '<connector slug>', parentRunId }` or `{ via: 'upload' }`. Catalogue names change from "(spreadsheet import)" to "(institution import)".
5. **The connector's own run** (under its `api-<name>` DataSource, `mocked: false`, kind `API`) is the orchestration run the admin "Run now" button and schedule create. Its metadata lists the child import run ids per dataset, warnings and validation errors.
6. **Every API load creates an `ImportBatch`**: `filename` = `API: <connector name>`, `contentHash` = `api-run:<import run id>` (unique, never deduplicated), `storageKey` = `''`, `fileSize` = 0. That puts API loads in the Uploads history and inside start-over, and the existing `storageKey.length > 0` filter already stops start-over-all from deleting an object for them.
7. **Mixed sources are allowed with a warning, never refused.** Term-scoped: last source to load a term owns it. Programme-scoped: same per programme. Upsert: a row may hold values from both. Warnings appear on the dataset page (banner + per-term/per-programme table), in the upload result, and in the connector run metadata.
8. **No raw values in logs or run metadata.** Validation errors are reported as `{ dataset, record, column, message }`, where `record` is 1-based. Connector code never logs fetched records. Per-student APIs must be aggregated inside `toRows`; groups under the dataset's `groupSizeFor` minimum are refused by validation as for uploads.
9. **Limits.** Default `maxRows` is `IMPORT_MAX_ROWS` (10,000). `CONNECTOR_<SLUG>_MAX_ROWS` raises it, capped at 100,000. Shrink guard on by default; `CONNECTOR_<SLUG>_ALLOW_SHRINK=true` overrides it.
10. **No reference solution in the repo.** The repo ships the base class, the scaffolder and the mock API server. The workshop runs the scaffolder live; the finished solution goes to facilitators outside the repo. No committed failing test.

## Global Constraints

- TypeScript strict; no `any`. Zod for every HTTP response the connector reads.
- `path.join()` for filesystem paths; no POSIX shell in scripts; no Makefile.
- Colours via tokens only; border colours only `border-subtle|default|strong|transparent`; danger/warning text via an arbitrary value wrapping the token var.
- Every mutation keeps its existing `@AuditLog()`; this plan adds no new mutation endpoint.
- Never print `.env` lines. Secrets live in `CONNECTOR_<SLUG>_TOKEN`, never committed.
- `<SLUG>` in env names = connector slug upper-cased with `-` → `_` (e.g. `api-myuni-classes` → `CONNECTOR_API_MYUNI_CLASSES_TOKEN`).
- UI copy English only. Docs pages change in EN and the TH twin with mirrored headings.
- A narrowed vitest include silently drops tests: after each task compare the package's file and test counts to the pre-task baseline.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A term an upload loaded, then an API run for the same term** (and the reverse): the later load replaces the term wholly, no unique-key collision, and the warning names the earlier source. → Task 2 test `term-scoped API load replaces an uploaded term and reports it`.
2. **A dataset in a multi-dataset run that references the one loaded before it** (`external-grant-team` → `external-grants`): validation of the second must see the first's committed codes. → Task 4 test `loads the second dataset against codes the first just committed`.
3. **Validation failure on a personal-data dataset**: the run metadata must not contain the offending name. → Task 4 test `error metadata never contains cell values from name columns`.
4. **Upstream returns a non-JSON body, a 401, or an empty page mid-pagination**: 401/403/404 fail without retry; a non-JSON or schema-mismatch body fails naming the path, never the body. → Task 3 tests.
5. **Start over after API loads only (no uploads)**: the start-over button must be enabled and must remove the API rows. → Task 2 test `start-over clears rows written by API import runs`.

---

### Task 1: Shared import pipeline in `@kku/db`

**Files:**
- Create: `packages/db/src/import/references.ts`, `packages/db/src/import/prepare.ts`, `packages/db/src/import/run.ts`
- Modify: `packages/db/src/import/index.ts` (export the three), `packages/db/src/import/batches.ts:170-206` (`startImportRun` options), `apps/api/src/import/import.service.ts:141-152, 232-347, 377-404` (delegate)
- Test: `packages/db/test/import-run.test.ts` (new); `apps/api/test/import-service.test.ts`, `apps/api/test/import-e2e.test.ts` (must pass unchanged)

**Interfaces:**
- Produces:
  - `IMPORT_MAX_ROWS = 10_000` and `METRIC_VIEW_DATASETS: ReadonlySet<string>` move to `packages/db/src/import/run.ts`; `import.service.ts` re-exports `IMPORT_MAX_ROWS` so existing imports keep compiling.
  - `loadImportReferences(dataset: ImportDataset): Promise<Map<string, Set<string>>>` — body moved verbatim from `ImportService.defaultLoadReferences`.
  - `interface PrepareDeps { loadReferences; heldCount; heldCountForTerm; heldCountForScope }` — same signatures as the four fields of `ImportServiceDeps`.
  - `prepareImportRows(dataset: ImportDataset, parsed: ParsedSheet, opts: { allowShrink: boolean; maxRows: number }, deps?: PrepareDeps): Promise<ValidateResult>` — the body of `uploadFile` from `Promise.all([references, heldRowCount])` through `validateSheet(...)`.
  - `type ImportRunSource = { via: 'upload'; userId: string | null; batch: { filename: string; contentHash: string; storageKey: string; fileSize: number } } | { via: 'api'; connectorSlug: string; connectorName: string; parentRunId: string }`
  - `runImportLoad(dataset: ImportDataset, rows: readonly ImportRow[], source: ImportRunSource, term?: Readonly<Record<string, ImportCellValue>>, scopes?: readonly Readonly<Record<string, ImportCellValue>>[]): Promise<{ batchId: string; runId: string; result: ImportLoadResult }>` — body of `ImportService.defaultRunLoad`. For `via: 'api'` it builds the batch per Design decision 6 and `uploadedByUserId: null`.
  - `startImportRun(datasetSlug, userId, opts?: { trigger?: IngestionRunTrigger; metadata?: Prisma.InputJsonValue })` — default trigger stays `'MANUAL'`. `runImportLoad` passes `metadata: { via, term?, scopes?, connector?, parentRunId? }`; API runs use trigger `'SCHEDULED'` when `source.parentRunId`'s run is scheduled, else `'MANUAL'` (read the parent run's `trigger`).
  - `refreshMetricViewsIfNeeded(datasetSlug: string): Promise<void>` — the `refreshViewsQuietly` body minus the Nest logger (returns silently; caller logs).

- [ ] **Step 1: Record the baseline.** Run `pnpm --filter @kku/db exec vitest run` and `pnpm --filter api exec vitest run`; write down file and test counts.
- [ ] **Step 2: Write the failing tests** in `packages/db/test/import-run.test.ts` (real dev DB, same setup as `import-batches.test.ts`):
  - `runImportLoad with via upload writes run metadata { via: 'upload' } and a SUCCEEDED batch` — load one `faculties` row; assert `ingestionRun.metadata` equals `{ via: 'upload' }` and the batch `status === 'SUCCEEDED'`.
  - `runImportLoad with via api writes an api batch` — assert `filename === 'API: Test connector'`, `contentHash === 'api-run:' + runId`, `storageKey === ''`, `fileSize === 0`, metadata `{ via: 'api', connector: 'api-test', parentRunId }`.
  - `two identical api loads both succeed` — same rows twice; two batches, no unique violation.
  - `term-scoped load records the term in run metadata` — `class-offerings` rows for 2025/1; metadata `term` equals `{ academicYear: 2025, semester: '1' }` (use the dataset's `termColumns` keys).
  - `prepareImportRows refuses a shrink unless allowShrink` — seed 10 faculties, prepare 2 → `ok: false`; with `allowShrink: true` → `ok: true`.
- [ ] **Step 3: Run** `pnpm --filter @kku/db exec vitest run test/import-run.test.ts` — expect FAIL (`runImportLoad` not exported).
- [ ] **Step 4: Implement** the files above; make `ImportService` call `prepareImportRows` (passing its `this.deps` subset so the service's test seams keep working) and `runImportLoad` (from `defaultRunLoad`, keeping the `runLoad` dep seam). `uploadFile` passes the declared term/scopes through to `runImportLoad`.
- [ ] **Step 5: Run** the new test file, then both full suites. Expect PASS and counts = baseline + 5 tests in `@kku/db`, api unchanged.
- [ ] **Step 6: Commit** — `refactor(import): move validate-and-load into @kku/db for reuse by connectors`.

### Task 2: Mixed-source visibility and start-over for API loads

**Files:**
- Create: `packages/db/src/import/source-mix.ts`
- Modify: `packages/db/src/import/batches.ts` (`ImportBatchView.via`), `packages/db/src/import/run.ts` (warnings), `apps/api/src/import/import.service.ts` (`getDataset` adds `sourceMix`; `uploadFile` result adds `warnings`), `apps/web/app/admin/data-setup/raw/[dataset]/import-panel.tsx`, `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx`, `packages/shared/src/ingestion/catalog.ts` (25 `xlsx-*` names: "(spreadsheet import)" → "(institution import)")
- Test: `packages/db/test/import-source-mix.test.ts` (new), `apps/api/test/import-service.test.ts`, `apps/web/test/import-panel.test.tsx`

**Interfaces:**
- Consumes: `runImportLoad`, `ImportRunSource` (Task 1).
- Produces:
  - `ImportBatchView.via: 'upload' | 'api'` and `ImportBatchView.connector: string | null`, read from the batch's run metadata; `'upload'` when the run is gone or has no `via`.
  - `interface SourceMix { sources: ('upload' | 'api')[]; lastBy: { via: 'upload' | 'api'; connector: string | null; at: Date } | null; perScope: { label: string; via: 'upload' | 'api'; connector: string | null; at: Date }[] }` — `perScope` holds one entry per term (term-scoped) or per programme code (programme-scoped), newest writer only; empty for upsert datasets.
  - `importSourceMix(datasetSlug: string): Promise<SourceMix>` — from live (non-CLEARED) batches' runs.
  - `ImportLoadResult` is unchanged; `runImportLoad`'s return gains `warnings: string[]`, computed before the load from `importSourceMix`.
  - `ImportUploadResult.warnings: string[]`.

Warning copy (exact):
- term/programme replaced from the other source: `` `${label} was last loaded by ${otherSourceName} on ${dd Mon yyyy}. This load replaced it.` `` where `otherSourceName` is `an upload` or `the API connector "${connector}"`.
- upsert dataset with both sources: `` `Rows in this dataset come from both uploads and the API connector "${connector}". A row may hold values from both.` ``

Banner copy on the dataset page when `sources.length > 1`: title `Two sources feed this dataset`, body `Uploads and the API connector "<name>" both load this dataset. Whichever loads a term (or programme) last replaces what the other loaded. Uploads history shows which source loaded what.` — followed by the `perScope` table (columns: Term/Programme, Last loaded by, When) for term-/programme-scoped datasets.

- [ ] **Step 1: Write the failing tests** in `import-source-mix.test.ts`:
  - `term-scoped API load replaces an uploaded term and reports it` — upload-source load of `class-offerings` 2025/1 (3 rows), then API-source load of the same term (2 rows): table holds 2 rows for the term, the second call's `warnings[0]` starts with `Semester 1/2025 was last loaded by an upload` (match the term label your `perScope` formatter produces; define it once in `source-mix.ts`).
  - `importSourceMix lists both sources and the newest writer per term`.
  - `start-over clears rows written by API import runs` — API-only load of `faculties`, then `startOverDataset('faculties')` → `rowsDeleted === n`, batch `CLEARED`.
  - `upsert dataset with both sources warns once` — `enrollment-metrics`.
- [ ] **Step 2:** Add to `apps/api/test/import-service.test.ts`: `uploadFile returns warnings from runImportLoad` (stub `runLoad` to return `warnings: ['x']`; assert result `warnings` equals `['x']`). Add to `apps/web/test/import-panel.test.tsx`: `shows the two-sources banner when sourceMix has two sources` and `labels API batches with the connector name in a Source column`.
- [ ] **Step 3: Run** the three files — expect FAIL.
- [ ] **Step 4: Implement.** Upload panel: render `warnings` from the upload response as a `warning`-tone inline note under the upload button (not a toast — it must stay readable). Uploads table: add a `Source` column (`Upload` / `API: <connector>`); Size cell shows `—` for API rows. Start-over copy becomes `Deletes the rows these uploads and API connector runs created. …` (rest unchanged). Rename the catalogue names.
- [ ] **Step 5: Run** the three files, then `pnpm --filter @kku/db exec vitest run test/import-registry.test.ts test/data-source-sync.test.ts` (catalogue rename) and the web suite. Expect PASS; compare counts.
- [ ] **Step 6: Commit** — `feat(import): show and warn when uploads and API connectors share a dataset`.

### Task 3: `ApiClient` — the HTTP helper connectors use

**Files:**
- Create: `apps/ingestion/src/connectors/base/api-client.ts`
- Modify: `apps/ingestion/src/connectors/base/index.ts`
- Test: `apps/ingestion/test/dataset-api/api-client.test.ts`

**Interfaces:**
- Produces:
  - `connectorEnv(connectorSlug: string, name: 'TOKEN' | 'BASE_URL' | 'MAX_ROWS' | 'ALLOW_SHRINK'): string | undefined` — reads `CONNECTOR_<SLUG>_<NAME>`.
  - `class ApiClient { constructor(opts: { baseUrl: string; token?: string; authHeader?: 'bearer' | { header: string }; timeoutMs?: number; fetchImpl?: typeof fetch }) }` — default `authHeader` `'bearer'`, `timeoutMs` 30,000.
  - `getJson<T>(path: string, schema: z.ZodType<T>, query?: Record<string, string | number | undefined>): Promise<T>`
  - `paginate<P, T>(path: string, pageSchema: z.ZodType<P>, opts: { items: (page: P) => readonly T[]; next: (page: P) => Record<string, string | number> | null; query?: Record<string, string | number>; maxPages?: number }): Promise<T[]>` — `maxPages` default 1,000; exceeding it throws.
  - `ApiClient.forConnector(ctx: ConnectorContext, connectorSlug: string, fetchImpl?: typeof fetch): ApiClient` — base URL from `CONNECTOR_<SLUG>_BASE_URL`, else `ctx.dataSource.baseUrl`, else throws `NonRetryableError('CONFIG', 'No base URL: set CONNECTOR_<SLUG>_BASE_URL or the data source base URL.')`.
- Errors: HTTP 401/403/404 → `NonRetryableError('HTTP_<status>', '<METHOD> <path> returned <status>')`; other non-2xx → plain `Error` (runner retries); non-JSON or schema mismatch → `NonRetryableError('SCHEMA', '<path>: response did not match the expected shape (<zod issue paths>)')`. No message ever includes the body.

- [ ] **Step 1: Write the failing tests** with an injected `fetchImpl` that records each `Request` (assert on the outgoing request, not only the response):
  - `sends Authorization: Bearer <token> and the query string` — assert URL `https://x.test/api/v1/sections?year=2025&cursor=abc` and header.
  - `uses a custom auth header when configured` — `{ header: 'X-Api-Key' }`.
  - `paginate follows next until null and concatenates items` — 3 pages.
  - `401 throws NonRetryableError HTTP_401 without retry`.
  - `500 throws a retryable Error`.
  - `schema mismatch names the path and issue paths but not the body` — body contains `"สมชาย"`; assert the message does not contain it.
  - `non-JSON body throws SCHEMA`.
  - `forConnector prefers CONNECTOR_<SLUG>_BASE_URL over the data source baseUrl`.
  - `paginate stops at maxPages with an error`.
- [ ] **Step 2: Run** `pnpm --filter ingestion exec vitest run test/dataset-api/api-client.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** using global `fetch` + `AbortController` for the timeout.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** — `feat(ingestion): add ApiClient for dataset API connectors`.

### Task 4: `DatasetApiConnector` base class and institution connector registration

**Files:**
- Create: `apps/ingestion/src/connectors/base/dataset-api-connector.ts`, `apps/ingestion/src/connectors/sources/institution/index.ts` (exports `INSTITUTION_CONNECTORS: readonly ConnectorEntry[] = []` with a `// connector:new entries` marker line), `packages/shared/src/ingestion/institution-catalog.ts` (exports `INSTITUTION_SOURCES: readonly SourceCatalogEntry[] = []` with a `// connector:new entries` marker line)
- Modify: `apps/ingestion/src/connectors/registry.ts` (export `ConnectorEntry`; spread `INSTITUTION_CONNECTORS` into `ENTRIES`), `packages/shared/src/ingestion/catalog.ts` (append `...INSTITUTION_SOURCES` to `SOURCE_CATALOG`), `apps/ingestion/src/connectors/base/index.ts`
- Test: `apps/ingestion/test/dataset-api/dataset-api-connector.test.ts` (with a test-only subclass in the same file; real dev DB like `connector-lifecycle.test.ts`)

**Interfaces:**
- Consumes: `prepareImportRows`, `runImportLoad`, `IMPORT_MAX_ROWS`, `refreshMetricViewsIfNeeded`, `getImportDataset`, `IMPORT_DATASETS` (Task 1); `runImportLoad`'s `warnings` (Task 2); `ApiClient`, `connectorEnv` (Task 3).
- Produces:
  - `type DatasetRows = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>` — dataset slug → rows keyed by the template's header text.
  - `abstract class DatasetApiConnector extends ApiConnector` with `readonly mocked = false`, abstract `readonly slug: string`, abstract `readonly displayName: string`, abstract `readonly datasets: readonly string[]`, `protected abstract fetchAll(ctx: ConnectorContext, api: ApiClient): Promise<readonly unknown[]>`, `protected abstract toRows(records: readonly unknown[]): DatasetRows`, and an overridable `protected createClient(ctx): ApiClient` (default `ApiClient.forConnector(ctx, this.slug)`; tests override it).
  - Lifecycle mapping: `fetch` calls `fetchAll`, stores the records on the instance, and returns one `RawRecord` per record (`externalId` = index, `data` = record). `transform` returns `[]`. `load` calls `toRows` over the stored records, then for each slug in `IMPORT_DATASETS` order that `toRows` returned: build `ParsedSheet { sheetName: dataset.sheetName, headers: dataset.columns.map(c => c.header), rows }` → `prepareImportRows` → on failure stop → on success `runImportLoad(..., { via: 'api', connectorSlug: this.slug, connectorName: this.displayName, parentRunId: ctx.runId }, term, scopes)` → `refreshMetricViewsIfNeeded`.
  - A slug in `toRows` output that is not in `this.datasets` → `NonRetryableError('CONFIG', ...)`.
  - `LoadResult.metadata`: `{ datasets: { [slug]: { importRunId?: string; rows: number; inserted: number; updated: number; deleted: number; status: 'LOADED' | 'REFUSED' | 'NOT_RUN' } }; warnings: string[]; errors: { dataset: string; record: number; column: string | null; message: string }[]; totalErrors: number }` — `record` = spreadsheet row − 1; at most 100 errors. If any dataset is `REFUSED`, `load` throws `NonRetryableError('VALIDATION', '<n> problems in <dataset title>. First: record <r>, <column> — <message>')` **after** writing the metadata (put metadata on the error's `details` and have the runner store `details` in run metadata on failure if it does not already — check `runner.ts:255-270`).
  - `maxRows` = `min(Number(connectorEnv(slug,'MAX_ROWS')) || IMPORT_MAX_ROWS, 100_000)`; `allowShrink` = `connectorEnv(slug,'ALLOW_SHRINK') === 'true'`.
  - `datasetApiEntry(slug: string, factory: () => Connector): ConnectorEntry` — returns `{ slug, mock: factory, real: factory }` (these connectors have no mock; the mock API server plays the upstream).

- [ ] **Step 1: Write the failing tests** with a test-only subclass whose `createClient` returns an `ApiClient` over an injected `fetchImpl`. Create the parent run row the way `connector-lifecycle.test.ts` does.
  - `loads class-offerings rows from records and stamps the xlsx DataSource` — assert rows exist with `ingestionRun.dataSource.slug === 'xlsx-class-offerings'` and run metadata `via === 'api'`.
  - `loads the second dataset against codes the first just committed` — `external-grants` + `external-grant-team` in one run, team rows reference a project code only present in this run.
  - `refuses on validation failure and loads nothing for that dataset` — a Buddhist-era year; error `{ record: 1, column: 'Academic Year' }`, status `REFUSED`, no rows.
  - `error metadata never contains cell values from name columns` — `faculty-members` row with name `ทดสอบ ข้อมูลส่วนตัว` and an invalid other cell; `JSON.stringify(metadata)` does not contain the name.
  - `refuses a dataset not declared in datasets` — `CONFIG`.
  - `respects CONNECTOR_<SLUG>_MAX_ROWS and its 100,000 cap`.
  - `registry resolves an INSTITUTION_CONNECTORS entry by slug`.
- [ ] **Step 2: Run** `pnpm --filter ingestion exec vitest run test/dataset-api/dataset-api-connector.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then the full ingestion suite and `pnpm --filter @kku/db exec vitest run test/data-source-sync.test.ts` (the catalogue now concatenates an empty array). Expect PASS; compare counts.
- [ ] **Step 5: Commit** — `feat(ingestion): add DatasetApiConnector for loading import datasets from HTTP APIs`.

### Task 5: Workshop mock API server

**Files:**
- Create: `apps/ingestion/src/scripts/workshop-mock-api/server.ts`, `apps/ingestion/src/scripts/workshop-mock-api/routes.ts`, `apps/ingestion/src/scripts/workshop-mock-api/README.md`
- Modify: `package.json` (`"workshop:mock-api": "tsx apps/ingestion/src/scripts/workshop-mock-api/server.ts"`)
- Test: `apps/ingestion/test/workshop-mock-api.test.ts`

**Interfaces:**
- CLI: `pnpm workshop:mock-api <dir> [--port 4010] [--token <t>]` — `<dir>` is a `pnpm workshop:mock` output folder (or any folder holding filled import templates named as `write.ts`'s `fileName()` names them). Prints the base URL and the token (random 24-char hex when `--token` is absent). Node `http` only; no new dependency.
- `loadMockSource(dir: string): Promise<MockSource>` in `routes.ts` reads the `class-offerings` and `enrollment-metrics` workbooks (with the `xlsx` package `write.ts` already uses, then `validateSheet` so rows are keyed and typed) into `interface MockSource { classOfferings: readonly ImportRow[]; enrollment: readonly ImportRow[] }`.
- `buildRoutes(source: MockSource, token: string): (req: IncomingMessage, res: ServerResponse) => void` serves them in a deliberately un-template-like shape:
  - `GET /api/v1/terms` → `{ data: [{ year_be: 2568, semester: 1 }] }`
  - `GET /api/v1/terms/:yearBe/:semester/sections?cursor=&limit=` (limit default 50, max 200) → `{ data: [{ faculty_code, level, subject: { code, name_th, name_en, credit }, section_no, class_id, hours: { lecture, lab }, seats: { capacity, enrolled } }], next_cursor: string | null }`
  - `GET /api/v1/terms/:yearBe/:semester/enrolments?cursor=` → one record per (fake) student per section: `{ data: [{ student_ref: 'S-<n>', subject_code, section_no }], next_cursor }`. `student_ref` values are synthetic, generated from the section's enrolled count.
  - `GET /api/v1/programmes/:code/intake` → `{ data: [{ year_be, applied, admitted, enrolled, ... }] }`
  - Missing/wrong `Authorization: Bearer` → 401 `{ error: 'unauthorized' }`. Unknown path → 404.
- Years are Buddhist era on the wire, so participants must convert.

- [ ] **Step 1: Write the failing tests** against `buildRoutes` over an in-memory `MockSource` (3 programmes, 2 terms, 120 sections so pagination spans 3 pages at limit 50), started on an ephemeral port:
  - `401 without the bearer token`.
  - `sections paginate with next_cursor until null and cover every class-offerings row`.
  - `years are served in the Buddhist era`.
  - `enrolments per section sum to the section's enrolled count`.
- [ ] **Step 2: Run** `pnpm --filter ingestion exec vitest run test/workshop-mock-api.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Add `workshop-mock-api` to the build exclusions only if `bundled-script-coverage.test.ts` demands it (it is a dev script, not a worker spawn target).
- [ ] **Step 4: Run** the test file and `test/bundled-script-coverage.test.ts`. Expect PASS.
- [ ] **Step 5: Smoke-test by hand:** `pnpm workshop:mock workshop/my-university.json --offline --out <scratch>`, then `pnpm workshop:mock-api <scratch>`, then `curl -H "Authorization: Bearer <token>" localhost:4010/api/v1/terms`. Expect the terms JSON.
- [ ] **Step 6: Commit** — `feat(workshop): add a mock institution API server`.

### Task 6: `pnpm connector:new` scaffolder

**Files:**
- Create: `apps/ingestion/src/scripts/connector-new/generate.ts`, `apps/ingestion/src/scripts/connector-new/templates.ts`
- Modify: `package.json` (`"connector:new": "tsx apps/ingestion/src/scripts/connector-new/generate.ts"`), `.env.example` (one commented block showing the four `CONNECTOR_<SLUG>_*` names)
- Test: `apps/ingestion/test/connector-new.test.ts`

**Interfaces:**
- CLI: `pnpm connector:new --name <kebab-name> --dataset <slug>[,<slug>...] [--display-name "<text>"] [--dry-run]`. Connector slug = `api-<name>`. Exit 2 with a message (no stack) on: unknown dataset slug (list the valid ones), a name that already exists, a name not matching `^[a-z0-9]+(-[a-z0-9]+)*$`.
- `generateConnectorFiles(opts: { name: string; datasets: readonly string[]; displayName: string }): { path: string; content: string }[]` — pure, testable. Produces:
  - `apps/ingestion/src/connectors/sources/institution/<name>/connector.ts` — a `DatasetApiConnector` subclass. For each dataset, a generated `type <Pascal>Row = { '<header>': <ts type>; ... }` (required columns non-optional, optional columns `?`; `integer`/`decimal` → `number`, `date` → `string`, `boolean` → `boolean`, `enum` → union of `enumValues`, `text` → `string`), with each column's `guide` as a doc comment. `fetchAll` and `toRows` bodies are `throw new Error('TODO: …')` with one-line hints (paging via `api.paginate`; Common Era years; aggregate per-student records; never log records).
  - `apps/ingestion/test/institution/<name>.test.ts` — a fixture test using `describe.skip` with a comment `Remove .skip once fetchAll/toRows are written` that feeds `test/institution/<name>.fixture.json` through `toRows` and asserts on the first row of each dataset.
  - `apps/ingestion/test/institution/<name>.fixture.json` — `[]`.
  - Insertions above the two `// connector:new entries` markers: a `datasetApiEntry('api-<name>', () => new <Pascal>Connector())` line and an import in `sources/institution/index.ts`; a `SourceCatalogEntry` (`kind: 'API'`, `inputFormat: 'JSON'`, `mocked: false`, `scheduleEnabled: false`, `ownerContact: 'Institution administrator'`, `name: displayName`) in `institution-catalog.ts`.
- After writing, it prints the next steps: set `CONNECTOR_<SLUG>_BASE_URL` / `_TOKEN` in `.env`, run `pnpm data-sources:sync --apply`, restart the ingestion worker, press "Run now" on `/admin/data-sources`.

- [ ] **Step 1: Write the failing tests** against `generateConnectorFiles`:
  - `class-offerings row type marks required headers non-optional and types enums as unions` — assert the generated text contains `'Course Code': string;` and `'Enrolled'?: number;` (match the dataset's actual required flags).
  - `generated test is skipped so pnpm check stays green`.
  - `two datasets generate two row types and list both in datasets`.
  - `rejects an unknown dataset slug and lists valid ones`.
  - `inserts registry and catalogue entries above the markers and is idempotent-refusing` — a second run with the same name exits 2.
  (Type-checking the generated code is covered by the Step 4 smoke test's `pnpm --filter ingestion typecheck`, not a unit test.)
- [ ] **Step 2: Run** `pnpm --filter ingestion exec vitest run test/connector-new.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test; then smoke-test end to end on the mock server from Task 5: `pnpm connector:new --name demo-classes --dataset class-offerings`, run `pnpm --filter ingestion typecheck` on the unfilled skeleton (expect PASS), fill `fetchAll`/`toRows` by hand against `/sections`, set env, `pnpm data-sources:sync --apply`, `pnpm connector:run api-demo-classes`. Expect the run SUCCEEDED and rows on `/admin/data-setup/raw/class-offerings` with Source `API: …`. **Then delete the generated files and marker insertions with `git checkout`/`git clean` on those paths only — the demo is not committed** (Design decision 10). Save the filled demo outside the repo for the facilitator pack.
- [ ] **Step 5: Run** `pnpm check`. Expect PASS (known pre-existing failures listed in CLAUDE.md excepted — name any others).
- [ ] **Step 6: Commit** — `feat(ingestion): add connector:new scaffolder for dataset API connectors`.

### Task 7: Docs, workshop pages and status

**Files:**
- Modify: `docs/guides/write-a-connector.md` + `docs/th/guides/write-a-connector.md` (new `## Load an import dataset from an HTTP API` section with `###` sub-sections: *When to use it*, *Scaffold*, *Map and aggregate*, *Run and check*, *Two sources for one dataset*, *Personal data*), `docs/data-import.md` + `docs/th/data-import.md` (one paragraph: an API can fill the same datasets; link the guide), `docs/workshop/03-university-data.md` + TH twin (`## The mock API server` section: what `pnpm workshop:mock-api` serves and how to start it), `docs/workshop/00-before-the-day.md` + TH twin (readiness-form list: "Do you have an HTTP/JSON API for any of this data? If yes: which dataset it fits, how it authenticates, whether it returns one row per student, and a redacted sample response."), `docs/workshop/facilitator.md` (+ TH if present: where the reference solution is handed out — "from the instructor, outside the repository"; no link), `docs/workshop/README.md` + TH (schedule session 4 exit check: "API connector run lands rows"), `CLAUDE.md` (16 → 25 datasets; one line under "In progress"), `docs/superpowers/notes/decisions-log.md` (entry: provenance-under-`xlsx-<slug>` decision and why, catalogue rename, `data-sources:sync --apply` needed on deploy).
- Test: `pnpm docs:build`

- [ ] **Step 1:** Write the EN sections; mirror headings and code blocks in the TH twins.
- [ ] **Step 2: Run** `pnpm docs:build`. Expect PASS (no dead links, no retired names, page-shape checks green).
- [ ] **Step 3: Commit** — `docs: guide and workshop pages for dataset API connectors`.

---

## Workshop fallback

The workshop is about 10 days out. Tasks 1, 3, 4, 5, 6 and the workshop parts of Task 7 are required for session 4. If time runs short, Task 2's UI half (banner, Source column, upload-result note) and the TH twin of the guide section may ship after the workshop. Task 2's `db` half (`importSourceMix`, `runImportLoad` warnings, the start-over test) may **not** be deferred: Task 4's run metadata reports those warnings, and the start-over test is the only proof that API rows can be removed.
