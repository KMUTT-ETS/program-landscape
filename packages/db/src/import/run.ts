import type { Prisma } from '@prisma/client';

import { prisma } from '../index';
import { refreshMetricViews } from '../scope';
import {
  finishImportRun,
  markImportBatchFailed,
  markImportBatchSucceeded,
  recordImportBatch,
  startImportRun,
} from './batches';
import type { ImportCellValue, ImportDataset, ImportLoadResult, ImportRow } from './types';

/**
 * A hard ceiling, not a fallback to async. A file above this is a sign the
 * dataset wants splitting — by term, for the term-scoped ones.
 *
 * 10,000 is set by what the loaders can actually finish, not by taste: each
 * does a sequential find + update/create per row (two round-trips) inside one
 * transaction with a 120 s timeout. At a realistic 1-2 ms per round-trip,
 * 10,000 rows take 20-40 s, leaving headroom. 50,000 rows would need
 * 100-300 s — past that timeout and past most reverse proxies' read timeout,
 * leaving the operator with a hung request and a failed batch. Raised from
 * 5,000 so a typical institution's publications or course list fits one
 * file. Raise further only together with batched loaders.
 */
export const IMPORT_MAX_ROWS = 10_000;

/** Datasets whose rows feed the scope roll-up views. */
export const METRIC_VIEW_DATASETS: ReadonlySet<string> = new Set([
  // The department and faculty views join these two, so their rows matter too.
  'faculties',
  'departments',
  'programmes',
  'enrollment-metrics',
  'financial-metrics',
  'graduate-outcomes',
]);

/** Where a load came from: an uploaded file, or a connector run. */
export type ImportRunSource =
  | {
      via: 'upload';
      userId: string | null;
      batch: { filename: string; contentHash: string; storageKey: string; fileSize: number };
    }
  | { via: 'api'; connectorSlug: string; connectorName: string; parentRunId: string };

/**
 * The scope roll-ups are materialised views over these tables, and nothing
 * else refreshes them for an adopter. A no-op for datasets that do not feed
 * them. Rethrows a refresh failure: the caller decides how to log it.
 */
export async function refreshMetricViewsIfNeeded(datasetSlug: string): Promise<void> {
  if (!METRIC_VIEW_DATASETS.has(datasetSlug)) return;
  await refreshMetricViews({ trigger: 'on-import' });
}

function jsonCell(v: ImportCellValue): string | number | boolean | null {
  return v instanceof Date ? v.toISOString() : v;
}

function jsonRecord(r: Readonly<Record<string, ImportCellValue>>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, jsonCell(v)]));
}

/** Closes a run on the failure path without masking the original error. */
async function finishQuietly(runId: string, rowCount: number, message: string): Promise<void> {
  try {
    await finishImportRun(runId, { loaded: 0, failed: rowCount, status: 'FAILED', errorMessage: message });
  } catch (e) {
    console.error(`import: could not close run ${runId}: ${String(e)}`);
  }
}

/**
 * Opens a run, records the batch, loads the rows in one transaction and
 * closes everything. Shared by the upload path and API connectors.
 * Does NOT refresh the metric views: the caller does, through
 * `refreshMetricViewsIfNeeded` or its own seam.
 */
export async function runImportLoad(
  dataset: ImportDataset,
  rows: readonly ImportRow[],
  source: ImportRunSource,
  term?: Readonly<Record<string, ImportCellValue>>,
  scopes?: readonly Readonly<Record<string, ImportCellValue>>[],
): Promise<{ batchId: string; runId: string; result: ImportLoadResult }> {
  const metadata: Record<string, Prisma.InputJsonValue> = { via: source.via };
  if (term) metadata.term = jsonRecord(term);
  if (scopes) metadata.scopes = scopes.map(jsonRecord);

  let userId: string | null;
  let trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL';
  if (source.via === 'upload') {
    userId = source.userId;
  } else {
    userId = null;
    metadata.connector = source.connectorSlug;
    metadata.parentRunId = source.parentRunId;
    const parent = await prisma.ingestionRun.findUnique({
      where: { id: source.parentRunId },
      select: { trigger: true },
    });
    if (parent?.trigger === 'SCHEDULED') trigger = 'SCHEDULED';
  }

  const { runId } = await startImportRun(dataset.slug, userId, { trigger, metadata });

  const batch =
    source.via === 'upload'
      ? source.batch
      : {
          filename: `API: ${source.connectorName}`,
          contentHash: `api-run:${runId}`,
          storageKey: '',
          fileSize: 0,
        };

  let created: { id: string };
  try {
    created = await recordImportBatch({
      datasetSlug: dataset.slug,
      filename: batch.filename,
      contentHash: batch.contentHash,
      storageKey: batch.storageKey,
      fileSize: batch.fileSize,
      rowCount: rows.length,
      uploadedByUserId: userId,
      ingestionRunId: runId,
    });
  } catch (e) {
    // Without this the run is left RUNNING forever, counted by the data
    // source dashboard and by the readiness green-history gate.
    const message = e instanceof Error ? e.message : String(e);
    await finishQuietly(runId, rows.length, message);
    throw e;
  }

  try {
    const result = await prisma.$transaction(
      (tx) => dataset.load({ tx, ingestionRunId: runId, term }, rows),
      { timeout: 120_000 },
    );
    // Order matters: the batch becomes SUCCEEDED — and therefore live for
    // dedupe — only once the rows are committed.
    await markImportBatchSucceeded(created.id);
    await finishImportRun(runId, { loaded: rows.length, failed: 0, status: 'SUCCEEDED' });
    return { batchId: created.id, runId, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Mark the batch FIRST. If finishImportRun throws (a concurrent
    // start-over may have deleted the run), the batch would otherwise be
    // left LOADING with no record of why.
    await markImportBatchFailed(created.id, message).catch(() => undefined);
    await finishQuietly(runId, rows.length, message);
    throw e;
  }
}
