import { describe, expect, it } from 'vitest';
import { healthTone, linearPos, logPos, logTicks, meanOf, median } from '../src/landscape-atlas/scales';

describe('linearPos', () => {
  it('maps the domain to 0–100 and clamps outside it', () => {
    expect(linearPos(5, 0, 10)).toBe(50);
    expect(linearPos(-1, 0, 10)).toBe(0);
    expect(linearPos(11, 0, 10)).toBe(100);
  });
  it('returns 50 for a degenerate domain', () => {
    expect(linearPos(3, 4, 4)).toBe(50);
  });
});

describe('logPos', () => {
  it('maps geometric midpoints to 50', () => {
    expect(logPos(10, 1, 100)).toBeCloseTo(50, 6);
  });
  it('puts zero and negative values at 0 instead of throwing', () => {
    expect(logPos(0, 1, 100)).toBe(0);
    expect(logPos(-3, 1, 100)).toBe(0);
  });
});

describe('logTicks', () => {
  it('emits 1-2-5 ticks inside the domain only', () => {
    const t = logTicks(0.5, 30, (v) => String(v));
    expect(t.map((x) => x.label)).toEqual(['0.5', '1', '2', '5', '10', '20']);
  });
  it('is empty for an invalid domain', () => {
    expect(logTicks(0, 10, String)).toEqual([]);
  });
});

describe('healthTone', () => {
  it('uses the health-score bands: <40 / 40–65 / ≥65, null neutral', () => {
    expect(healthTone(null)).toBe('neutral');
    expect(healthTone(39.9)).toBe('negative');
    expect(healthTone(40)).toBe('warning');
    expect(healthTone(64.9)).toBe('warning');
    expect(healthTone(65)).toBe('positive');
  });
  it('healthTone follows the shared zones at the boundaries', () => {
    expect(healthTone(39.99)).toBe('negative');
    expect(healthTone(40)).toBe('warning');
    expect(healthTone(64.99)).toBe('warning');
    expect(healthTone(65)).toBe('positive');
    expect(healthTone(null)).toBe('neutral');
    expect(healthTone(Number.NaN)).toBe('neutral');
  });
});

describe('median / meanOf', () => {
  it('median handles empty, odd and even lists', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('meanOf ignores nulls and returns null when nothing is present', () => {
    expect(meanOf([null, null])).toBeNull();
    expect(meanOf([10, null, 20])).toBe(15);
  });
});
