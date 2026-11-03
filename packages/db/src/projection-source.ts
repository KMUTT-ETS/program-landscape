// Which population-projection source a reader should use.
//
// `demographic_projections` holds several editions side by side: an
// institution's own spreadsheet (`xlsx:<name>`), the UN World Population
// Prospects pull (`UN-WPP2024`) and the NESDC starter series KKU is seeded
// with. Readers used to hard-code the NESDC name; they now ask for the best
// source that can actually answer their question.
import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from './index';
import { SPREADSHEET_SOURCE_PREFIX } from './import/datasets/population-projections';
import { NATIONAL_REGION } from './projection-region';

export const UN_WPP_SOURCE = 'UN-WPP2024';
export const NESDC_SOURCE = 'NESDC-PopProj-2010-2040';

/** Lower is better: spreadsheet, then UN, then NESDC, then anything else. */
export function sourceRank(source: string): number {
  if (source.startsWith(SPREADSHEET_SOURCE_PREFIX)) return 0;
  if (source === UN_WPP_SOURCE) return 1;
  if (source === NESDC_SOURCE) return 2;
  return 3;
}

export interface PickProjectionSourceOptions {
  /** Age cohort the caller reads, e.g. '18-22'. */
  cohort: string;
  /** When set, only a source that also carries this region qualifies. */
  needRegion?: string;
  /** Calendar year that must be present. Defaults to the current UTC year. */
  year?: number;
  client?: PrismaClient;
}

/**
 * The best source with a national ('TH') row for the cohort at the current
 * year (and the requested region, when one is needed). Within a preference
 * tier the name sorts alphabetically so the pick is deterministic. Null when
 * no source qualifies.
 */
export async function pickProjectionSource(
  opts: PickProjectionSourceOptions,
): Promise<string | null> {
  const client = opts.client ?? defaultPrisma;
  const year = opts.year ?? new Date().getUTCFullYear();
  const regions = opts.needRegion && opts.needRegion !== NATIONAL_REGION
    ? [NATIONAL_REGION, opts.needRegion]
    : [NATIONAL_REGION];
  const rows = await client.demographicProjection.findMany({
    where: { ageCohort: opts.cohort, year, region: { in: regions } },
    select: { source: true, region: true },
  });
  const regionsBySource = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = regionsBySource.get(r.source) ?? new Set<string>();
    set.add(r.region);
    regionsBySource.set(r.source, set);
  }
  const eligible = [...regionsBySource.entries()]
    .filter(([, set]) => regions.every((region) => set.has(region)))
    .map(([source]) => source)
    .sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b));
  return eligible[0] ?? null;
}
