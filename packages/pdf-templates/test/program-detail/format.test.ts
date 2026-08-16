import { describe, expect, it } from 'vitest';

import { formatCohortChangePct } from '../../src/templates/program-detail/format';

// `cohortDeclinePct` = ((anchor - population) / anchor) * 100.
// POSITIVE means the cohort is shrinking; NEGATIVE means it is growing.
// Both are reachable — the anchor is the current year and a later year can
// exceed it — which is what the original formatting got wrong.
describe('formatCohortChangePct', () => {
  it('renders a shrinking cohort with a minus sign', () => {
    expect(formatCohortChangePct(12.34)).toBe('−12.3%');
    expect(formatCohortChangePct(1)).toBe('−1.0%');
  });

  // The regression this test exists for: the old code collapsed every
  // non-positive value to '0.0%', so real cohort GROWTH was reported as flat
  // — understating in exactly the direction that matters when the number is
  // used to argue demographic pressure on a program.
  it('renders a growing cohort as growth, not as flat', () => {
    expect(formatCohortChangePct(-2.3)).toBe('+2.3%');
    expect(formatCohortChangePct(-15)).toBe('+15.0%');
  });

  it('renders a genuinely flat cohort as zero', () => {
    expect(formatCohortChangePct(0)).toBe('0.0%');
  });

  // A second site prefixed '−' unconditionally, so a negative input rendered
  // as the double-negative '−-2.3%'. Nothing may emit two signs.
  it('never emits two signs', () => {
    for (const v of [-5, -0.5, 0, 0.5, 5]) {
      expect(formatCohortChangePct(v)).not.toMatch(/[−+-]{2}/);
    }
  });

  it('rounds before choosing a sign, so a hair below zero is not "+0.0%"', () => {
    expect(formatCohortChangePct(-0.04)).toBe('0.0%');
    expect(formatCohortChangePct(0.04)).toBe('0.0%');
  });

  it('returns an em dash rather than "NaN%" for non-finite input', () => {
    expect(formatCohortChangePct(Number.NaN)).toBe('—');
    expect(formatCohortChangePct(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
