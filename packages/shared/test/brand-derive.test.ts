/* eslint-disable no-restricted-syntax -- hex values here are brand-colour test data, not UI colours */
import { describe, expect, it } from 'vitest';
import { deriveBrandTokens, oklchToHex, type BrandTokenName } from '../src/brand';

// Today's coral and cardinal, from packages/design/src/css/tokens.css.
const CORAL = oklchToHex({ l: 0.7, c: 0.15, h: 45 });
const CARDINAL = oklchToHex({ l: 0.44, c: 0.165, h: 20 });

function parse(v: string | undefined): { L: number; C: number; H: number } {
  const m = /^(\d+\.\d)% (\d\.\d{3}) (\d+)$/.exec(v ?? '');
  if (!m) throw new Error(`bad token ${v}`);
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

describe('deriveBrandTokens', () => {
  // Every accent and cardinal token, both modes, from tokens.css: [mode, name, L, C, H].
  const TODAY: Array<['light' | 'dark', BrandTokenName, number, number, number]> = [
    ['light', 'accent-default', 70.0, 0.15, 45],
    ['light', 'accent-hover', 76.0, 0.14, 48],
    ['light', 'accent-active', 62.0, 0.165, 40],
    ['light', 'accent-subtle', 95.5, 0.04, 50],
    ['light', 'accent-fg', 22.0, 0.05, 35],
    ['dark', 'accent-default', 53.0, 0.18, 38],
    ['dark', 'accent-hover', 48.0, 0.19, 35],
    ['dark', 'accent-active', 43.0, 0.195, 32],
    ['dark', 'accent-subtle', 30.0, 0.06, 50],
    ['dark', 'accent-fg', 99.0, 0.005, 70],
    ['light', 'brand-cardinal', 44.0, 0.165, 20],
    ['light', 'brand-cardinal-hover', 48.5, 0.165, 20],
    ['light', 'brand-cardinal-subtle', 95.0, 0.018, 20],
    ['dark', 'brand-cardinal', 62.0, 0.175, 20],
    ['dark', 'brand-cardinal-hover', 66.5, 0.175, 20],
    ['dark', 'brand-cardinal-subtle', 25.0, 0.05, 20],
  ];

  it('reproduces every accent and cardinal token of today in both modes (L exact, C ±0.006, H ±1°)', () => {
    const { tokens, ok } = deriveBrandTokens(CORAL, CARDINAL);
    expect(ok).toBe(true);
    for (const [mode, name, L, C, H] of TODAY) {
      const t = parse(tokens[mode][name]);
      expect(t.L, `${mode} ${name} L`).toBe(L);
      expect(Math.abs(t.C - C), `${mode} ${name} C`).toBeLessThanOrEqual(0.006);
      const dh = Math.abs(((t.H - H + 540) % 360) - 180);
      expect(dh, `${mode} ${name} H (got ${t.H}, want ${H})`).toBeLessThanOrEqual(1);
    }
  });

  it('wraps hue offsets modulo 360', () => {
    const { tokens } = deriveBrandTokens(oklchToHex({ l: 0.7, c: 0.15, h: 2 }), null);
    // dark active is -13 degrees: 2 - 13 wraps to about 349.
    const h = parse(tokens.dark['accent-active']).H;
    expect(h).toBeGreaterThan(340);
    expect(h).toBeLessThan(360);
  });

  it('omits the cardinal tokens when no secondary colour is given', () => {
    const { tokens } = deriveBrandTokens(CORAL, null);
    expect(tokens.light['brand-cardinal']).toBeUndefined();
    expect(tokens.dark['brand-cardinal']).toBeUndefined();
  });

  it('returns no tokens and ok:true when neither colour is set', () => {
    expect(deriveBrandTokens(null, null)).toMatchObject({ ok: true, tokens: { light: {}, dark: {} } });
  });

  it('rejects a near-grey colour with a readable reason', () => {
    const r = deriveBrandTokens('#808585', null);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/too close to grey/i);
  });

  it('reports every contrast check with its ratio', () => {
    const r = deriveBrandTokens(CORAL, CARDINAL);
    expect(r.checks.map((c) => `${c.name}/${c.mode}`).sort()).toEqual([
      'primary text on primary/dark',
      'primary text on primary/light',
      'secondary on page/dark',
      'secondary on page/light',
    ]);
    for (const c of r.checks) expect(c.pass).toBe(c.ratio >= c.required);
  });

  it('rejects an invalid hex for either colour', () => {
    expect(deriveBrandTokens('nothex', null).ok).toBe(false);
    expect(deriveBrandTokens(CORAL, '#12345').ok).toBe(false);
  });
});
