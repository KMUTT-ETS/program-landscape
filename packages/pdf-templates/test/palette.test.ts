import { describe, expect, it } from 'vitest';
import { PRINT_PALETTE, SEMANTIC } from '../src/charts/palette';

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
