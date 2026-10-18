import type { PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type {
  ImportColumn,
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 1. Feeds the Deep-Dive's cohort and demographic-outlook sections,
// and the demand funnel's benchmark figures.
//
// Unlike the tier-0 datasets, realDataWhere() applies to this table: a row
// whose ingestionRunId is null, or whose DataSource is mocked, loads
// successfully and is then invisible. See batches.ts for the guards.

/**
 * A required Common Era year column.
 *
 * A Thai registrar's export says 2568, not 2025. A Buddhist-era year is 543
 * years in the future, which is far enough ahead that it clears any check
 * for "a plausible number" — and every figure then sits on a year no
 * surface will ever ask for, so the upload succeeds and the Deep-Dive stays
 * empty. Shared with the other year-keyed datasets in this tier.
 */
export function yearColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'integer',
    required: true,
    guide: `${guide} Use the Common Era year (2025), not the Buddhist era (2568).`,
    example: '2024',
    check: (value) => {
      if (typeof value !== 'number') return null;
      if (value < 1950) {
        return `${value} is too early to be a real academic year — check the cell.`;
      }
      if (value > new Date().getUTCFullYear() + 2) {
        return (
          `${value} is in the future. If this is a Buddhist-era year, subtract ` +
          `543 — BE 2568 is CE 2025.`
        );
      }
      return null;
    },
  };
}

/** Optional count columns, all defaulting to 0 on insert. See D4. */
function countColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'integer',
    required: false,
    guide: `${guide} Leave blank if you do not have it — a blank cell keeps whatever is already stored rather than setting it to zero.`,
    example: '120',
  };
}

export const enrollmentDataset: ImportDataset = {
  slug: 'enrollment-metrics',
  title: 'Enrolment',
  description:
    'Applications through to graduation, one row per programme per academic year. ' +
    'Fills the Deep-Dive student sections.',
  tier: 1,
  sheetName: 'Enrolment',
  columns: [
    {
      header: 'Programme Code',
      key: 'programmeCode',
      type: 'text',
      required: true,
      guide:
        'The programme this row is about, exactly as its Programme Code in the ' +
        'Programmes sheet. A programme that was created before this import existed ' +
        'may not be canonical, in which case its figures load but stay hidden on ' +
        'Council surfaces — re-upload it through the Programmes sheet to fix that.',
      example: 'ENG-CIVIL-BE',
      references: { dataset: 'programmes', column: 'code' },
    },
    yearColumn(
      'Academic Year',
      'academicYear',
      'The academic year this cohort entered.',
    ),
    countColumn('Applications', 'applications', 'People who applied.'),
    countColumn('Admitted', 'admitted', 'People offered a place.'),
    countColumn('Enrolled', 'enrolled', 'People who actually enrolled.'),
    countColumn('Retained to Year 2', 'retainedYear2', 'Still enrolled a year later.'),
    countColumn('Graduated on Time', 'graduatedOnTime', 'Graduated within the nominal duration.'),
    countColumn('Graduated Late', 'graduatedLate', 'Graduated after the nominal duration.'),
    countColumn('Dropouts', 'dropouts', 'Left without graduating.'),
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'unique', columns: ['programmeCode', 'academicYear'] },
  },

  rowRules: [
    {
      message: 'Admitted cannot exceed Applications — check the two columns against each other.',
      check: (r) =>
        typeof r.admitted !== 'number' || typeof r.applications !== 'number'
          ? true
          : r.admitted <= r.applications,
    },
    {
      message: 'Enrolled cannot exceed Admitted — check the two columns against each other.',
      check: (r) =>
        typeof r.enrolled !== 'number' || typeof r.admitted !== 'number'
          ? true
          : r.enrolled <= r.admitted,
    },
  ],

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

    const counts = [
      'applications', 'admitted', 'enrolled', 'retainedYear2',
      'graduatedOnTime', 'graduatedLate', 'dropouts',
    ] as const;

    for (const row of rows) {
      const code = String(row.programmeCode);
      const programId = idByCode.get(code);
      if (!programId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
        );
      }
      const academicYear = Number(row.academicYear);

      const existing = await ctx.tx.enrollmentMetric.findUnique({
        where: { programId_academicYear: { programId, academicYear } },
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        // Only the cells the operator actually filled. A blank keeps what
        // another source wrote rather than zeroing it (D4).
        const data: Record<string, number | Date | string> = { freshnessDate };
        if (claimsRow(existing)) data.ingestionRunId = ctx.ingestionRunId;
        for (const key of counts) {
          if (typeof row[key] === 'number') data[key] = row[key] as number;
        }
        await ctx.tx.enrollmentMetric.update({
          where: { programId_academicYear: { programId, academicYear } },
          data,
        });
        updated += 1;
      } else {
        await ctx.tx.enrollmentMetric.create({
          data: {
            programId,
            academicYear,
            applications: Number(row.applications ?? 0),
            admitted: Number(row.admitted ?? 0),
            enrolled: Number(row.enrolled ?? 0),
            retainedYear2: Number(row.retainedYear2 ?? 0),
            graduatedOnTime: Number(row.graduatedOnTime ?? 0),
            graduatedLate: Number(row.graduatedLate ?? 0),
            dropouts: Number(row.dropouts ?? 0),
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

  count: (prisma: PrismaClient): Promise<number> => prisma.enrollmentMetric.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.enrollmentMetric.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
