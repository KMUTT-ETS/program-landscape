import type { CourseCategory, PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import { normaliseCourseCode } from '../../course-code-normalise';
import { importOwnedCourseWhere } from '../../program-course-ownership';
import type {
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';

// Tier 2. The course list of each programme.
//
// The fallback for phase 2b of the programme pipeline, which reads the list
// from the curriculum PDF with code regexes tuned to one university's shape.
// An adopter whose PDFs cannot be parsed uploads the list instead. PROGRAMME-
// SCOPED: a programme named in the file has its whole list replaced, PDF-
// extracted rows included — two sources mixed in one list mean nothing.

export const PROGRAMME_COURSES_IMPORT_VERSION = 'xlsx-import.v1';

export const COURSE_CATEGORY_LABELS: readonly {
  value: CourseCategory;
  en: string;
  th: string;
}[] = [
  { value: 'GENERAL_EDUCATION', en: 'General education', th: 'หมวดวิชาศึกษาทั่วไป' },
  { value: 'CORE', en: 'Core', th: 'วิชาแกน' },
  { value: 'MAJOR_REQUIRED', en: 'Major required', th: 'วิชาเฉพาะบังคับ' },
  { value: 'MAJOR_ELECTIVE', en: 'Major elective', th: 'วิชาเฉพาะเลือก' },
  { value: 'FREE_ELECTIVE', en: 'Free elective', th: 'หมวดวิชาเลือกเสรี' },
  { value: 'THESIS_PROJECT', en: 'Thesis / project', th: 'วิทยานิพนธ์/โครงงาน' },
  { value: 'UNKNOWN', en: 'Unknown', th: 'ไม่ระบุ' },
];

const fold = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Null means unrecognised. Blank is the caller's concern, never guessed here. */
export function parseCourseCategory(text: string): CourseCategory | null {
  const wanted = fold(text);
  for (const c of COURSE_CATEGORY_LABELS) {
    if (fold(c.value) === wanted || fold(c.en) === wanted || fold(c.th) === wanted) {
      return c.value;
    }
  }
  return null;
}

const CATEGORY_HELP = COURSE_CATEGORY_LABELS.map((c) => c.en).join(', ');

export const programmeCoursesDataset: ImportDataset = {
  slug: 'programme-courses',
  title: 'Programme course lists',
  description:
    'The courses of each programme, one row per programme per course. This is the fallback when ' +
    'PDF extraction cannot read a programme’s course list. A programme that appears in the file ' +
    'has its whole course list replaced, including any courses read from its curriculum PDF; ' +
    'programmes not in the file are untouched. Programme overlap and the curriculum sections read these rows.',
  tier: 2,
  sheetName: 'Programme Courses',
  columns: [
    {
      header: 'Programme Code',
      key: 'programmeCode',
      type: 'text',
      required: true,
      guide: 'The programme this course belongs to, exactly as it appears in the Programmes sheet.',
      example: 'ENG-ME-BSC',
      references: { dataset: 'programmes', column: 'code' },
    },
    {
      header: 'Course Code',
      key: 'courseCode',
      type: 'text',
      required: true,
      guide:
        'The course code in your own format. Spaces and letter case are ignored when comparing, ' +
        'so "MEE 221" and "mee221" are the same course.',
      example: 'MEE 221',
      identity: (value) => normaliseCourseCode(String(value)),
    },
    {
      header: 'Course Name (Thai)',
      key: 'courseNameTh',
      type: 'text',
      required: false,
      guide: 'Optional. The course title in Thai.',
      example: 'อุณหพลศาสตร์',
    },
    {
      header: 'Course Name (English)',
      key: 'courseNameEn',
      type: 'text',
      required: false,
      guide: 'Optional. The course title in English.',
      example: 'Thermodynamics',
    },
    {
      header: 'Credits',
      key: 'credits',
      type: 'integer',
      required: false,
      guide: 'Whole credits, 0 to 60. Leave blank if unknown.',
      example: '3',
      check: (value) => {
        if (typeof value !== 'number') return null;
        return value >= 0 && value <= 60 && Number.isInteger(value)
          ? null
          : 'Credits must be a whole number from 0 to 60.';
      },
    },
    {
      header: 'Category',
      key: 'category',
      type: 'text',
      required: false,
      guide:
        `One of: ${CATEGORY_HELP}. Leave blank if unknown — a blank is stored as Unknown, never guessed. ` +
        'Mark general-education courses as General education — otherwise programme overlap counts ' +
        'them as major courses (its code-prefix fallback only knows GE, LI and 00).',
      example: 'Major required',
      check: (value) => {
        if (typeof value !== 'string' || value.trim() === '') return null;
        return parseCourseCategory(value) === null
          ? `"${value}" is not a category. Use one of: ${CATEGORY_HELP} — or leave blank.`
          : null;
      },
    },
  ],
  strategy: {
    kind: 'programme-scoped',
    scopeColumns: ['programmeCode'],
    match: { kind: 'unique', columns: ['programmeCode', 'courseCode'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const codes = [...new Set(rows.map((r) => String(r.programmeCode)))];
    const programmes = await ctx.tx.program.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, activeRevisionId: true },
    });
    const byCode = new Map(programmes.map((p) => [p.code, p]));

    for (const code of codes) {
      if (!byCode.has(code)) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
        );
      }
    }

    const deleted = await ctx.tx.programCourse.deleteMany({
      where: { programId: { in: programmes.map((p) => p.id) } },
    });

    const data = rows.map((row) => {
      const programme = byCode.get(String(row.programmeCode))!;
      const raw = String(row.courseCode).trim();
      const category =
        typeof row.category === 'string' && row.category.trim() !== ''
          ? parseCourseCategory(row.category) ?? 'UNKNOWN'
          : 'UNKNOWN';
      return {
        programId: programme.id,
        courseCode: normaliseCourseCode(raw),
        courseCodeRaw: raw,
        courseNameTh: typeof row.courseNameTh === 'string' ? row.courseNameTh : null,
        courseNameEn: typeof row.courseNameEn === 'string' ? row.courseNameEn : null,
        credits: typeof row.credits === 'number' ? row.credits : null,
        category,
        methodVersion: PROGRAMME_COURSES_IMPORT_VERSION,
        ingestionRunId: ctx.ingestionRunId,
        programRevisionId: programme.activeRevisionId,
      };
    });
    const created = await ctx.tx.programCourse.createMany({ data });

    return { inserted: created.count, updated: 0, deleted: deleted.count };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.programCourse.count(),

  // Only rows the import itself wrote: the guard protects an adopter's own
  // list from a partial re-upload and must not refuse a first upload over an
  // extractor list that over-collected.
  countForScope: async (prisma, scopes): Promise<number> => {
    const codes = scopes.map((s) => String(s.programmeCode));
    if (codes.length === 0) return 0;
    const programmes = await prisma.program.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    return prisma.programCourse.count({
      where: importOwnedCourseWhere(programmes.map((p) => p.id)),
    });
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.programCourse.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
