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

// Tier 2. The Deep-Dive's cohort funnel: how many of each entry cohort are
// still enrolled, and what became of the ones who are not.
//
// Both tables store a BUDDHIST ERA year (`entry_year_be`), parsed by the
// registrar connector from the first two digits of a student code. Every
// import template asks for Common Era — an adopter outside Thailand has no
// Buddhist era at all — so the conversion happens here, in one place, and
// the operator never sees it.

/** The Buddhist-era year a Common Era year falls in. */
export function toBuddhistEra(commonEraYear: number): number {
  return commonEraYear + 543;
}

/**
 * A Common Era year column whose value is stored converted to Buddhist era.
 *
 * Identical to `yearColumn` except for the guide, which says so. A reader
 * comparing their sheet against the admin raw view sees 2024 in one and
 * 2567 in the other, and without this sentence concludes the import is
 * broken.
 */
export function buddhistYearColumn(header: string, key: string, guide: string): ImportColumn {
  const base = yearColumn(header, key, guide);
  return {
    ...base,
    guide:
      `${base.guide} Stored converted to the Buddhist era, so the admin data ` +
      `view shows this year plus 543.`,
  };
}

const PROGRAMME_COLUMN: ImportColumn = {
  header: 'Programme Code',
  key: 'programmeCode',
  type: 'text',
  required: true,
  guide: 'The programme this cohort belongs to, exactly as its Programme Code in the Programmes sheet.',
  example: 'ENG-CIVIL-BE',
  references: { dataset: 'programmes', column: 'code' },
};

/**
 * The eight buckets `programsDeepDive` switches on
 * (packages/db/src/program-deep-dive.ts). Anything it does not recognise
 * falls into its `other` total, so a value outside this list is a cohort
 * quietly leaving the chart rather than an error anyone sees.
 */
const STATUS_BUCKETS = [
  'GRADUATED',
  'RENOUNCED',
  'NO_REPORT',
  'DROPPED_FINANCIAL',
  'DROPPED_ACADEMIC',
  'DROPPED_VOLUNTARY',
  'TRANSFERRED',
  'OTHER',
] as const;

/** Resolves programme codes to ids, failing on the first unknown one. */
async function programmeIds(
  ctx: ImportLoadContext,
  rows: readonly ImportRow[],
): Promise<Map<string, string>> {
  const codes = [...new Set(rows.map((r) => String(r.programmeCode)))];
  const found = await ctx.tx.program.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const byCode = new Map(found.map((p) => [p.code, p.id]));
  for (const code of codes) {
    if (!byCode.has(code)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
      );
    }
  }
  return byCode;
}

export const studentCohortsDataset: ImportDataset = {
  slug: 'student-cohorts',
  title: 'Student Cohorts',
  description:
    'How many students from each entry cohort are still enrolled. One row per ' +
    'programme per entry year.',
  tier: 2,
  sheetName: 'Student Cohorts',
  columns: [
    PROGRAMME_COLUMN,
    buddhistYearColumn('Entry Year', 'entryYear', 'The year this cohort started.'),
    {
      header: 'Students Still Enrolled',
      key: 'studentCount',
      type: 'integer',
      required: true,
      guide:
        'How many of this cohort are still studying today — not how many started. ' +
        'The Deep-Dive reads it against the alumni figures to show where a cohort went.',
      example: '120',
    },
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'unique', columns: ['programmeCode', 'entryYear'] },
  },
  prefill: programmeYearPrefill({ yearKey: 'entryYear' }),

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const byCode = await programmeIds(ctx, rows);
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const programId = byCode.get(String(row.programmeCode)) as string;
      const entryYearBE = toBuddhistEra(Number(row.entryYear));
      const where = { programId_entryYearBE: { programId, entryYearBE } };
      const studentCount = Number(row.studentCount);

      const existing = await ctx.tx.studentCohortDistribution.findUnique({
        where,
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        await ctx.tx.studentCohortDistribution.update({
          where,
          data: claimsRow(existing)
            ? { studentCount, ingestionRunId: ctx.ingestionRunId }
            : { studentCount },
        });
        updated += 1;
      } else {
        await ctx.tx.studentCohortDistribution.create({
          data: { programId, entryYearBE, studentCount, ingestionRunId: ctx.ingestionRunId },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.studentCohortDistribution.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.studentCohortDistribution.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};

export const alumniCohortsDataset: ImportDataset = {
  slug: 'alumni-cohorts',
  title: 'Alumni Cohorts',
  description:
    'What became of each entry cohort — graduated, transferred, left. One row ' +
    'per programme per entry year per outcome.',
  tier: 2,
  sheetName: 'Alumni Cohorts',
  columns: [
    PROGRAMME_COLUMN,
    buddhistYearColumn('Entry Year', 'entryYear', 'The year this cohort started.'),
    {
      header: 'Status',
      key: 'statusBucket',
      type: 'enum',
      required: true,
      enumValues: STATUS_BUCKETS,
      guide:
        'What became of this part of the cohort. Use OTHER for an outcome none ' +
        'of the rest describes — it is counted, just not broken out.',
      example: 'GRADUATED',
    },
    {
      header: 'Count',
      key: 'count',
      type: 'integer',
      required: true,
      guide: 'How many of the cohort ended up with this status.',
      example: '95',
    },
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'unique', columns: ['programmeCode', 'entryYear', 'statusBucket'] },
  },
  // The status cannot be guessed — a cohort has several, and pre-filling one
  // would look like an answer. Same reasoning as the outcomes survey year.
  prefill: programmeYearPrefill({ yearKey: 'entryYear', extraKeys: ['statusBucket'] }),

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const byCode = await programmeIds(ctx, rows);
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const programId = byCode.get(String(row.programmeCode)) as string;
      const entryYearBE = toBuddhistEra(Number(row.entryYear));
      const statusBucket = String(row.statusBucket);
      const where = {
        programId_entryYearBE_statusBucket: { programId, entryYearBE, statusBucket },
      };
      const count = Number(row.count);

      const existing = await ctx.tx.alumniCohortStatus.findUnique({
        where,
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        await ctx.tx.alumniCohortStatus.update({
          where,
          data: claimsRow(existing) ? { count, ingestionRunId: ctx.ingestionRunId } : { count },
        });
        updated += 1;
      } else {
        await ctx.tx.alumniCohortStatus.create({
          data: {
            programId, entryYearBE, statusBucket, count,
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.alumniCohortStatus.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.alumniCohortStatus.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
