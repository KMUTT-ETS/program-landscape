import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { compensationDataset } from '../src/import/datasets/compensation';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'CMP-ENG';
const DEPARTMENT_CODE = 'CMP-ENG-CIV';

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.facultyCompensation.deleteMany({ where: { faculty: { code: FACULTY_CODE } } });
  await prisma.department.deleteMany({ where: { code: DEPARTMENT_CODE } });
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
    return compensationDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const headers = compensationDataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: compensationDataset.sheetName, headers, rows };
  return validateSheet(compensationDataset, parsed, {
    references: new Map([
      ['faculties', new Set([FACULTY_CODE])],
      ['departments', new Set([DEPARTMENT_CODE])],
    ]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function sheetRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Faculty Code': FACULTY_CODE,
    'Department Code': null,
    Rank: 'LECTURER',
    'Fiscal Year': 2024,
    Headcount: 12,
    'Total Salary (THB)': 7_200_000,
    'Mean Salary (THB)': 600_000,
    'Min Salary (THB)': 480_000,
    'Max Salary (THB)': 820_000,
    ...over,
  };
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    facultyCode: FACULTY_CODE,
    departmentCode: null,
    rank: 'LECTURER',
    fiscalYear: 2024,
    headcount: 12,
    sumSalary: 7_200_000,
    meanSalary: 600_000,
    minSalary: 480_000,
    maxSalary: 820_000,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-faculty-compensation');
  otherRunId = await makeRun('xlsx-faculty-compensation');

  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
  await prisma.department.create({
    data: { code: DEPARTMENT_CODE, nameTh: 'โยธา', nameEn: 'Civil', facultyId: faculty.id },
  });
});

afterAll(cleanup);

describe('compensation dataset', () => {
  it('is registered under the slug the raw view already uses', () => {
    expect(getImportDataset('faculty-compensation').slug).toBe('faculty-compensation');
  });

  it('inserts a faculty-wide row whose department is blank', async () => {
    const result = await load([row()], runId);
    expect(result.inserted).toBe(1);

    const stored = await prisma.facultyCompensation.findFirstOrThrow({
      where: { faculty: { code: FACULTY_CODE }, departmentId: null },
      select: { headcount: true, departmentId: true, ingestionRunId: true, meanSalary: true },
    });
    expect(stored.departmentId).toBeNull();
    expect(stored.headcount).toBe(12);
    expect(Number(stored.meanSalary)).toBe(600_000);
    expect(stored.ingestionRunId).toBe(runId);
  });

  it('updates the faculty-wide row rather than duplicating it', async () => {
    // Postgres treats NULL as distinct in a unique index, so the compound
    // unique does NOT constrain a null department — findFirst is the only
    // way this row is ever found again.
    const result = await load([row({ headcount: 13 })], otherRunId);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);

    expect(await prisma.facultyCompensation.count({
      where: { faculty: { code: FACULTY_CODE }, departmentId: null },
    })).toBe(1);
  });

  it('keeps a department row and a faculty-wide row apart', async () => {
    const result = await load([row({ departmentCode: DEPARTMENT_CODE, headcount: 6 })], runId);
    expect(result.inserted).toBe(1);

    expect(await prisma.facultyCompensation.count({
      where: { faculty: { code: FACULTY_CODE } },
    })).toBe(2);
  });

  it('refuses a row covering four people, naming the row', () => {
    const result = validate([sheetRow({ Headcount: 4 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.row).toBe(2);
    expect(result.errors[0]?.column).toBe('Headcount');
  });

  it('does not quote any salary figure in that refusal', () => {
    // Section 7.2: the message explains the rule, it does not reproduce
    // the figures that tripped it.
    const result = validate([sheetRow({ Headcount: 4 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.errors[0]?.message ?? '';
    for (const figure of ['7200000', '600000', '480000', '820000']) {
      expect(message).not.toContain(figure);
    }
  });

  it('accepts a row covering exactly five', () => {
    expect(validate([sheetRow({ Headcount: 5 })]).ok).toBe(true);
  });

  it('refuses a negative salary', () => {
    const result = validate([sheetRow({ 'Min Salary (THB)': -1 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.column).toBe('Min Salary (THB)');
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => compensationDataset.clear(tx, [runId]));
    // Both rows were created by runId — the second load only updated one.
    expect(deleted).toBe(2);
    expect(await prisma.facultyCompensation.count({
      where: { faculty: { code: FACULTY_CODE } },
    })).toBe(0);
  });
});
