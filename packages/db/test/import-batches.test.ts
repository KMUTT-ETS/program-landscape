import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import {
  finishImportRun,
  findLiveBatchByHash,
  importDatasetStatus,
  listImportBatches,
  markImportBatchSucceeded,
  recordImportBatch,
  startImportRun,
  startOverDataset,
} from '../src/import/batches';
import { IMPORT_DATASETS } from '../src/import/registry';
import type { ImportDataset } from '../src/import/types';

// Exercises the batch ledger and start-over against the dev database with a
// throwaway dataset of its own, so no shipped declaration is involved.

const SLUG = 'test-batches-fixture';
const DEPENDENT_SLUG = 'test-batches-dependent';
const SOURCE_SLUG = `xlsx-${SLUG}`;

/** Rows this fixture dataset "owns": faculties we create and clean up. */
const ownedFacultyIds: string[] = [];
let dependentRowCount = 0;

const fixture: ImportDataset = {
  slug: SLUG,
  title: 'Batch fixture',
  description: '',
  tier: 0,
  sheetName: 'Data',
  columns: [{ header: 'Code', key: 'code', type: 'text', required: true, guide: 'the code', example: 'A' }],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } },
  load: async () => ({ inserted: 0, updated: 0, deleted: 0 }),
  count: async (p) => p.faculty.count({ where: { id: { in: ownedFacultyIds } } }),
  clear: async (tx, runIds) => {
    const result = await tx.faculty.deleteMany({
      where: { id: { in: ownedFacultyIds }, ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
  dependents: [DEPENDENT_SLUG],
};

const dependent: ImportDataset = {
  ...fixture,
  slug: DEPENDENT_SLUG,
  title: 'Dependent fixture',
  dependents: undefined,
  count: async () => dependentRowCount,
};

const registry = IMPORT_DATASETS as ImportDataset[];
const createdRunIds: string[] = [];

beforeAll(async () => {
  registry.push(fixture, dependent);
  await prisma.dataSource.upsert({
    where: { slug: SOURCE_SLUG },
    update: { mocked: false },
    create: {
      slug: SOURCE_SLUG,
      name: 'Batch fixture (spreadsheet import)',
      kind: 'CSV',
      inputFormat: 'XLSX',
      mocked: false,
      scheduleEnabled: false,
      status: 'real',
    },
  });
});

afterAll(async () => {
  await prisma.faculty.deleteMany({ where: { id: { in: ownedFacultyIds } } });
  await prisma.importBatch.deleteMany({ where: { datasetSlug: { in: [SLUG, DEPENDENT_SLUG] } } });
  await prisma.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await prisma.dataSource.deleteMany({ where: { slug: SOURCE_SLUG } });
  registry.splice(registry.indexOf(fixture), 1);
  registry.splice(registry.indexOf(dependent), 1);
});

async function makeRun(): Promise<string> {
  const { runId } = await startImportRun(SLUG, null);
  createdRunIds.push(runId);
  return runId;
}

async function makeFaculty(runId: string, code: string): Promise<string> {
  const row = await prisma.faculty.create({
    data: { code, nameTh: code, nameEn: code, ingestionRunId: runId },
    select: { id: true },
  });
  ownedFacultyIds.push(row.id);
  return row.id;
}

describe('startImportRun / finishImportRun', () => {
  it('creates a RUNNING run against the dataset data source', async () => {
    const runId = await makeRun();
    const run = await prisma.ingestionRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true, trigger: true, dataSource: { select: { slug: true, mocked: true } } },
    });
    expect(run.status).toBe('RUNNING');
    expect(run.trigger).toBe('MANUAL');
    expect(run.dataSource.slug).toBe(SOURCE_SLUG);
    // mocked:false is load-bearing — realDataWhere() discards mocked rows.
    expect(run.dataSource.mocked).toBe(false);
  });

  it('throws, naming the seed command, when the data source is missing', async () => {
    await expect(startImportRun('no-such-dataset-source', null)).rejects.toThrow(/db:seed/);
  });

  it('records counts and completion', async () => {
    const runId = await makeRun();
    await finishImportRun(runId, { loaded: 7, failed: 0, status: 'SUCCEEDED' });
    const run = await prisma.ingestionRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true, recordsLoaded: true, completedAt: true, durationMs: true },
    });
    expect(run.status).toBe('SUCCEEDED');
    expect(run.recordsLoaded).toBe(7);
    expect(run.completedAt).toBeInstanceOf(Date);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records an error message on failure', async () => {
    const runId = await makeRun();
    await finishImportRun(runId, { loaded: 0, failed: 3, status: 'FAILED', errorMessage: 'bad sheet' });
    const run = await prisma.ingestionRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true, errorMessage: true, recordsFailed: true },
    });
    expect(run.status).toBe('FAILED');
    expect(run.errorMessage).toContain('bad sheet');
    expect(run.recordsFailed).toBe(3);
  });
});

describe('findLiveBatchByHash', () => {
  it('finds a batch only once its rows are committed', async () => {
    const runId = await makeRun();
    const batch = await recordImportBatch({
      datasetSlug: SLUG, filename: 'a.xlsx', contentHash: 'live-hash-1',
      storageKey: 'k1', fileSize: 10, rowCount: 2, uploadedByUserId: null, ingestionRunId: runId,
    });

    // Recorded as LOADING: the rows are not in yet, so the file must still
    // be re-uploadable if the load dies here.
    expect(await findLiveBatchByHash(SLUG, 'live-hash-1')).toBeNull();

    await markImportBatchSucceeded(batch.id);
    const found = await findLiveBatchByHash(SLUG, 'live-hash-1');
    expect(found?.rowCount).toBe(2);
  });

  it('ignores a cleared batch with the same hash', async () => {
    // This is what makes replay possible: start-over marks batches CLEARED,
    // and re-uploading the identical file must load again rather than being
    // refused as a duplicate.
    const runId = await makeRun();
    const batch = await recordImportBatch({
      datasetSlug: SLUG, filename: 'b.xlsx', contentHash: 'cleared-hash-1',
      storageKey: 'k2', fileSize: 10, rowCount: 2, uploadedByUserId: null, ingestionRunId: runId,
    });
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'CLEARED', clearedAt: new Date() },
    });
    expect(await findLiveBatchByHash(SLUG, 'cleared-hash-1')).toBeNull();
  });

  it('does not match a hash belonging to another dataset', async () => {
    expect(await findLiveBatchByHash(DEPENDENT_SLUG, 'live-hash-1')).toBeNull();
  });

  it('ignores a FAILED batch, so a fixed cause can be retried with the same file', async () => {
    // A failed load leaves a batch holding the hash. If that counted as
    // live, the operator would fix the cause, re-upload the identical file
    // and be told "already uploaded — nothing changed", with no way out
    // short of altering a byte of their workbook.
    const runId = await makeRun();
    const batch = await recordImportBatch({
      datasetSlug: SLUG, filename: 'failed.xlsx', contentHash: 'failed-hash-1',
      storageKey: 'k-failed', fileSize: 10, rowCount: 2, uploadedByUserId: null, ingestionRunId: runId,
    });
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'FAILED', errorMessage: 'constraint violated' },
    });

    expect(await findLiveBatchByHash(SLUG, 'failed-hash-1')).toBeNull();
  });

  it('ignores a batch still LOADING, so a crashed load can be retried', async () => {
    const runId = await makeRun();
    const batch = await recordImportBatch({
      datasetSlug: SLUG, filename: 'stuck.xlsx', contentHash: 'stuck-hash-1',
      storageKey: 'k-stuck', fileSize: 10, rowCount: 2, uploadedByUserId: null, ingestionRunId: runId,
    });
    await prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'LOADING' } });

    expect(await findLiveBatchByHash(SLUG, 'stuck-hash-1')).toBeNull();
  });

  it('revives a cleared batch when the same file is uploaded again', async () => {
    // The cleared row still occupies the (datasetSlug, contentHash) unique
    // slot, so recording the replay must update it rather than insert a
    // second row — otherwise the replay path start-over promises throws.
    const firstRun = await makeRun();
    const first = await recordImportBatch({
      datasetSlug: SLUG, filename: 'replay.xlsx', contentHash: 'replay-hash-1',
      storageKey: 'k-replay', fileSize: 10, rowCount: 2, uploadedByUserId: null, ingestionRunId: firstRun,
    });
    await prisma.importBatch.update({
      where: { id: first.id },
      data: { status: 'CLEARED', clearedAt: new Date() },
    });

    const secondRun = await makeRun();
    const second = await recordImportBatch({
      datasetSlug: SLUG, filename: 'replay.xlsx', contentHash: 'replay-hash-1',
      storageKey: 'k-replay', fileSize: 10, rowCount: 2, uploadedByUserId: null, ingestionRunId: secondRun,
    });

    expect(second.id).toBe(first.id);
    await markImportBatchSucceeded(second.id);
    const row = await prisma.importBatch.findUniqueOrThrow({
      where: { id: first.id },
      select: { status: true, clearedAt: true, ingestionRunId: true },
    });
    expect(row.status).toBe('SUCCEEDED');
    expect(row.clearedAt).toBeNull();
    expect(row.ingestionRunId).toBe(secondRun);
  });
});

describe('startOverDataset', () => {
  it('deletes only rows written by this dataset import runs', async () => {
    const mineRun = await makeRun();
    const mine = await makeFaculty(mineRun, 'SO-MINE');
    // A row with no provenance stands for a seeded or connector-written one.
    const seeded = await prisma.faculty.create({
      data: { code: 'SO-SEEDED', nameTh: 'seeded', nameEn: 'seeded' },
      select: { id: true },
    });
    ownedFacultyIds.push(seeded.id);

    const result = await startOverDataset(SLUG);

    expect(result.rowsDeleted).toBe(1);
    expect(await prisma.faculty.findUnique({ where: { id: mine } })).toBeNull();
    expect(await prisma.faculty.findUnique({ where: { id: seeded.id } })).not.toBeNull();
  });

  it('marks batches cleared rather than deleting them', async () => {
    const runId = await makeRun();
    await makeFaculty(runId, 'SO-BATCH');
    const batch = await recordImportBatch({
      datasetSlug: SLUG, filename: 'keep-me.xlsx', contentHash: 'startover-hash-1',
      storageKey: 'k3', fileSize: 10, rowCount: 1, uploadedByUserId: null, ingestionRunId: runId,
    });

    await startOverDataset(SLUG);

    const after = await prisma.importBatch.findUnique({
      where: { id: batch.id },
      select: { status: true, clearedAt: true, filename: true, storageKey: true },
    });
    expect(after?.status).toBe('CLEARED');
    expect(after?.clearedAt).toBeInstanceOf(Date);
    // The file must stay nameable so it can be re-uploaded.
    expect(after?.filename).toBe('keep-me.xlsx');
    expect(after?.storageKey).toBe('k3');
  });

  it('refuses while a dependent dataset holds rows, naming it', async () => {
    dependentRowCount = 4;
    try {
      await expect(startOverDataset(SLUG)).rejects.toThrow(/Dependent fixture/);
    } finally {
      dependentRowCount = 0;
    }
  });
});

describe('listImportBatches / importDatasetStatus', () => {
  it('reports row count, batch count and the last upload', async () => {
    const runId = await makeRun();
    await makeFaculty(runId, 'STATUS-1');
    await recordImportBatch({
      datasetSlug: SLUG, filename: 'status.xlsx', contentHash: 'status-hash-1',
      storageKey: 'k4', fileSize: 10, rowCount: 1, uploadedByUserId: null, ingestionRunId: runId,
    });

    const status = await importDatasetStatus(SLUG);
    expect(status.rowCount).toBeGreaterThanOrEqual(1);
    expect(status.batchCount).toBeGreaterThanOrEqual(1);
    expect(status.lastUpload).toBeInstanceOf(Date);

    const batches = await listImportBatches(SLUG);
    expect(batches.some((b) => b.filename === 'status.xlsx')).toBe(true);
    expect(batches[0]?.storageKey).toBeTruthy();
  });
});
