import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { realDataWhere } from '../src/data-quality';
import {
  classOfferingsDataset,
  synthesiseClassId,
} from '../src/import/datasets/class-offerings';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'CO-ENG';
const FACULTY_NAME_TH = 'คณะวิศวกรรมศาสตร์ (ทดสอบวิชา)';
const COURSE_A = 'CO-TEST-101';
const COURSE_B = 'CO-TEST-202';

let runId = '';

async function cleanup(): Promise<void> {
  await prisma.classOffering.deleteMany({
    where: { courseCode: { startsWith: 'CO-' } },
  });
  await prisma.classOffering.deleteMany({
    where: { courseCode: { in: [COURSE_A, COURSE_B, 'GE101', 'EN205'] } },
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

function load(rows: readonly ImportRow[], term: Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: runId, term };
    return classOfferingsDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const headers = classOfferingsDataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: classOfferingsDataset.sheetName, headers, rows };
  return validateSheet(classOfferingsDataset, parsed, {
    references: new Map([['faculties', new Set([FACULTY_CODE])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function sheetRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    'Academic Year': 2024,
    Semester: 1,
    'Faculty Code': FACULTY_CODE,
    Level: 'Bachelor',
    'Course Code': COURSE_A,
    Section: 1,
    'Class Id': null,
    'Course Name (Thai)': 'กลศาสตร์',
    'Course Name (English)': 'Mechanics',
    Credits: 3,
    'Lecture Hours/Week': 3,
    'Lab Hours/Week': 0,
    Enrolled: 48,
    'Total Seats': 60,
  };
  for (const g of ['A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F']) base[`Grade ${g}`] = null;
  base.Incomplete = null;
  base.Withdrawn = null;
  base.Audit = null;
  base.Satisfactory = null;
  return { ...base, ...over };
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    academicYear: 2024,
    semester: 1,
    facultyCode: FACULTY_CODE,
    levelName: 'Bachelor',
    courseCode: COURSE_A,
    section: 1,
    classId: null,
    courseNameTh: 'กลศาสตร์',
    courseNameEn: 'Mechanics',
    creditTotal: 3,
    lectureHrsPerWeek: 3,
    labHrsPerWeek: 0,
    enrollSeat: 48,
    totalSeat: 60,
    gradeA: null, gradeBPlus: null, gradeB: null, gradeCPlus: null,
    gradeC: null, gradeDPlus: null, gradeD: null, gradeF: null,
    gradeI: null, gradeW: null, gradeAU: null, gradeS: null,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-class-offerings');
  await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: FACULTY_NAME_TH, nameEn: 'Engineering (course test)' },
  });
});

afterAll(cleanup);

describe('class offerings dataset', () => {
  it('is registered under the slug the raw view uses', () => {
    expect(getImportDataset('class-offerings').slug).toBe('class-offerings');
  });

  it('declares itself term-scoped on year and semester', () => {
    expect(classOfferingsDataset.strategy.kind).toBe('term-scoped');
  });

  it('loads a term and reports the rows inserted', async () => {
    const result = await load(
      [row({ section: 1 }), row({ section: 2, enrollSeat: 44 })],
      { academicYear: 2024, semester: 1 },
    );
    expect(result.inserted).toBe(2);
    expect(result.deleted).toBe(0);

    expect(await prisma.classOffering.count({
      where: { courseCode: COURSE_A, acadYearBE: 2567, semester: 1 },
    })).toBe(2);
  });

  it('replaces a term on re-upload, so a cancelled section disappears', async () => {
    // The whole reason this dataset is term-scoped: the registrar's export
    // states what exists, and an upsert would leave a cancelled section in
    // the system permanently because nothing in the file says it is gone.
    const result = await load([row({ section: 1 })], { academicYear: 2024, semester: 1 });
    expect(result.deleted).toBe(2);
    expect(result.inserted).toBe(1);

    const remaining = await prisma.classOffering.findMany({
      where: { courseCode: COURSE_A, acadYearBE: 2567, semester: 1 },
      select: { section: true },
    });
    expect(remaining.map((r) => r.section)).toEqual([1]);
  });

  it('leaves another term’s rows alone', async () => {
    await load(
      [row({ semester: 2, courseCode: COURSE_B })],
      { academicYear: 2024, semester: 2 },
    );
    // Semester 1 survives untouched.
    expect(await prisma.classOffering.count({
      where: { courseCode: COURSE_A, acadYearBE: 2567, semester: 1 },
    })).toBe(1);
    expect(await prisma.classOffering.count({
      where: { courseCode: COURSE_B, acadYearBE: 2567, semester: 2 },
    })).toBe(1);
  });

  it('refuses a file carrying two different terms, naming both', () => {
    const result = validate([sheetRow(), sheetRow({ Semester: 2, Section: 9 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/same period/i);
  });

  it('synthesises a class id when the column is blank', async () => {
    const stored = await prisma.classOffering.findFirstOrThrow({
      where: { courseCode: COURSE_A, acadYearBE: 2567, semester: 1 },
      select: { classId: true },
    });
    expect(stored.classId).toBe(synthesiseClassId(2567, 1, COURSE_A, 1));
  });

  it('keeps a supplied class id unchanged', async () => {
    await load(
      [row({ courseCode: COURSE_B, section: 5, classId: 883344 })],
      { academicYear: 2024, semester: 2 },
    );
    const stored = await prisma.classOffering.findFirstOrThrow({
      where: { courseCode: COURSE_B, section: 5 },
      select: { classId: true },
    });
    expect(stored.classId).toBe(883344n);
  });

  it('synthesises deterministically, above the range a registrar uses', () => {
    const a = synthesiseClassId(2567, 1, 'ENG-101', 3);
    const b = synthesiseClassId(2567, 1, 'ENG-101', 3);
    expect(a).toBe(b);
    // A real CLASSID is ten digits; 2^62 is nineteen, so the two ranges
    // cannot overlap however many rows an institution has.
    expect(a).toBeGreaterThan(2n ** 62n);
    expect(synthesiseClassId(2567, 1, 'ENG-101', 4)).not.toBe(a);
    expect(synthesiseClassId(2567, 2, 'ENG-101', 3)).not.toBe(a);
    expect(synthesiseClassId(2568, 1, 'ENG-101', 3)).not.toBe(a);
  });

  it('refuses two rows for one course, semester and section', () => {
    // Caught in validation, naming both rows, rather than surfacing as a
    // unique-constraint error from the insert.
    const result = validate([sheetRow({ Section: 7 }), sheetRow({ Section: 7 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.row).toBe(3);
  });

  it('carries the faculty name every scoped reader joins through', async () => {
    // class-offerings.service.ts scopes by registryFacultyName. An imported
    // row with none would be invisible to every faculty-scoped user while
    // loading perfectly — the failure this whole phase guards against.
    const stored = await prisma.classOffering.findFirstOrThrow({
      where: { courseCode: COURSE_A, acadYearBE: 2567, semester: 1 },
      select: { registryFacultyName: true, facultyId: true, levelName: true },
    });
    expect(stored.registryFacultyName).toBe(FACULTY_NAME_TH);
    expect(stored.facultyId).not.toBeNull();
    expect(stored.levelName).toBe('Bachelor');
  });

  it('is visible through realDataWhere()', async () => {
    const found = await prisma.classOffering.findMany({
      where: { courseCode: COURSE_A, ...realDataWhere() },
      select: { semester: true },
    });
    expect(found.length).toBeGreaterThan(0);
  });

describe('the term delete and other people’s rows', () => {
  // The one destructive write in the importer. Every other write respects
  // claimsRow: an upload never touches a row a live source created. The
  // delete has to hold the same line, or a 40-row trial upload on a KKU
  // installation wipes a term of registrar data — and cascades into the
  // instructor rosters hanging off it.
  const CONNECTOR_COURSE = 'CO-CONN-900';

  it('leaves a connector-written row in the term alone', async () => {
    const connectorRunId = await makeRun('kku-class-offerings-test');
    const faculty = await prisma.faculty.findUniqueOrThrow({ where: { code: FACULTY_CODE } });
    await prisma.classOffering.create({
      data: {
        acadYearBE: 2567, semester: 1, courseCode: CONNECTOR_COURSE,
        courseCodeRaw: CONNECTOR_COURSE, section: 1, classId: 9_900_001n,
        enrollSeat: 30, totalSeat: 40, levelName: 'Bachelor',
        registryFacultyId: '07', registryFacultyName: faculty.nameTh,
        facultyId: faculty.id, ingestionRunId: connectorRunId,
      },
    });

    await load([row({ courseCode: COURSE_A, section: 1 })], { academicYear: 2024, semester: 1 });

    const survivor = await prisma.classOffering.findFirst({
      where: { courseCode: CONNECTOR_COURSE },
      select: { ingestionRunId: true },
    });
    expect(survivor?.ingestionRunId).toBe(connectorRunId);
  });

  it('still replaces the rows its own uploads created', async () => {
    const result = await load(
      [row({ courseCode: COURSE_A, section: 1 })],
      { academicYear: 2024, semester: 1 },
    );
    expect(result.deleted).toBe(1);
    expect(result.inserted).toBe(1);
  });

  it('reclaims a row with no recorded origin', async () => {
    // A legacy row nothing owns is invisible anyway; leaving it would mean
    // the term could never be made correct.
    const faculty = await prisma.faculty.findUniqueOrThrow({ where: { code: FACULTY_CODE } });
    await prisma.classOffering.create({
      data: {
        acadYearBE: 2567, semester: 1, courseCode: 'CO-LEGACY-1',
        courseCodeRaw: 'CO-LEGACY-1', section: 1, classId: 9_900_002n,
        enrollSeat: 1, totalSeat: 1, levelName: '',
        registryFacultyId: '', registryFacultyName: faculty.nameTh,
        facultyId: faculty.id,
      },
    });

    const result = await load(
      [row({ courseCode: COURSE_A, section: 1 })],
      { academicYear: 2024, semester: 1 },
    );
    expect(result.deleted).toBeGreaterThanOrEqual(2);
    expect(await prisma.classOffering.count({ where: { courseCode: 'CO-LEGACY-1' } })).toBe(0);
  });
});

  it('classifies a general-education course from its code', async () => {
    // The connector derives this from the code prefix; without it an
    // adopter's GE filter silently returns nothing, which reads as "we
    // teach no general education" rather than "nobody set the flag".
    await load(
      [row({ courseCode: 'GE101', section: 1 }), row({ courseCode: 'EN205', section: 1 })],
      { academicYear: 2024, semester: 1 },
    );
    const rows = await prisma.classOffering.findMany({
      where: { courseCode: { in: ['GE101', 'EN205'] } },
      select: { courseCode: true, isGeneralEducation: true },
    });
    expect(rows.find((r) => r.courseCode === 'GE101')?.isGeneralEducation).toBe(true);
    expect(rows.find((r) => r.courseCode === 'EN205')?.isGeneralEducation).toBe(false);
    await prisma.classOffering.deleteMany({ where: { courseCode: { in: ['GE101', 'EN205'] } } });
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => classOfferingsDataset.clear(tx, [runId]));
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.classOffering.count({
      where: { courseCode: { in: [COURSE_A, COURSE_B] } },
    })).toBe(0);
  });
});
