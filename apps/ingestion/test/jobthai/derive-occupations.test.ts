import { describe, expect, it } from 'vitest';

import { occupationCode, groupPostingsIntoOccupations } from '../../src/jobthai/derive-occupations';

describe('occupationCode', () => {
  it('is namespaced so it cannot collide with a future ISCO-08 code', () => {
    expect(occupationCode('งานบัญชี', 'งานบัญชีทั่วไป')).toMatch(/^jobthai:/);
  });

  it('is stable across calls for the same pair', () => {
    expect(occupationCode('งานบัญชี', 'งานบัญชีทั่วไป')).toBe(occupationCode('งานบัญชี', 'งานบัญชีทั่วไป'));
  });

  it('distinguishes two subcategories under one category', () => {
    expect(occupationCode('งานบัญชี', 'งานบัญชีทั่วไป')).not.toBe(occupationCode('งานบัญชี', 'งานตรวจสอบภายใน'));
  });

  it('distinguishes the same subcategory under two categories', () => {
    // The real corpus does this: 240 distinct pairs over 173 subcategories.
    expect(occupationCode('งานขาย', 'งานธุรการทั่วไป')).not.toBe(occupationCode('งานธุรการ', 'งานธุรการทั่วไป'));
  });

  it('normalises surrounding and repeated whitespace', () => {
    // Observed in the source: "Digital Marketing " with a trailing space.
    expect(occupationCode(' งานบัญชี ', 'งานบัญชี  ทั่วไป')).toBe(occupationCode('งานบัญชี', 'งานบัญชี ทั่วไป'));
  });
});

describe('groupPostingsIntoOccupations', () => {
  const postings = [
    { jobCategory: 'งานบัญชี', jobSubcategory: 'งานบัญชีทั่วไป' },
    { jobCategory: 'งานบัญชี', jobSubcategory: 'งานบัญชีทั่วไป' },
    { jobCategory: 'งานบัญชี', jobSubcategory: 'งานตรวจสอบภายใน' },
  ];

  it('produces one occupation per distinct pair with the right counts', () => {
    const out = groupPostingsIntoOccupations(postings);
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.subcategory === 'งานบัญชีทั่วไป')!.postingCount).toBe(2);
    expect(out.find((o) => o.subcategory === 'งานตรวจสอบภายใน')!.postingCount).toBe(1);
  });

  it('is idempotent — grouping twice yields the same codes', () => {
    const a = groupPostingsIntoOccupations(postings).map((o) => o.code).sort();
    const b = groupPostingsIntoOccupations(postings).map((o) => o.code).sort();
    expect(a).toEqual(b);
  });

  it('skips a posting missing either column rather than inventing a placeholder', () => {
    const out = groupPostingsIntoOccupations([
      ...postings,
      { jobCategory: null, jobSubcategory: 'งานบัญชีทั่วไป' },
      { jobCategory: 'งานบัญชี', jobSubcategory: '' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.reduce((s, o) => s + o.postingCount, 0)).toBe(3);
  });

  it('orders by posting count so the biggest occupations lead', () => {
    const out = groupPostingsIntoOccupations(postings);
    expect(out[0]!.postingCount).toBeGreaterThanOrEqual(out[1]!.postingCount);
  });
});
