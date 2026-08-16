import { describe, expect, it } from 'vitest';

import {
  formatCohortChangePct,
  formatCompactNumber,
  formatCount,
  formatPct,
  formatScore,
} from '../../src/templates/program-detail/format';

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

// The shared render-time formatters every section reuses from here on —
// health/lifecycle/AI-readiness dimension scores, percentages, counts.
// The rule that matters for all three: null is an em dash, never '0' and
// never the literal string 'null' — a null score means the methodology
// deliberately excluded that dimension from the average (see the
// null-handling rule at the top of schema.ts), and this document is used
// to close programs, so a substituted 0 asserts a measurement that was
// never taken.
describe('formatScore', () => {
  it('renders a whole-number score', () => {
    expect(formatScore(72)).toBe('72');
  });

  it('rounds a fractional score', () => {
    expect(formatScore(71.6)).toBe('72');
    expect(formatScore(71.4)).toBe('71');
  });

  it('renders an em dash for null, never "0" or the literal "null"', () => {
    expect(formatScore(null)).toBe('—');
  });

  it('renders an em dash for non-finite input rather than "NaN"', () => {
    expect(formatScore(Number.NaN)).toBe('—');
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('renders a real zero as "0", not an em dash — a measured zero is data', () => {
    expect(formatScore(0)).toBe('0');
  });
});

describe('formatPct', () => {
  it('renders a whole-number percentage by default', () => {
    expect(formatPct(45.6)).toBe('46%');
  });

  it('honours an explicit decimal-place count', () => {
    expect(formatPct(45.649, 1)).toBe('45.6%');
  });

  it('renders an em dash for null, never "0%" or the literal "null"', () => {
    expect(formatPct(null)).toBe('—');
  });

  it('renders an em dash for non-finite input', () => {
    expect(formatPct(Number.NaN)).toBe('—');
  });

  it('renders a real zero percent as "0%", not an em dash', () => {
    expect(formatPct(0)).toBe('0%');
  });
});

describe('formatCount', () => {
  it('renders a thousands-separated integer', () => {
    expect(formatCount(12345)).toBe('12,345');
  });

  it('rounds a fractional count', () => {
    expect(formatCount(1234.6)).toBe('1,235');
  });

  it('renders an em dash for null, never "0" or the literal "null"', () => {
    expect(formatCount(null)).toBe('—');
  });

  it('renders an em dash for non-finite input', () => {
    expect(formatCount(Number.NaN)).toBe('—');
  });

  it('renders a real zero count as "0", not an em dash', () => {
    expect(formatCount(0)).toBe('0');
  });
});

// The regression this exists for: LineTrend rendered raw cohort-population
// ticks as '3500000' — unreadable on a printed axis. Values here are drawn
// from real fixture magnitudes (demographic.projections[].cohortPopulation).
describe('formatCompactNumber', () => {
  it('abbreviates millions to two decimal places', () => {
    expect(formatCompactNumber(1_250_000)).toBe('1.25M');
    expect(formatCompactNumber(3_982_000)).toBe('3.98M');
  });

  it('abbreviates thousands to one decimal place', () => {
    expect(formatCompactNumber(12_400)).toBe('12.4K');
  });

  it('renders sub-thousand values as a plain rounded integer', () => {
    expect(formatCompactNumber(940)).toBe('940');
  });

  it('drops fake trailing precision on a round number', () => {
    expect(formatCompactNumber(2_000_000)).toBe('2M');
    expect(formatCompactNumber(5_000)).toBe('5K');
  });

  it('renders an em dash for null, never "0" or the literal "null"', () => {
    expect(formatCompactNumber(null)).toBe('—');
  });

  it('renders an em dash for non-finite input rather than "NaN"', () => {
    expect(formatCompactNumber(Number.NaN)).toBe('—');
  });

  it('renders a real zero as "0", not an em dash', () => {
    expect(formatCompactNumber(0)).toBe('0');
  });
});
