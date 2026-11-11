# Write a connector

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/write-a-connector.md)

**Outcome.** You can write a connector that replaces a mock with your institution's real system, without losing provenance.

## The interface

Defined in `packages/shared/src/ingestion/types.ts`. Four methods, invoked in order by the runner:

```
healthCheck(ctx) → HealthStatus          // can we reach the source at all?
fetch(ctx)       → RawRecord[]           // pull, unchanged, from upstream
transform(ctx, raw) → NormalizedRecord[] // map to our schema; 0..n per raw
load(ctx, normalized) → LoadResult       // write, idempotently
```

The three record types:

- `RawRecord` — `{ externalId, data: unknown, sourceTimestamp }`. `externalId` is what dedup keys on across re-runs.
- `NormalizedRecord` — `{ target, externalId, payload, freshnessDate, sourcePdfId? }`. `target` names the destination table.
- `LoadResult` — `{ recordsFetched, recordsLoaded, recordsFailed, metadata }`. The `metadata` blob is surfaced in `/admin/data-sources/<slug>` and is where you put unmapped-code samples, distribution counts, and anything an analyst needs for triage.
- `ctx.log.info/warn/error(msg, meta?)` — log through this, never `console`. The runner stores every line (plus its own `[runner]` step markers and the failure stack) in `ingestion_run_logs`; admins read it from the **Log** button on each run in `/admin/data-sources/<slug>`, live while the run is going. Lines are masked for national IDs, emails and phone numbers, capped at 5,000 per run and deleted after 90 days — but still never log names or whole rows.

## What a real connector looks like

`apps/ingestion/src/connectors/sources/unicon-ds2001/connector.ts` is 310 lines and is the best single file to read. Concretely:

- `healthCheck` opens a connection with `configFromEnv('UNICON_DS2001_DB')` and runs `SELECT 1`, returning the resolved `user@host:port/database` in the message so the admin page shows what it actually connected to.
- `fetch` runs one explicit column projection (the PII trust boundary), then **refuses to proceed on zero rows** — `throw new NonRetryableError('EMPTY_DATA', 'DS2001 returned 0 rows — refusing to wipe')`. This matters because `load` does a snapshot replace; an empty fetch would otherwise delete the whole snapshot. Copy this guard.
- `fetch` also stashes per-run aggregates on `this.runState` (counts by staff type, by nationality, unhashable rows), which end up in `LoadResult.metadata`.
- `transform` hashes `CITIZEN_ID` at the boundary and returns `[]` for rows it cannot key — the unhashable count is tracked rather than silently dropped.
- `load` deletes prior rows for the same `(academicYear, semester)` scope, then inserts in chunks of 1,000 via `createMany`, stamping `ingestionRunId: ctx.runId` on every row. **That stamp is mandatory** — see [Trap 2](../adopters/traps.md#trap-2-realdatawhere--empty-sections-with-rows-in-the-database).

## The mock → real pattern

Every catalog slug has a mock connector. Real implementations are added alongside, never in place of. `apps/ingestion/src/connectors/registry.ts` holds the pair table:

```ts
{
  slug: 'kku-registry',
  mock: () => new KkuRegistryConnector(),
  real: () => new KkuRegistryRealConnector(),
}
```

Mode resolution is in `packages/shared/src/ingestion/connector-mode.ts`, first match wins:

1. `CONNECTOR_<SLUG>_MODE` — slug uppercased, non-alphanumerics to `_` (e.g. `CONNECTOR_KKU_REGISTRY_MODE=real`)
2. `CONNECTOR_MODE` — global default
3. Hard default `mocked`

If a slug is set to `real` but no `real` factory is registered, the registry logs a loud warning and **falls back to the mock** — flipping an env var without writing the class never takes ingestion down.

**Rollback is "set the env back to `mocked`" and restart the worker.** No data migration, no schema change. Preserve this property in every connector you write; it is the reason the readiness checklist's gate 11 can be satisfied at all.

## The per-connector session playbook

`prompts/14-integration-session-template.md` (128 lines) is the existing playbook and you should use it verbatim. Its non-negotiables:

- **One slug per session.** Not two, not half. Two connectors means two sessions, possibly in parallel, never bundled.
- **Pre-session checklist completed by the data owner** before any code: spec filled in beyond the stub, credentials in the target environment's secret store, sample payload committed to `apps/ingestion/test/fixtures/<slug>/` (at minimum one happy path and one edge case), data owner confirms the endpoint is stable, DPO counter-signature if personal data is involved.
- **Exit criterion:** at least **three successful runs** visible in `/admin/data-sources/<slug>` with zero failures across ten attempts, plus a drift fingerprint (row counts and key-field distributions) recorded in the spec.
- **Explicitly out of scope for a connector session:** methodology bumps, materialising into domain tables, and UI changes. Each is a separate session.

Run a connector without going through BullMQ with `pnpm connector:run <slug>` — same code path as the worker, much faster to iterate.

## The `mocked` / `status` flag rule

When you flip a connector to real, the `data_sources` row must have **both** `status` and `mocked` updated, atomically. They are independent columns and `status='real'` does not imply `mocked=false`. Getting this wrong produces an empty UI with rows visibly present in SQL. `pnpm data-sources:audit` exists to catch exactly this drift; run it after every connector flip and after every database reset.

## Load an import dataset from an HTTP API

### When to use it

If your registrar, finance or HR system already exposes an HTTP/JSON API, you can fill the same datasets the spreadsheet import fills (see [Importing your institution's data](../data-import.md)) without writing a full connector. The base class `DatasetApiConnector` (`apps/ingestion/src/connectors/base/dataset-api-connector.ts`) fetches the records, you map them onto dataset rows, and the upload pipeline's validation and loading do the rest: an API load obeys every rule an upload does. One connector may fill several datasets; they load in dependency order.

Only HTTP with a JSON body is supported. For SOAP, GraphQL, database views or SFTP, export to XLSX and upload it.

### Scaffold

```bash
pnpm connector:new --name myuni-classes --dataset class-offerings
```

`--dataset` takes one or more dataset slugs separated by commas (`--dataset external-grants,external-grant-team`); an unknown slug lists the valid ones. Every dataset's slug is in the table under [What you can import today](../data-import.md#what-you-can-import-today), and `pnpm connector:new --list` prints them. `--display-name "<text>"` sets the name shown in the admin and `--dry-run` prints what would be created. The scaffolder creates the connector class and its test under `apps/ingestion/`, registers the connector and adds its data-source entry to the catalogue, then prints the next steps. You fill in two methods:

```ts
export class MyuniClassesConnector extends DatasetApiConnector {
  readonly slug = 'api-myuni-classes';
  readonly displayName = 'Myuni Classes API';
  readonly datasets = ['class-offerings'] as const;

  protected async fetchAll(ctx: ConnectorContext, api: ApiClient): Promise<readonly unknown[]> {
    // talk to the API with api.getJson(path, ZodSchema) or api.paginate(...)
  }

  protected toRows(records: readonly unknown[]): DatasetRows {
    // return { 'class-offerings': [ { <template header>: value, ... } ] }
  }
}
```

Configuration comes from the environment. `<SLUG>` is the connector slug upper-cased with `-` turned into `_`, so `api-myuni-classes` gives `API_MYUNI_CLASSES`:

```bash
CONNECTOR_API_MYUNI_CLASSES_BASE_URL=https://registrar.example.ac.th/api/v1
CONNECTOR_API_MYUNI_CLASSES_TOKEN=<bearer token>
# optional
CONNECTOR_API_MYUNI_CLASSES_MAX_ROWS=50000
CONNECTOR_API_MYUNI_CLASSES_ALLOW_SHRINK=true
```

Never commit the token.

### Map and aggregate

- Row keys are the dataset template's header text, exactly as in the XLSX template. Download the template from the dataset's page to see them. The generated test checks that the required headers are present.
- Validate every HTTP response with Zod. `api.getJson` takes the schema as its second argument and `api.paginate` pages through list endpoints.
- The client retries transient failures but not 401, 403, 404 or redirects: those mean a wrong token, path or URL, and retrying only hides it.
- Convert years yourself. Many Thai systems use Buddhist Era; the datasets want what their template says.
- The default row limit is 10,000 per dataset (`IMPORT_MAX_ROWS`). `CONNECTOR_<SLUG>_MAX_ROWS` raises it, capped at 100,000. A load that would remove much of what a term or programme already holds is refused unless `CONNECTOR_<SLUG>_ALLOW_SHRINK=true`.
- Validation errors are reported as dataset, record number (1-based), column and message, without the offending value. A run stops at the first dataset the validation refuses: later datasets are reported as not run. A dataset that fails while loading (for example its `xlsx-<slug>` data source is missing; run `pnpm data-sources:sync --apply`) is marked FAILED, the datasets loaded before it stay in the report, and the run is not retried.
- `api.paginate` accepts an empty page that still carries a next cursor, but stops with a PAGINATION error after three in a row. The scaffolded `fetchAll` and `toRows` throw `NOT_IMPLEMENTED` until you write them, so a premature "Run now" fails once instead of retrying.

### Run and check

1. Set the environment variables in `.env`.
2. Run `pnpm data-sources:sync --apply`. It creates the connector's data source and renames the import datasets' sources from "(spreadsheet import)" to "(institution import)". An existing installation needs this once after upgrading.
3. Restart the ingestion worker.
4. Press "Run now" on `/admin/data-sources`, or run `pnpm connector:run api-myuni-classes`.

The rows appear on `/admin/data-setup/raw/<dataset>`, with Source `API: <connector name>`, and the load shows in the dataset's Uploads history. The connector's own run stores the import run for each dataset, the warnings and the validation errors in its metadata; the admin page does not display that report yet, but a failed run's "Log" shows the error code and message. API rows are stored under the dataset's `xlsx-<slug>` data source, the same one uploads use, because many read paths find a dataset's rows by that name; the import run's metadata records `via: 'api'`.

To practise without a real system, `pnpm workshop:mock-api <mock output folder>` serves generated mock data over HTTP (see [Session 3](../workshop/03-university-data.md#the-mock-api-server)); [Load data from an API (practice run)](../tutorials/load-data-from-an-api.md) walks through a complete connector against it.

### Two sources for one dataset

A dataset can be filled by both uploads and an API. Nothing is refused, but the loads do not combine:

- Class Offerings and other term-scoped datasets: whichever source loads a term last replaces what the other loaded for that term.
- Programme-scoped datasets: the same, per programme.
- Datasets that upsert: a row can end up holding values from both sources.

The same holds for two API connectors on one dataset, for example one per campus: each connector counts as a source of its own, and `pnpm connector:new` prints a note when the dataset you name is already filled by another connector. Whichever loads last wins, so give connectors that share a dataset separate terms or programmes, or accept that the later run replaces the earlier one.

The dataset page shows a banner whenever two or more sources have loaded, naming each one, with a table of the terms or programmes affected, and the same warnings appear in the upload result and are stored with the connector run. "Start over" removes the rows from uploads and from API runs alike.

### Personal data

Some APIs return one record per student. Aggregate them inside `toRows` to the dataset's grain (for example enrolled students per section, or graduates per programme and year); do not pass student-level values on. Datasets that report a group, such as Course Evaluations, Digital Competency, Employer Feedback, Graduate Outcomes, Staff Salary by Funding and Compensation, refuse groups under 5, exactly as an upload does. Class Offerings and Enrolment have no such minimum, so the connector author decides whether small sections are passed on. Connector code must never log the records it fetches, and the run metadata holds counts and positions only. Test fixtures must be invented or anonymised, never copied from a live system.

## Next step

Continue with [Curriculum documents and the AI digest pipeline](./curriculum-pdfs-and-ai-digest.md).
