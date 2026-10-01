import { describe, expect, it } from 'vitest';
import { latestEducationSnapshot } from '../src/staff-profile/education-snapshot';

const row = (academicYear: string | null, semester: string | null, gradCurriculum: string) => ({
  academicYear,
  semester,
  gradCurriculum,
});

describe('latestEducationSnapshot', () => {
  // DS2003 is a per-term staff report and the connector keeps every term as
  // history, so one person's degrees recur once per term loaded.
  it('keeps only the most recent term a person appears in', () => {
    const rows = [
      row('2568', '2', 'B.Sc.'),
      row('2569', '1', 'B.Sc.'),
      row('2568', '2', 'Ph.D.'),
      row('2569', '1', 'Ph.D.'),
    ];
    expect(latestEducationSnapshot(rows)).toEqual([row('2569', '1', 'B.Sc.'), row('2569', '1', 'Ph.D.')]);
  });

  it('orders terms numerically, semester within year', () => {
    const rows = [row('2569', '1', 'a'), row('2568', '3', 'b'), row('2569', '2', 'c')];
    expect(latestEducationSnapshot(rows)).toEqual([row('2569', '2', 'c')]);
  });

  it("uses the person's own latest term, even if it is not the newest term loaded", () => {
    // Someone who left after 2568/2 has no 2569/1 rows; their 2568/2 rows stand.
    const rows = [row('2568', '2', 'M.N.S.')];
    expect(latestEducationSnapshot(rows)).toEqual(rows);
  });

  it('leaves repeats within one term alone — those are the source data', () => {
    const rows = [row('2569', '1', 'B.Sc.'), row('2569', '1', 'B.Sc.')];
    expect(latestEducationSnapshot(rows)).toHaveLength(2);
  });

  it('treats a missing term as older than any stated one, and keeps all rows when none is stated', () => {
    expect(latestEducationSnapshot([row(null, null, 'x'), row('2569', '1', 'y')])).toEqual([row('2569', '1', 'y')]);
    const undated = [row(null, null, 'x'), row(null, null, 'y')];
    expect(latestEducationSnapshot(undated)).toEqual(undated);
  });

  it('returns an empty list unchanged', () => {
    expect(latestEducationSnapshot([])).toEqual([]);
  });
});
