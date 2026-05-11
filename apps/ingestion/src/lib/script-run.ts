// ─────────────────────────────────────────────────────────────────────────────
// withScriptRun — minimal IngestionRun lifecycle for one-shot scripts.
//
// The connector framework's `ConnectorRunner` (apps/ingestion/src/connectors/
// runner.ts) handles IngestionRun lifecycle for scheduled / queue-driven
// connectors. But standalone scripts like `link-program-alumni.ts`,
// `link-program-cohorts.ts`, `link-program-financials.ts`,
// `ingest-employment-surveys.ts`, and `ingest-employment-surveys-xlsx.ts`
// also write to provenance-tracked metric tables — without this helper they
// produce NULL `ingestion_run_id` rows that become suspect under the
// `data-quality.v2` STRICT mode flip.
//
// Use this helper to wrap the script's main work block in a tracked run.
// The callback receives `runId`; pass it to every metric-table write
// (typically `ingestionRunId: runId` on `createMany.data[*]` / `upsert.create`
// / `upsert.update` payloads).
//
// On success: status='SUCCEEDED', completedAt=now, durationMs set, optional
// recordsLoaded reported via setRecordsLoaded().
// On thrown error: status='FAILED', errorCode='SCRIPT_ERROR', message captured,
// then the error is re-thrown so the script's existing exit-on-error path
// continues to function.
//
// Trigger is `MANUAL` (a script invocation is always operator-initiated).
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '@kku/db';

export interface ScriptRunHandle {
  /** Pass this to every metric-table write inside the callback. */
  readonly runId: string;
  /** Optional — report the count for the IngestionRun row's `recordsLoaded`
   *  column. Calling this multiple times overwrites the running total; call
   *  it once at the end of the script with the final count. */
  setRecordsLoaded(n: number): void;
}

/**
 * Wraps a script's main work block in a tracked IngestionRun.
 *
 * @param sourceSlug The `DataSource.slug` to attribute the run to. Must
 *   resolve to an existing row — throws if not found (operator should
 *   either pick a different slug or run `pnpm db:seed` to populate the
 *   catalog).
 * @param fn The work to perform. Use `handle.runId` on every metric-table
 *   write inside.
 */
export async function withScriptRun<T>(
  sourceSlug: string,
  fn: (handle: ScriptRunHandle) => Promise<T>,
): Promise<T> {
  const source = await prisma.dataSource.findUnique({
    where: { slug: sourceSlug },
    select: { id: true, slug: true, mocked: true },
  });
  if (!source) {
    throw new Error(
      `withScriptRun: no DataSource with slug='${sourceSlug}'. ` +
        `Add it to packages/shared/src/ingestion/catalog.ts + run pnpm db:seed.`,
    );
  }
  if (source.mocked) {
    // Not a fatal error — the script may legitimately be running against
    // a still-mocked source during development. Surface a warning so
    // operators notice that rows will be tagged as mock-sourced.
    console.warn(
      `withScriptRun: source '${sourceSlug}' is mocked=true. Rows tagged to this ` +
        `run will be filtered out by realDataWhere() under data-quality.v2 STRICT mode.`,
    );
  }

  const startedAt = new Date();
  const run = await prisma.ingestionRun.create({
    data: {
      dataSourceId: source.id,
      trigger: 'MANUAL',
      status: 'RUNNING',
      startedAt,
      attempt: 1,
    },
    select: { id: true },
  });

  let recordsLoaded = 0;
  const handle: ScriptRunHandle = {
    runId: run.id,
    setRecordsLoaded(n: number) {
      recordsLoaded = n;
    },
  };

  const t0 = Date.now();
  try {
    const result = await fn(handle);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        durationMs: Date.now() - t0,
        recordsLoaded,
      },
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        durationMs: Date.now() - t0,
        errorCode: 'SCRIPT_ERROR',
        errorMessage: message.slice(0, 2000),
      },
    });
    throw err;
  }
}
