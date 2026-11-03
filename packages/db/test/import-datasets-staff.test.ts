import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { staffDataset } from '../src/import/datasets/staff';
import { getImportDataset } from '../src/import/registry';
import type { ImportDataset, ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'STF-ENG';
const DEPARTMENT_CODE = 'STF-ENG-CIV';
const EMPLOYEE_CODE = 'STF-0001';
const CONNECTOR_EMPLOYEE_CODE = 'STF-0002';

let runId = '';
let otherRunId = '';
let connectorRunId = '';

async function cleanup(): Promise<void> {
  await prisma.facultyMember.deleteMany({
    where: { employeeCode: { in: [EMPLOYEE_CODE, CONNECTOR_EMPLOYEE_CODE] } },
  });
  await prisma.department.deleteMany({ where: { code: DEPARTMENT_CODE } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

async function makeRun(slug: string, mocked = false): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug },
    update: {},
    create: {
      slug, name: `${slug} test`, kind: 'CSV', inputFormat: 'XLSX',
      mocked, scheduleEnabled: false, status: 'real',
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
    return staffDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const headers = staffDataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: staffDataset.sheetName, headers, rows };
  return validateSheet(staffDataset, parsed, {
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
    'Employee Code': EMPLOYEE_CODE,
    'Name (Thai)': 'สมชาย ใจดี',
    'Name (English)': 'Somchai Jaidee',
    'Faculty Code': FACULTY_CODE,
    'Department Code': DEPARTMENT_CODE,
    Rank: 'LECTURER',
    'Academic Qualification': null,
    Specialization: null,
    'Hire Date': null,
    'Retirement Date': null,
    Active: null,
    ...over,
  };
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    employeeCode: EMPLOYEE_CODE,
    nameTh: 'สมชาย ใจดี',
    nameEn: 'Somchai Jaidee',
    facultyCode: FACULTY_CODE,
    departmentCode: DEPARTMENT_CODE,
    rank: 'LECTURER',
    academicQualification: null,
    specialization: null,
    hireDate: null,
    retirementDate: null,
    isActive: null,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-faculty-members');
  otherRunId = await makeRun('xlsx-faculty-members');
  connectorRunId = await makeRun('kku-hr-test-source');

  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
  await prisma.department.create({
    data: {
      code: DEPARTMENT_CODE, nameTh: 'โยธา', nameEn: 'Civil', facultyId: faculty.id,
    },
  });
});

afterAll(cleanup);

describe('staff dataset', () => {
  it('is registered under the slug the raw view already uses', () => {
    expect(getImportDataset('faculty-members').slug).toBe('faculty-members');
  });

  it('inserts a staff member against a faculty and department', async () => {
    const result = await load([row({ rank: 'ASSOC_PROF' })], runId);
    expect(result.inserted).toBe(1);

    const stored = await prisma.facultyMember.findUniqueOrThrow({
      where: { employeeCode: EMPLOYEE_CODE },
      select: {
        nameEn: true, rank: true, isActive: true, ingestionRunId: true,
        faculty: { select: { code: true } },
        department: { select: { code: true } },
      },
    });
    expect(stored.nameEn).toBe('Somchai Jaidee');
    expect(stored.rank).toBe('ASSOC_PROF');
    expect(stored.faculty.code).toBe(FACULTY_CODE);
    expect(stored.department?.code).toBe(DEPARTMENT_CODE);
    expect(stored.isActive).toBe(true);
    expect(stored.ingestionRunId).toBe(runId);
  });

  it('keeps stored qualification, dates, department and Active when those columns are absent', async () => {
    const hire = new Date('2015-06-01T00:00:00.000Z');
    await load([row({ academicQualification: 'PhD', hireDate: hire, isActive: false })], runId);
    const absent = row() as Record<string, unknown>;
    for (const key of ['academicQualification', 'specialization', 'hireDate', 'retirementDate', 'isActive', 'departmentCode']) {
      delete absent[key];
    }
    await load([absent as ImportRow], otherRunId);
    const after = await prisma.facultyMember.findUniqueOrThrow({
      where: { employeeCode: EMPLOYEE_CODE },
      select: { academicQualification: true, hireDate: true, isActive: true, departmentId: true },
    });
    expect(after.academicQualification).toBe('PhD');
    expect(after.hireDate?.toISOString()).toBe(hire.toISOString());
    expect(after.isActive).toBe(false);
    expect(after.departmentId).not.toBeNull();
  });

  it('accepts a blank Department Code', () => {
    // Phase 1 made departments optional; staff hang off a faculty directly
    // in an institution that does not use them.
    expect(validate([sheetRow({ 'Department Code': null })]).ok).toBe(true);
  });

  it('refuses a rank outside the four the schema allows', () => {
    const result = validate([sheetRow({ Rank: 'READER' })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.column).toBe('Rank');
  });

  it('offers no date of birth and no national-id column', () => {
    // §7.4 and the owner's decision of 2026-10-18. A birth date in a
    // spreadsheet is emailed around before anyone uploads it.
    const headers = staffDataset.columns.map((c) => c.header.toLowerCase());
    const keys = staffDataset.columns.map((c) => c.key.toLowerCase());
    expect(headers.some((h) => /birth/.test(h))).toBe(false);
    expect(keys.some((k) => /birth|citizen|national|passport|taxid/.test(k))).toBe(false);
  });

  it('says what the retirement date is for', () => {
    const retirement = staffDataset.columns.find((c) => c.key === 'retirementDate');
    expect(retirement?.guide).toMatch(/succession|retire/i);
  });

  it('refuses a cell holding a national ID, without echoing it', () => {
    // §7.3. 1101700207366 is synthetic and passes the mod-11 check.
    const result = validate([sheetRow({ 'Academic Qualification': '1101700207366' })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/personal identifier/i);
    expect(result.errors[0]?.message).not.toContain('1101700207366');
  });

  it('does not re-attribute a row a connector created', async () => {
    const faculty = await prisma.faculty.findUniqueOrThrow({ where: { code: FACULTY_CODE } });
    await prisma.facultyMember.create({
      data: {
        employeeCode: CONNECTOR_EMPLOYEE_CODE, nameTh: 'ก', nameEn: 'Connector Person',
        facultyId: faculty.id, rank: 'LECTURER', ingestionRunId: connectorRunId,
      },
    });

    const result = await load([
      row({ employeeCode: CONNECTOR_EMPLOYEE_CODE, nameEn: 'Corrected Name' }),
    ], otherRunId);
    expect(result.updated).toBe(1);

    const stored = await prisma.facultyMember.findUniqueOrThrow({
      where: { employeeCode: CONNECTOR_EMPLOYEE_CODE },
      select: { nameEn: true, ingestionRunId: true },
    });
    expect(stored.nameEn).toBe('Corrected Name');
    expect(stored.ingestionRunId).toBe(connectorRunId);
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => staffDataset.clear(tx, [runId]));
    expect(deleted).toBe(1);
    // The connector's person survives: this import never created them.
    expect(await prisma.facultyMember.count({
      where: { employeeCode: CONNECTOR_EMPLOYEE_CODE },
    })).toBe(1);
  });
});
