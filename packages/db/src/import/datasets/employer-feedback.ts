import type { PrismaClient } from '@prisma/client';

import { ApiError } from '@kku/shared';

import type { ImportDataset, ImportLoadContext, ImportLoadResult, ImportRow } from '../types';
import { yearColumn } from './enrollment';

// Tier 2. Employer feedback: the "Top employers" list in the Deep-Dive's
// graduate outcomes section.
//
// PROGRAMME-SCOPED. The table has no unique key, so there is nothing to merge
// on: a programme named in the file has its previously imported rows replaced.
// The replace deletes only rows written by THIS dataset's own earlier uploads.
//
// Satisfaction is stored as a 0–1 fraction because the reader multiplies by
// 100 for display; 87 here would render as 8700 %.

const SLUG = 'xlsx-employer-feedback';
export const ALL_EMPLOYERS = 'All employers';

async function ownRunIds(tx: ImportLoadContext['tx']): Promise<string[]> {
  const runs = await tx.ingestionRun.findMany({
    where: { dataSource: { slug: SLUG } },
    select: { id: true },
  });
  return runs.map((r) => r.id);
}

export const employerFeedbackDataset: ImportDataset = {
  slug: 'employer-feedback',
  title: 'Employer Feedback',
  description:
    'How employers rate a programme’s graduates: one row per programme per survey year per employer, ' +
    'or one row for all employers together. A programme named in the file has its previously imported ' +
    'rows replaced. Feeds the Top employers list in the Deep-Dive’s graduate outcomes section.',
  tier: 2,
  sheetName: 'Employer Feedback',
  columns: [
    {
      header: 'Programme Code',
      key: 'programmeCode',
      type: 'text',
      required: true,
      guide: 'The programme this feedback is about, exactly as its Programme Code in the Programmes sheet.',
      example: 'ENG-ME-BSC',
      references: { dataset: 'programmes', column: 'code' },
    },
    yearColumn('Survey Year', 'surveyYear', 'The year the employer survey was run.'),
    {
      header: 'Employer',
      key: 'employer',
      type: 'text',
      required: false,
      guide:
        'The employer’s organisation name. Leave blank for a single figure covering all employers ' +
        `together; it is stored as "${ALL_EMPLOYERS}". Organisations only — never a person’s name.`,
      example: 'Example Manufacturing Co.',
    },
    {
      header: 'Satisfaction (0–1)',
      key: 'satisfaction',
      type: 'decimal',
      required: true,
      guide:
        'Employer satisfaction with the programme’s graduates, as a proportion between 0 and 1 — ' +
        'write 87 % as 0.87.',
      example: '0.87',
      check: (value) => {
        if (typeof value !== 'number') return null;
        if (value < 0) return 'A proportion cannot be negative.';
        if (value > 1) {
          return `${value} is not a proportion. This column takes a value between 0 and 1 — write 0.87, not 87.`;
        }
        return null;
      },
    },
    {
      header: 'Respondents',
      key: 'respondents',
      type: 'integer',
      required: true,
      guide:
        'How many people answered for this row. A row covering fewer than five respondents is refused, ' +
        'so no individual’s opinion can be inferred.',
      example: '12',
      groupSizeFor: { minimum: 5 },
    },
  ],
  strategy: {
    kind: 'programme-scoped',
    scopeColumns: ['programmeCode'],
    match: { kind: 'unique', columns: ['programmeCode', 'surveyYear', 'employer'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const codes = [...new Set(rows.map((r) => String(r.programmeCode)))];
    const found = await ctx.tx.program.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const idByCode = new Map(found.map((p) => [p.code, p.id]));
    for (const code of codes) {
      if (!idByCode.has(code)) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Programme code "${code}" does not exist. Upload the Programmes sheet first.`,
        );
      }
    }

    const runIds = await ownRunIds(ctx.tx);
    const deleted = await ctx.tx.employerFeedback.deleteMany({
      where: { programId: { in: [...idByCode.values()] }, ingestionRunId: { in: runIds } },
    });

    const freshnessDate = new Date();
    const created = await ctx.tx.employerFeedback.createMany({
      data: rows.map((row) => ({
        programId: idByCode.get(String(row.programmeCode))!,
        year: Number(row.surveyYear),
        employerName:
          typeof row.employer === 'string' && row.employer.trim() !== '' ? row.employer.trim() : ALL_EMPLOYERS,
        satisfactionScore: Number(row.satisfaction),
        skillGapsJson: [],
        sampleSize: Number(row.respondents),
        freshnessDate,
        ingestionRunId: ctx.ingestionRunId,
      })),
    });
    return { inserted: created.count, updated: 0, deleted: deleted.count };
  },

  count: (prisma: PrismaClient): Promise<number> =>
    prisma.employerFeedback.count({ where: { ingestionRun: { dataSource: { slug: SLUG } } } }),

  countForScope: async (prisma, scopes): Promise<number> => {
    const codes = scopes.map((s) => String(s.programmeCode));
    if (codes.length === 0) return 0;
    const programmes = await prisma.program.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    return prisma.employerFeedback.count({
      where: {
        programId: { in: programmes.map((p) => p.id) },
        ingestionRun: { dataSource: { slug: SLUG } },
      },
    });
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.employerFeedback.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
