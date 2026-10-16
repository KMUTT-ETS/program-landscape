import { describe, expect, it } from 'vitest';
import { deriveBrandTokens, oklchToHex } from '../src/brand';

// Today's coral and cardinal, from packages/design/src/css/tokens.css.
const CORAL = oklchToHex({ l: 0.7, c: 0.15, h: 45 });
const CARDINAL = oklchToHex({ l: 0.44, c: 0.165, h: 20 });

function parse(v: string | undefined): { L: number; C: number; H: number } {
  const m = /^(\d+\.\d)% (\d\.\d{3}) (\d+)$/.exec(v ?? '');
  if (!m) throw new Error(`bad token ${v}`);
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

describe('deriveBrandTokens', () => {
  it('reproduces today\'s coral accent steps (lightness exact, chroma within 0.006)', () => {
    const { tokens, ok } = deriveBrandTokens(CORAL, null);
    expect(ok).toBe(true);
    const expected: Array<[keyof typeof tokens.light, 'light' | 'dark', number, number]> = [
      ['accent-default', 'light', 70.0, 0.15],
      ['accent-hover', 'light', 76.0, 0.14],
      ['accent-active', 'light', 62.0, 0.165],
      ['accent-subtle', 'light', 95.5, 0.04],
      ['accent-default', 'dark', 53.0, 0.18],
      ['accent-hover', 'dark', 48.0, 0.19],
      ['accent-active', 'dark', 43.0, 0.195],
      ['accent-subtle', 'dark', 30.0, 0.06],
    ];
    for (const [name, mode, L, C] of expected) {
      const t = parse(tokens[mode][name]);
      expect(t.L, `${mode} ${name} L`).toBe(L);
      expect(Math.abs(t.C - C), `${mode} ${name} C`).toBeLessThanOrEqual(0.006);
    }
    expect(parse(tokens.light['accent-fg']).L).toBe(22.0); // dark text on pastel
    expect(parse(tokens.dark['accent-fg']).L).toBe(99.0); // light text in dark mode
  });

  it('reproduces today\'s cardinal steps', () => {
    const { tokens, ok } = deriveBrandTokens(CORAL, CARDINAL);
    expect(ok).toBe(true);
    expect(parse(tokens.light['brand-cardinal']).L).toBe(44.0);
    expect(parse(tokens.light['brand-cardinal-hover']).L).toBe(48.5);
    expect(parse(tokens.light['brand-cardinal-subtle']).L).toBe(95.0);
    expect(parse(tokens.dark['brand-cardinal']).L).toBe(62.0);
    expect(Math.abs(parse(tokens.dark['brand-cardinal']).C - 0.175)).toBeLessThanOrEqual(0.006);
    expect(parse(tokens.dark['brand-cardinal-subtle']).L).toBe(25.0);
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
