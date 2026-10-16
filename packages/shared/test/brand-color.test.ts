import { describe, expect, it } from 'vitest';
import { clampToGamut, contrastRatio, formatOklch, hexToOklch, oklchToHex } from '../src/brand';

describe('hexToOklch', () => {
  it('white and black sit at the ends of lightness with no chroma', () => {
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3);
    expect(hexToOklch('#ffffff').c).toBeLessThan(0.0005);
    expect(hexToOklch('#000000').l).toBeCloseTo(0, 3);
  });

  it('matches the published OKLCH of pure sRGB red', () => {
    const red = hexToOklch('#ff0000');
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
  });

  it('rejects malformed input', () => {
    expect(() => hexToOklch('red')).toThrow();
    expect(() => hexToOklch('#ff00')).toThrow();
  });
});

describe('oklchToHex / clampToGamut', () => {
  it('round-trips an in-gamut colour', () => {
    expect(oklchToHex(hexToOklch('#3a7bd5')).toLowerCase()).toBe('#3a7bd5');
  });

  it('reduces chroma, never lightness or hue, to reach the sRGB gamut', () => {
    const out = clampToGamut({ l: 0.9, c: 0.4, h: 140 });
    expect(out.l).toBe(0.9);
    expect(out.h).toBe(140);
    expect(out.c).toBeLessThan(0.4);
    expect(oklchToHex(out)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white and symmetric', () => {
    const w = hexToOklch('#ffffff');
    const k = hexToOklch('#000000');
    expect(contrastRatio(w, k)).toBeCloseTo(21, 1);
    expect(contrastRatio(k, w)).toBeCloseTo(21, 1);
  });
});

describe('formatOklch', () => {
  it('formats like tokens.css', () => {
    expect(formatOklch({ l: 0.7, c: 0.15, h: 45 })).toBe('70.0% 0.150 45');
  });
});
