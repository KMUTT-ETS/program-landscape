import { describe, expect, it } from 'vitest';
import { averageLinkageOrder, overlapGroups } from '../src/program-overlap/cluster';

const sim = (pairs: Array<[string, string, number]>) => {
  const m = new Map<string, number>();
  for (const [a, b, v] of pairs) { m.set(`${a}|${b}`, v); m.set(`${b}|${a}`, v); }
  return (a: string, b: string) => (a === b ? 100 : m.get(`${a}|${b}`) ?? 0);
};

describe('averageLinkageOrder', () => {
  it('places mutually similar programmes next to each other', () => {
    const ids = ['a', 'x', 'b', 'y'];
    const order = averageLinkageOrder(ids, sim([['a', 'b', 90], ['x', 'y', 80], ['a', 'x', 5]]));
    const pos = (id: string) => order.indexOf(id);
    expect(Math.abs(pos('a') - pos('b'))).toBe(1);
    expect(Math.abs(pos('x') - pos('y'))).toBe(1);
    expect(order).toHaveLength(4);
  });
  it('handles empty and single inputs', () => {
    expect(averageLinkageOrder([], () => 0)).toEqual([]);
    expect(averageLinkageOrder(['a'], () => 0)).toEqual(['a']);
  });
  it('is deterministic for ties (sorted by id)', () => {
    expect(averageLinkageOrder(['c', 'a', 'b'], () => 0)).toEqual(averageLinkageOrder(['b', 'c', 'a'], () => 0));
  });
});

describe('overlapGroups', () => {
  it('builds connected components of edges at or above the threshold', () => {
    const groups = overlapGroups(['a', 'b', 'c', 'd'], [
      { a: 'a', b: 'b', index: 55 },
      { a: 'b', b: 'c', index: 72 },
      { a: 'c', b: 'd', index: 40 },
    ], 50);
    expect(groups).toEqual([{ members: ['a', 'b', 'c'], peakIndex: 72 }]);
  });
  it('ignores null indexes and unknown ids; sorts groups by peak', () => {
    const groups = overlapGroups(['a', 'b', 'c', 'd'], [
      { a: 'a', b: 'b', index: null },
      { a: 'a', b: 'z', index: 90 },
      { a: 'c', b: 'd', index: 60 },
      { a: 'a', b: 'b', index: 50 },
    ], 50);
    expect(groups).toEqual([{ members: ['c', 'd'], peakIndex: 60 }, { members: ['a', 'b'], peakIndex: 50 }]);
  });
  it('returns no groups when nothing clears the threshold', () => {
    expect(overlapGroups(['a', 'b'], [{ a: 'a', b: 'b', index: 49.9 }], 50)).toEqual([]);
  });
});
