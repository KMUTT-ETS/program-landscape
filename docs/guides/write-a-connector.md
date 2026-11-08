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

## Next step

Continue with [Curriculum documents and the AI digest pipeline](./curriculum-pdfs-and-ai-digest.md).
