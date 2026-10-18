import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { withCanonical } from '../src/canonical-programs';
import { facultiesDataset } from '../src/import/datasets/faculties';
import { programmesDataset } from '../src/import/datasets/programmes';
import { getImportDataset } from '../src/import/registry';
import type { ImportDataset, ImportLoadContext, ImportRow } from '../src/import/types';

// The task that makes imported programmes VISIBLE. IS_CANONICAL_PROGRAM keys
// on sequenceNoFromSheet IS NOT NULL and Council surfaces enumerate through
// withCanonical(), so a programme imported without one loads successfully and
// is invisible everywhere that matters.

const FACULTY_CODE = 'PDT-ENG';
const programCodes = ['PDT-P1', 'PDT-P2', 'PDT-P3'];
let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.program.deleteMany({ where: { code: { in: programCodes } } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

async function makeRun(): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug: 'xlsx-programmes' },
    update: {},
    create: {
      slug: 'xlsx-programmes', name: 'programmes test source', kind: 'CSV',
      inputFormat: 'XLSX', mocked: false, scheduleEnabled: false, status: 'real',
    },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'RUNNING', attempt: 1 },
    select: { id: true },
  });
  return run.id;
}

async function load(
  dataset: ImportDataset,
  rows: readonly ImportRow[],
  withRunId: string,
): Promise<{ inserted: number; updated: number; deleted: number }> {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: withRunId };
    return dataset.load(ctx, rows);
  });
}

function programRow(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    code: 'PDT-P1',
    nameTh: 'วิศวกรรมโยธา',
    nameEn: 'Civil Engineering',
    facultyCode: FACULTY_CODE,
    departmentCode: null,
    level: 'BACHELOR',
    status: null,
    yearEstablished: null,
    durationYears: null,
    totalCredits: null,
    mhesiCode: null,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun();
  otherRunId = await makeRun();
  await load(facultiesDataset, [
    { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering', kind: null },
  ], runId);
});

afterAll(async () => {
  await cleanup();
  await prisma.ingestionRun.deleteMany({ where: { id: { in: [runId, otherRunId] } } });
});

describe('programmes dataset', () => {
  it('is registered under its slug', () => {
    expect(getImportDataset('programmes').slug).toBe('programmes');
  });

  it('gives an inserted programme a sequence number, making it canonical', async () => {
    await load(programmesDataset, [programRow()], runId);
    const row = await prisma.program.findUniqueOrThrow({
      where: { code: 'PDT-P1' },
      select: { sequenceNoFromSheet: true, ingestionRunId: true, status: true },
    });
    expect(row.sequenceNoFromSheet).not.toBeNull();
    expect(row.ingestionRunId).toBe(runId);
  });

  it('is visible through withCanonical()', async () => {
    const found = await prisma.program.findMany({
      where: withCanonical({ code: 'PDT-P1' }),
      select: { code: true },
    });
    expect(found.map((p) => p.code)).toContain('PDT-P1');
  });

  it('gives two programmes in one load consecutive sequence numbers', async () => {
    await load(programmesDataset, [
      programRow({ code: 'PDT-P2', nameEn: 'Two' }),
      programRow({ code: 'PDT-P3', nameEn: 'Three' }),
    ], runId);

    const rows = await prisma.program.findMany({
      where: { code: { in: ['PDT-P2', 'PDT-P3'] } },
      select: { code: true, sequenceNoFromSheet: true },
      orderBy: { sequenceNoFromSheet: 'asc' },
    });
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(second?.sequenceNoFromSheet).toBe((first?.sequenceNoFromSheet ?? 0) + 1);
  });

  it('starts after the highest sequence number already in the database', async () => {
    const max = await prisma.program.aggregate({ _max: { sequenceNoFromSheet: true } });
    const mine = await prisma.program.findUniqueOrThrow({
      where: { code: 'PDT-P3' },
      select: { sequenceNoFromSheet: true },
    });
    expect(mine.sequenceNoFromSheet).toBeLessThanOrEqual(max._max.sequenceNoFromSheet ?? 0);
    expect(mine.sequenceNoFromSheet).toBeGreaterThan(0);
  });

  it('leaves the sequence number untouched when updating an existing programme', async () => {
    const before = await prisma.program.findUniqueOrThrow({
      where: { code: 'PDT-P1' },
      select: { sequenceNoFromSheet: true },
    });

    const result = await load(programmesDataset, [
      programRow({ nameEn: 'Civil Engineering (revised)' }),
    ], otherRunId);

    expect(result.updated).toBe(1);
    const after = await prisma.program.findUniqueOrThrow({
      where: { code: 'PDT-P1' },
      select: { sequenceNoFromSheet: true, nameEn: true },
    });
    expect(after.sequenceNoFromSheet).toBe(before.sequenceNoFromSheet);
    expect(after.nameEn).toBe('Civil Engineering (revised)');
  });

  it('defaults a blank Status to ACTIVE', async () => {
    const row = await prisma.program.findUniqueOrThrow({
      where: { code: 'PDT-P2' },
      select: { status: true },
    });
    expect(row.status).toBe('ACTIVE');
  });

  it('accepts a blank Department Code', async () => {
    const row = await prisma.program.findUniqueOrThrow({
      where: { code: 'PDT-P2' },
      select: { departmentId: true },
    });
    expect(row.departmentId).toBeNull();
  });

  it('does not expose the sequence number as an import column', () => {
    // The adopter has no reason to care about it, and offering the column
    // would invite them to set it badly.
    expect(programmesDataset.columns.map((c) => c.key)).not.toContain('sequenceNoFromSheet');
  });

  it('clears only rows carrying the given run ids', async () => {
    const deleted = await prisma.$transaction((tx) => programmesDataset.clear(tx, [otherRunId]));
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.program.findUnique({ where: { code: 'PDT-P1' } })).toBeNull();
    expect(await prisma.program.findUnique({ where: { code: 'PDT-P2' } })).not.toBeNull();
  });
});
