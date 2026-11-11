import { ApiError } from '@kku/shared';
import type { ImportBatchStatus, IngestionRunTrigger, Prisma } from '@prisma/client';

import { prisma } from '../index';
import { getImportDataset, importDataSourceSlug, listImportDatasets } from './registry';
import type { ImportDataset } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// The batch ledger, the ingestion runs imports are attributed to, and
// start-over.
//
// Provenance is what makes an imported row visible: realDataWhere() requires
// a non-null ingestion_run_id whose DataSource is not mocked. It is also what
// makes start-over safe — the importer only ever deletes rows it can
// positively attribute to one of its own runs.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportBatchView {
  id: string;
  filename: string;
  rowCount: number;
  fileSize: number;
  status: ImportBatchStatus;
  createdAt: Date;
  clearedAt: Date | null;
  uploadedBy: string | null;
  storageKey: string;
  errorMessage: string | null;
}

export interface ImportDatasetStatus {
  rowCount: number;
  lastUpload: Date | null;
  batchCount: number;
  liveBatchCount: number;
}

export interface RecordImportBatchInput {
  datasetSlug: string;
  filename: string;
  contentHash: string;
  storageKey: string;
  fileSize: number;
  rowCount: number;
  uploadedByUserId: string | null;
  ingestionRunId: string | null;
}

export interface FinishImportRunInput {
  loaded: number;
  failed: number;
  status: 'SUCCEEDED' | 'FAILED';
  errorMessage?: string;
}

/**
 * A batch that actually landed, i.e. one whose rows are in the database.
 *
 * ONLY `SUCCEEDED` counts. Every other state means this file has not landed
 * and must be allowed to load again:
 *  - `CLEARED` — start-over removed the rows but kept the row so the stored
 *    file stays nameable; re-uploading it is the documented replay path.
 *  - `FAILED` — the load threw. The operator fixes the cause (a missing
 *    faculty, a lock) and re-uploads the SAME file. Treating this as live
 *    would answer "already uploaded — nothing changed" forever, with no way
 *    out short of altering a byte of their workbook.
 *  - `PENDING` / `LOADING` — a crash mid-load. Same reasoning.
 */
export async function findLiveBatchByHash(
  datasetSlug: string,
  contentHash: string,
): Promise<{ id: string; rowCount: number } | null> {
  return prisma.importBatch.findFirst({
    where: { datasetSlug, contentHash, status: 'SUCCEEDED' },
    select: { id: true, rowCount: true },
  });
}

/**
 * Records an upload.
 *
 * An UPSERT, not a create, and the difference is the replay path. Start-over
 * keeps a batch row and marks it CLEARED, which leaves it occupying the
 * (datasetSlug, contentHash) unique slot. findLiveBatchByHash rightly ignores
 * cleared rows so the same file loads again — but the insert that follows
 * would then collide with the very row that was kept. Re-uploading a cleared
 * file therefore revives its batch: same file, same hash, new run.
 */
export async function recordImportBatch(
  input: RecordImportBatchInput,
): Promise<{ id: string }> {
  const fields = {
    filename: input.filename,
    storageKey: input.storageKey,
    fileSize: input.fileSize,
    rowCount: input.rowCount,
    // LOADING, not SUCCEEDED: the rows have not been written yet. A crash
    // between here and the end of the load would otherwise leave a batch
    // claiming rowCount rows that were rolled back — and, since only
    // SUCCEEDED counts as live, the file would then be un-retryable.
    status: 'LOADING' as const,
    uploadedByUserId: input.uploadedByUserId,
    ingestionRunId: input.ingestionRunId,
    errorMessage: null,
    clearedAt: null,
  };
  return prisma.importBatch.upsert({
    where: {
      datasetSlug_contentHash: {
        datasetSlug: input.datasetSlug,
        contentHash: input.contentHash,
      },
    },
    create: { datasetSlug: input.datasetSlug, contentHash: input.contentHash, ...fields },
    update: fields,
    select: { id: true },
  });
}

export async function markImportBatchFailed(id: string, errorMessage: string): Promise<void> {
  await prisma.importBatch.update({
    where: { id },
    data: { status: 'FAILED', errorMessage: errorMessage.slice(0, 2000) },
  });
}

/** Called once the rows are committed. Until this runs the batch is LOADING. */
export async function markImportBatchSucceeded(id: string): Promise<void> {
  await prisma.importBatch.update({
    where: { id },
    data: { status: 'SUCCEEDED', errorMessage: null },
  });
}

export async function listImportBatches(
  datasetSlug: string,
  limit = 50,
): Promise<ImportBatchView[]> {
  const rows = await prisma.importBatch.findMany({
    where: { datasetSlug },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, filename: true, rowCount: true, fileSize: true, status: true,
      createdAt: true, clearedAt: true, storageKey: true, errorMessage: true,
      uploadedBy: { select: { name: true, email: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    rowCount: r.rowCount,
    fileSize: r.fileSize,
    status: r.status,
    createdAt: r.createdAt,
    clearedAt: r.clearedAt,
    uploadedBy: r.uploadedBy?.name ?? r.uploadedBy?.email ?? null,
    storageKey: r.storageKey,
    errorMessage: r.errorMessage,
  }));
}

/**
 * Opens the IngestionRun an import is attributed to.
 *
 * Throws when the dataset has no DataSource row — without one the rows would
 * load and then be invisible to every Council surface, which is worse than
 * refusing the upload.
 */
export async function startImportRun(
  datasetSlug: string,
  userId: string | null,
  opts: { trigger?: IngestionRunTrigger; metadata?: Prisma.InputJsonValue } = {},
): Promise<{ runId: string }> {
  const sourceSlug = importDataSourceSlug(datasetSlug);
  const source = await prisma.dataSource.findUnique({
    where: { slug: sourceSlug },
    select: { id: true, mocked: true },
  });
  if (!source) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `No data source "${sourceSlug}" exists, so imported rows could not be ` +
        `attributed and would be invisible. Run \`pnpm data-sources:sync --apply\` ` +
        `to create it.`,
    );
  }
  if (source.mocked) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `Data source "${sourceSlug}" is marked mocked, so imported rows would be ` +
        `discarded by every Council surface. Fix the catalogue entry first.`,
    );
  }

  const run = await prisma.ingestionRun.create({
    data: {
      dataSourceId: source.id,
      trigger: opts.trigger ?? 'MANUAL',
      triggeredByUserId: userId,
      ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
      status: 'RUNNING',
      startedAt: new Date(),
      attempt: 1,
    },
    select: { id: true },
  });
  return { runId: run.id };
}

export async function finishImportRun(runId: string, input: FinishImportRunInput): Promise<void> {
  const run = await prisma.ingestionRun.findUnique({
    where: { id: runId },
    select: { startedAt: true },
  });
  const completedAt = new Date();
  const durationMs = run?.startedAt ? completedAt.getTime() - run.startedAt.getTime() : 0;

  await prisma.ingestionRun.update({
    where: { id: runId },
    data: {
      status: input.status,
      completedAt,
      durationMs: Math.max(0, durationMs),
      recordsFetched: input.loaded,
      recordsLoaded: input.loaded,
      recordsFailed: input.failed,
      errorCode: input.status === 'FAILED' ? 'IMPORT_ERROR' : null,
      errorMessage: input.errorMessage ? input.errorMessage.slice(0, 2000) : null,
    },
  });
}

export async function importDatasetStatus(datasetSlug: string): Promise<ImportDatasetStatus> {
  const dataset = getImportDataset(datasetSlug);
  const [rowCount, batchCount, liveBatchCount, latest] = await Promise.all([
    dataset.count(prisma),
    prisma.importBatch.count({ where: { datasetSlug } }),
    prisma.importBatch.count({ where: { datasetSlug, status: { not: 'CLEARED' } } }),
    prisma.importBatch.findFirst({
      where: { datasetSlug },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  return { rowCount, batchCount, liveBatchCount, lastUpload: latest?.createdAt ?? null };
}

/**
 * Clears one dataset: deletes the rows its own import runs wrote, marks those
 * batches CLEARED, and removes the runs.
 *
 * Refuses while a dependent dataset still holds rows. Clearing programmes
 * would cascade into every metric table, so "start over on Programmes"
 * silently becoming "wipe the installation" is the failure this prevents.
 */
export async function startOverDataset(
  datasetSlug: string,
): Promise<{ rowsDeleted: number; batchesCleared: number }> {
  const dataset = getImportDataset(datasetSlug);

  const blocking: string[] = [];
  for (const dependentSlug of dataset.dependents ?? []) {
    const dependent = getImportDataset(dependentSlug);
    if ((await dependent.count(prisma)) > 0) blocking.push(dependent.title);
  }
  if (blocking.length > 0) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `Cannot clear ${dataset.title} while other data depends on it: ` +
        `${blocking.join(', ')}. Clear those first.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // Read the runs INSIDE the transaction. Reading them outside left a
    // window where an upload starting mid-clear had its batch marked CLEARED
    // while its rows survived — a dataset showing as cleared with rows still
    // in it, and no way to finish the job from the UI.
    const runs = await tx.ingestionRun.findMany({
      where: { dataSource: { slug: importDataSourceSlug(datasetSlug) } },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    if (runIds.length === 0) return { rowsDeleted: 0, batchesCleared: 0 };

    // What would be destroyed beyond this dataset's own rows. Checked here,
    // inside the transaction, so the answer cannot go stale before the
    // delete. See ImportDataset.cascadeBlockers.
    const cascade = dataset.cascadeBlockers
      ? await dataset.cascadeBlockers(tx as Prisma.TransactionClient, runIds)
      : [];
    if (cascade.length > 0) {
      const detail = cascade.map((b) => `${b.count} ${b.label}`).join(', ');
      throw new ApiError(
        'VALIDATION_FAILED',
        `Cannot clear ${dataset.title}: ${detail} would be deleted along with it. ` +
          `That data did not come from this import. Remove it first if you really mean to.`,
      );
    }

    // Data rows first: the deferred evaluation and DQ tables carry a non-null
    // ingestion_run_id with onDelete: Restrict, so this ordering is a hard
    // constraint the moment one of them is brought into scope.
    const rowsDeleted = await dataset.clear(tx as Prisma.TransactionClient, runIds);

    // Scoped to these runs: a batch created by an upload that started after
    // this transaction opened still owns its rows and must stay live.
    const cleared = await tx.importBatch.updateMany({
      where: { datasetSlug, ingestionRunId: { in: runIds }, status: { not: 'CLEARED' } },
      data: { status: 'CLEARED', clearedAt: new Date() },
    });

    // SetNull on import_batches.ingestion_run_id, so the batch rows survive
    // this and keep naming their stored files.
    await tx.ingestionRun.deleteMany({ where: { id: { in: runIds } } });

    return { rowsDeleted, batchesCleared: cleared.count };
  });
}

export interface StartOverAllResult {
  datasets: { slug: string; title: string; rowsDeleted: number }[];
  batchesDeleted: number;
  runsDeleted: number;
  /** Object-storage keys of every upload removed; the caller deletes the files. */
  storageKeys: string[];
}

/**
 * Empties every spreadsheet import at once: the rows, the upload history and
 * the runs. What the organisation profile, users, settings and connector data
 * hold is untouched.
 *
 * Unlike startOverDataset this does NOT refuse for dependents or cascade
 * blockers. Its job is "back to an empty installation", so everything built on
 * an imported programme or faculty (curricula, AI analysis, risk assessments,
 * mappings) goes with it — that is what the operator confirmed.
 *
 * Datasets are cleared in reverse registry order, which puts every dataset
 * before the ones it references. One transaction: a failure part-way leaves
 * everything as it was. Files are not touched here — the returned keys are
 * deleted by the caller once this has committed.
 */
export async function startOverAllImports(opts?: {
  datasets?: readonly ImportDataset[];
}): Promise<StartOverAllResult> {
  const datasets = opts?.datasets ?? listImportDatasets();
  const slugs = datasets.map((d) => d.slug);

  try {
    return await prisma.$transaction(
      async (tx) => {
        const runs = await tx.ingestionRun.findMany({
          where: { dataSource: { slug: { in: slugs.map(importDataSourceSlug) } } },
          select: { id: true, dataSource: { select: { slug: true } } },
        });
        const runIdsBySource = new Map<string, string[]>();
        for (const run of runs) {
          const list = runIdsBySource.get(run.dataSource.slug) ?? [];
          list.push(run.id);
          runIdsBySource.set(run.dataSource.slug, list);
        }

        const cleared: StartOverAllResult['datasets'] = [];
        for (const dataset of [...datasets].reverse()) {
          const runIds = runIdsBySource.get(importDataSourceSlug(dataset.slug)) ?? [];
          const rowsDeleted =
            runIds.length === 0 ? 0 : await dataset.clear(tx as Prisma.TransactionClient, runIds);
          cleared.unshift({ slug: dataset.slug, title: dataset.title, rowsDeleted });
        }

        const batches = await tx.importBatch.findMany({
          where: { datasetSlug: { in: slugs } },
          select: { storageKey: true },
        });
        const deletedBatches = await tx.importBatch.deleteMany({ where: { datasetSlug: { in: slugs } } });
        const deletedRuns = await tx.ingestionRun.deleteMany({
          where: { id: { in: runs.map((r) => r.id) } },
        });

        return {
          datasets: cleared,
          batchesDeleted: deletedBatches.count,
          runsDeleted: deletedRuns.count,
          storageKeys: [...new Set(batches.map((b) => b.storageKey).filter((k) => k.length > 0))],
        };
      },
      // Programme deletes cascade through ~35 tables; the 5 s default is too
      // short for a real installation.
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Cannot start over: some data not loaded from a spreadsheet still refers to an ' +
          'uploaded faculty, department or staff member (for example a programme or ' +
          'department created by hand). Remove it first, then try again.',
      );
    }
    throw e;
  }
}

function isForeignKeyViolation(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: unknown }).code;
  // P2003 from Prisma's query engine; 23503 when Postgres reports it directly.
  return code === 'P2003' || code === '23503' || /foreign key constraint/i.test(String((e as Error).message));
}
