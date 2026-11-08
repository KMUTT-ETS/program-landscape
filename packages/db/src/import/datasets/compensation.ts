import type { FacultyRank, PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type {
  ImportColumn,
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { yearColumn } from './enrollment';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2. Aggregate salary by faculty, department and rank.
//
// This is the dataset §7 of the design is written about. The `kku-hr`
// connector protects these figures in SQL — `HAVING COUNT(*) >= 5`, applied
// before anything is fetched — and a spreadsheet has no such thing. An
// adopter can quite reasonably type a row covering two people. So the
// group-size floor is re-imposed here, as a declared property of the
// Headcount column, and the refusal never quotes the salaries that tripped
// it.
//
// Rows are per-RANK, never per-person. There is no name column and no
// employee code: a compensation row describes a group or it does not exist.

const RANKS = ['LECTURER', 'ASST_PROF', 'ASSOC_PROF', 'PROF'] as const;

/** A salary column. Negative is always an error, never a deduction. */
function salaryColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'decimal',
    required: true,
    guide: `${guide} Annual, in baht, across everyone the row covers.`,
    example: '600000',
    check: (value) =>
      typeof value === 'number' && value < 0
        ? 'A salary cannot be negative.'
        : null,
  };
}

export const compensationDataset: ImportDataset = {
  slug: 'faculty-compensation',
  title: 'Compensation',
  description:
    'Aggregate salary by faculty, department and rank. Every row describes a ' +
    'group of at least five people — never an individual.',
  tier: 2,
  sheetName: 'Compensation',
  columns: [
    {
      header: 'Faculty Code',
      key: 'facultyCode',
      type: 'text',
      required: true,
      guide: 'The faculty these figures cover, exactly as in the Faculties sheet.',
      example: 'ENG',
      references: { dataset: 'faculties', column: 'code' },
    },
    {
      header: 'Department Code',
      key: 'departmentCode',
      type: 'text',
      required: false,
      guide:
        'Leave blank for a faculty-wide figure. A blank row and a department ' +
        'row for the same rank and year are two different figures, both kept. ' +
        'A sheet without this column folds every row onto the faculty-wide figure.',
      example: 'ENG-CIVIL',
      references: { dataset: 'departments', column: 'code' },
    },
    {
      header: 'Rank',
      key: 'rank',
      type: 'enum',
      required: true,
      enumValues: RANKS,
      guide: 'Academic rank these figures cover. One row per rank.',
      example: 'ASSOC_PROF',
    },
    yearColumn('Fiscal Year', 'fiscalYear', 'The budget year these figures are for.'),
    {
      header: 'Headcount',
      key: 'headcount',
      type: 'integer',
      required: true,
      guide:
        'How many people this row covers. A row covering fewer than five is ' +
        'refused: at that size an average is close enough to an individual ' +
        "salary to identify someone, and a spreadsheet has none of the " +
        'protections a database query does.',
      example: '12',
      groupSizeFor: { minimum: 5 },
    },
    salaryColumn('Total Salary (THB)', 'sumSalary', 'Sum of all salaries in the group.'),
    salaryColumn('Mean Salary (THB)', 'meanSalary', 'Average salary in the group.'),
    salaryColumn('Min Salary (THB)', 'minSalary', 'Lowest salary in the group.'),
    salaryColumn('Max Salary (THB)', 'maxSalary', 'Highest salary in the group.'),
  ],
  strategy: {
    // MANUAL, not unique. The table's compound unique includes a nullable
    // departmentId, and Postgres treats NULL as distinct in a unique index —
    // so a faculty-wide row is not constrained by it, and Prisma's compound
    // `where` rejects a null component outright. findFirst is the only way
    // such a row is ever found again. Same pattern as the kku-hr connector.
    kind: 'upsert',
    match: { kind: 'manual', columns: ['facultyCode', 'departmentCode', 'rank', 'fiscalYear'] },
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

    const freshnessDate = new Date();
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

      const rank = String(row.rank) as FacultyRank;
      const fiscalYear = Number(row.fiscalYear);
      const figures = {
        headcount: Number(row.headcount),
        sumSalary: Number(row.sumSalary),
        meanSalary: Number(row.meanSalary),
        minSalary: Number(row.minSalary),
        maxSalary: Number(row.maxSalary),
        freshnessDate,
      };

      const existing = await ctx.tx.facultyCompensation.findFirst({
        where: { facultyId, departmentId, rank, fiscalYear },
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        await ctx.tx.facultyCompensation.update({
          where: { id: existing.id },
          data: claimsRow(existing)
            ? { ...figures, ingestionRunId: ctx.ingestionRunId }
            : figures,
        });
        updated += 1;
      } else {
        await ctx.tx.facultyCompensation.create({
          data: {
            facultyId, departmentId, rank, fiscalYear, ...figures,
            methodologyVersion: 'xlsx-import.v1',
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.facultyCompensation.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.facultyCompensation.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
