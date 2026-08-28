import { describe, it, expect } from 'vitest';
import { DQ_ELIGIBLE_LEVEL, dqDriverScore, dqIsEligible } from '../src/student-dq';

describe('dqDriverScore — anchored on the pass mark, not on the observed spread', () => {
  it('puts the pass mark at the middle of the scale', () => {
    // The whole point of the anchor: 50 means "the average student just passes".
    expect(dqDriverScore(70)).toBe(50);
  });

  it('maps the working range 70-90 across the upper half', () => {
    expect(dqDriverScore(80)).toBe(75);
    expect(dqDriverScore(90)).toBe(100);
  });

  it('maps below-pass scores across the lower half', () => {
    expect(dqDriverScore(50)).toBe(0);
    expect(dqDriverScore(60)).toBe(25);
  });

  it('clamps rather than extrapolating outside the band', () => {
    expect(dqDriverScore(95)).toBe(100);
    expect(dqDriverScore(100)).toBe(100);
    expect(dqDriverScore(20)).toBe(0);
    expect(dqDriverScore(0)).toBe(0);
  });

  it('differentiates the real programme range', () => {
    // Measured: programmes span 75.1 (weakest) to 90.7 (strongest),
    // median 85.0. A raw pass-through would put them all in the top
    // quarter; the band spreads them from ~63 to 100.
    expect(dqDriverScore(75.1)).toBeCloseTo(62.75, 2);
    expect(dqDriverScore(85.0)).toBeCloseTo(87.5, 2);
    expect(dqDriverScore(90.7)).toBe(100);
  });

  it('returns null for a null mean — never 0', () => {
    // A programme with no DQ evidence is not a programme that scored
    // zero. The health score excludes nulls from its average.
    expect(dqDriverScore(null)).toBeNull();
  });
});

describe('dqIsEligible', () => {
  it('accepts a bachelor programme at exactly the floor', () => {
    expect(dqIsEligible('BACHELOR', 6)).toBe(true);
  });

  it('rejects below the floor', () => {
    expect(dqIsEligible('BACHELOR', 5)).toBe(false);
    expect(dqIsEligible('BACHELOR', 4)).toBe(false);
    expect(dqIsEligible('BACHELOR', 0)).toBe(false);
  });

  it('rejects every non-bachelor level whatever its data', () => {
    // The 30 graduate programmes holding DQ rows total 10 students —
    // undergraduates who later enrolled, caught by the current-enrolment
    // join. Scoring them would report the join, not the programme.
    for (const level of ['MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']) {
      expect(dqIsEligible(level, 500)).toBe(false);
    }
    expect(DQ_ELIGIBLE_LEVEL).toBe('BACHELOR');
  });
});
