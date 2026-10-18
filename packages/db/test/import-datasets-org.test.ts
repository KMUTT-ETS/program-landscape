import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { departmentsDataset } from '../src/import/datasets/departments';
import { facultiesDataset } from '../src/import/datasets/faculties';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';

// The tier-0 declarations, exercised against the dev database.

const RUN_PREFIX = 'org-dataset-test';
let runId = '';
let otherRunId = '';
const sourceSlug = 'xlsx-faculties';

const facultyCodes = ['ODT-ENG', 'ODT-SCI', 'ODT-RENAMED', 'ODT-SEEDED'];
const departmentCodes = ['ODT-DEP-1', 'ODT-DEP-2'];

async function cleanup(): Promise<void> {
  await prisma.department.deleteMany({ where: { code: { in: departmentCodes } } });
  await prisma.faculty.deleteMany({ where: { code: { in: facultyCodes } } });
}

async function makeRun(): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug: sourceSlug },
    update: {},
    create: {
      slug: sourceSlug,
      name: `${RUN_PREFIX} source`,
      kind: 'CSV',
      inputFormat: 'XLSX',
      mocked: false,
      scheduleEnabled: false,
      status: 'real',
    },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'RUNNING', attempt: 1 },
    select: { id: true },
  });
  return run.id;
}

/** Runs a dataset's load in a transaction, the way the service does. */
async function load(
  dataset: typeof facultiesDataset,
  rows: readonly ImportRow[],
  withRunId: string,
): Promise<{ inserted: number; updated: number; deleted: number }> {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: withRunId };
    return dataset.load(ctx, rows);
  });
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun();
  otherRunId = await makeRun();
});

afterAll(async () => {
  await cleanup();
  await prisma.ingestionRun.deleteMany({ where: { id: { in: [runId, otherRunId] } } });
});

describe('faculties dataset', () => {
  it('is registered under its slug', () => {
    expect(getImportDataset('faculties').slug).toBe('faculties');
  });

  it('inserts a faculty with the run id stamped', async () => {
    const result = await load(facultiesDataset, [
      { code: 'ODT-ENG', nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering', kind: 'ACADEMIC' },
    ], runId);

    expect(result.inserted).toBe(1);
    const row = await prisma.faculty.findUniqueOrThrow({
      where: { code: 'ODT-ENG' },
      select: { nameEn: true, kind: true, ingestionRunId: true },
    });
    expect(row.nameEn).toBe('Engineering');
    expect(row.kind).toBe('ACADEMIC');
    expect(row.ingestionRunId).toBe(runId);
  });

  it('does not claim a pre-existing row it merely updated', async () => {
    // A seeded or connector-written faculty whose code appears in an
    // uploaded sheet is UPDATED, not created. Stamping it would hand it to
    // start-over, which deletes rather than reverts — and on this table a
    // delete cascades. Provenance marks origin, not last writer.
    const seeded = await prisma.faculty.create({
      data: { code: 'ODT-SEEDED', nameTh: 'เดิม', nameEn: 'Pre-existing' },
      select: { id: true },
    });

    await load(facultiesDataset, [
      { code: 'ODT-SEEDED', nameTh: 'เดิม', nameEn: 'Pre-existing (edited)', kind: null },
    ], runId);

    const after = await prisma.faculty.findUniqueOrThrow({
      where: { id: seeded.id },
      select: { nameEn: true, ingestionRunId: true },
    });
    expect(after.nameEn).toBe('Pre-existing (edited)');
    expect(after.ingestionRunId).toBeNull();
  });

  it('updates an existing faculty by code without duplicating it', async () => {
    const result = await load(facultiesDataset, [
      { code: 'ODT-ENG', nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering (renamed)', kind: null },
    ], otherRunId);

    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(await prisma.faculty.count({ where: { code: 'ODT-ENG' } })).toBe(1);
    const row = await prisma.faculty.findUniqueOrThrow({
      where: { code: 'ODT-ENG' },
      select: { nameEn: true, ingestionRunId: true },
    });
    expect(row.nameEn).toBe('Engineering (renamed)');
    // Still owned by the run that CREATED it, not the one that last edited
    // it — ownership decides what start-over may delete.
    expect(row.ingestionRunId).toBe(runId);
  });

  it('defaults a blank Kind to ACADEMIC', async () => {
    await load(facultiesDataset, [
      { code: 'ODT-SCI', nameTh: 'วิทยาศาสตร์', nameEn: 'Science', kind: null },
    ], runId);
    const row = await prisma.faculty.findUniqueOrThrow({
      where: { code: 'ODT-SCI' },
      select: { kind: true },
    });
    expect(row.kind).toBe('ACADEMIC');
  });

  it('clears only rows carrying the given run ids', async () => {
    await load(facultiesDataset, [
      { code: 'ODT-RENAMED', nameTh: 'x', nameEn: 'x', kind: null },
    ], otherRunId);

    const deleted = await prisma.$transaction((tx) => facultiesDataset.clear(tx, [otherRunId]));

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.faculty.findUnique({ where: { code: 'ODT-RENAMED' } })).toBeNull();
    // ODT-SCI was written by the other run and must survive.
    expect(await prisma.faculty.findUnique({ where: { code: 'ODT-SCI' } })).not.toBeNull();
  });
});

describe('departments dataset', () => {
  it('is registered under its slug', () => {
    expect(getImportDataset('departments').slug).toBe('departments');
  });

  it('resolves Faculty Code to the faculty id', async () => {
    await load(facultiesDataset, [
      { code: 'ODT-ENG', nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering', kind: null },
    ], runId);

    const result = await load(departmentsDataset, [
      { code: 'ODT-DEP-1', nameTh: 'โยธา', nameEn: 'Civil', facultyCode: 'ODT-ENG' },
    ], runId);

    expect(result.inserted).toBe(1);
    const row = await prisma.department.findUniqueOrThrow({
      where: { code: 'ODT-DEP-1' },
      select: { nameEn: true, ingestionRunId: true, faculty: { select: { code: true } } },
    });
    expect(row.faculty.code).toBe('ODT-ENG');
    expect(row.ingestionRunId).toBe(runId);
  });

  it('fails loudly on an unknown faculty code', async () => {
    // Unreachable through the service — validation checks references first —
    // so this asserts the loader does not silently drop the row instead.
    await expect(
      load(departmentsDataset, [
        { code: 'ODT-DEP-2', nameTh: 'x', nameEn: 'x', facultyCode: 'NO-SUCH-FACULTY' },
      ], runId),
    ).rejects.toThrow(/NO-SUCH-FACULTY/);
  });

  it('names faculties as a dependent, so start-over is ordered', () => {
    expect(facultiesDataset.dependents).toContain('departments');
  });
});
