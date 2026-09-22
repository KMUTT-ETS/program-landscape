import { describe, expect, it } from 'vitest';
import { DEMAND_BASES } from '@kku/shared';
import type { CacheService } from '../src/common/cache.service';

const { mapMeta } = await import('../src/gap/gap.controller');
const { GapService } = await import('../src/gap/gap.service');
type GapService = InstanceType<typeof GapService>;

// The map's cache key already carries both thresholds (see gap-controller
// tests) — this file covers the demand basis added alongside them. Without
// the basis and the public window in the key, `all` / `private` / `public`
// collide in the cache and a reader gets whichever basis was computed first
// under someone else's request; the same failure mode the thresholds fixed
// once already.

describe('GapService.map cache key — demand basis', () => {
  it('computes separately for each of the three demand bases', async () => {
    const get = async () => undefined;
    const set = async () => undefined;
    const compute = async () => ({ rows: [] }) as never;
    const calls: unknown[] = [];
    const s = new GapService(
      { get, set } as unknown as CacheService,
      (async (args: unknown) => {
        calls.push(args);
        return compute();
      }) as never,
    );
    const base = { scope: 'university' as const, scopeId: null, thresholds: { under: 0.5, over: 2 } };
    for (const basis of DEMAND_BASES) {
      await s.map({ ...base, demand: { basis, publicWindowMonths: 12 } });
    }
    expect(calls).toHaveLength(3);
  });

  it('gives two different public windows two different keys, so they do not collide under the same basis', async () => {
    const get = async () => undefined;
    const keysSeen: string[] = [];
    const cache = {
      get: async (key: string) => {
        keysSeen.push(key);
        return undefined;
      },
      set: async () => undefined,
    };
    const compute = async () => ({ rows: [] }) as never;
    const s = new GapService(cache as unknown as CacheService, compute as never);
    const base = { scope: 'university' as const, scopeId: null, thresholds: { under: 0.5, over: 2 } };
    await s.map({ ...base, demand: { basis: 'public', publicWindowMonths: 6 } });
    await s.map({ ...base, demand: { basis: 'public', publicWindowMonths: 12 } });
    expect(keysSeen).toHaveLength(2);
    expect(keysSeen[0]).not.toBe(keysSeen[1]);
    expect(keysSeen[0]).toContain('6');
    expect(keysSeen[1]).toContain('12');
  });
});

describe('mapMeta — demand basis', () => {
  const reconciliation = {
    scoredWithSupply: 83,
    supplyFromProxy: 13,
    publicAnnouncements: 45,
    publicPositions: 90,
    publicSeats: 500,
  };

  it('exposes the basis and the public window as methodology parameters, before the thresholds', () => {
    const meta = mapMeta({
      thresholds: { under: 0.5, over: 2 },
      demand: { basis: 'all', publicWindowMonths: 12, publicWindowFrom: '2025-09-20' },
      reconciliation,
      freshnessDate: null,
    });
    const params = meta.methodologyParameters ?? [];
    const basisIdx = params.findIndex((p) => p.label === 'Demand counted from');
    const windowIdx = params.findIndex((p) => p.label === 'Public announcements counted since');
    const underIdx = params.findIndex((p) => p.label === 'Under-served below a ratio of');
    expect(basisIdx).toBeGreaterThanOrEqual(0);
    expect(windowIdx).toBeGreaterThanOrEqual(0);
    expect(underIdx).toBeGreaterThanOrEqual(0);
    expect(basisIdx).toBeLessThan(underIdx);
    expect(windowIdx).toBeLessThan(underIdx);
    expect(params[windowIdx]!.value).toContain('2025-09-20');
    expect(params[windowIdx]!.value).toContain('12');
  });

  /* The provenance drawer and the Council brief cite what a figure rests on.
   * GAP_MAP_SOURCES listed only jobthai, so a blended- or public-basis figure
   * under-stated its own sources; naively adding job-108 to the static list
   * would swap that for the opposite error, citing a board a private-basis
   * figure never read. The cited demand boards are therefore derived from
   * `demandSourcesFor`, the same function that decides the denominator, so
   * the two cannot drift. */
  it('cites exactly the demand boards its denominator read, per basis', () => {
    const expected: Record<string, string[]> = {
      all: ['jobthai', 'job-108'],
      private: ['jobthai'],
      public: ['job-108'],
    };
    for (const basis of DEMAND_BASES) {
      const meta = mapMeta({
        thresholds: { under: 0.5, over: 2 },
        demand: { basis, publicWindowMonths: 12, publicWindowFrom: '2025-09-20' },
        reconciliation,
        freshnessDate: null,
      });
      const ids = (meta.sources ?? []).map((s) => s.id);
      for (const id of expected[basis]!) expect(ids).toContain(id);
      for (const id of ['jobthai', 'job-108']) {
        if (!expected[basis]!.includes(id)) expect(ids).not.toContain(id);
      }
      // The supply and signal sources are basis-independent and must survive.
      expect(ids).toContain('alumni-cohort-statuses');
      expect(ids).toContain('job-field-taxonomy');
    }
  });

  it('gives every cited source a human name, never a bare slug', () => {
    for (const basis of DEMAND_BASES) {
      const meta = mapMeta({
        thresholds: { under: 0.5, over: 2 },
        demand: { basis, publicWindowMonths: 12, publicWindowFrom: '2025-09-20' },
        reconciliation,
        freshnessDate: null,
      });
      for (const src of meta.sources ?? []) {
        expect(src.name.length).toBeGreaterThan(0);
        expect(src.name).not.toBe(src.id);
      }
    }
  });

  it('names the sources in words, not slugs, for each basis', () => {
    for (const basis of DEMAND_BASES) {
      const meta = mapMeta({
        thresholds: { under: 0.5, over: 2 },
        demand: { basis, publicWindowMonths: 12, publicWindowFrom: '2025-09-20' },
        reconciliation,
        freshnessDate: null,
      });
      const value = meta.methodologyParameters?.find((p) => p.label === 'Demand counted from')?.value ?? '';
      expect(value).not.toContain('jobthai');
      expect(value).not.toContain('job-108');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('caveats mention seats not being weighted, with the real reconciliation numbers', () => {
    const meta = mapMeta({
      thresholds: { under: 0.5, over: 2 },
      demand: { basis: 'all', publicWindowMonths: 12, publicWindowFrom: '2025-09-20' },
      reconciliation,
      freshnessDate: null,
    });
    const caveat = meta.caveats?.find((c) => c.includes('never weighted'));
    expect(caveat).toBeDefined();
    expect(caveat).toContain('90');
    expect(caveat).toContain('45');
    expect(caveat).toContain('500');
  });

  it('caveats mention the two extractors differing, with the measured calibration figures', () => {
    const meta = mapMeta({
      thresholds: { under: 0.5, over: 2 },
      demand: { basis: 'all', publicWindowMonths: 12, publicWindowFrom: '2025-09-20' },
      reconciliation,
      freshnessDate: null,
    });
    const caveat = meta.caveats?.find((c) => c.includes('extracted differently'));
    expect(caveat).toBeDefined();
    expect(caveat).toContain('120');
    expect(caveat).toContain('64%');
    expect(caveat).toContain('69');
    expect(caveat).toContain('17');
  });

  it('caveats note government rows create no occupation rows or programme links', () => {
    const meta = mapMeta({
      thresholds: { under: 0.5, over: 2 },
      demand: { basis: 'all', publicWindowMonths: 12, publicWindowFrom: '2025-09-20' },
      reconciliation,
      freshnessDate: null,
    });
    const caveat = meta.caveats?.find((c) => c.includes('no occupation classification'));
    expect(caveat).toBeDefined();
    expect(caveat).toContain('demand-alignment');
  });
});
