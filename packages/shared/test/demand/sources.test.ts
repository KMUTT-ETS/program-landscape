import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEMAND_BASIS,
  DEFAULT_PUBLIC_WINDOW_MONTHS,
  DEMAND_BASES,
  PRIVATE_DEMAND_SOURCE,
  PUBLIC_DEMAND_SOURCE,
  demandSourcesFor,
} from '../../src/demand/sources';

describe('demand sources', () => {
  it('defaults to the blended basis', () => {
    expect(DEFAULT_DEMAND_BASIS).toBe('all');
    expect(DEFAULT_PUBLIC_WINDOW_MONTHS).toBe(12);
  });

  it('maps each basis to its source slugs', () => {
    expect(demandSourcesFor('private')).toEqual([PRIVATE_DEMAND_SOURCE]);
    expect(demandSourcesFor('public')).toEqual([PUBLIC_DEMAND_SOURCE]);
    expect(demandSourcesFor('all')).toEqual([PRIVATE_DEMAND_SOURCE, PUBLIC_DEMAND_SOURCE]);
  });

  it('never returns an empty source list', () => {
    for (const basis of DEMAND_BASES) expect(demandSourcesFor(basis).length).toBeGreaterThan(0);
  });

  it('the private and public source lists are disjoint', () => {
    const priv = new Set(demandSourcesFor('private'));
    const pub = demandSourcesFor('public');
    expect(pub.some((slug) => priv.has(slug))).toBe(false);
    expect(demandSourcesFor('all')).toEqual([...demandSourcesFor('private'), ...demandSourcesFor('public')]);
  });
});
