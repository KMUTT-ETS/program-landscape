import { describe, expect, it } from 'vitest';
import { KKU_LEVEL_FILL, TIER_FILL_HEX, tint } from '../app/risks/types';

describe('risk fills', () => {
  it('are design-token wrappers, never colour literals', () => {
    for (const v of [...Object.values(KKU_LEVEL_FILL), ...Object.values(TIER_FILL_HEX)]) {
      expect(v).toMatch(/^oklch\(var\(--color-[a-z0-9-]+\)\)$/);
    }
  });

  it('keep the hue order of the scale: neutral, green, yellow/amber, orange, red', () => {
    expect(KKU_LEVEL_FILL).toEqual({
      NEEDS_DATA: 'oklch(var(--color-data-neutral))',
      LOW: 'oklch(var(--color-success-default))',
      MODERATE: 'oklch(var(--color-chart-3))',
      HIGH: 'oklch(var(--color-chart-1))',
      VERY_HIGH: 'oklch(var(--color-danger-default))',
    });
    expect(new Set(Object.values(TIER_FILL_HEX)).size).toBe(5);
  });

  it('tint mixes a token colour with transparent instead of appending a hex alpha', () => {
    expect(tint(KKU_LEVEL_FILL.LOW, 40)).toBe('color-mix(in oklch, oklch(var(--color-success-default)) 40%, transparent)');
    expect(tint('x', 140)).toContain(' 100%,');
    expect(tint('x', -3)).toContain(' 0%,');
  });
});
