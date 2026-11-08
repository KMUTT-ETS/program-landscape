import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { courseEvaluationsDataset } from '../src/import/datasets/course-evaluations';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';
import { computeHealthScores } from '../src/health-score';
import { SCRATCH_DB, describeScratchDb } from './helpers/scratch-db';

// Course evaluations feed the student-satisfaction health driver. A row is a
// course-level overall rating, never a per-instructor or per-question one.

const FACULTY_CODE = 'CE-ENG';
const PROG_CODE = 'CE-PROG-1';
const COURSE = 'CEX 221';
const NORM = 'CEX221';

let runId = '';
let otherRunId = '';
let programId = '';

async function cleanup(): Promise<void> {
  await prisma.evaluationResponseSummary.deleteMany({ where: { courseCode: { in: [NORM, 'CEX999'] } } });
  await prisma.programCourse.deleteMany({ where: { program: { code: PROG_CODE } } });
  await prisma.program.deleteMany({ where: { code: PROG_CODE } });
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
    return courseEvaluationsDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const parsed: ParsedSheet = {
    sheetName: courseEvaluationsDataset.sheetName,
    headers: courseEvaluationsDataset.columns.map((c) => c.header),
    rows,
  };
  return validateSheet(courseEvaluationsDataset, parsed, {
    references: new Map([['faculties', new Set([FACULTY_CODE])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function sRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Course Code': COURSE,
    'Academic Year': 2025,
    Semester: 1,
    Section: 1,
    'Average Rating': 4.25,
    Respondents: 30,
    'Faculty Code': FACULTY_CODE,
    'Course Name (Thai)': null,
    'Course Name (English)': 'Thermodynamics',
    ...over,
  };
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    courseCode: COURSE, academicYear: 2025, semester: 1, section: 1,
    averageRating: 4.25, respondents: 30, facultyCode: FACULTY_CODE,
    courseNameTh: null, courseNameEn: 'Thermodynamics',
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  if (!SCRATCH_DB) return;
  await cleanup();
  runId = await makeRun('xlsx-course-evaluations');
  otherRunId = await makeRun('xlsx-course-evaluations');
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
    select: { id: true },
  });
  const p = await prisma.program.create({
    data: {
      code: PROG_CODE, nameTh: 'โปรแกรม', nameEn: 'Programme', facultyId: faculty.id,
      level: 'BACHELOR', status: 'ACTIVE', sequenceNoFromSheet: -9301,
    },
    select: { id: true },
  });
  programId = p.id;
  await prisma.programCourse.create({
    data: { programId, courseCode: NORM, courseCodeRaw: COURSE, methodVersion: 'xlsx-import.v1', ingestionRunId: runId },
  });
});

afterAll(async () => {
  if (!SCRATCH_DB) return;
  if (SCRATCH_DB) await cleanup();
});

describeScratchDb('course evaluations dataset', () => {
  it('is registered', () => {
    expect(getImportDataset('course-evaluations').slug).toBe('course-evaluations');
  });

  it('refuses a rating outside 1–5', () => {
    for (const bad of [0.5, 5.5, 87]) {
      const r = validate([sRow({ 'Average Rating': bad })]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]!.message).toMatch(/1 and 5/);
    }
  });

  it('refuses fewer than 5 respondents without quoting the rating', () => {
    const r = validate([sRow({ Respondents: 3, 'Average Rating': 4.123 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.column === 'Respondents')).toBe(true);
      expect(JSON.stringify(r.errors)).not.toContain('4.123');
    }
  });

  it('refuses a Buddhist-era year', () => {
    const r = validate([sRow({ 'Academic Year': 2568 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.column).toBe('Academic Year');
  });

  it('refuses a semester outside 1–3', () => {
    expect(validate([sRow({ Semester: 4 })]).ok).toBe(false);
  });

  it('matches MEE 221 and MEE221 as one course', () => {
    const r = validate([sRow({ 'Course Code': 'MEE 221' }), sRow({ 'Course Code': 'MEE221' })]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.row === 2 || e.row === 3)).toBe(true);
      expect(r.errors.map((e) => e.message).join(' ')).toMatch(/row/i);
    }
  });

  it('accepts a good row', () => {
    expect(validate([sRow()]).ok).toBe(true);
  });

  it('load writes sentinels and stamps the run', async () => {
    const result = await load([row()], runId);
    expect(result.inserted).toBe(1);
    const stored = await prisma.evaluationResponseSummary.findFirstOrThrow({
      where: { courseCode: NORM },
    });
    expect(stored.questionIdRegistrar).toBe('OVERALL');
    expect(stored.classIdRegistrar > 2n ** 62n).toBe(true);
    expect(stored.acadYearBE).toBe(2568);
    expect(stored.facultyRegistryId).toBe(0);
    expect(stored.officerIdRegistrar).toBe(0);
    expect(stored.campusId).toBe(0);
    expect(stored.courseCodeRaw).toBe(COURSE);
    expect(stored.ingestionRunId).toBe(runId);
    expect(stored.facultyId).not.toBeNull();
    expect(stored.methodologyVersion).toBe('xlsx-import.v1');
    // Must not feed the registrar connector's MAX(lastUpdateAt) watermark.
    expect(stored.lastUpdateAt).toBeNull();
    expect(Number(stored.ratingAvg)).toBe(4.25);
  });

  it('re-uploading updates in place', async () => {
    const result = await load([row({ courseCode: 'CEX221', averageRating: 4.5 })], runId);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    const all = await prisma.evaluationResponseSummary.findMany({ where: { courseCode: NORM } });
    expect(all).toHaveLength(1);
    expect(Number(all[0]!.ratingAvg)).toBe(4.5);
  });

  it('student_satisfaction reads an imported row', async () => {
    const [scored] = await computeHealthScores('program', programId);
    const driver = scored?.dimensions.outcomes.drivers.find((d) => d.label === 'student_satisfaction');
    expect(driver?.value).not.toBeNull();
  });

  it('clear only deletes this dataset’s runs', async () => {
    await load([row({ courseCode: 'CEX 999' })], otherRunId);
    const deleted = await prisma.$transaction((tx) => courseEvaluationsDataset.clear(tx, [runId]));
    expect(deleted).toBe(1);
    const left = await prisma.evaluationResponseSummary.findMany({ where: { courseCode: 'CEX999' } });
    expect(left).toHaveLength(1);
  });
});
