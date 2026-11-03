import { describe, expect, it } from 'vitest';
import { admittedCount, publicTcasTotals } from '../src/public-tcas-basis';

const row = (code: string, quota: number, applicants: number, p1 = 0, p2 = 0) => ({
  tcasCourseCode: code, quota, applicants, admittedPass1: p1, admittedPass2: p2,
});

describe('publicTcasTotals', () => {
  it('counts a course code once when 3.1 and 3.2 repeat it', () => {
    const t = publicTcasTotals([row('A', 33, 455), row('A', 33, 455, 33, 33)]);
    expect(t).toMatchObject({ quota: 33, applicants: 455, admitted: 33, courses: 1 });
  });
  it('sums distinct course codes', () => {
    const t = publicTcasTotals([row('A', 20, 80, 5), row('B', 10, 20, 0, 7)]);
    expect(t).toMatchObject({ quota: 30, applicants: 100, admitted: 12, courses: 2 });
  });
  it('is null with no quota', () => {
    expect(publicTcasTotals([])).toBeNull();
    expect(publicTcasTotals([row('A', 0, 5)])).toBeNull();
  });
  it('flags a year with no admitted counts as unpublished', () => {
    expect(publicTcasTotals([row('A', 40, 200)])?.admittedPublished).toBe(false);
    expect(publicTcasTotals([row('A', 40, 200, 3)])?.admittedPublished).toBe(true);
  });
  it('does not add pass2 to pass1', () => {
    expect(admittedCount(33, 33)).toBe(33);
  });
});
