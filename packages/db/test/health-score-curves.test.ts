// The upstream (health-score.v5.6) anchor points of each score curve. If you
// retune a curve in tuning.ts, update the expectations here to your values —
// this file is the worked example of what each curve does.

import { describe, expect, it } from 'vitest';

import {
  scoreCompetitionRatio,
  scoreFillRate,
  scoreFurtherStudyRate,
  scoreOnCurve,
  scoreRegistrationYield,
  scoreStudentFacultyRatio,
} from '../src/health-score/curves';

describe('scoreOnCurve', () => {
  const curve = [
    [0, 0],
    [1, 20],
    [10, 100],
  ] as const;
  it('holds the first score below the first point and the last at or above the last', () => {
    expect(scoreOnCurve(-5, curve)).toBe(0);
    expect(scoreOnCurve(10, curve)).toBe(100);
    expect(scoreOnCurve(50, curve)).toBe(100);
  });
  it('interpolates linearly inside a segment', () => {
    expect(scoreOnCurve(0.5, curve)).toBe(10);
    expect(scoreOnCurve(5.5, curve)).toBe(60);
  });
  it('rejects an empty curve', () => {
    expect(() => scoreOnCurve(1, [])).toThrow();
  });
});

describe('upstream curve anchors', () => {
  it('tcas_competition_ratio: 1× → 20, 2× → 40, 5× → 70, 10×+ → 100', () => {
    expect([0, 1, 2, 5, 10, 20].map(scoreCompetitionRatio)).toEqual([0, 20, 40, 70, 100, 100]);
  });
  it('tcas_fill_rate: half the seats filled → 100', () => {
    expect([0, 0.25, 0.5, 0.9].map(scoreFillRate)).toEqual([0, 50, 100, 100]);
  });
  it('tcas_registration_yield: 0.5 → 50, 0.85+ → 100', () => {
    expect([0, 0.25, 0.5, 0.85, 1].map(scoreRegistrationYield)).toEqual([0, 25, 50, 100, 100]);
  });
  it('student_faculty_ratio: CLINICAL band 6:1 → 100, 16:1 → 0', () => {
    expect([5, 6, 11, 16, 30].map((r) => scoreStudentFacultyRatio(r, 'CLINICAL'))).toEqual([100, 100, 50, 0, 0]);
  });
  it('further_study_rate: 0 → 50, 5-15% → 100, 30% → 70, floor 30', () => {
    expect(scoreFurtherStudyRate(0)).toBe(50);
    expect(scoreFurtherStudyRate(0.1)).toBe(100);
    expect(scoreFurtherStudyRate(0.3)).toBeCloseTo(70, 10);
    expect(scoreFurtherStudyRate(0.9)).toBe(30);
  });
});
