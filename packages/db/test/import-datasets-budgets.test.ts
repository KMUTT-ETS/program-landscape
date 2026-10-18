import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { budgetsDataset } from '../src/import/datasets/budgets';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';

const FACULTY_CODE = 'BUD-ENG';
const FACULTY_DIVISION = 'Faculty of Engineering (budget test)';
const CENTRAL_DIVISION = "President's Office (budget test)";

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.facultyBudget.deleteMany({
    where: { divisionName: { in: [FACULTY_DIVISION, CENTRAL_DIVISION] } },
  });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

async function makeRun(slug: string): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug },
    update: {},
    create: {
      slug, name: `${slug} test`, kind: 'CSV', inputFormat: 'XLSX',
      mocked: false, scheduleEnabled: false, status: 'real',
    },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'SUCCEEDED', attempt: 1 },
    select: { id: true },
  });
  return run.id;
}

function load(rows: readonly ImportRow[], withRunId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: withRunId };
    return budgetsDataset.load(ctx, rows);
  });
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    divisionName: FACULTY_DIVISION,
    facultyCode: FACULTY_CODE,
    fundCategory: 'University revenue',
    fiscalYear: 2024,
    totalBudget: 12_000_000,
    totalCommitment: null,
    totalObligation: null,
    totalExpenditure: null,
    fundsAvailable: null,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-faculty-budgets');
  otherRunId = await makeRun('xlsx-faculty-budgets');
  await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
});

afterAll(cleanup);

describe('budgets dataset', () => {
  it('is registered under the slug the raw view already uses', () => {
    expect(getImportDataset('faculty-budgets').slug).toBe('faculty-budgets');
  });

  it('inserts a division that is not a faculty', async () => {
    // A president's office or a hospital has a budget and is not a faculty.
    // The connector leaves facultyId null for these and so must the import.
    const result = await load([
      row({ divisionName: CENTRAL_DIVISION, facultyCode: null, totalBudget: 5_000_000 }),
    ], runId);
    expect(result.inserted).toBe(1);

    const stored = await prisma.facultyBudget.findFirstOrThrow({
      where: { divisionName: CENTRAL_DIVISION },
      select: { facultyId: true, ingestionRunId: true },
    });
    expect(stored.facultyId).toBeNull();
    expect(stored.ingestionRunId).toBe(runId);
  });

  it('links a division to a faculty when the code is given', async () => {
    const result = await load([row()], runId);
    expect(result.inserted).toBe(1);

    const stored = await prisma.facultyBudget.findFirstOrThrow({
      where: { divisionName: FACULTY_DIVISION },
      select: { faculty: { select: { code: true } }, totalBudget: true },
    });
    expect(stored.faculty?.code).toBe(FACULTY_CODE);
    expect(Number(stored.totalBudget)).toBe(12_000_000);
  });

  it('updates on (division, fund, year) rather than duplicating', async () => {
    const result = await load([row({ totalBudget: 13_500_000 })], otherRunId);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);

    expect(await prisma.facultyBudget.count({
      where: { divisionName: FACULTY_DIVISION },
    })).toBe(1);
  });

  it('defaults a blank figure to 0 on insert and leaves it alone on update', async () => {
    const afterInsert = await prisma.facultyBudget.findFirstOrThrow({
      where: { divisionName: FACULTY_DIVISION },
      select: { totalExpenditure: true },
    });
    expect(Number(afterInsert.totalExpenditure)).toBe(0);

    await load([row({ totalExpenditure: 900_000 })], otherRunId);
    await load([row({ totalExpenditure: null, totalBudget: 14_000_000 })], otherRunId);

    const afterBlank = await prisma.facultyBudget.findFirstOrThrow({
      where: { divisionName: FACULTY_DIVISION },
      select: { totalExpenditure: true, totalBudget: true },
    });
    expect(Number(afterBlank.totalExpenditure)).toBe(900_000);
    expect(Number(afterBlank.totalBudget)).toBe(14_000_000);
  });

  it('does not drop a faculty link when the code is left blank', async () => {
    // The comment on the update path promises a blank cell keeps what is
    // stored. facultyId was written unconditionally, so a re-upload that
    // omits the code silently orphaned the row from its faculty rollup.
    await load([row({ facultyCode: null, totalBudget: 14_500_000 })], otherRunId);

    const stored = await prisma.facultyBudget.findFirstOrThrow({
      where: { divisionName: FACULTY_DIVISION },
      select: { faculty: { select: { code: true } }, totalBudget: true },
    });
    expect(stored.faculty?.code).toBe(FACULTY_CODE);
    expect(Number(stored.totalBudget)).toBe(14_500_000);
  });

  it('keeps a second fund category for one division apart', async () => {
    const result = await load([row({ fundCategory: 'Government subsidy' })], runId);
    expect(result.inserted).toBe(1);
    expect(await prisma.facultyBudget.count({
      where: { divisionName: FACULTY_DIVISION },
    })).toBe(2);
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => budgetsDataset.clear(tx, [runId]));
    expect(deleted).toBe(3);
    expect(await prisma.facultyBudget.count({
      where: { divisionName: { in: [FACULTY_DIVISION, CENTRAL_DIVISION] } },
    })).toBe(0);
  });
});
