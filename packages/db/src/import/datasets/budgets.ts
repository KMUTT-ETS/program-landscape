import type { PrismaClient } from '@prisma/client';

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

// Tier 2. Budget by division and fund.
//
// The unit here is a DIVISION, not a faculty, and that is deliberate: a
// university's budget covers a president's office, a hospital, a research
// institute — none of which is a faculty, all of which spend money. The
// faculty link is optional and is only what makes a figure roll up into a
// faculty view; a division without one still has its budget recorded.
//
// `FacultyBudget` has no unique constraint at all, so matching is manual.

/** An optional money column. 0 on insert, untouched on update when blank. */
function optionalBahtColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'decimal',
    required: false,
    guide: `${guide} In baht. Leave blank if you do not track it — a blank keeps whatever is already stored.`,
    example: '4200000',
    check: (value) =>
      typeof value === 'number' && value < 0
        ? 'This figure cannot be negative.'
        : null,
  };
}

export const budgetsDataset: ImportDataset = {
  slug: 'faculty-budgets',
  title: 'Budgets',
  description:
    'Budget by division and fund category. A division may be a faculty, an ' +
    'institute or a central office — only faculties roll up into faculty views.',
  tier: 2,
  sheetName: 'Budgets',
  columns: [
    {
      header: 'Division Name',
      key: 'divisionName',
      type: 'text',
      required: true,
      guide:
        'The budget-holding unit, written exactly as your finance system names ' +
        'it. This is what identifies the row, so keep it identical between ' +
        'uploads or you will get a second row rather than an update.',
      example: 'Faculty of Engineering',
    },
    {
      header: 'Faculty Code',
      key: 'facultyCode',
      type: 'text',
      required: false,
      guide:
        'Optional. Fill it in when the division IS one of your faculties, and ' +
        'the budget rolls up into that faculty’s views. Leave blank for a ' +
        'central office, a hospital or an institute — the figure is still ' +
        'recorded, it just does not belong to a faculty.',
      example: 'ENG',
      references: { dataset: 'faculties', column: 'code' },
    },
    {
      header: 'Fund Category',
      key: 'fundCategory',
      type: 'text',
      required: true,
      guide:
        'Which pot the money comes from — your own category names. One row per ' +
        'division per fund per year.',
      example: 'University revenue',
    },
    yearColumn('Fiscal Year', 'fiscalYear', 'The budget year.'),
    {
      header: 'Total Budget (THB)',
      key: 'totalBudget',
      type: 'decimal',
      required: true,
      guide: 'The amount allocated for the year, in baht.',
      example: '12000000',
      check: (value) =>
        typeof value === 'number' && value < 0 ? 'A budget cannot be negative.' : null,
    },
    optionalBahtColumn('Total Commitment (THB)', 'totalCommitment', 'Committed but not yet obligated.'),
    optionalBahtColumn('Total Obligation (THB)', 'totalObligation', 'Obligated but not yet spent.'),
    optionalBahtColumn('Total Expenditure (THB)', 'totalExpenditure', 'Actually spent.'),
    optionalBahtColumn('Funds Available (THB)', 'fundsAvailable', 'Still unspent and uncommitted.'),
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'manual', columns: ['divisionName', 'fundCategory', 'fiscalYear'] },
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

    const freshnessDate = new Date();
    const optional = [
      'totalCommitment', 'totalObligation', 'totalExpenditure', 'fundsAvailable',
    ] as const;
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      let facultyId: string | null = null;
      if (typeof row.facultyCode === 'string') {
        const found = facultyByCode.get(row.facultyCode);
        if (!found) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `Faculty code "${row.facultyCode}" does not exist. Upload the Faculties sheet first.`,
          );
        }
        facultyId = found;
      }

      const divisionName = String(row.divisionName);
      const fundCategory = String(row.fundCategory);
      const fiscalYear = Number(row.fiscalYear);

      const existing = await ctx.tx.facultyBudget.findFirst({
        where: { divisionName, fundCategory, fiscalYear },
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        // Only the cells the operator filled, so a partial return does not
        // zero figures another source supplied.
        const data: Record<string, number | string | Date | null> = {
          totalBudget: Number(row.totalBudget),
          freshnessDate,
        };
        // Blank means "I did not say", here too. Writing null unconditionally
        // would orphan a division from the faculty it rolls up into on any
        // re-upload that omits the code.
        if (facultyId !== null) data.facultyId = facultyId;
        for (const key of optional) {
          if (typeof row[key] === 'number') data[key] = row[key] as number;
        }
        if (claimsRow(existing)) data.ingestionRunId = ctx.ingestionRunId;

        await ctx.tx.facultyBudget.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await ctx.tx.facultyBudget.create({
          data: {
            facultyId,
            divisionName,
            fundCategory,
            fiscalYear,
            totalBudget: Number(row.totalBudget),
            totalCommitment: Number(row.totalCommitment ?? 0),
            totalObligation: Number(row.totalObligation ?? 0),
            totalExpenditure: Number(row.totalExpenditure ?? 0),
            fundsAvailable: Number(row.fundsAvailable ?? 0),
            freshnessDate,
            methodologyVersion: 'xlsx-import.v1',
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.facultyBudget.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.facultyBudget.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
