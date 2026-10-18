import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { researchDataset } from '../src/import/datasets/research';
import { staffDataset } from '../src/import/datasets/staff';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'RES-ENG';
const AUTHOR_A = 'RES-0001';
const AUTHOR_B = 'RES-0002';
const DOI = '10.1234/res.test.0001';
const SHARED_TITLE = 'A shared paper on bridge fatigue';

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.researchOutput.deleteMany({
    where: { facultyMember: { employeeCode: { in: [AUTHOR_A, AUTHOR_B] } } },
  });
  await prisma.facultyMember.deleteMany({
    where: { employeeCode: { in: [AUTHOR_A, AUTHOR_B] } },
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
    return researchDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const headers = researchDataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: researchDataset.sheetName, headers, rows };
  return validateSheet(researchDataset, parsed, {
    references: new Map([['faculty-members', new Set([AUTHOR_A, AUTHOR_B])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    employeeCode: AUTHOR_A,
    year: 2023,
    type: 'JOURNAL',
    title: 'Fatigue in welded steel connections',
    venue: 'Journal of Structural Engineering',
    citations: 4,
    doi: DOI,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-research-outputs');
  otherRunId = await makeRun('xlsx-research-outputs');

  const facultyRunId = await makeRun('xlsx-faculty-members');
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
  await prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: facultyRunId };
    await staffDataset.load(ctx, [
      {
        employeeCode: AUTHOR_A, nameTh: 'ก', nameEn: 'Author A', facultyCode: FACULTY_CODE,
        departmentCode: null, rank: 'LECTURER', academicQualification: null,
        specialization: null, hireDate: null, retirementDate: null, isActive: null,
      },
      {
        employeeCode: AUTHOR_B, nameTh: 'ข', nameEn: 'Author B', facultyCode: FACULTY_CODE,
        departmentCode: null, rank: 'LECTURER', academicQualification: null,
        specialization: null, hireDate: null, retirementDate: null, isActive: null,
      },
    ]);
  });
  expect(faculty.code).toBe(FACULTY_CODE);
});

afterAll(cleanup);

describe('research dataset', () => {
  it('is registered under the slug the raw view already uses', () => {
    expect(getImportDataset('research-outputs').slug).toBe('research-outputs');
  });

  it('is declared a dependent of the staff roster', () => {
    // Clearing staff would cascade these away, so start-over must refuse.
    expect(staffDataset.dependents).toContain('research-outputs');
  });

  it('inserts a publication against a staff member', async () => {
    const result = await load([row()], runId);
    expect(result.inserted).toBe(1);

    const stored = await prisma.researchOutput.findFirstOrThrow({
      where: { facultyMember: { employeeCode: AUTHOR_A } },
      select: { title: true, year: true, citations: true, doi: true, ingestionRunId: true },
    });
    expect(stored.year).toBe(2023);
    expect(stored.citations).toBe(4);
    expect(stored.doi).toBe(DOI);
    expect(stored.ingestionRunId).toBe(runId);
  });

  it('matches an existing row by DOI and updates its citation count', async () => {
    const result = await load([row({ citations: 19 })], otherRunId);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);

    const stored = await prisma.researchOutput.findFirstOrThrow({
      where: { facultyMember: { employeeCode: AUTHOR_A }, doi: DOI },
      select: { citations: true },
    });
    expect(stored.citations).toBe(19);
  });

  it('falls back to title and year when the row has no DOI', async () => {
    const noDoi = { employeeCode: AUTHOR_A, year: 2021, type: 'CONFERENCE',
      title: 'Seismic retrofit of short-span bridges', venue: null, citations: 1, doi: null };

    expect((await load([noDoi as ImportRow], runId)).inserted).toBe(1);
    const second = await load([{ ...noDoi, citations: 6 } as ImportRow], runId);
    expect(second.updated).toBe(1);
    expect(second.inserted).toBe(0);

    const stored = await prisma.researchOutput.findFirstOrThrow({
      where: { facultyMember: { employeeCode: AUTHOR_A }, year: 2021 },
      select: { citations: true },
    });
    expect(stored.citations).toBe(6);
  });

  it('does not match another person’s paper of the same title and year', async () => {
    // The fallback is scoped to the staff member. Two people with a paper
    // of the same name and year are two rows, not one row that changes
    // hands depending on upload order.
    await load([row({ employeeCode: AUTHOR_A, title: SHARED_TITLE, doi: null, citations: 2 })], runId);
    const result = await load([
      row({ employeeCode: AUTHOR_B, title: SHARED_TITLE, doi: null, citations: 7 }),
    ], runId);

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);

    const both = await prisma.researchOutput.findMany({
      where: { title: SHARED_TITLE },
      select: { citations: true, facultyMember: { select: { employeeCode: true } } },
    });
    expect(both).toHaveLength(2);
    expect(both.find((r) => r.facultyMember?.employeeCode === AUTHOR_A)?.citations).toBe(2);
    expect(both.find((r) => r.facultyMember?.employeeCode === AUTHOR_B)?.citations).toBe(7);
  });

  it('refuses a type outside the four the schema allows', () => {
    const result = validate([{
      'Employee Code': AUTHOR_A, Year: 2023, Type: 'PREPRINT',
      Title: 'x', Venue: null, Citations: null, DOI: null,
    }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.column).toBe('Type');
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => researchDataset.clear(tx, [runId]));
    expect(deleted).toBeGreaterThanOrEqual(3);
    expect(await prisma.researchOutput.count({
      where: { facultyMember: { employeeCode: { in: [AUTHOR_A, AUTHOR_B] } } },
    })).toBe(0);
  });
});
