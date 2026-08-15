import { describe, expect, it } from 'vitest';
import { PRINT_PALETTE, SEMANTIC, seriesColour } from '../src/charts/palette';

describe('PRINT_PALETTE', () => {
  it('has at least 6 series colours', () => {
    expect(PRINT_PALETTE.length).toBeGreaterThanOrEqual(6);
  });

  it('is entirely uppercase 6-digit hex — no CSS variables survive SSR', () => {
    for (const c of PRINT_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('carries the KKU cardinal as the second series colour', () => {
    expect(PRINT_PALETTE[1]).toBe('#9C1D2E');
  });
});

describe('SEMANTIC', () => {
  it('exposes the four status colours the templates already use', () => {
    expect(Object.keys(SEMANTIC).sort()).toEqual(['danger', 'info', 'success', 'warning']);
    for (const c of Object.values(SEMANTIC)) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('seriesColour', () => {
  it('returns the colour at an in-range index', () => {
    expect(seriesColour(0)).toBe(PRINT_PALETTE[0]);
    expect(seriesColour(3)).toBe(PRINT_PALETTE[3]);
  });

  it('wraps past the end of the palette', () => {
    expect(seriesColour(PRINT_PALETTE.length)).toBe(PRINT_PALETTE[0]);
    expect(seriesColour(PRINT_PALETTE.length * 2 + 1)).toBe(PRINT_PALETTE[1]);
  });

  it('rejects a negative index rather than returning undefined', () => {
    expect(() => seriesColour(-1)).toThrow(RangeError);
  });

  it('rejects a non-integer index', () => {
    expect(() => seriesColour(1.5)).toThrow(RangeError);
    expect(() => seriesColour(Number.NaN)).toThrow(RangeError);
  });
});
