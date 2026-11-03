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
const programCodes = ['PDT-P1', 'PDT-P2', 'PDT-P3', 'PDT-P4'];
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

  it('reports metric rows that a clear would cascade-delete', async () => {
    // Every FK into `programs` is onDelete: Cascade, so deleting an imported
    // programme takes connector-written metrics with it. The guard must see
    // them BEFORE the delete — this is the difference between refusing and
    // destroying a registrar's history.
    const programme = await prisma.program.findUniqueOrThrow({
      where: { code: 'PDT-P2' },
      select: { id: true, ingestionRunId: true },
    });
    expect(programme.ingestionRunId).toBe(runId);

    const metric = await prisma.enrollmentMetric.create({
      data: {
        programId: programme.id, academicYear: 2099,
        applications: 0, admitted: 0, enrolled: 10,
        retainedYear2: 0, graduatedOnTime: 0, graduatedLate: 0, dropouts: 0,
        freshnessDate: new Date(),
      },
      select: { id: true },
    });

    try {
      const blockers = await programmesDataset.cascadeBlockers?.(prisma, [runId]);
      expect(blockers).toBeDefined();
      expect(blockers?.some((b) => b.label.includes('enrolment') && b.count >= 1)).toBe(true);
    } finally {
      await prisma.enrollmentMetric.delete({ where: { id: metric.id } });
    }
  });

  it('reports digital-competency cubes, which have no foreign key to cascade', async () => {
    const programme = await prisma.program.findUniqueOrThrow({
      where: { code: 'PDT-P2' },
      select: { id: true },
    });
    const cube = await prisma.dqStudentCube.create({
      data: {
        facultyName: 'x', programId: programme.id, studentsTested: 9, studentsWithScores: 9,
        studentsAllPassed: 5, cohortYearBe: 2560, ingestionRunId: runId,
      },
      select: { id: true },
    });
    try {
      const blockers = await programmesDataset.cascadeBlockers?.(prisma, [runId]);
      expect(blockers?.some((b) => b.label.includes('digital competency') && b.count >= 1)).toBe(true);
    } finally {
      await prisma.dqStudentCube.delete({ where: { id: cube.id } });
    }
  });

  it('finds nothing to block when no child rows exist', async () => {
    const blockers = await programmesDataset.cascadeBlockers?.(prisma, [runId]);
    expect(blockers).toEqual([]);
  });

  it('clears only rows the given runs created', async () => {
    // PDT-P4 is created by otherRunId; PDT-P1 was created by runId and only
    // UPDATED by otherRunId, so clearing otherRunId must not touch it.
    await load(programmesDataset, [programRow({ code: 'PDT-P4', nameEn: 'Four' })], otherRunId);

    const deleted = await prisma.$transaction((tx) => programmesDataset.clear(tx, [otherRunId]));

    expect(deleted).toBe(1);
    expect(await prisma.program.findUnique({ where: { code: 'PDT-P4' } })).toBeNull();
    expect(await prisma.program.findUnique({ where: { code: 'PDT-P1' } })).not.toBeNull();
    expect(await prisma.program.findUnique({ where: { code: 'PDT-P2' } })).not.toBeNull();
  });
});
