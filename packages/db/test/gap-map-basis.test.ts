import { describe, expect, it } from 'vitest';
import { DEFAULT_DEMAND_BASIS, DEFAULT_PUBLIC_WINDOW_MONTHS } from '@kku/shared';
import { parseDemandBasis, publicWindowStart } from '../src/gap-map-rules';

describe('parseDemandBasis', () => {
  it('defaults to the blended basis', () => {
    expect(parseDemandBasis({})).toEqual({
      basis: DEFAULT_DEMAND_BASIS,
      publicWindowMonths: DEFAULT_PUBLIC_WINDOW_MONTHS,
    });
  });

  it('accepts each basis', () => {
    expect(parseDemandBasis({ basis: 'private' }).basis).toBe('private');
    expect(parseDemandBasis({ basis: 'public' }).basis).toBe('public');
    expect(parseDemandBasis({ basis: 'all' }).basis).toBe('all');
  });

  it('coerces the window from a query string', () => {
    expect(parseDemandBasis({ publicWindowMonths: '24' }).publicWindowMonths).toBe(24);
  });

  it('rejects an unknown basis rather than silently defaulting', () => {
    expect(() => parseDemandBasis({ basis: 'government' })).toThrow();
  });

  it('rejects a non-positive window', () => {
    expect(() => parseDemandBasis({ publicWindowMonths: '0' })).toThrow();
  });
});

describe('publicWindowStart', () => {
  it('reaches back the stated number of months', () => {
    expect(publicWindowStart(new Date('2026-09-20T00:00:00Z'), 12).toISOString().slice(0, 10)).toBe('2025-09-20');
  });

  it('handles a window crossing a year boundary', () => {
    expect(publicWindowStart(new Date('2026-02-10T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2025-11-10');
  });
});
