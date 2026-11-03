import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { programFacultySalaryByFunding, levelMatchesRank } from '../src/program-deep-dive';
import {
  RANK_LEVEL_LABEL,
  staffSalaryByFundingDataset,
} from '../src/import/datasets/staff-salary-by-funding';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'SSF-FAC';
const FACULTY_NAME_TH = 'คณะทดสอบเงินเดือน';
const PROGRAM_CODE = 'SSF-PROG';
const STAFF_CODE = 'SSF-STAFF-1';

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.staffCompensationCube.deleteMany({ where: { facultyName: FACULTY_NAME_TH } });
  await prisma.programFaculty.deleteMany({ where: { program: { code: PROGRAM_CODE } } });
  await prisma.enrollmentMetric.deleteMany({ where: { program: { code: PROGRAM_CODE } } });
  await prisma.facultyMember.deleteMany({ where: { employeeCode: STAFF_CODE } });
  await prisma.program.deleteMany({ where: { code: PROGRAM_CODE } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

async function makeRun(slug: string): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug },
    update: { mocked: false },
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
    return staffSalaryByFundingDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const parsed: ParsedSheet = {
    sheetName: staffSalaryByFundingDataset.sheetName,
    headers: staffSalaryByFundingDataset.columns.map((c) => c.header),
    rows,
  };
  return validateSheet(staffSalaryByFundingDataset, parsed, {
    references: new Map([['faculties', new Set([FACULTY_CODE])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function sheetRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Faculty Code': FACULTY_CODE,
    Rank: 'ASST_PROF',
    'Funding Source': 'Government budget',
    'Fiscal Year': 2024,
    Headcount: 12,
    'Mean Monthly Salary (THB)': 50_000,
    'Min Monthly Salary (THB)': 40_000,
    'Max Monthly Salary (THB)': 65_000,
    ...over,
  };
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    facultyCode: FACULTY_CODE, rank: 'ASST_PROF', fundingSource: 'Government budget',
    fiscalYear: 2024, headcount: 12, meanSalary: 50_000, minSalary: 40_000, maxSalary: 65_000,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-staff-salary-by-funding');
  otherRunId = await makeRun('xlsx-staff-salary-by-funding');
  await prisma.faculty.create({ data: { code: FACULTY_CODE, nameTh: FACULTY_NAME_TH, nameEn: 'Salary test' } });
});

afterAll(cleanup);

describe('staff-salary-by-funding dataset', () => {
  it('is registered', () => {
    expect(getImportDataset('staff-salary-by-funding').sheetName).toBe('Staff Salary by Funding');
  });

  it('accepts a well-formed row', () => {
    expect(validate([sheetRow()]).ok).toBe(true);
  });

  it('refuses an annual figure in a monthly column', () => {
    const result = validate([sheetRow({ 'Mean Monthly Salary (THB)': 600_000, 'Max Monthly Salary (THB)': 900_000 })]);
    expect(result.errors.some((e) => /monthly, not annual/i.test(e.message))).toBe(true);
  });

  it('refuses headcount below 5 without quoting salaries', () => {
    const result = validate([sheetRow({ Headcount: 3, 'Mean Monthly Salary (THB)': 51_234 })]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.errors)).not.toContain('51234');
    expect(JSON.stringify(result.errors)).not.toContain('51,234');
  });

  it('refuses min > mean or mean > max', () => {
    expect(validate([sheetRow({ 'Min Monthly Salary (THB)': 55_000 })]).errors.length).toBeGreaterThan(0);
    expect(validate([sheetRow({ 'Max Monthly Salary (THB)': 45_000 })]).errors.length).toBeGreaterThan(0);
  });

  it('refuses a Buddhist-era year', () => {
    expect(validate([sheetRow({ 'Fiscal Year': 2567 })]).errors.length).toBeGreaterThan(0);
  });

  it('level prefix matches levelMatchesRank for every rank', () => {
    for (const [rank, label] of Object.entries(RANK_LEVEL_LABEL)) {
      expect(levelMatchesRank(label, rank as keyof typeof RANK_LEVEL_LABEL)).toBe(true);
    }
    expect(levelMatchesRank(RANK_LEVEL_LABEL.PROF, 'ASSOC_PROF')).toBe(false);
  });

  it('stores Buddhist-era year, Thai level, faculty name and sum', async () => {
    const result = await load([row()], runId);
    expect(result.inserted).toBe(1);
    const stored = await prisma.staffCompensationCube.findFirstOrThrow({ where: { facultyName: FACULTY_NAME_TH } });
    expect(stored.fiscalYear).toBe(2567);
    expect(stored.level).toBe(RANK_LEVEL_LABEL.ASST_PROF);
    expect(stored.isAcademic).toBe(true);
    expect(stored.salType).toBe('Government budget');
    expect(stored.sumSalary).toBe(600_000);
    expect(stored.ingestionRunId).toBe(runId);
    expect(stored.facultyId).not.toBeNull();
  });

  it('upserts rather than duplicating', async () => {
    const result = await load([row({ headcount: 14 })], otherRunId);
    expect(result.updated).toBe(1);
    expect(await prisma.staffCompensationCube.count({ where: { facultyName: FACULTY_NAME_TH } })).toBe(1);
  });

  it('programFacultySalaryByFunding reads an imported row', async () => {
    const faculty = await prisma.faculty.findUniqueOrThrow({ where: { code: FACULTY_CODE } });
    const program = await prisma.program.create({
      data: {
        code: PROGRAM_CODE, nameTh: 'ทดสอบ', nameEn: 'Salary test programme',
        level: 'BACHELOR', facultyId: faculty.id, status: 'ACTIVE', sequenceNoFromSheet: -9201,
      },
    });
    const member = await prisma.facultyMember.create({
      data: {
        employeeCode: STAFF_CODE, nameTh: 'ทดสอบ', nameEn: 'Test Staff',
        facultyId: faculty.id, rank: 'ASST_PROF', isActive: true,
      },
    });
    await prisma.programFaculty.create({ data: { programId: program.id, facultyMemberId: member.id } });
    await prisma.enrollmentMetric.create({
      data: {
        programId: program.id, academicYear: 2024, applications: 10, admitted: 10, enrolled: 10,
        retainedYear2: 0, graduatedOnTime: 0, graduatedLate: 0, dropouts: 0, freshnessDate: new Date(),
      },
    });
    const result = await programFacultySalaryByFunding(program.id);
    expect(result).not.toBeNull();
    expect(result!.entries[0]!.salType).toBe('Government budget');
    expect(result!.totalAnnualThb).toBeCloseTo(50_000 * 12, 0);
  });

  it('clear only deletes this dataset\'s runs', async () => {
    const faculty = await prisma.faculty.findUniqueOrThrow({ where: { code: FACULTY_CODE } });
    const foreign = await prisma.staffCompensationCube.create({
      data: {
        fiscalYear: 2567, facultyName: FACULTY_NAME_TH, facultyId: faculty.id, isAcademic: true,
        level: RANK_LEVEL_LABEL.PROF, salType: 'Connector', headcount: 9, meanSalary: 1, minSalary: 1, maxSalary: 1, sumSalary: 9,
      },
    });
    const removed = await prisma.$transaction((tx) => staffSalaryByFundingDataset.clear(tx, [runId, otherRunId]));
    expect(removed).toBe(1);
    expect(await prisma.staffCompensationCube.count({ where: { id: foreign.id } })).toBe(1);
  });

  it('the connector\'s scoped delete keeps imported rows and removes unstamped ones', async () => {
    await load([row({ rank: 'PROF' })], runId);
    await prisma.staffCompensationCube.create({
      data: {
        fiscalYear: 2567, facultyName: FACULTY_NAME_TH, isAcademic: true,
        level: 'อ.', salType: 'Connector', headcount: 9, meanSalary: 1, minSalary: 1, maxSalary: 1, sumSalary: 9,
      },
    });
    const deleted = await prisma.staffCompensationCube.deleteMany({
      where: {
        fiscalYear: 2567, facultyName: FACULTY_NAME_TH,
        OR: [
          { ingestionRunId: null },
          { NOT: { ingestionRun: { dataSource: { slug: 'xlsx-staff-salary-by-funding' } } } },
        ],
      },
    });
    expect(deleted.count).toBeGreaterThanOrEqual(1);
    const left = await prisma.staffCompensationCube.findMany({ where: { facultyName: FACULTY_NAME_TH } });
    expect(left.map((r) => r.salType)).toEqual(['Government budget']);
  });
});
