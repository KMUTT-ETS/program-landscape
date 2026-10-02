import { describe, expect, it } from 'vitest';
import {
  GRANT_ENGAGEMENT_TARGET,
  engagementScore,
  fiscalYearBe,
  grantWindow,
  greenHistoryGate,
} from '../src/grant-engagement';

const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

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
    expect(grantWindow(at('2026-10-02T09:00:00+07:00'))).toEqual({ fromFyBe: 2567, toFyBe: 2569 });
    expect(grantWindow(at('2026-09-29T09:00:00+07:00'))).toEqual({ fromFyBe: 2566, toFyBe: 2568 });
  });
});

describe('engagementScore', () => {
  it('scores the funded share linearly against a 60 % target', () => {
    expect(GRANT_ENGAGEMENT_TARGET).toBe(0.6);
    expect(engagementScore(0, 10)).toBe(0);
    expect(engagementScore(36, 100)).toBeCloseTo(60, 5);
    expect(engagementScore(6, 10)).toBe(100);
    expect(engagementScore(9, 10)).toBe(100);
  });

  it('is null when there are no staff', () => {
    expect(engagementScore(0, 0)).toBeNull();
  });
});

describe('greenHistoryGate', () => {
  const NOW = at('2026-11-15T12:00:00+07:00');
  const daily = (days: number, skip: number[] = []) =>
    Array.from({ length: days }, (_, i) => new Date(NOW.getTime() - (i + 0.2) * DAY)).filter((_, i) => !skip.includes(i));

  it('is closed as not-synced with no successful run', () => {
    expect(greenHistoryGate([], NOW)).toEqual({ open: false, reason: 'source-not-synced' });
  });

  it('is closed as stale when the latest success is older than 72 hours', () => {
    const runs = daily(60).map((d) => new Date(d.getTime() - 4 * DAY));
    const g = greenHistoryGate(runs, NOW);
    expect(g.open).toBe(false);
    if (!g.open) expect(g.reason).toBe('source-stale');
  });

  it('is closed while history is under 30 days, reporting progress', () => {
    const g = greenHistoryGate(daily(12), NOW);
    expect(g).toMatchObject({ open: false, reason: 'awaiting-green-history', daysOfHistory: 11 });
  });

  it('is closed when fewer than 25 of the last 30 days had a success', () => {
    const g = greenHistoryGate(daily(60, [1, 3, 5, 7, 9, 11]), NOW);
    expect(g).toMatchObject({ open: false, reason: 'awaiting-green-history', successfulDaysLast30: 24 });
  });

  it('opens with 30+ days of history, 25+ of the last 30 days green, and a recent success', () => {
    const g = greenHistoryGate(daily(45, [2, 4, 6]), NOW);
    expect(g.open).toBe(true);
    if (g.open) expect(g.successfulDaysLast30).toBe(27);
  });

  it('counts several runs on one Bangkok day as one day', () => {
    const runs = [...daily(40), ...daily(40).map((d) => new Date(d.getTime() + 3_600_000))];
    const g = greenHistoryGate(runs, NOW);
    expect(g.open).toBe(true);
    if (g.open) expect(g.successfulDaysLast30).toBe(30);
  });
});
