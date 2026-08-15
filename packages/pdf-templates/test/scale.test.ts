import { describe, expect, it } from 'vitest';
import { linear, niceTicks, pt } from '../src/charts/scale';

describe('pt', () => {
  // Anchor on exact inch fractions — these are unambiguous and independent
  // of any rounded constant.
  it('converts points to millimetres', () => {
    expect(pt(72)).toBeCloseTo(25.4, 10);  // 1 inch
    expect(pt(36)).toBeCloseTo(12.7, 10);  // 1/2 inch
    expect(pt(0)).toBe(0);
  });

  it('gives the Cabinet body size in mm', () => {
    // 16 × 25.4/72 = 5.64444…  NOT 5.6448 (that is 16 × the rounded 0.3528).
    expect(pt(16)).toBeCloseTo(5.6444, 3);
  });
});

describe('linear', () => {
  it('maps a domain onto a range', () => {
    const s = linear([0, 100], [0, 180]);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(90);
    expect(s(100)).toBe(180);
  });

  it('supports an inverted range, as SVG y-axes need', () => {
    const s = linear([0, 10], [60, 0]);
    expect(s(0)).toBe(60);
    expect(s(10)).toBe(0);
  });

  // A single-valued series must not divide by zero and produce NaN —
  // a NaN in a path attribute silently renders nothing at all.
  it('collapses a zero-width domain onto the range start', () => {
    const s = linear([5, 5], [0, 100]);
    expect(s(5)).toBe(0);
    expect(Number.isNaN(s(5))).toBe(false);
  });
});

describe('niceTicks', () => {
  it('produces round numbers', () => {
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('handles a non-zero floor', () => {
    expect(niceTicks(12, 47)).toEqual([20, 30, 40]);
  });

  it('returns a single tick when min equals max', () => {
    expect(niceTicks(7, 7)).toEqual([7]);
  });

  it('returns nothing for non-finite input rather than looping forever', () => {
    expect(niceTicks(0, Number.NaN)).toEqual([]);
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe('niceTicks — hardening', () => {
  it('returns nothing for a non-positive or non-finite count', () => {
    expect(niceTicks(0, 100, 0)).toEqual([]);
    expect(niceTicks(0, 100, -5)).toEqual([]);
    expect(niceTicks(0, 100, Number.NaN)).toEqual([]);
  });

  it('does not drop the final tick to float drift', () => {
    // 0.1-sized steps are the classic accumulation trap.
    expect(niceTicks(0, 1, 10)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(niceTicks(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it('stays within bounds — no tick beyond max', () => {
    for (const [lo, hi] of [[0, 100], [12, 47], [-30, 30], [0, 1], [3, 3.7]] as const) {
      for (const t of niceTicks(lo, hi)) {
        expect(t).toBeGreaterThanOrEqual(lo);
        expect(t).toBeLessThanOrEqual(hi);
      }
    }
  });
});
