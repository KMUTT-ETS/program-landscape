import type { PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type {
  ImportColumn,
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { optNum } from './optional';
import { buddhistYearColumn, toBuddhistEra } from './cohorts';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2. The admissions funnel: applicants, passes, confirmations and
// arrivals, per recruitment campaign.
//
// The table was shaped around a Thai registrar's Oracle export and carries
// a lot that only that export has: a per-row surrogate (W_PROGRAM_ID), a
// recruitment-programme code, a 14-digit MHESI curriculum code, and KKU's
// internal faculty numbering. None of it is offered here — an adopter asked
// for those would be inventing a primary key — so the sheet asks for what
// anyone running an admissions round actually has, and the migration that
// accompanies this dataset lets the registrar-only columns be null.
//
// Matching is manual: the natural key includes a nullable programme link
// and a campaign name held as TEXT, which is both awkward and wrong to put
// in a composite unique index.

/** An optional funnel count. Blank keeps whatever is already stored. */
function funnelColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'integer',
    required: false,
    guide: `${guide} Leave blank if you do not track this stage.`,
    example: '480',
    check: (value) =>
      typeof value === 'number' && value < 0 ? 'A count cannot be negative.' : null,
  };
}

export const campaignsDataset: ImportDataset = {
  slug: 'admission-campaigns',
  title: 'Admission Campaigns',
  description:
    'The admissions funnel per recruitment campaign — applicants through to ' +
    'students who actually arrived. One row per programme per year per round.',
  tier: 2,
  sheetName: 'Admission Campaigns',
  columns: [
    {
      header: 'Programme Code',
      key: 'programmeCode',
      type: 'text',
      required: true,
      guide: 'The programme being recruited into, exactly as in the Programmes sheet.',
      example: 'ENG-CIVIL-BE',
      references: { dataset: 'programmes', column: 'code' },
    },
    buddhistYearColumn('Academic Year', 'academicYear', 'The year students would start.'),
    {
      header: 'Round',
      key: 'round',
      type: 'text',
      required: true,
      guide:
        'Which admissions round this is — your own naming. Part of what ' +
        'identifies the row, so keep it identical between uploads.',
      example: 'Round 1 — Portfolio',
    },
    {
      header: 'Campaign Name',
      key: 'campaignName',
      type: 'text',
      required: true,
      guide:
        'The campaign or track, as you advertise it. One programme may run ' +
        'several in a round — a regular track and a special-project track — ' +
        'and each is its own row.',
      example: 'Civil Engineering, regular programme',
    },
    funnelColumn('Planned Seats', 'planPerYear', "Seats offered by this row's round or campaign. Do not repeat the annual plan on every round row: the seats of a programme-year are the sum of its rows."),
    funnelColumn('Total Applicants', 'totalApplicants', 'People who applied.'),
    funnelColumn('Total Passed', 'totalPassed', 'People who passed selection.'),
    funnelColumn('Confirmed', 'confirmClearinghouse', 'People who confirmed their place.'),
    funnelColumn('Reported', 'regReported', 'People who actually registered.'),
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'manual', columns: ['programmeCode', 'academicYear', 'round', 'campaignName'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const codes = [...new Set(rows.map((r) => String(r.programmeCode)))];
    const programmes = await ctx.tx.program.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, faculty: { select: { id: true, nameTh: true } } },
    });
    const byCode = new Map(programmes.map((p) => [p.code, p]));

    const freshnessDate = new Date();
    const optional = [
      'planPerYear', 'totalApplicants', 'totalPassed', 'confirmClearinghouse', 'regReported',
    ] as const;
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const code = String(row.programmeCode);
      const programme = byCode.get(code);
      if (!programme) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
        );
      }

      const acadYearBE = toBuddhistEra(Number(row.academicYear));
      const round = String(row.round);
      const campaignName = String(row.campaignName);

      const existing = await ctx.tx.admissionCampaignStat.findFirst({
        where: { programId: programme.id, acadYearBE, round, campaignName },
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        const data: Record<string, number | string | Date | null> = { freshnessDate };
        for (const key of optional) {
          if (typeof row[key] === 'number') data[key] = row[key] as number;
        }
        // A row is its own round, so its plan IS the seats it offers. The
        // health drivers read enrollSeats, not planPerYear.
        if (typeof row.planPerYear === 'number') data.enrollSeats = row.planPerYear;
        // The sheet has no separate "sent to clearinghouse" figure; the
        // yield driver reads that column, so Confirmed stands in for it.
        if (typeof row.confirmClearinghouse === 'number') data.sendClearinghouse = row.confirmClearinghouse;
        if (claimsRow(existing)) data.ingestionRunId = ctx.ingestionRunId;

        await ctx.tx.admissionCampaignStat.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await ctx.tx.admissionCampaignStat.create({
          data: {
            // Deliberately absent: wProgramId, recruitmentProgramId, currId,
            // sourceFacultyId. They identify rows in a registrar's system,
            // not in anyone else's.
            programId: programme.id,
            facultyId: programme.faculty.id,
            // NOT NULL in the schema and never asked for — the programme
            // already says which faculty it belongs to.
            facultyNameTh: programme.faculty.nameTh,
            acadYearBE,
            round,
            campaignName,
            planPerYear: optNum(row.planPerYear),
            // The registrar export carries seats per round and a plan per
            // year; an imported row is one round, so both are the same
            // figure. The competition and fill-rate drivers read this one.
            enrollSeats: optNum(row.planPerYear),
            totalApplicants: optNum(row.totalApplicants),
            totalPassed: optNum(row.totalPassed),
            confirmClearinghouse: optNum(row.confirmClearinghouse),
            sendClearinghouse: optNum(row.confirmClearinghouse),
            regReported: optNum(row.regReported),
            freshnessDate,
            source: 'xlsx-import',
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.admissionCampaignStat.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.admissionCampaignStat.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
