import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { pickProjectionSource } from '../src/projection-source';

interface Row {
  source: string;
  region: string;
  ageCohort: string;
  year: number;
}

const YEAR = 2026;

// A tiny in-memory stand-in for the one query the picker makes.
function fakeClient(rows: Row[]): PrismaClient {
  return {
    demographicProjection: {
      findMany: async (args: {
        where: { ageCohort: string; year: { in: number[] }; region?: { in: string[] } };
      }) =>
        rows
          .filter(
            (r) =>
              r.ageCohort === args.where.ageCohort &&
              args.where.year.in.includes(r.year) &&
              (!args.where.region || args.where.region.in.includes(r.region)),
          )
          .map((r) => ({ source: r.source, region: r.region, year: r.year })),
    },
  } as unknown as PrismaClient;
}

// A source row at the current year AND +10, as the picker requires.
const row = (source: string, region = 'TH', ageCohort = '18-22', year = YEAR): Row[] => [
  { source, region, ageCohort, year },
  { source, region, ageCohort, year: year + 10 },
];
const rows = (...groups: Row[][]): Row[] => groups.flat();

describe('pickProjectionSource', () => {
  it('prefers spreadsheet over UN over NESDC', async () => {
    const client = fakeClient(rows(
      row('NESDC-PopProj-2010-2040'),
      row('UN-WPP2024'),
      row('xlsx:Ministry 2024'),
    ));
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client })).toBe('xlsx:Ministry 2024');
    const noSheet = fakeClient(rows(row('NESDC-PopProj-2010-2040'), row('UN-WPP2024')));
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client: noSheet })).toBe('UN-WPP2024');
  });

  it('skips a source without the national current-year row', async () => {
    const client = fakeClient(rows(
      row('xlsx:Regional only', 'Northeast'),
      row('xlsx:Old edition', 'TH', '18-22', YEAR - 3),
      row('UN-WPP2024'),
    ));
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client })).toBe('UN-WPP2024');
  });

  it('needRegion excludes UN (national only)', async () => {
    const client = fakeClient(rows(
      row('UN-WPP2024'),
      row('NESDC-PopProj-2010-2040'),
      row('NESDC-PopProj-2010-2040', 'Northeast'),
    ));
    expect(
      await pickProjectionSource({ cohort: '18-22', needRegion: 'Northeast', year: YEAR, client }),
    ).toBe('NESDC-PopProj-2010-2040');
    expect(
      await pickProjectionSource({ cohort: '18-22', needRegion: 'South', year: YEAR, client }),
    ).toBeNull();
  });

  it('KKU data → NESDC', async () => {
    const client = fakeClient(rows(
      row('NESDC-PopProj-2010-2040'),
      row('NESDC-PopProj-2010-2040', 'Northeast'),
      row('NESDC-v1'),
    ));
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client })).toBe('NESDC-PopProj-2010-2040');
    expect(
      await pickProjectionSource({ cohort: '18-22', needRegion: 'Northeast', year: YEAR, client }),
    ).toBe('NESDC-PopProj-2010-2040');
  });

  it('a spreadsheet covering only the near years does not outrank NESDC that reaches +10', async () => {
    const short: Row[] = [2026, 2027, 2028, 2029, 2030].map((year) => ({ source: 'xlsx:Short', region: 'TH', ageCohort: '18-22', year }));
    const client = fakeClient(rows(short, row('NESDC-PopProj-2010-2040')));
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client })).toBe('NESDC-PopProj-2010-2040');
    const regionShort: Row[] = [YEAR].map((year) => ({ source: 'xlsx:RegionShort', region: 'Northeast', ageCohort: '18-22', year }));
    const c2 = fakeClient(rows(row('xlsx:RegionShort'), regionShort, row('NESDC-PopProj-2010-2040'), row('NESDC-PopProj-2010-2040', 'Northeast')));
    expect(await pickProjectionSource({ cohort: '18-22', needRegion: 'Northeast', year: YEAR, client: c2 })).toBe('NESDC-PopProj-2010-2040');
  });

  it('returns null when nothing qualifies', async () => {
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client: fakeClient([]) })).toBeNull();
    expect(
      await pickProjectionSource({ cohort: '23-29', year: YEAR, client: fakeClient(rows(row('UN-WPP2024'))) }),
    ).toBeNull();
  });
});
