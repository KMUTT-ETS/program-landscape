import { describe, it, expect } from 'vitest';
import {
  TALENT_DEFAULT_THRESHOLD,
  TALENT_WINDOW_YEARS,
  classifyTalent,
  displayRating,
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

describe('splitPersonName', () => {
  it('splits a two-token Thai name', () => {
    expect(splitPersonName('สมชาย ใจดี')).toEqual({
      first: 'ศิริลักษณ์',
      last: 'อนันต์ณัฐศิริ',
    });
  });

  it('keeps token 1 as the first name and the rest as the surname', () => {
    expect(splitPersonName('สม ชาย ใจดี')).toEqual({ first: 'สม', last: 'ชาย ใจดี' });
  });

  it('puts a single token in the first name and leaves the surname blank', () => {
    expect(splitPersonName('มาลี')).toEqual({ first: 'มาลี', last: '' });
  });

  it('collapses stray whitespace', () => {
    expect(splitPersonName('  ประธาน   ฦาชา  ')).toEqual({
      first: 'ประธาน',
      last: 'ฦาชา',
    });
  });

  it('returns two blanks for an empty name', () => {
    expect(splitPersonName('')).toEqual({ first: '', last: '' });
    expect(splitPersonName('   ')).toEqual({ first: '', last: '' });
  });
});
