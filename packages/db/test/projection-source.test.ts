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
        where: { ageCohort: string; year: number; region: { in: string[] } };
      }) =>
        rows
          .filter(
            (r) =>
              r.ageCohort === args.where.ageCohort &&
              r.year === args.where.year &&
              args.where.region.in.includes(r.region),
          )
          .map((r) => ({ source: r.source, region: r.region })),
    },
  } as unknown as PrismaClient;
}

const row = (source: string, region = 'TH', ageCohort = '18-22', year = YEAR): Row => ({
  source,
  region,
  ageCohort,
  year,
});

describe('pickProjectionSource', () => {
  it('prefers spreadsheet over UN over NESDC', async () => {
    const client = fakeClient([
      row('NESDC-PopProj-2010-2040'),
      row('UN-WPP2024'),
      row('xlsx:Ministry 2024'),
    ]);
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client })).toBe('xlsx:Ministry 2024');
    const noSheet = fakeClient([row('NESDC-PopProj-2010-2040'), row('UN-WPP2024')]);
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client: noSheet })).toBe('UN-WPP2024');
  });

  it('skips a source without the national current-year row', async () => {
    const client = fakeClient([
      row('xlsx:Regional only', 'Northeast'),
      row('xlsx:Old edition', 'TH', '18-22', YEAR - 3),
      row('UN-WPP2024'),
    ]);
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client })).toBe('UN-WPP2024');
  });

  it('needRegion excludes UN (national only)', async () => {
    const client = fakeClient([
      row('UN-WPP2024'),
      row('NESDC-PopProj-2010-2040'),
      row('NESDC-PopProj-2010-2040', 'Northeast'),
    ]);
    expect(
      await pickProjectionSource({ cohort: '18-22', needRegion: 'Northeast', year: YEAR, client }),
    ).toBe('NESDC-PopProj-2010-2040');
    expect(
      await pickProjectionSource({ cohort: '18-22', needRegion: 'South', year: YEAR, client }),
    ).toBeNull();
  });

  it('KKU data → NESDC', async () => {
    const client = fakeClient([
      row('NESDC-PopProj-2010-2040'),
      row('NESDC-PopProj-2010-2040', 'Northeast'),
      row('NESDC-v1'),
    ]);
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client })).toBe('NESDC-PopProj-2010-2040');
    expect(
      await pickProjectionSource({ cohort: '18-22', needRegion: 'Northeast', year: YEAR, client }),
    ).toBe('NESDC-PopProj-2010-2040');
  });

  it('returns null when nothing qualifies', async () => {
    expect(await pickProjectionSource({ cohort: '18-22', year: YEAR, client: fakeClient([]) })).toBeNull();
    expect(
      await pickProjectionSource({ cohort: '23-29', year: YEAR, client: fakeClient([row('UN-WPP2024')]) }),
    ).toBeNull();
  });
});
