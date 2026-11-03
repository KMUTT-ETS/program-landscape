import type { PrismaClient } from '@prisma/client';

import {
  RANKED_UNIVERSITIES_STARTER,
  RANKED_UNIVERSITIES_STARTER_YEAR,
} from '../../ranked-universities-starter';
import type {
  ImportColumn,
  ImportDataset,
  ImportLoadContext,
  ImportLoadResult,
  ImportRow,
} from '../types';
import { PROVENANCE_SELECT, claimsRow } from './provenance';

// Tier 2 (public / external data). University rankings: the universe the
// Deep-Dive's AI peer selector chooses comparison institutions from.
//
// Not gated by realDataWhere() — the readers (peer selection, benchmarking
// overview, Deep-Dive peers) read the table directly — so the run id only
// serves start-over and provenance.
//
// The template is pre-filled with the curated starter list so an adopter
// edits rather than types. The institution's own row is left out of peer
// picks only when its University cell equals the organisation profile's
// English name.

/** The four values the peer selector's tier map understands (program-peers/select.ts). */
export const RANKING_REGIONS = ['World', 'Asia', 'Southeast Asia', 'Thailand'] as const;

function rankColumn(header: string, key: string, guide: string): ImportColumn {
  return {
    header,
    key,
    type: 'integer',
    required: false,
    guide: `${guide} A whole number of 1 or more; leave blank if the university is not ranked.`,
    example: '801',
    check: (value) =>
      typeof value === 'number' && value < 1 ? 'A rank must be 1 or higher.' : null,
  };
}

function optionalInt(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export const rankedUniversitiesDataset: ImportDataset = {
  slug: 'ranked-universities',
  title: 'University Rankings',
  description:
    'The institutions your programmes are compared against: one row per university per ranking year, ' +
    'with its QS and THE ranks. The template comes pre-filled with a starter list of world, Asian, ' +
    'Southeast Asian and Thai universities — edit it. Feeds the AI peer selection and the benchmarking views.',
  tier: 2,
  sheetName: 'University Rankings',
  columns: [
    {
      header: 'University',
      key: 'university',
      type: 'text',
      required: true,
      guide:
        'The university’s English name. Your own institution’s row is left out of peer picks only when ' +
        'this equals the English name in your organisation profile exactly.',
      example: 'National University of Singapore',
    },
    {
      header: 'Country',
      key: 'country',
      type: 'text',
      required: true,
      guide: 'The country the university is in, in English.',
      example: 'Singapore',
    },
    {
      header: 'Region',
      key: 'region',
      type: 'enum',
      required: true,
      enumValues: RANKING_REGIONS,
      guide:
        'The tier the peer selector files this university under: World (top global research universities), ' +
        'Asia, Southeast Asia, or Thailand. Exactly one of these four values.',
      example: 'Asia',
    },
    {
      header: 'Ranking Year',
      key: 'rankingYear',
      type: 'integer',
      required: true,
      guide:
        'The year of the ranking edition the ranks come from (Common Era). The peer selector uses only ' +
        'the latest year in the table, so a refreshed list for a new year replaces the old one.',
      example: String(RANKED_UNIVERSITIES_STARTER_YEAR),
      check: (value) => {
        if (typeof value !== 'number') return null;
        if (value < 2000 || value > new Date().getUTCFullYear() + 1) {
          return `${value} is not a plausible ranking year. Use the Common Era year of the edition.`;
        }
        return null;
      },
    },
    rankColumn('QS World Rank', 'qsWorldRank', 'Position in the QS World University Rankings.'),
    rankColumn('THE World Rank', 'theWorldRank', 'Position in the Times Higher Education World University Rankings.'),
    rankColumn('QS Asia Rank', 'qsAsiaRank', 'Position in the QS Asia University Rankings.'),
    rankColumn('THE Asia Rank', 'theAsiaRank', 'Position in the THE Asia University Rankings.'),
    {
      header: 'Website',
      key: 'website',
      type: 'text',
      required: false,
      guide:
        'The university’s home page. Optional. Tip: SCImago Institutions Rankings (scimagoir.com, country ' +
        'filter ?country=THA) is a free source for Thai research ranks; QS and THE figures are copied ' +
        'from their public tables.',
      example: 'https://www.nus.edu.sg',
    },
  ],
  strategy: {
    kind: 'upsert',
    match: { kind: 'manual', columns: ['university', 'rankingYear'] },
  },

  prefill: async (): Promise<readonly ImportRow[]> =>
    RANKED_UNIVERSITIES_STARTER.map((u) => ({
      university: u.name,
      country: u.country,
      region: u.region,
      rankingYear: RANKED_UNIVERSITIES_STARTER_YEAR,
      qsWorldRank: u.qsWorldRank ?? null,
      theWorldRank: u.theWorldRank ?? null,
      qsAsiaRank: u.qsAsiaRank ?? null,
      theAsiaRank: u.theAsiaRank ?? null,
      website: u.websiteUrl ?? null,
    })),

  load: async (ctx: ImportLoadContext, rows: readonly ImportRow[]): Promise<ImportLoadResult> => {
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const name = String(row.university).trim();
      const rankingYear = Number(row.rankingYear);
      const where = { name_rankingYear: { name, rankingYear } };
      // A blank rank clears the stored rank: the sheet states the whole row.
      const data = {
        country: String(row.country).trim(),
        region: String(row.region),
        // An absent column keeps the stored value; a blank cell clears it.
        qsWorldRank: row.qsWorldRank === undefined ? undefined : optionalInt(row.qsWorldRank),
        theWorldRank: row.theWorldRank === undefined ? undefined : optionalInt(row.theWorldRank),
        qsAsiaRank: row.qsAsiaRank === undefined ? undefined : optionalInt(row.qsAsiaRank),
        theAsiaRank: row.theAsiaRank === undefined ? undefined : optionalInt(row.theAsiaRank),
        websiteUrl: row.website === undefined ? undefined : optionalText(row.website),
      };
      const existing = await ctx.tx.rankedUniversity.findUnique({
        where,
        select: { id: true, ...PROVENANCE_SELECT },
      });
      if (existing) {
        await ctx.tx.rankedUniversity.update({
          where,
          data: claimsRow(existing) ? { ...data, ingestionRunId: ctx.ingestionRunId } : data,
        });
        updated += 1;
      } else {
        await ctx.tx.rankedUniversity.create({
          data: { name, rankingYear, ...data, ingestionRunId: ctx.ingestionRunId },
        });
        inserted += 1;
      }
    }
    return { inserted, updated, deleted: 0 };
  },

  count: (prisma: PrismaClient): Promise<number> =>
    prisma.rankedUniversity.count({
      where: { ingestionRun: { dataSource: { slug: 'xlsx-ranked-universities' } } },
    }),

  // Peer selections cascade from the university row; refuse rather than
  // silently erase every programme's chosen peers.
  cascadeBlockers: async (tx, runIds): Promise<{ label: string; count: number }[]> => {
    const count = await tx.programPeerSelection.count({
      where: { rankedUniversity: { ingestionRunId: { in: [...runIds] } } },
    });
    return count > 0 ? [{ label: 'programme peer selections that cite these universities', count }] : [];
  },

  clear: async (tx, runIds): Promise<number> => {
    const result = await tx.rankedUniversity.deleteMany({
      where: { ingestionRunId: { in: [...runIds] } },
    });
    return result.count;
  },
};
