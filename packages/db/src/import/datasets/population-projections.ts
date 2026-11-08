import type { PrismaClient } from '@prisma/client';

import type { ImportDataset, ImportLoadContext, ImportLoadResult, ImportRow } from '../types';

// Tier 2 (public / external data). Population projections.
//
// The cohort sizes behind the demographic-ceiling views: how many 15-17,
// 18-22 and 23-29 year-olds a region is projected to have each year. An
// institution that cannot use the built-in UN series (or wants its own
// national statistics office's edition) uploads this sheet; the source picker
// (projection-source.ts) prefers a spreadsheet source over every other.
//
// Stored with source `xlsx:<Source Name>`, so two editions can sit side by
// side and a re-upload of the same edition updates it in place.

const NATIONAL_SPELLINGS = new Set(['th', 'thailand', 'ประเทศไทย']);

/** 'TH', 'th', 'Thailand', 'ประเทศไทย' (any case, trimmed) all mean the national series. */
export function normaliseRegion(value: string): string {
  const trimmed = value.trim();
  return NATIONAL_SPELLINGS.has(trimmed.toLowerCase()) ? 'TH' : trimmed;
}

export const AGE_GROUPS = ['15-17', '18-22', '23-29'] as const;
export const SPREADSHEET_SOURCE_PREFIX = 'xlsx:';

export const populationProjectionsDataset: ImportDataset = {
  slug: 'population-projections',
  title: 'Population Projections',
  description:
    'Projected population per region, calendar year and age group (15-17, 18-22, 23-29), ' +
    'from your national statistics office or any published projection. Takes precedence over the ' +
    'built-in UN series. Feeds the demographic-ceiling analysis and the scenario planner.',
  tier: 2,
  sheetName: 'Population Projections',
  columns: [
    {
      header: 'Region',
      key: 'region',
      type: 'text',
      required: true,
      guide:
        'The area the figure covers. Write TH for the national total ("Thailand" and "ประเทศไทย" are ' +
        'also accepted and stored as TH). A regional row only drives the ' +
        'demographic health score when it names the region selected in your organisation profile: ' +
        'Northeast, Central, North or South (Central includes Bangkok, the East and the West). ' +
        'Other regions are stored but never used; the national figure is never substituted.',
      example: 'TH',
      identity: (value) => normaliseRegion(String(value ?? '')),
    },
    {
      header: 'Year',
      key: 'year',
      type: 'integer',
      required: true,
      guide: 'The calendar year the projection is for. Use the Common Era year (2030), not the Buddhist era (2573).',
      example: '2030',
      check: (value) => {
        if (typeof value !== 'number') return null;
        if (value < 2000 || value > 2100) {
          return `${value} is outside 2000–2100. If this is a Buddhist-era year, subtract 543 — BE 2573 is CE 2030.`;
        }
        return null;
      },
    },
    {
      header: 'Age Group',
      key: 'ageGroup',
      type: 'enum',
      required: true,
      enumValues: AGE_GROUPS,
      guide:
        '15-17 (next-year applicants), 18-22 (undergraduate age) or 23-29 (postgraduate age). ' +
        'Other groupings are refused: add single-age figures together first.',
      example: '18-22',
    },
    {
      header: 'Population',
      key: 'population',
      type: 'integer',
      required: true,
      guide: 'Persons (not thousands) in that region, year and age group. Must be above zero.',
      example: '4300000',
      check: (value) =>
        typeof value === 'number' && value <= 0 ? 'Population must be greater than zero.' : null,
    },
    {
      header: 'Source Name',
      key: 'sourceName',
      type: 'text',
      required: true,
      guide:
        'Which edition this is, as free text — for example "NESDC 2023 edition". It is stored as ' +
        '"xlsx:<name>" and shown wherever the projection is cited. Keep it identical between uploads so ' +
        'a refreshed file updates the edition rather than adding a second one.',
      example: 'NESDC 2023 edition',
    },
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'manual', columns: ['region', 'year', 'ageGroup', 'sourceName'] },
  },

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    const freshnessDate = new Date();
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const key = {
        region: normaliseRegion(String(row.region)),
        year: Number(row.year),
        ageCohort: String(row.ageGroup),
        source: `${SPREADSHEET_SOURCE_PREFIX}${String(row.sourceName).trim()}`,
      };
      const existing = await ctx.tx.demographicProjection.findUnique({
        where: { region_year_ageCohort_source: key },
        select: { id: true },
      });
      await ctx.tx.demographicProjection.upsert({
        where: { region_year_ageCohort_source: key },
        create: {
          ...key,
          population: Number(row.population),
          freshnessDate,
          ingestionRunId: ctx.ingestionRunId,
        },
        update: {
          population: Number(row.population),
          freshnessDate,
          ingestionRunId: ctx.ingestionRunId,
        },
      });
      if (existing) updated += 1;
      else inserted += 1;
    }
    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> =>
    prisma.demographicProjection.count({
      where: { ingestionRun: { dataSource: { slug: 'xlsx-population-projections' } } },
    }),

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.demographicProjection.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
