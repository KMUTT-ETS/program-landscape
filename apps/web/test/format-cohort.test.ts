import { describe, expect, it } from 'vitest';

// Relative import rather than the '@/' alias — vitest has no config in this
// app and would not resolve the tsconfig path mapping.
import {
  contractionMeterWidth,
  formatCohortChangePct,
} from '../src/lib/format-cohort';

// `cohortDeclinePct` = ((anchor - population) / anchor) * 100.
// POSITIVE = the cohort is shrinking. NEGATIVE = it is growing. Both are
// reachable: the anchor is the current year and a later year can exceed it.
describe('formatCohortChangePct', () => {
  it('renders a shrinking cohort with a minus sign', () => {
    expect(formatCohortChangePct(12.34)).toBe('−12.3%');
  });

  // The regression. Four separate web sites formatted this by hand and every
  // one lost growth: two collapsed it to '0.0%', one prefixed '−'
  // unconditionally (giving '−-2.3%'), and one hid it behind `> 0` so it
  // rendered nothing at all.
  it('renders a growing cohort as growth', () => {
    expect(formatCohortChangePct(-2.3)).toBe('+2.3%');
  });

  it('renders a flat cohort as zero', () => {
    expect(formatCohortChangePct(0)).toBe('0.0%');
  });

  it('never emits two signs', () => {
    for (const v of [-5, -0.5, 0, 0.5, 5]) {
      expect(formatCohortChangePct(v)).not.toMatch(/[−+-]{2}/);
    }
  });

  it('rounds before choosing a sign', () => {
    expect(formatCohortChangePct(-0.04)).toBe('0.0%');
  });

  it('returns an em dash for non-finite input rather than "NaN%"', () => {
    expect(formatCohortChangePct(Number.NaN)).toBe('—');
  });

  // Must stay identical to apps/api/src/programs/program-detail-data.ts's
  // copy. They are duplicated deliberately — @kku/shared has no exports map,
  // so importing it from a client component pulls a barrel that uses
  // node:crypto and breaks the build.
  it('agrees with the API copy on the cases that matter', () => {
    expect([
      formatCohortChangePct(12.34),
      formatCohortChangePct(-2.3),
      formatCohortChangePct(0),
      formatCohortChangePct(Number.NaN),
    ]).toEqual(['−12.3%', '+2.3%', '0.0%', '—']);
  });
});

describe('contractionMeterWidth', () => {
  it('clamps to the meter range', () => {
    expect(contractionMeterWidth(42)).toBe('42%');
    expect(contractionMeterWidth(140)).toBe('100%');
  });

  // A growing cohort produced a NEGATIVE css width, which is invalid — the
  // bar collapsed silently instead of reading as "no contraction".
  it('never returns a negative width', () => {
    expect(contractionMeterWidth(-8)).toBe('0%');
    expect(contractionMeterWidth(-0.1)).toBe('0%');
  });

  it('survives non-finite input', () => {
    expect(contractionMeterWidth(Number.NaN)).toBe('0%');
  });
});
