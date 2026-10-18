import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type {
  ImportColumn,
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { buddhistYearColumn, toBuddhistEra } from './cohorts';

// Tier 2, and the only TERM-SCOPED dataset.
//
// Every other import upserts: it changes what the file mentions and leaves
// the rest alone. That is wrong here. A class-offering export states what
// EXISTS in a term, not what changed, so a section cancelled since the last
// upload is absent from the new file — and an upsert would leave it in the
// system for ever, because nothing in the file says it is gone.
//
// So the file declares its own term, in the data columns rather than a
// cover sheet, and loading replaces that term wholesale. The validator
// refuses a file whose rows disagree about the term, and refuses one that
// states no term at all, so by the time the loader runs the period it is
// about to delete is exactly the period the file covers.
//
// This is NOT the "replace mode" the design rejected (§4.1). That was a
// toggle an operator chose on every routine upload, where the danger was a
// familiar control doing something destructive on the hundredth use. This
// is a fixed property of one dataset with no control in the UI at all: the
// operator picks a file and uploads it, exactly as everywhere else.
//
// Instructor rosters are deliberately NOT part of this dataset — they key
// on instructor email, personal data the §7 rules do not cover, and the
// GPA figures do not read them.

/** Where synthesised ids start. A registrar's own CLASSID is ten digits. */
const SYNTHETIC_CLASS_ID_FLOOR = 2n ** 62n;

/**
 * A stable class id for a row whose registrar did not provide one.
 *
 * `ClassOffering.classId` is NOT NULL and the table's only unique key, so a
 * row must have one; an adopter reading their timetable out of a
 * spreadsheet has nothing to put there. This derives one from what does
 * identify the class, deterministically, so re-uploading a term produces
 * the same ids rather than a new set each time.
 *
 * The 2^62 floor keeps the two namespaces apart: a real CLASSID is about
 * ten digits, this is nineteen, so a synthesised id can never be mistaken
 * for — or collide with — one an Oracle export supplies.
 */
export function synthesiseClassId(
  academicYearBE: number,
  semester: number,
  courseCode: string,
  section: number,
): bigint {
  const digest = createHash('sha256')
    .update(`${academicYearBE}|${semester}|${courseCode}|${section}`)
    .digest();
  // 7 bytes = 56 bits, comfortably inside the 62 bits below the floor.
  return SYNTHETIC_CLASS_ID_FLOOR + BigInt(`0x${digest.subarray(0, 7).toString('hex')}`);
}

/** An optional grade tally. 0 when the term is still in progress. */
function gradeColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'integer',
    required: false,
    guide: `${guide} Leave blank while the term is still running.`,
    example: '12',
    check: (value) =>
      typeof value === 'number' && value < 0 ? 'A count of students cannot be negative.' : null,
  };
}

/** The eight letters that weight into a GPA, then the four that do not. */
const GRADE_COLUMNS: readonly ImportColumn[] = [
  gradeColumn('Grade A', 'gradeA', 'Students awarded A.'),
  gradeColumn('Grade B+', 'gradeBPlus', 'Students awarded B+.'),
  gradeColumn('Grade B', 'gradeB', 'Students awarded B.'),
  gradeColumn('Grade C+', 'gradeCPlus', 'Students awarded C+.'),
  gradeColumn('Grade C', 'gradeC', 'Students awarded C.'),
  gradeColumn('Grade D+', 'gradeDPlus', 'Students awarded D+.'),
  gradeColumn('Grade D', 'gradeD', 'Students awarded D.'),
  gradeColumn('Grade F', 'gradeF', 'Students awarded F.'),
  gradeColumn('Incomplete', 'gradeI', 'Students carrying an incomplete. Not counted in the class GPA.'),
  gradeColumn('Withdrawn', 'gradeW', 'Students who withdrew. Not counted in the class GPA.'),
  gradeColumn('Audit', 'gradeAU', 'Students auditing. Not counted in the class GPA.'),
  gradeColumn('Satisfactory', 'gradeS', 'Students passing a pass/fail course. Not counted in the class GPA.'),
];

/** The eight graded letters, in GPA weight order from 4.0 down to 0.0. */
const GPA_WEIGHTS: readonly [string, number][] = [
  ['gradeA', 4], ['gradeBPlus', 3.5], ['gradeB', 3], ['gradeCPlus', 2.5],
  ['gradeC', 2], ['gradeDPlus', 1.5], ['gradeD', 1], ['gradeF', 0],
];

export const classOfferingsDataset: ImportDataset = {
  slug: 'class-offerings',
  title: 'Class Offerings',
  description:
    'Every class section taught in one term, with its seats and grade tally. ' +
    'Uploading a term REPLACES it — a section missing from the file is treated ' +
    'as cancelled, which is how a timetable export actually behaves.',
  tier: 2,
  sheetName: 'Class Offerings',
  columns: [
    buddhistYearColumn('Academic Year', 'academicYear', 'The academic year this term belongs to.'),
    {
      header: 'Semester',
      key: 'semester',
      type: 'integer',
      required: true,
      guide:
        'Which semester. Together with the year this says which term the file ' +
        'covers, and uploading replaces everything already stored for it — so ' +
        'one file per term, and every row in it from the same term.',
      example: '1',
      check: (value) =>
        typeof value === 'number' && (value < 1 || value > 4)
          ? 'A semester is 1, 2, or 3 for a summer term.'
          : null,
    },
    {
      header: 'Faculty Code',
      key: 'facultyCode',
      type: 'text',
      required: true,
      guide:
        'The faculty that teaches this class, exactly as in the Faculties sheet. ' +
        'Required because it is what makes the row visible to someone whose ' +
        'view is scoped to a faculty — a class with no faculty is a class most ' +
        'of your users cannot see.',
      example: 'ENG',
      references: { dataset: 'faculties', column: 'code' },
    },
    {
      header: 'Level',
      key: 'levelName',
      type: 'text',
      required: false,
      guide:
        'Degree level of the class, in your own words — bachelor, master and ' +
        'so on. Optional, but a class left blank will not appear when someone ' +
        'filters the course list by level.',
      example: 'Bachelor',
    },
    {
      header: 'Course Code',
      key: 'courseCode',
      type: 'text',
      required: true,
      guide: 'The course being taught, as it appears in your catalogue.',
      example: 'EN101203',
    },
    {
      header: 'Section',
      key: 'section',
      type: 'integer',
      required: true,
      guide: 'Section number. One row per section — two rows for one course, semester and section is refused.',
      example: '1',
    },
    {
      header: 'Class Id',
      key: 'classId',
      type: 'integer',
      required: false,
      guide:
        'Your registrar’s own identifier for this class, if it has one. ' +
        'Leave it blank and one is generated from the year, semester, course ' +
        'and section — stable across re-uploads, so a blank column stays blank ' +
        'for ever without anything drifting.',
      example: '1234567890',
    },
    {
      header: 'Course Name (Thai)',
      key: 'courseNameTh',
      type: 'text',
      required: false,
      guide: 'Course title in Thai. Optional.',
      example: 'กลศาสตร์วิศวกรรม',
    },
    {
      header: 'Course Name (English)',
      key: 'courseNameEn',
      type: 'text',
      required: false,
      guide: 'Course title in English. Optional.',
      example: 'Engineering Mechanics',
    },
    {
      header: 'Credits',
      key: 'creditTotal',
      type: 'integer',
      required: false,
      guide: 'Credit value of the course.',
      example: '3',
    },
    {
      header: 'Lecture Hours/Week',
      key: 'lectureHrsPerWeek',
      type: 'integer',
      required: false,
      guide: 'Scheduled lecture hours per week. Optional.',
      example: '3',
    },
    {
      header: 'Lab Hours/Week',
      key: 'labHrsPerWeek',
      type: 'integer',
      required: false,
      guide: 'Scheduled laboratory hours per week. Optional.',
      example: '2',
    },
    {
      header: 'Enrolled',
      key: 'enrollSeat',
      type: 'integer',
      required: true,
      guide: 'How many students are enrolled in this section.',
      example: '48',
      check: (value) =>
        typeof value === 'number' && value < 0 ? 'A seat count cannot be negative.' : null,
    },
    {
      header: 'Total Seats',
      key: 'totalSeat',
      type: 'integer',
      required: true,
      guide: 'Capacity of the section. Read against Enrolled to show how full it ran.',
      example: '60',
      check: (value) =>
        typeof value === 'number' && value < 0 ? 'A seat count cannot be negative.' : null,
    },
    ...GRADE_COLUMNS,
  ],
  strategy: {
    kind: 'term-scoped',
    termColumns: ['academicYear', 'semester'],
    // Keyed on what identifies a class to a human, not on the stored
    // classId — which is optional in the sheet and synthesised when blank.
    // This is also what lets the validator catch two rows for one section
    // and name both, instead of the insert failing on a unique index with
    // nothing an operator can act on.
    match: { kind: 'unique', columns: ['academicYear', 'semester', 'courseCode', 'section'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const term = ctx.term;
    if (!term) {
      // Unreachable through the upload path — validateSheet establishes the
      // term and refuses a file without one — but this function DELETES, so
      // it refuses to guess rather than delete the wrong period.
      throw new ApiError(
        'VALIDATION_FAILED',
        'This dataset replaces a whole term and no term was established for the file.',
      );
    }

    const acadYearBE = toBuddhistEra(Number(term.academicYear));
    const semester = Number(term.semester);

    const facultyCodes = [...new Set(rows.map((r) => String(r.facultyCode)))];
    const faculties = await ctx.tx.faculty.findMany({
      where: { code: { in: facultyCodes } },
      select: { id: true, code: true, nameTh: true },
    });
    const facultyByCode = new Map(faculties.map((f) => [f.code, f]));
    for (const code of facultyCodes) {
      if (!facultyByCode.has(code)) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Faculty code "${code}" does not exist. Upload the Faculties sheet first.`,
        );
      }
    }

    // Delete the term, then insert the file. In one transaction, so a
    // failure part-way leaves the term exactly as it was.
    const removed = await ctx.tx.classOffering.deleteMany({ where: { acadYearBE, semester } });

    const data = rows.map((row) => {
      const courseCode = String(row.courseCode);
      const section = Number(row.section);
      // Faculty scoping compares registryFacultyName against the faculty
      // names a user may see, so an imported row carries the faculty's own
      // name there rather than a registrar string it does not have.
      const faculty = facultyByCode.get(String(row.facultyCode))!;
      const grades = Object.fromEntries(
        GRADE_COLUMNS.map((c) => [c.key, Number(row[c.key] ?? 0)]),
      ) as Record<string, number>;

      const gradedCount = GPA_WEIGHTS.reduce((sum, [key]) => sum + (grades[key] ?? 0), 0);
      const points = GPA_WEIGHTS.reduce(
        (sum, [key, weight]) => sum + (grades[key] ?? 0) * weight,
        0,
      );

      return {
        acadYearBE,
        semester,
        courseCode,
        // No separate raw form exists in a spreadsheet; the code as written
        // IS the raw code.
        courseCodeRaw: courseCode,
        section,
        classId:
          typeof row.classId === 'number'
            ? BigInt(row.classId)
            : synthesiseClassId(acadYearBE, semester, courseCode, section),
        courseNameTh: row.courseNameTh === null ? null : String(row.courseNameTh),
        courseNameEn: row.courseNameEn === null ? null : String(row.courseNameEn),
        creditTotal: row.creditTotal === null ? null : Number(row.creditTotal),
        lectureHrsPerWeek: row.lectureHrsPerWeek === null ? null : Number(row.lectureHrsPerWeek),
        labHrsPerWeek: row.labHrsPerWeek === null ? null : Number(row.labHrsPerWeek),
        enrollSeat: Number(row.enrollSeat),
        totalSeat: Number(row.totalSeat),
        facultyId: faculty.id,
        registryFacultyName: faculty.nameTh,
        // No registrar id exists for an imported row; the faculty link above
        // is what every reader actually joins through.
        registryFacultyId: '',
        levelName: row.levelName === null ? '' : String(row.levelName),
        ...grades,
        gradedCount,
        // Null rather than 0 when nothing is graded yet: a term in progress
        // has no GPA, and 0.0 would read as everybody failing.
        classGpa: gradedCount === 0 ? null : points / gradedCount,
        ingestionRunId: ctx.ingestionRunId,
      };
    });

    const created = await ctx.tx.classOffering.createMany({ data });

    return { inserted: created.count, updated: 0, deleted: removed.count };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.classOffering.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.classOffering.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
