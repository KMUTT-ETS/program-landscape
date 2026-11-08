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
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2. Monthly salary by faculty, rank and funding source: the figures
// behind the Deep-Dive's "Teaching-staff salary cost" card.
//
// Distinct from `faculty-compensation`: that one is ANNUAL and has no funding
// source; this feeds `staff_compensation_cube`, whose salaries are MONTHLY
// and keyed by who pays them. Rows are per group, never per person — the
// Headcount column carries the same five-person floor.

const RANKS = ['LECTURER', 'ASST_PROF', 'ASSOC_PROF', 'PROF'] as const;
type Rank = (typeof RANKS)[number];

/**
 * The prefix the Deep-Dive reader (`levelMatchesRank`) matches a rank by.
 * The cube stores Thai abbreviations, so the loader must write exactly one
 * the reader recognises, or the row loads and the card stays empty.
 */
export const RANK_LEVEL_LABEL: Record<Rank, string> = {
  PROF: 'ศ.',
  ASSOC_PROF: 'รศ.',
  ASST_PROF: 'ผศ.',
  LECTURER: 'อ.',
};

function normaliseFunding(value: unknown): string {
  return String(value).trim().replace(/\s+/g, ' ');
}

const MAX_MONTHLY_THB = 500_000;

function monthlyColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'decimal',
    required: true,
    guide: `${guide} Monthly, in baht, not annual.`,
    example: '50000',
    check: (value) => {
      if (typeof value !== 'number') return null;
      if (value < 0) return 'A salary cannot be negative.';
      if (value > MAX_MONTHLY_THB) {
        return 'This looks like an annual figure — this column is monthly, not annual. Divide by 12.';
      }
      return null;
    },
  };
}

type Figures = Record<string, unknown>;
const ordered = (r: Figures): boolean =>
  typeof r.minSalary !== 'number' || typeof r.meanSalary !== 'number' || typeof r.maxSalary !== 'number'
    ? true
    : r.minSalary <= r.meanSalary;

export const staffSalaryByFundingDataset: ImportDataset = {
  slug: 'staff-salary-by-funding',
  title: 'Staff Salary by Funding',
  description:
    'Monthly salary of academic staff by faculty, rank and funding source. Every row ' +
    'describes a group of at least five people — never an individual.',
  tier: 2,
  sheetName: 'Staff Salary by Funding',
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
      header: 'Rank',
      key: 'rank',
      type: 'enum',
      required: true,
      enumValues: RANKS,
      guide:
        'Academic rank these figures cover: LECTURER (lecturer), ASST_PROF (assistant professor), ' +
        'ASSOC_PROF (associate professor) or PROF (professor). Same values as the Compensation sheet.',
      example: 'ASST_PROF',
    },
    {
      header: 'Funding Source',
      key: 'fundingSource',
      type: 'text',
      required: true,
      guide:
        'Who pays the salary, in your own words — for example "Government budget" or ' +
        '"University revenue". It is shown as written; use one spelling per source ' +
        '(extra spaces are ignored when comparing rows).',
      example: 'Government budget',
      identity: (value) => normaliseFunding(value),
    },
    buddhistYearColumn('Fiscal Year', 'fiscalYear', 'The budget year these figures are for.'),
    {
      header: 'Headcount',
      key: 'headcount',
      type: 'integer',
      required: true,
      guide:
        'How many people this row covers. A row covering fewer than five is refused: ' +
        'at that size an average is close enough to an individual salary to identify someone.',
      example: '12',
      groupSizeFor: { minimum: 5 },
    },
    monthlyColumn('Mean Monthly Salary (THB)', 'meanSalary', 'Average salary in the group.'),
    monthlyColumn('Min Monthly Salary (THB)', 'minSalary', 'Lowest salary in the group.'),
    monthlyColumn('Max Monthly Salary (THB)', 'maxSalary', 'Highest salary in the group.'),
  ],
  rowRules: [
    {
      message: 'Min cannot exceed Mean — check the two columns against each other.',
      check: ordered,
    },
    {
      message: 'Mean cannot exceed Max — check the two columns against each other.',
      check: (r) =>
        typeof r.maxSalary !== 'number' || typeof r.meanSalary !== 'number' ? true : r.meanSalary <= r.maxSalary,
    },
  ],
  strategy: {
    // MANUAL: facultyName and level are stored derived values, not the sheet's
    // columns, so there is no sheet-shaped unique key to hand Prisma.
    kind: 'upsert',
    match: { kind: 'manual', columns: ['fiscalYear', 'facultyCode', 'rank', 'fundingSource'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const codes = [...new Set(rows.map((r) => String(r.facultyCode)))];
    const faculties = await ctx.tx.faculty.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, nameTh: true },
    });
    const byCode = new Map(faculties.map((f) => [f.code, f]));

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const faculty = byCode.get(String(row.facultyCode));
      if (!faculty) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Faculty code "${String(row.facultyCode)}" does not exist. Upload the Faculties sheet first.`,
        );
      }
      const level = RANK_LEVEL_LABEL[String(row.rank) as Rank];
      const salType = normaliseFunding(row.fundingSource);
      const fiscalYear = toBuddhistEra(Number(row.fiscalYear));
      const headcount = Number(row.headcount);
      const meanSalary = Number(row.meanSalary);
      const figures = {
        headcount,
        meanSalary,
        minSalary: Number(row.minSalary),
        maxSalary: Number(row.maxSalary),
        sumSalary: meanSalary * headcount,
      };

      const existing = await ctx.tx.staffCompensationCube.findFirst({
        where: { fiscalYear, facultyName: faculty.nameTh, isAcademic: true, level, salType },
        select: { id: true, ...PROVENANCE_SELECT },
      });
      if (existing) {
        await ctx.tx.staffCompensationCube.update({
          where: { id: existing.id },
          data: claimsRow(existing) ? { ...figures, ingestionRunId: ctx.ingestionRunId } : figures,
        });
        updated += 1;
      } else {
        await ctx.tx.staffCompensationCube.create({
          data: {
            fiscalYear,
            facultyName: faculty.nameTh,
            facultyId: faculty.id,
            isAcademic: true,
            level,
            salType,
            ...figures,
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }
    return { inserted, updated, deleted: 0 };
  },

  // Own rows only: the table is shared with the kku-hr-processed connector.
  count: (prisma: PrismaClient): Promise<number> =>
    prisma.staffCompensationCube.count({
      where: { ingestionRun: { dataSource: { slug: 'xlsx-staff-salary-by-funding' } } },
    }),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.staffCompensationCube.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
