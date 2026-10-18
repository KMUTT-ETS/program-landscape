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
import { programmeYearPrefill } from './prefill';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 1. Revenue only.
//
// Cost figures are produced by the cost-allocation methodology
// (docs/methodologies/cost-allocation.md) from staff and budget data, and
// are deliberately not importable: a programme's cost is an allocation
// decision the institution has to be able to defend, not a number typed
// into a spreadsheet. Every cost column on this table therefore survives
// an upload untouched (D2).

/** A money column. Negative is always an error, never a credit. */
function bahtColumn(
  header: string,
  key: string,
  required: boolean,
  guide: string,
): ImportColumn {
  return {
    header,
    key,
    type: 'decimal',
    required,
    guide: `${guide} In baht. Commas are fine; do not include a currency symbol.`,
    example: '12500000',
    check: (value) =>
      typeof value === 'number' && value < 0
        ? 'Revenue cannot be negative. If this is a refund or an adjustment, net it off the figure for the year it belongs to.'
        : null,
  };
}

export const financialsDataset: ImportDataset = {
  slug: 'financial-metrics',
  title: 'Finance',
  description:
    'Tuition and other revenue, one row per programme per academic year. ' +
    'Cost figures are not imported — they are produced by the cost-allocation ' +
    'methodology and are left untouched by an upload.',
  tier: 1,
  sheetName: 'Finance',
  columns: [
    {
      header: 'Programme Code',
      key: 'programmeCode',
      type: 'text',
      required: true,
      guide: 'The programme this row is about, exactly as its Programme Code in the Programmes sheet.',
      example: 'ENG-CIVIL-BE',
      references: { dataset: 'programmes', column: 'code' },
    },
    yearColumn(
      'Academic Year',
      'academicYear',
      'The academic year the money was earned in — NOT the budget year. ' +
        'An academic year straddles two fiscal years, so a figure taken ' +
        'straight from a fiscal-year budget report belongs to a different ' +
        'period than this column asks for.',
    ),
    bahtColumn('Tuition Revenue (THB)', 'tuitionRevenue', true, 'Tuition and fees collected for this programme.'),
    bahtColumn(
      'Other Revenue (THB)',
      'otherRevenue',
      false,
      'Any other revenue attributable to the programme — short courses, ' +
        'service income. Leave blank if you do not separate it; a blank ' +
        'keeps whatever is already stored.',
    ),
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'unique', columns: ['programmeCode', 'academicYear'] },
  },
  prefill: programmeYearPrefill({ yearKey: 'academicYear' }),

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const codes = [...new Set(rows.map((r) => String(r.programmeCode)))];
    const programmes = await ctx.tx.program.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const idByCode = new Map(programmes.map((p) => [p.code, p.id]));

    const freshnessDate = new Date();
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const code = String(row.programmeCode);
      const programId = idByCode.get(code);
      if (!programId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
        );
      }
      // The Prisma field is `fiscalYear` and holds an ACADEMIC year — the
      // column is misnamed upstream of this import. See the schema comment.
      const fiscalYear = Number(row.academicYear);
      const where = { programId_fiscalYear: { programId, fiscalYear } };

      const existing = await ctx.tx.financialMetric.findUnique({
        where,
        select: {
          tuitionRevenue: true,
          otherRevenue: true,
          directCost: true,
          allocatedFacultyCost: true,
          allocatedFacilityCost: true,
          allocatedOverhead: true,
          ...PROVENANCE_SELECT,
        },
      });

      if (existing) {
        const tuitionRevenue =
          typeof row.tuitionRevenue === 'number' ? row.tuitionRevenue : Number(existing.tuitionRevenue);
        const otherRevenue =
          typeof row.otherRevenue === 'number' ? row.otherRevenue : Number(existing.otherRevenue);

        const data: Record<string, number | Date | string> = {
          tuitionRevenue,
          freshnessDate,
        };
        if (typeof row.otherRevenue === 'number') data.otherRevenue = row.otherRevenue;
        if (claimsRow(existing)) data.ingestionRunId = ctx.ingestionRunId;

        // Net contribution belongs to the cost-allocation methodology once
        // there is an allocation to speak of. Until then it is just the
        // revenue, and leaving it at whatever the first upload said would
        // freeze every adopter's figure forever — the common case, since
        // an installation with no cost methodology has nothing but zeros.
        const allocated =
          Number(existing.directCost) +
          Number(existing.allocatedFacultyCost) +
          Number(existing.allocatedFacilityCost) +
          Number(existing.allocatedOverhead);
        if (allocated === 0) data.netContribution = tuitionRevenue + otherRevenue;

        await ctx.tx.financialMetric.update({ where, data });
        updated += 1;
      } else {
        const tuitionRevenue = Number(row.tuitionRevenue ?? 0);
        const otherRevenue = Number(row.otherRevenue ?? 0);
        await ctx.tx.financialMetric.create({
          data: {
            programId,
            fiscalYear,
            tuitionRevenue,
            otherRevenue,
            directCost: 0,
            allocatedFacultyCost: 0,
            allocatedFacilityCost: 0,
            allocatedOverhead: 0,
            netContribution: tuitionRevenue + otherRevenue,
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

  count: (prisma: PrismaClient): Promise<number> => prisma.financialMetric.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.financialMetric.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
