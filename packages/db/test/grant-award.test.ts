import { describe, expect, it } from 'vitest';
import {
  GRANT_AWARD_CAP_THB,
  GRANT_AWARD_FLOOR_THB,
  GRANT_AWARD_LABEL,
  GRANT_AWARD_MAX_POINTS,
  awardPoints,
  fiscalYearBe,
  grantWindow,
  withAward,
} from '../src/grant-award';

const at = (iso: string) => new Date(iso);

describe('fiscalYearBe', () => {
  it('starts a new Thai fiscal year on 1 October, Bangkok time', () => {
    expect(fiscalYearBe(at('2026-09-30T12:00:00+07:00'))).toBe(2569);
    expect(fiscalYearBe(at('2026-10-01T00:00:00+07:00'))).toBe(2570);
    // 30 Sep 18:00 UTC is already 1 Oct 01:00 in Bangkok.
    expect(fiscalYearBe(at('2026-09-30T18:00:00Z'))).toBe(2570);
    expect(fiscalYearBe(at('2026-01-15T00:00:00+07:00'))).toBe(2569);
  });
});

describe('grantWindow', () => {
  it('is the last three complete fiscal years', () => {
    expect(grantWindow(at('2026-10-03T09:00:00+07:00'))).toEqual({ fromFyBe: 2567, toFyBe: 2569 });
    expect(grantWindow(at('2026-09-29T09:00:00+07:00'))).toEqual({ fromFyBe: 2566, toFyBe: 2568 });
  });
});

describe('awardPoints', () => {
  it('uses the agreed anchors', () => {
    expect(GRANT_AWARD_LABEL).toBe('external_grant_award');
    expect(GRANT_AWARD_FLOOR_THB).toBe(100_000);
    expect(GRANT_AWARD_CAP_THB).toBe(3_000_000);
    expect(GRANT_AWARD_MAX_POINTS).toBe(10);
  });

  it('is 0 at or below the floor', () => {
    expect(awardPoints(0)).toBe(0);
    expect(awardPoints(50_000)).toBe(0);
    expect(awardPoints(100_000)).toBe(0);
  });

  it('follows the log curve between the anchors', () => {
    expect(awardPoints(300_000)).toBeCloseTo(3.23, 2);
    expect(awardPoints(1_000_000)).toBeCloseTo(6.77, 2);
  });

  it('caps at 10 from the cap upward', () => {
    expect(awardPoints(3_000_000)).toBeCloseTo(10, 10);
    expect(awardPoints(50_000_000)).toBe(10);
  });

  it('treats a non-finite input as no award', () => {
    expect(awardPoints(Number.NaN)).toBe(0);
    expect(awardPoints(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('withAward', () => {
  const base = { score: 61.4, dataCompletenessPct: 75, drivers: [] as Array<{ label: string; value: number | null; raw: unknown }> };

  it('adds the points to a non-null base and records the base', () => {
    const out = withAward(base, { label: GRANT_AWARD_LABEL, points: 6.2, raw: { staff: 4 } });
    expect(out.score).toBeCloseTo(67.6, 10);
    expect(out.award).toEqual({ label: GRANT_AWARD_LABEL, points: 6.2, baseScore: 61.4, raw: { staff: 4 } });
  });

  it('never changes data completeness or drivers', () => {
    const out = withAward(base, { label: GRANT_AWARD_LABEL, points: 10, raw: {} });
    expect(out.dataCompletenessPct).toBe(75);
    expect(out.drivers).toBe(base.drivers);
  });

  it('caps the score at 100', () => {
    const out = withAward({ ...base, score: 96 }, { label: GRANT_AWARD_LABEL, points: 10, raw: {} });
    expect(out.score).toBe(100);
  });

  it('leaves a null base null and reports no points', () => {
    const out = withAward({ ...base, score: null }, { label: GRANT_AWARD_LABEL, points: 7, raw: { staff: 3 } });
    expect(out.score).toBeNull();
    expect(out.award?.points).toBeNull();
    expect(out.award?.baseScore).toBeNull();
  });

  it('leaves the score unchanged when points are null (not synced)', () => {
    const out = withAward(base, { label: GRANT_AWARD_LABEL, points: null, raw: { reason: 'source-not-synced' } });
    expect(out.score).toBe(61.4);
    expect(out.award?.points).toBeNull();
    expect(out.award?.baseScore).toBe(61.4);
  });
});
