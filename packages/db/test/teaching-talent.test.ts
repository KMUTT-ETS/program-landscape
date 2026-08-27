import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  TALENT_DEFAULT_THRESHOLD,
  TALENT_WINDOW_YEARS,
  classifyTalent,
  displayRating,
  foldYearCells,
  overallFromYears,
  resolveTalentYears,
  splitPersonName,
} from '../src/teaching-talent';

describe('resolveTalentYears', () => {
  it('takes the three most recent completed years, ascending', () => {
    // Current academic year is BE 2569, so 2568 is the newest completed one.
    expect(resolveTalentYears([2569, 2568, 2567, 2566, 2565], 2569)).toEqual([
      2566, 2567, 2568,
    ]);
  });

  it('excludes the in-progress year even when it already has data', () => {
    expect(resolveTalentYears([2569, 2568, 2567, 2566], 2569)).not.toContain(2569);
  });

  it('skips a gap rather than inventing a year', () => {
    // 2566 never landed; the window reaches further back instead.
    expect(resolveTalentYears([2568, 2567, 2565], 2569)).toEqual([2565, 2567, 2568]);
  });

  it('returns fewer than three years when the data is thin', () => {
    expect(resolveTalentYears([2568, 2567], 2569)).toEqual([2567, 2568]);
    expect(resolveTalentYears([], 2569)).toEqual([]);
  });

  it('tolerates unsorted input', () => {
    expect(resolveTalentYears([2566, 2569, 2568, 2567], 2569)).toEqual([
      2566, 2567, 2568,
    ]);
  });

  it('exposes the window size it enforces', () => {
    expect(TALENT_WINDOW_YEARS).toBe(3);
    expect(resolveTalentYears([2568, 2567, 2566, 2565], 2569)).toHaveLength(3);
  });
});

describe('classifyTalent', () => {
  const years = [2566, 2567, 2568];

  it('badges an instructor above the bar in all three years', () => {
    const r = classifyTalent(
      { '2566': 4.31, '2567': 4.52, '2568': 4.48 },
      years,
      TALENT_DEFAULT_THRESHOLD,
    );
    expect(r.isTalent).toBe(true);
    expect(r.yearsWithData).toBe(3);
    expect(r.minYearRating).toBe(4.31);
  });

  it('refuses when one year is below the bar', () => {
    const r = classifyTalent(
      { '2566': 4.9, '2567': 3.8, '2568': 4.7 },
      years,
      TALENT_DEFAULT_THRESHOLD,
    );
    expect(r.isTalent).toBe(false);
    expect(r.minYearRating).toBe(3.8);
  });

  it('refuses when a year is missing, however high the others are', () => {
    const r = classifyTalent({ '2567': 4.9, '2568': 4.95 }, years, TALENT_DEFAULT_THRESHOLD);
    expect(r.isTalent).toBe(false);
    expect(r.yearsWithData).toBe(2);
  });

  it('treats a null year as missing', () => {
    const r = classifyTalent(
      { '2566': null, '2567': 4.9, '2568': 4.95 },
      years,
      TALENT_DEFAULT_THRESHOLD,
    );
    expect(r.isTalent).toBe(false);
    expect(r.yearsWithData).toBe(2);
  });

  it('compares on the displayed 2-decimal value, so 3.996 counts as 4.00', () => {
    // The UI prints 4.00 for this instructor. A missing badge next to a
    // printed 4.00 is indefensible in front of a dean.
    const r = classifyTalent(
      { '2566': 3.996, '2567': 4.5, '2568': 4.5 },
      years,
      4.0,
    );
    expect(r.isTalent).toBe(true);
  });

  it('rejects 3.994, which displays as 3.99', () => {
    const r = classifyTalent(
      { '2566': 3.994, '2567': 4.5, '2568': 4.5 },
      years,
      4.0,
    );
    expect(r.isTalent).toBe(false);
  });

  it('respects a higher threshold', () => {
    const scores = { '2566': 4.31, '2567': 4.52, '2568': 4.48 };
    expect(classifyTalent(scores, years, 4.25).isTalent).toBe(true);
    expect(classifyTalent(scores, years, 4.5).isTalent).toBe(false);
  });

  it('never badges anyone when the window itself is short', () => {
    const r = classifyTalent({ '2567': 4.9, '2568': 4.9 }, [2567, 2568], 4.0);
    expect(r.isTalent).toBe(false);
    expect(r.yearsWithData).toBe(2);
  });

  it('returns a null minimum when there is no data at all', () => {
    const r = classifyTalent({}, years, 4.0);
    expect(r.minYearRating).toBeNull();
    expect(r.isTalent).toBe(false);
  });

  it('does not let a duplicated year forge a complete window', () => {
    const r = classifyTalent({ '2566': 4.9, '2568': 4.9 }, [2566, 2566, 2568], 4.0);
    expect(r.isTalent).toBe(false);
    expect(r.yearsWithData).toBe(2);
  });
});

describe('displayRating', () => {
  it('agrees with the toFixed(2) the UI prints, including at 4.005', () => {
    for (const v of [4.005, 4.145, 3.995, 4.245, 1.005]) {
      expect(displayRating(v).toFixed(2)).toBe(v.toFixed(2));
    }
  });
});

// SYNTHETIC DATA — and it must stay synthetic. The names below are invented and
// follow the repo-wide placeholder convention (สมชาย ใจดี / สมหญิง แสงทอง / มาลี,
// <placeholder>@kku.ac.th). A real name next to a teaching-evaluation score is
// personal data under PDPA and a performance record besides; never paste real
// rows in here, not even temporarily to reproduce a bug.
describe('splitPersonName', () => {
  it('splits a two-token Thai name', () => {
    expect(splitPersonName('สมชาย ใจดี')).toEqual({
      first: 'สมชาย',
      last: 'ใจดี',
    });
  });

  it('keeps token 1 as the first name and the rest as the surname', () => {
    expect(splitPersonName('สม ชาย ใจดี')).toEqual({ first: 'สม', last: 'ชาย ใจดี' });
  });

  it('puts a single token in the first name and leaves the surname blank', () => {
    expect(splitPersonName('มาลี')).toEqual({ first: 'มาลี', last: '' });
  });

  it('collapses stray whitespace', () => {
    expect(splitPersonName('  สมหญิง   แสงทอง  ')).toEqual({
      first: 'สมหญิง',
      last: 'แสงทอง',
    });
  });

  it('returns two blanks for an empty name', () => {
    expect(splitPersonName('')).toEqual({ first: '', last: '' });
    expect(splitPersonName('   ')).toEqual({ first: '', last: '' });
  });
});

describe('population guard', () => {
  // This is a source-level assertion on purpose. The realistic failure
  // mode is a future contributor "reusing" the /staff/teaching pivot for
  // consistency — which joins program_courses and would silently delete
  // 565 of 1,695 evaluated instructors (33%) from a talent list.
  const source = readFileSync(
    join(__dirname, '..', 'src', 'teaching-talent.ts'),
    'utf8',
  );
  // Strip comments so the explanatory prose above (which names the tables)
  // does not trip the assertion.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('never joins program_courses — that join drops a third of the roster', () => {
    expect(code).not.toContain('program_courses');
  });

  it('never joins program_faculties — curriculum mapping must not gate the roster', () => {
    expect(code).not.toContain('program_faculties');
  });

  it('gates on real data only', () => {
    expect(code).toContain('ds.mocked = false');
  });
});

describe('foldYearCells', () => {
  it('combines two rows for one person-year respondent-weighted, not as a naive mean', () => {
    // Same teacher, same year, two source rows (classes owned by two
    // faculties). The naive mean of 4.0 and 5.0 is 4.5; the honest answer
    // is 4.9, because 90 of the 100 respondents gave the 5.0.
    const folded = foldYearCells([
      { key: 'somchai@kku.ac.th', year: 2568, ratingAvg: 4.0, respondents: 10 },
      { key: 'somchai@kku.ac.th', year: 2568, ratingAvg: 5.0, respondents: 90 },
    ]);
    const entry = folded.get('somchai@kku.ac.th');
    expect(entry).toBeDefined();
    expect(entry!.byYear['2568']!.ratingAvg).toBeCloseTo(4.9, 10);
    expect(entry!.byYear['2568']!.respondentCount).toBe(100);
    expect(entry!.totalRespondents).toBe(100);
  });

  it('keeps separate people and separate years apart', () => {
    const folded = foldYearCells([
      { key: 'a', year: 2567, ratingAvg: 3.0, respondents: 5 },
      { key: 'a', year: 2568, ratingAvg: 4.0, respondents: 7 },
      { key: 'b', year: 2568, ratingAvg: 5.0, respondents: 9 },
    ]);
    expect(folded.size).toBe(2);
    expect(folded.get('a')!.byYear['2567']!.ratingAvg).toBe(3.0);
    expect(folded.get('a')!.byYear['2568']!.ratingAvg).toBe(4.0);
    expect(folded.get('a')!.totalRespondents).toBe(12);
    expect(folded.get('b')!.byYear['2568']!.ratingAvg).toBe(5.0);
  });

  it('carries a null rating through and lets a later real rating replace it', () => {
    // A null cell holds no weight, so it must not drag the merged value.
    const folded = foldYearCells([
      { key: 'a', year: 2568, ratingAvg: null, respondents: 0 },
      { key: 'a', year: 2568, ratingAvg: 4.5, respondents: 8 },
    ]);
    expect(folded.get('a')!.byYear['2568']!.ratingAvg).toBe(4.5);
    expect(folded.get('a')!.byYear['2568']!.respondentCount).toBe(8);
  });
});

describe('overallFromYears', () => {
  it('equals the row-level weighted mean across the window', () => {
    // (3.0*10 + 4.0*20 + 5.0*70) / 100 = 4.6 — the same number you get by
    // weighting the underlying rows directly, which is the claim the
    // function's comment makes.
    const overall = overallFromYears({
      '2566': { ratingAvg: 3.0, respondentCount: 10 },
      '2567': { ratingAvg: 4.0, respondentCount: 20 },
      '2568': { ratingAvg: 5.0, respondentCount: 70 },
    });
    expect(overall).toBeCloseTo(4.6, 10);
  });

  it('ignores null years rather than counting them as zero', () => {
    const overall = overallFromYears({
      '2567': { ratingAvg: null, respondentCount: 40 },
      '2568': { ratingAvg: 4.25, respondentCount: 10 },
    });
    expect(overall).toBe(4.25);
  });

  it('returns null when no year carries a rating', () => {
    expect(overallFromYears({})).toBeNull();
    expect(
      overallFromYears({ '2568': { ratingAvg: null, respondentCount: 12 } }),
    ).toBeNull();
  });
});
