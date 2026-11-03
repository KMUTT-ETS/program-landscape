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

export const ELIGIBILITY_HORIZON_YEARS = 10;

export interface PickProjectionSourceOptions {
  /** Age cohort the caller reads, e.g. '18-22'. */
  cohort: string;
  /** When set, only a source that also carries this region qualifies. */
  needRegion?: string;
  /** Calendar year that must be present. Defaults to the current UTC year. */
  year?: number;
  client?: PrismaClient;
}

interface EligibleSource {
  source: string;
  /** Regions with a row at BOTH checked years. */
  regions: Set<string>;
}

/**
 * Sources with a national row for the cohort at the current year AND at
 * current year + 10 (the driver's target year and the outlook's +10 horizon),
 * best first. A source covering only the near years never outranks one that
 * reaches the horizon.
 */
async function eligibleSources(opts: {
  cohort: string;
  year?: number;
  client?: PrismaClient;
  regions?: readonly string[];
}): Promise<EligibleSource[]> {
  const client = opts.client ?? defaultPrisma;
  const year = opts.year ?? new Date().getUTCFullYear();
  const years = [year, year + ELIGIBILITY_HORIZON_YEARS];
  const rows = await client.demographicProjection.findMany({
    where: {
      ageCohort: opts.cohort,
      year: { in: years },
      ...(opts.regions ? { region: { in: [...opts.regions] } } : {}),
    },
    select: { source: true, region: true, year: true },
  });
  const seen = new Map<string, Map<string, Set<number>>>(); // source -> region -> years
  for (const r of rows) {
    const byRegion = seen.get(r.source) ?? new Map<string, Set<number>>();
    const ys = byRegion.get(r.region) ?? new Set<number>();
    ys.add(r.year);
    byRegion.set(r.region, ys);
    seen.set(r.source, byRegion);
  }
  const out: EligibleSource[] = [];
  for (const [source, byRegion] of seen) {
    const complete = new Set(
      [...byRegion.entries()].filter(([, ys]) => years.every((y) => ys.has(y))).map(([r]) => r),
    );
    if (!complete.has(NATIONAL_REGION)) continue;
    out.push({ source, regions: complete });
  }
  return out.sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.source.localeCompare(b.source));
}

/**
 * The best source with a national ('TH') row for the cohort at the current
 * year and at +10 (and the requested region at both, when one is needed).
 * Within a preference tier the name sorts alphabetically so the pick is
 * deterministic. Null when no source qualifies.
 */
export async function pickProjectionSource(
  opts: PickProjectionSourceOptions,
): Promise<string | null> {
  const need = opts.needRegion && opts.needRegion !== NATIONAL_REGION
    ? [NATIONAL_REGION, opts.needRegion]
    : [NATIONAL_REGION];
  const eligible = await eligibleSources({ ...opts, regions: need });
  return eligible.find((e) => need.every((r) => e.regions.has(r)))?.source ?? null;
}

/** Regions (national excluded) carried by at least one eligible source. */
export async function eligibleProjectionRegions(opts: {
  cohort: string;
  year?: number;
  client?: PrismaClient;
}): Promise<string[]> {
  const eligible = await eligibleSources(opts);
  const regions = new Set<string>();
  for (const e of eligible) for (const r of e.regions) regions.add(r);
  return [...regions].sort();
}
