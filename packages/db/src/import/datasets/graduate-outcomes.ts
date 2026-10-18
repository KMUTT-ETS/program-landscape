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

// Tier 1. The Deep-Dive's graduate outcome section and the employment
// driver of the health score.
//
// One row is one survey of one graduating cohort. A cohort surveyed again
// the following year is a SECOND row, not a correction of the first, which
// is why the key is three parts and not two.

/**
 * A proportion, stored 0–1.
 *
 * 87 and 0.87 are both plausible numbers to a validator that checks only
 * that a cell holds a number, and the wrong one of them renders as 8700 %
 * employment on a Council surface — or, worse, as a health-score driver
 * pinned at its ceiling with nothing visibly odd about it.
 */
function rateColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'decimal',
    required: true,
    guide: `${guide} A proportion between 0 and 1 — write 87 % as 0.87.`,
    example: '0.87',
    check: (value) => {
      if (typeof value !== 'number') return null;
      if (value < 0) return 'A proportion cannot be negative.';
      if (value > 1) {
        return (
          `${value} is not a proportion. This column takes a value between 0 ` +
          `and 1 — write 87 % as 0.87.`
        );
      }
      return null;
    },
  };
}

export const graduateOutcomesDataset: ImportDataset = {
  slug: 'graduate-outcomes',
  title: 'Graduate Outcomes',
  description:
    'Employment survey results, one row per programme per graduating cohort ' +
    'per survey. A cohort surveyed twice has two rows.',
  tier: 1,
  sheetName: 'Graduate Outcomes',
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
    yearColumn('Graduation Year', 'graduationYear', 'The academic year this cohort graduated in.'),
    yearColumn(
      'Survey Year',
      'surveyYear',
      'The year the survey was run. Survey the same cohort again and that ' +
        'is a new row, not a correction of the old one.',
    ),
    rateColumn('Employment Rate', 'employmentRate', 'Share of respondents in work.'),
    {
      header: 'Average Salary (THB/month)',
      key: 'averageSalary',
      type: 'decimal',
      required: true,
      guide:
        'Mean monthly salary of employed respondents, in baht. Monthly, not ' +
        'annual — an annual figure here reads as a salary twelve times too ' +
        'high and nothing downstream will question it.',
      example: '24000',
      check: (value) =>
        typeof value === 'number' && value < 0 ? 'A salary cannot be negative.' : null,
    },
    rateColumn(
      'Job Relevance Score',
      'jobRelevanceScore',
      'Share of employed respondents whose work relates to what they studied.',
    ),
    rateColumn('Further Study Rate', 'furtherStudyRate', 'Share of respondents who went on to study further.'),
    {
      header: 'Sample Size',
      key: 'sampleSize',
      type: 'integer',
      required: true,
      guide:
        'How many graduates answered. Every other figure in the row is read ' +
        'against it, and a row covering fewer than five people is refused — ' +
        'at that size the averages describe individuals.',
      example: '40',
      groupSizeFor: { minimum: 5 },
    },
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'unique', columns: ['programmeCode', 'graduationYear', 'surveyYear'] },
  },
  // The survey year is left blank on purpose: it cannot be guessed, and a
  // guessed one is worse than an empty cell because it looks like an answer.
  prefill: programmeYearPrefill({ yearKey: 'graduationYear', extraKeys: ['surveyYear'] }),

  rowRules: [
    {
      message:
        'The survey year is before the graduation year — a cohort cannot be ' +
        'surveyed before it graduates. Check the two columns against each other.',
      check: (r) =>
        typeof r.surveyYear !== 'number' || typeof r.graduationYear !== 'number'
          ? true
          : r.surveyYear >= r.graduationYear,
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

    for (const r of rows) {
      const code = String(r.programmeCode);
      const programId = idByCode.get(code);
      if (!programId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
        );
      }

      const where = {
        programId_graduationYear_surveyYear: {
          programId,
          graduationYear: Number(r.graduationYear),
          surveyYear: Number(r.surveyYear),
        },
      };

      // Every column here is required, so unlike the other tier-1 datasets
      // there is no partial-update case: a row either states the whole
      // survey result or fails validation.
      const figures = {
        employmentRate: Number(r.employmentRate),
        averageSalary: Number(r.averageSalary),
        jobRelevanceScore: Number(r.jobRelevanceScore),
        furtherStudyRate: Number(r.furtherStudyRate),
        sampleSize: Number(r.sampleSize),
        freshnessDate,
      };

      const existing = await ctx.tx.graduateOutcome.findUnique({
        where,
        select: { id: true, ...PROVENANCE_SELECT },
      });

      if (existing) {
        await ctx.tx.graduateOutcome.update({
          where,
          data: claimsRow(existing)
            ? { ...figures, ingestionRunId: ctx.ingestionRunId }
            : figures,
        });
        updated += 1;
      } else {
        await ctx.tx.graduateOutcome.create({
          data: {
            programId,
            graduationYear: Number(r.graduationYear),
            surveyYear: Number(r.surveyYear),
            ...figures,
            methodologyVersion: 'xlsx-import.v1',
            ingestionRunId: ctx.ingestionRunId,
          },
        });
        inserted += 1;
      }
    }

    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> => prisma.graduateOutcome.count(),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.graduateOutcome.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
