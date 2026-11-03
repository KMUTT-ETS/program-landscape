import type { PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import { normaliseCourseCode } from '../../course-code-normalise';
import type {
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { optDate, optNum, optStr } from './optional';
import { buddhistYearColumn, toBuddhistEra } from './cohorts';
import { synthesiseClassId } from './class-offerings';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2. Course-level student evaluation results, the input of the
// student-satisfaction driver in the outcomes dimension.
//
// One row is one course section's OVERALL rating in one term: a mean on a
// 1–5 scale and how many students answered. There is no per-instructor and no
// per-question row, so no instructor identity enters the sheet; the registrar
// shape the table was built for (officer id, question id, campus, class id)
// is filled with sentinels the reader never looks at.
//
// The driver joins programme course lists on the normalised course code, so
// the code is stored normalised and a course on no programme's list counts
// for nothing — load the programme course lists first.

export const COURSE_EVALUATIONS_IMPORT_VERSION = 'xlsx-import.v1';

/** The single question every imported row answers. */
const OVERALL_QUESTION = 'OVERALL';

export const courseEvaluationsDataset: ImportDataset = {
  slug: 'course-evaluations',
  title: 'Course Evaluations',
  description:
    'Overall student evaluation of each course, one row per course section per term: the mean ' +
    'rating on a 1–5 scale and how many students answered. Feeds the Student Satisfaction ' +
    'measure of each programme’s Outcomes score.',
  tier: 2,
  sheetName: 'Course Evaluations',
  columns: [
    {
      header: 'Course Code',
      key: 'courseCode',
      type: 'text',
      required: true,
      guide:
        'The course code, as it appears in the Programme Courses sheet. Spaces and letter case are ' +
        'ignored when comparing. A course that is on no programme’s course list counts for nothing, ' +
        'so load the programme course lists first.',
      example: 'MEE 221',
      identity: (value) => normaliseCourseCode(String(value)),
    },
    buddhistYearColumn('Academic Year', 'academicYear', 'The academic year the course was taught.'),
    {
      header: 'Semester',
      key: 'semester',
      type: 'integer',
      required: true,
      guide:
        '1, 2 or 3 (summer). Only semesters 1 and 2 are counted in the satisfaction measure; ' +
        'a summer term is stored but does not move the score.',
      example: '1',
      check: (value) =>
        typeof value === 'number' && (value < 1 || value > 3)
          ? 'A semester is 1, 2, or 3 for a summer term.'
          : null,
    },
    {
      header: 'Section',
      key: 'section',
      type: 'integer',
      required: false,
      guide: 'The section number, if a course has several. Leave blank for a single-section course.',
      example: '1',
      check: (value) =>
        typeof value === 'number' && value < 0 ? 'A section number cannot be negative.' : null,
    },
    {
      header: 'Average Rating',
      key: 'averageRating',
      type: 'decimal',
      required: true,
      guide:
        'The mean of a 1–5 scale across the students who answered (5 is best). Not a percentage: ' +
        '4.25 is right, 85 is refused.',
      example: '4.25',
      check: (value) =>
        typeof value === 'number' && (value < 1 || value > 5)
          ? `${value} is not on the scale. This column takes the mean of a rating between 1 and 5.`
          : null,
    },
    {
      header: 'Respondents',
      key: 'respondents',
      type: 'integer',
      required: true,
      guide:
        'How many students answered. A row with fewer than five respondents is refused: at that ' +
        'size the average describes individuals. It is also the weight of this row in the measure.',
      example: '30',
      groupSizeFor: { minimum: 5 },
    },
    {
      header: 'Faculty Code',
      key: 'facultyCode',
      type: 'text',
      required: false,
      guide:
        'The faculty that teaches the course, exactly as in the Faculties sheet. Optional, but the ' +
        'faculty satisfaction view groups by it, so a blank row is missing from that view.',
      example: 'ENG',
      references: { dataset: 'faculties', column: 'code' },
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
  ],
  strategy: {
    // MANUAL: the stored key is (year, semester, a class id synthesised from
    // year, semester, course and section, question, officer), which the
    // validator cannot see. The four sheet columns it is derived from are the
    // identity an operator thinks in, so the duplicate check names both rows.
    // A blank section and an explicit 0 are the same section; the loader's
    // upsert merges them, the validator cannot tell them apart.
    kind: 'upsert',
    match: { kind: 'manual', columns: ['academicYear', 'semester', 'courseCode', 'section'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const facultyCodes = [
      ...new Set(rows.map((r) => r.facultyCode).filter((c): c is string => typeof c === 'string')),
    ];
    const faculties = await ctx.tx.faculty.findMany({
      where: { code: { in: facultyCodes } },
      select: { id: true, code: true },
    });
    const facultyByCode = new Map(faculties.map((f) => [f.code, f.id]));
    for (const code of facultyCodes) {
      if (!facultyByCode.has(code)) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Faculty code "${code}" does not exist. Upload the Faculties sheet first.`,
        );
      }
    }

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const raw = String(row.courseCode).trim();
      const courseCode = normaliseCourseCode(raw);
      const acadYearBE = toBuddhistEra(Number(row.academicYear));
      const semester = Number(row.semester);
      const section = typeof row.section === 'number' ? row.section : 0;
      const classIdRegistrar = synthesiseClassId(acadYearBE, semester, courseCode, section);

      const figures = {
        facultyId:
          row.facultyCode === undefined
            ? undefined
            : typeof row.facultyCode === 'string'
              ? facultyByCode.get(row.facultyCode)!
              : null,
        courseNameTh: optStr(row.courseNameTh),
        courseNameEn: optStr(row.courseNameEn),
        // Decimal(4,3): three places is all the column holds.
        ratingAvg: Number(row.averageRating).toFixed(3),
        respondentCount: Number(row.respondents),
        // Null on purpose: the registrar connector's incremental watermark is MAX(lastUpdateAt).
        lastUpdateAt: null,
      };

      const where = {
        evaluation_natural_key: {
          acadYearBE,
          semester,
          classIdRegistrar,
          questionIdRegistrar: OVERALL_QUESTION,
          officerIdRegistrar: 0,
        },
      };
      const existing = await ctx.tx.evaluationResponseSummary.findUnique({
        where,
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        await ctx.tx.evaluationResponseSummary.update({
          where: { id: existing.id },
          data: claimsRow(existing)
            ? { ...figures, ingestionRunId: ctx.ingestionRunId }
            : figures,
        });
        updated += 1;
      } else {
        await ctx.tx.evaluationResponseSummary.create({
          data: {
            acadYearBE,
            semester,
            classIdRegistrar,
            questionIdRegistrar: OVERALL_QUESTION,
            officerIdRegistrar: 0,
            facultyRegistryId: 0,
            campusId: 0,
            courseCode,
            courseCodeRaw: raw,
            section,
            ...figures,
            methodologyVersion: COURSE_EVALUATIONS_IMPORT_VERSION,
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.evaluationResponseSummary.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.evaluationResponseSummary.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
