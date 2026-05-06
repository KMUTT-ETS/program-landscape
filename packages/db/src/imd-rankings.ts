// ─────────────────────────────────────────────────────────────────────────────
// IMD World Competitiveness Center — read-side helpers.
//
// Country-level rankings only (~67 economies × 3 datasets × yearly).
// Used as macro-context for the Trends Radar narrative, the Cockpit AI
// brief's executive paragraph, and the Benchmarking module's ASEAN
// peer-country comparator.
//
// All helpers are pure read calls — no AI, no aggregation, no caching.
// They're cheap; the underlying tables are small (~400 rows total).
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './index';
import type { ImdDataset } from '@prisma/client';

export interface ImdSnapshot {
  dataset: ImdDataset;
  year: number;
  economyCode: string;
  economyName: string;
  indicatorKey: string;
  rank: number | null;
  value: number | null;
  totalRanked: number | null;
  /** Year-on-year delta in rank, signed: negative = improving (lower-rank
   *  = better), positive = declining. Null when prior-year row is missing. */
  rankDelta: number | null;
  /** Three-year delta (2024 vs 2021 for example). Null when older year missing. */
  rankDelta3y: number | null;
}

export interface ImdContext {
  /** Country whose context we're building — defaults to 'TH' for KKU. */
  economyCode: string;
  /** Latest WCY/WTR/WDCR overall ranks for the country, with deltas. */
  headlines: ImdSnapshot[];
  /** ASEAN peer comparison — same dataset, same year, peers ranked
   *  alongside (sorted best → worst). */
  peerComparisons: Array<{
    dataset: ImdDataset;
    year: number;
    rows: Array<{ economyCode: string; economyName: string; rank: number | null }>;
  }>;
  /** Latest year in the database — used as the "as of" stamp. */
  latestYear: number | null;
}

const DEFAULT_DATASETS: ImdDataset[] = ['WCY', 'WTR', 'WDCR'];

/**
 * Returns the latest IMD snapshot for an economy across all three datasets,
 * with year-on-year + 3-year rank deltas. Powers the Trends Radar
 * "national context" widget and the AI brief's opening paragraph.
 */
export async function getImdContextForCountry(
  economyCode: string = 'TH',
): Promise<ImdContext> {
  const economy = await prisma.imdEconomy.findUnique({
    where: { code: economyCode },
  });
  if (!economy) {
    return { economyCode, headlines: [], peerComparisons: [], latestYear: null };
  }

  const headlines: ImdSnapshot[] = [];
  let latestYear: number | null = null;

  for (const dataset of DEFAULT_DATASETS) {
    const overallKey = `${dataset.toLowerCase()}.overall`;
    const latest = await prisma.imdRanking.findFirst({
      where: { economyId: economy.id, dataset, indicatorKey: overallKey },
      orderBy: { year: 'desc' },
    });
    if (!latest) continue;
    if (latestYear === null || latest.year > latestYear) latestYear = latest.year;

    const prior = await prisma.imdRanking.findFirst({
      where: {
        economyId: economy.id,
        dataset,
        indicatorKey: overallKey,
        year: latest.year - 1,
      },
    });
    const threeYearsAgo = await prisma.imdRanking.findFirst({
      where: {
        economyId: economy.id,
        dataset,
        indicatorKey: overallKey,
        year: latest.year - 3,
      },
    });

    headlines.push({
      dataset,
      year: latest.year,
      economyCode: economy.code,
      economyName: economy.name,
      indicatorKey: latest.indicatorKey,
      rank: latest.rank,
      value: latest.value,
      totalRanked: latest.totalRanked,
      rankDelta:
        latest.rank !== null && prior?.rank != null ? latest.rank - prior.rank : null,
      rankDelta3y:
        latest.rank !== null && threeYearsAgo?.rank != null
          ? latest.rank - threeYearsAgo.rank
          : null,
    });
  }

  // Peer comparison — pull peers (isPeer=true) plus the focus country
  // for each dataset's latest year.
  const peerEconomies = await prisma.imdEconomy.findMany({
    where: { OR: [{ isPeer: true }, { id: economy.id }] },
    select: { id: true, code: true, name: true },
  });
  const peerComparisons: ImdContext['peerComparisons'] = [];
  for (const dataset of DEFAULT_DATASETS) {
    const headline = headlines.find((h) => h.dataset === dataset);
    if (!headline) continue;
    const overallKey = `${dataset.toLowerCase()}.overall`;
    const rows = await prisma.imdRanking.findMany({
      where: {
        dataset,
        indicatorKey: overallKey,
        year: headline.year,
        economyId: { in: peerEconomies.map((p) => p.id) },
      },
    });
    const byEconId = new Map(rows.map((r) => [r.economyId, r]));
    peerComparisons.push({
      dataset,
      year: headline.year,
      rows: peerEconomies
        .map((p) => ({
          economyCode: p.code,
          economyName: p.name,
          rank: byEconId.get(p.id)?.rank ?? null,
        }))
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)),
    });
  }

  return { economyCode: economy.code, headlines, peerComparisons, latestYear };
}

/**
 * Latest year present in the database for a given dataset. Returns null
 * when no rows exist yet.
 */
export async function latestImdYear(dataset: ImdDataset): Promise<number | null> {
  const row = await prisma.imdRanking.findFirst({
    where: { dataset },
    orderBy: { year: 'desc' },
    select: { year: true },
  });
  return row?.year ?? null;
}
