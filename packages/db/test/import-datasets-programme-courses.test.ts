import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { importOwnedProgramIds } from '../src/program-course-ownership';
import {
  parseCourseCategory,
  programmeCoursesDataset,
} from '../src/import/datasets/programme-courses';
import { programmesDataset } from '../src/import/datasets/programmes';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

// Programme course lists. PROGRAMME-SCOPED: a programme named in the file has
// its whole list replaced (PDF-extracted rows included); other programmes are
// never touched.

const FACULTY_CODE = 'PC-ENG';
const CODES = ['PC-PROG-1', 'PC-PROG-2', 'PC-PROG-3'] as const;

let runId = '';
let otherRunId = '';
let programmesRunId = '';
const ids: Record<string, string> = {};
let revisionId = '';

async function cleanup(): Promise<void> {
  await prisma.programCourse.deleteMany({ where: { program: { code: { in: [...CODES] } } } });
  await prisma.programRevision.deleteMany({ where: { program: { code: { in: [...CODES] } } } });
  await prisma.program.deleteMany({ where: { code: { in: [...CODES] } } });
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
    return programmeCoursesDataset.load(ctx, rows);
  });
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    programmeCode: CODES[0],
    courseCode: 'MEE 221',
    courseNameTh: null,
    courseNameEn: 'Thermodynamics',
    credits: 3,
    category: null,
    ...over,
  } as ImportRow;
}

async function pdfRows(programId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await prisma.programCourse.create({
      data: {
        programId, courseCode: `PDF${i}`, courseCodeRaw: `PDF ${i}`,
        methodVersion: 'program-courses-extract.v4', ingestionRunId: null,
      },
    });
  }
}

function sheet(rows: Record<string, unknown>[]): ParsedSheet {
  return {
    sheetName: programmeCoursesDataset.sheetName,
    headers: programmeCoursesDataset.columns.map((c) => c.header),
    rows,
  };
}

function validate(rows: Record<string, unknown>[]) {
  return validateSheet(programmeCoursesDataset, sheet(rows), {
    references: new Map([['programmes', new Set<string>(CODES)]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function sRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Programme Code': CODES[0],
    'Course Code': 'MEE 221',
    'Course Name (Thai)': null,
    'Course Name (English)': 'Thermodynamics',
    Credits: 3,
    Category: null,
    ...over,
  };
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-programme-courses');
  otherRunId = await makeRun('xlsx-programme-courses');
  programmesRunId = await makeRun('xlsx-programmes');

  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
    select: { id: true },
  });
  let seq = -9201;
  for (const code of CODES) {
    const p = await prisma.program.create({
      data: {
        code, nameTh: `โปรแกรม ${code}`, nameEn: `Programme ${code}`,
        facultyId: faculty.id, level: 'BACHELOR', status: 'ACTIVE',
        sequenceNoFromSheet: seq--,
        // Only the third is stamped as created by a programmes run.
        ingestionRunId: code === CODES[2] ? programmesRunId : null,
      },
      select: { id: true },
    });
    ids[code] = p.id;
  }
  const rev = await prisma.programRevision.create({
    data: { programId: ids[CODES[0]]!, curriculumYearBE: 2567, status: 'DRAFT' },
    select: { id: true },
  });
  revisionId = rev.id;
  await prisma.program.update({
    where: { id: ids[CODES[0]]! },
    data: { activeRevisionId: revisionId },
  });
  await pdfRows(ids[CODES[0]]!, 3);
  await pdfRows(ids[CODES[2]]!, 2);
});

afterAll(cleanup);

const countFor = (code: string) =>
  prisma.programCourse.count({ where: { programId: ids[code]! } });

describe('parseCourseCategory', () => {
  it('accepts labels, Thai labels and enum tokens', () => {
    for (const t of ['Major elective', ' major ELECTIVE ', 'วิชาเฉพาะเลือก', 'MAJOR_ELECTIVE']) {
      expect(parseCourseCategory(t)).toBe('MAJOR_ELECTIVE');
    }
    expect(parseCourseCategory('Lab')).toBeNull();
  });
});

describe('programme-courses dataset', () => {
  it('load replaces every row of each programme in the file and nothing else', async () => {
    const result = await load(
      [
        row(),
        row({ courseCode: 'MEE 222' }),
        row({ programmeCode: CODES[1], courseCode: 'CE 101' }),
      ],
      runId,
    );
    expect(result).toEqual({ inserted: 3, updated: 0, deleted: 3 });
    expect(await countFor(CODES[0])).toBe(2);
    expect(await countFor(CODES[1])).toBe(1);
    expect(await countFor(CODES[2])).toBe(2);
  });

  it('stores normalised code, raw code, UNKNOWN for blank category, version, run, active revision', async () => {
    const stored = await prisma.programCourse.findFirstOrThrow({
      where: { programId: ids[CODES[0]]!, courseCode: 'MEE221' },
    });
    expect(stored.courseCodeRaw).toBe('MEE 221');
    expect(stored.category).toBe('UNKNOWN');
    expect(stored.methodVersion).toBe('xlsx-import.v1');
    expect(stored.ingestionRunId).toBe(runId);
    expect(stored.programRevisionId).toBe(revisionId);
  });

  it('re-upload replaces the import own previous rows', async () => {
    await load([row({ courseCode: 'MEE 300' })], otherRunId);
    const rows = await prisma.programCourse.findMany({ where: { programId: ids[CODES[0]]! } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ingestionRunId).toBe(otherRunId);
  });

  it('countForScope counts only imported rows of the named programmes', async () => {
    const count = programmeCoursesDataset.countForScope!;
    expect(await count(prisma, [{ programmeCode: CODES[0] }])).toBe(1);
    expect(await count(prisma, [{ programmeCode: CODES[2] }])).toBe(0);
  });

  it('importOwnedProgramIds names the programmes holding imported rows', async () => {
    const owned = await importOwnedProgramIds(prisma, CODES.map((c) => ids[c]!));
    expect(owned).toEqual(new Set([ids[CODES[0]]!, ids[CODES[1]]!]));
  });

  it('clear removes only rows of the given runs', async () => {
    const removed = await prisma.$transaction((tx) =>
      programmeCoursesDataset.clear(tx, [runId, otherRunId]),
    );
    expect(removed).toBe(2);
    expect(await countFor(CODES[2])).toBe(2);
    const owned = await importOwnedProgramIds(prisma, CODES.map((c) => ids[c]!));
    expect(owned.size).toBe(0);
  });

  it('clearing programmes is refused while course rows exist', async () => {
    const blockers = await programmesDataset.cascadeBlockers!(prisma, [programmesRunId]);
    expect(blockers.map((b) => b.label)).toContain('courses');
  });
});

describe('programme-courses validation', () => {
  it('names the earlier row when two codes normalise alike', () => {
    const res = validate([sRow(), sRow({ 'Course Code': 'mee221' })]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const err = res.errors.find((e) => e.column === 'Programme Code');
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/row 2/i);
  });

  it('refuses an unknown category, listing the labels', () => {
    const res = validate([sRow({ Category: 'Lab' })]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]!.message).toContain('Major elective');
  });

  it('refuses credits over 60', () => {
    const res = validate([sRow({ Credits: 61 })]);
    expect(res.ok).toBe(false);
  });

  it('accepts a clean file', () => {
    expect(validate([sRow({ Category: 'Core' })]).ok).toBe(true);
  });
});
