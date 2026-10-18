import { ApiError } from '@kku/shared';
import type { ImportBatchStatus, Prisma } from '@prisma/client';

import { prisma } from '../index';
import { getImportDataset, importDataSourceSlug } from './registry';

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
 * A batch that still owns its rows. Cleared batches are deliberately
 * invisible here: start-over keeps the row so the stored file stays
 * nameable, and re-uploading that same file must load again rather than
 * being refused as a duplicate.
 */
export async function findLiveBatchByHash(
  datasetSlug: string,
  contentHash: string,
): Promise<{ id: string; rowCount: number } | null> {
  return prisma.importBatch.findFirst({
    where: { datasetSlug, contentHash, status: { not: 'CLEARED' } },
    select: { id: true, rowCount: true },
  });
}

export async function recordImportBatch(
  input: RecordImportBatchInput,
): Promise<{ id: string }> {
  return prisma.importBatch.create({
    data: {
      datasetSlug: input.datasetSlug,
      filename: input.filename,
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      fileSize: input.fileSize,
      rowCount: input.rowCount,
      status: 'SUCCEEDED',
      uploadedByUserId: input.uploadedByUserId,
      ingestionRunId: input.ingestionRunId,
    },
    select: { id: true },
  });
}

export async function markImportBatchFailed(id: string, errorMessage: string): Promise<void> {
  await prisma.importBatch.update({
    where: { id },
    data: { status: 'FAILED', errorMessage: errorMessage.slice(0, 2000) },
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
        `attributed and would be invisible. Run \`pnpm db:seed\` to create it.`,
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
      trigger: 'MANUAL',
      triggeredByUserId: userId,
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

  const runs = await prisma.ingestionRun.findMany({
    where: { dataSource: { slug: importDataSourceSlug(datasetSlug) } },
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);
  if (runIds.length === 0) return { rowsDeleted: 0, batchesCleared: 0 };

  return prisma.$transaction(async (tx) => {
    // Data rows first: the deferred evaluation and DQ tables carry a non-null
    // ingestion_run_id with onDelete: Restrict, so this ordering is a hard
    // constraint the moment one of them is brought into scope.
    const rowsDeleted = await dataset.clear(tx as Prisma.TransactionClient, runIds);

    const cleared = await tx.importBatch.updateMany({
      where: { datasetSlug, status: { not: 'CLEARED' } },
      data: { status: 'CLEARED', clearedAt: new Date() },
    });

    // SetNull on import_batches.ingestion_run_id, so the batch rows survive
    // this and keep naming their stored files.
    await tx.ingestionRun.deleteMany({ where: { id: { in: runIds } } });

    return { rowsDeleted, batchesCleared: cleared.count };
  });
}
