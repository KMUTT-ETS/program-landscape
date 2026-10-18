import type { FacultyRank, PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type {
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2. The teaching-staff roster: the Deep-Dive's faculty composition,
// the succession-risk view, and the denominator of every per-staff figure
// in the atlas.
//
// This is the only import dataset whose rows are about PEOPLE, so §7 of the
// design governs it:
//
//  - No date of birth. It drives nothing the retirement date cannot, and a
//    birth date in a workbook is emailed between offices before anyone
//    uploads it (owner decision, 2026-10-18).
//  - No national ID, in any column, hashed or raw. Where the schema holds a
//    hashed identifier the template simply does not offer one; an adopter
//    matching identities across their own systems uses their own employee
//    code, which is not sensitive on its own (§7.4).
//  - Unknown columns are refused by the framework, which is what stops a
//    pasted ID column from arriving beside the real data (§7.1).

const RANKS = ['LECTURER', 'ASST_PROF', 'ASSOC_PROF', 'PROF'] as const;

export const staffDataset: ImportDataset = {
  slug: 'faculty-members',
  title: 'Staff',
  description:
    'Teaching staff, one row per person. Drives faculty composition, ' +
    'succession risk, and every per-staff figure on the dashboards.',
  tier: 2,
  sheetName: 'Staff',
  columns: [
    {
      header: 'Employee Code',
      key: 'employeeCode',
      type: 'text',
      required: true,
      guide:
        'Your own identifier for this person — a staff number or payroll code. ' +
        'It is how a re-upload finds the same person, so it must not change ' +
        'between uploads. Do not use a national ID number here.',
      example: 'EMP-10427',
    },
    {
      header: 'Name (Thai)',
      key: 'nameTh',
      type: 'text',
      required: true,
      guide: 'Full name as it should appear on Thai-language surfaces.',
      example: 'สมชาย ใจดี',
    },
    {
      header: 'Name (English)',
      key: 'nameEn',
      type: 'text',
      required: true,
      guide: 'Full name as it should appear on English-language surfaces.',
      example: 'Somchai Jaidee',
    },
    {
      header: 'Faculty Code',
      key: 'facultyCode',
      type: 'text',
      required: true,
      guide: 'The faculty this person belongs to, exactly as in the Faculties sheet.',
      example: 'ENG',
      references: { dataset: 'faculties', column: 'code' },
    },
    {
      header: 'Department Code',
      key: 'departmentCode',
      type: 'text',
      required: false,
      guide:
        'Optional. Leave blank if your institution has no departments, or if ' +
        'this person sits at faculty level.',
      example: 'ENG-CIVIL',
      references: { dataset: 'departments', column: 'code' },
    },
    {
      header: 'Rank',
      key: 'rank',
      type: 'enum',
      required: true,
      enumValues: RANKS,
      guide:
        'Academic rank. Map your own titles onto the closest of these four — ' +
        'they are what the capability figures count.',
      example: 'ASSOC_PROF',
    },
    {
      header: 'Academic Qualification',
      key: 'academicQualification',
      type: 'text',
      required: false,
      guide: 'Highest qualification held, e.g. "PhD Civil Engineering". Optional.',
      example: 'PhD Civil Engineering',
    },
    {
      header: 'Specialization',
      key: 'specialization',
      type: 'text',
      required: false,
      guide: 'Research or teaching speciality, in a few words. Optional.',
      example: 'Structural engineering',
    },
    {
      header: 'Hire Date',
      key: 'hireDate',
      type: 'date',
      required: false,
      guide: 'When they joined. Write it as YYYY-MM-DD, or use a real date cell.',
      example: '2015-06-01',
    },
    {
      header: 'Retirement Date',
      key: 'retirementDate',
      type: 'date',
      required: false,
      guide:
        'When they are due to retire. This is what the succession-risk view ' +
        'reads to find a department losing several people at once, so it is ' +
        'worth filling even though it is optional. There is deliberately no ' +
        'date-of-birth column — this answers the same question and reveals ' +
        'far less.',
      example: '2031-09-30',
    },
    {
      header: 'Active',
      key: 'isActive',
      type: 'boolean',
      required: false,
      guide:
        'Whether they are currently employed. Blank means yes. Set it to no ' +
        'rather than deleting the row, so their past teaching still counts.',
      example: 'yes',
    },
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'unique', columns: ['employeeCode'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const facultyCodes = [...new Set(rows.map((r) => String(r.facultyCode)))];
    const departmentCodes = [
      ...new Set(rows.map((r) => r.departmentCode).filter((c): c is string => typeof c === 'string')),
    ];

    const [faculties, departments] = await Promise.all([
      ctx.tx.faculty.findMany({ where: { code: { in: facultyCodes } }, select: { id: true, code: true } }),
      ctx.tx.department.findMany({
        where: { code: { in: departmentCodes } },
        select: { id: true, code: true },
      }),
    ]);
    const facultyByCode = new Map(faculties.map((f) => [f.code, f.id]));
    const departmentByCode = new Map(departments.map((d) => [d.code, d.id]));

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const facultyCode = String(row.facultyCode);
      const facultyId = facultyByCode.get(facultyCode);
      if (!facultyId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Faculty code "${facultyCode}" does not exist. Upload the Faculties sheet first.`,
        );
      }

      let departmentId: string | null = null;
      if (typeof row.departmentCode === 'string') {
        const found = departmentByCode.get(row.departmentCode);
        if (!found) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `Department code "${row.departmentCode}" does not exist. Upload the Departments sheet first.`,
          );
        }
        departmentId = found;
      }

      const employeeCode = String(row.employeeCode);
      const data = {
        facultyId,
        departmentId,
        nameTh: String(row.nameTh),
        nameEn: String(row.nameEn),
        rank: String(row.rank) as FacultyRank,
        academicQualification: row.academicQualification === null ? null : String(row.academicQualification),
        specialization: row.specialization === null ? null : String(row.specialization),
        hireDate: row.hireDate instanceof Date ? row.hireDate : null,
        retirementDate: row.retirementDate instanceof Date ? row.retirementDate : null,
        // Blank means employed. Saying "no" is how someone leaves without
        // their teaching history leaving with them.
        isActive: typeof row.isActive === 'boolean' ? row.isActive : true,
      };

      const existing = await ctx.tx.facultyMember.findUnique({
        where: { employeeCode },
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        await ctx.tx.facultyMember.update({
          where: { employeeCode },
          data: claimsRow(existing) ? { ...data, ingestionRunId: ctx.ingestionRunId } : data,
        });
        updated += 1;
      } else {
        await ctx.tx.facultyMember.create({
          data: { employeeCode, ...data, ingestionRunId: ctx.ingestionRunId },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.facultyMember.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.facultyMember.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
