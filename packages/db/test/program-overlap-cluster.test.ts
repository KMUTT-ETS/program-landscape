import { describe, expect, it } from 'vitest';
import { overlapGroups } from '../src/program-overlap/cluster';

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
