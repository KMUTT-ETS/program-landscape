// packages/db/test/landscape-atlas-market.test.ts
import { describe, expect, it } from 'vitest';
import { buildMarket, type MarketRowInput } from '../src/landscape-atlas/market';

const r = (over: Partial<MarketRowInput>): MarketRowInput => ({
  slug: 's',
  nameTh: 'สาขา',
  nameEn: 'Field',
  postings: 100,
  demandShare: 0.05,
  supplyShare: 0.05,
  verdict: 'served',
  ...over,
});

describe('buildMarket', () => {
  it('puts white-space fields on the left rail and the rest on a shared log scale', () => {
    const out = buildMarket([
      r({ slug: 'ws', verdict: 'white-space', supplyShare: 0, demandShare: 0.02 }),
      r({ slug: 'eq', demandShare: 0.04, supplyShare: 0.04 }),
    ]);
    const ws = out.points.find((p) => p.id === 'ws')!;
    const eq = out.points.find((p) => p.id === 'eq')!;
    expect(ws.onRail).toBe(true);
    expect(ws.x).toBe(0);
    // Same domain on both axes, so a balanced field sits on the diagonal.
    expect(eq.x).toBeCloseTo(eq.y, 6);
    expect(out.frame.diagonal).toBe(true);
    expect(out.frame.split).toBeNull();
  });

  it('lists supply-unknown, too-few-postings and zero-demand fields', () => {
    const out = buildMarket([
      r({ slug: 'a', verdict: 'supply-unknown' }),
      r({ slug: 'b', verdict: 'too-few-postings' }),
      r({ slug: 'c', demandShare: 0 }),
    ]);
    expect(out.unplotted.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'KKU supply unknown (no graduate figure)'],
      ['b', 'Too few job adverts'],
      ['c', 'No job adverts'],
    ]);
    expect(out.points).toEqual([]);
  });

  it('answers with under-served and white-space counts', () => {
    const out = buildMarket([
      r({ slug: 'u1', verdict: 'under-served' }),
      r({ slug: 'u2', verdict: 'under-served' }),
      r({ slug: 'w', verdict: 'white-space', supplyShare: 0 }),
      r({ slug: 'o', verdict: 'over-served' }),
    ]);
    expect(out.answer).toEqual({
      figure: '3',
      sentence: 'fields need attention: 2 under-served and 1 white space (no KKU programme); 1 over-served.',
    });
    expect(out.counts['under-served']).toBe(2);
  });
});
