import { describe, expect, it } from 'vitest';
import { computeRetirementDateFromBirth } from '../../src/connectors/sources/kku-hr/transforms';

// KKU civil-service retirement rule:
//   Retire on 1 Oct AFTER the staff member is fully 60 years old.
//   Equivalently: birth month <= Sep → retire on 1 Oct (birthYear + 60);
//                 birth month >= Oct → retire on 1 Oct (birthYear + 61).
//
// Edge case: born exactly on 1 Oct counts as the "next year" branch —
// they have just turned 60 on the cut-off day and don't retire until
// the following year.

function d(yyyymmdd: string): Date {
  const [y, m, day] = yyyymmdd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

describe('computeRetirementDateFromBirth — KKU civil-service rule', () => {
  it.each([
    // birthDate            expectedRetire   reason
    ['1968-01-15',          '2028-10-01',    'Jan → retire +60'],
    ['1973-05-07',          '2033-10-01',    'May → retire +60'],
    ['1974-09-12',          '2034-10-01',    'Sep (before Oct cut-off) → retire +60'],
    ['1974-09-30',          '2034-10-01',    'Sep 30 (last day before cut-off) → retire +60'],
    ['1968-10-01',          '2029-10-01',    'Oct 1 (cut-off day) → retire +61 (not yet fully 60 by previous Oct 1)'],
    ['1968-10-24',          '2029-10-01',    'Oct (after cut-off) → retire +61'],
    ['1975-11-14',          '2036-10-01',    'Nov → retire +61'],
    ['1974-12-05',          '2035-10-01',    'Dec → retire +61'],
    ['1983-12-20',          '2044-10-01',    'Dec → retire +61'],
  ])('birth %s → retire %s (%s)', (birth, expected) => {
    expect(iso(computeRetirementDateFromBirth(d(birth)))).toBe(expected);
  });

  it('returns null when birthDate is null', () => {
    expect(computeRetirementDateFromBirth(null)).toBe(null);
  });

  it('returns null for impossible years (sanity-check)', () => {
    expect(computeRetirementDateFromBirth(new Date(Date.UTC(1850, 0, 1)))).toBe(null);
    expect(computeRetirementDateFromBirth(new Date(Date.UTC(2200, 0, 1)))).toBe(null);
  });
});
