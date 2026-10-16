import { describe, expect, it } from 'vitest';
import { deriveBrandTokens } from '@kku/shared';
import { KKU_BRAND_COLOURS, fillKkuBrand, planKkuBrandFill } from '../src/lib/kku-brand';

const EMPTY = { logoLightKey: null, logoDarkKey: null, faviconKey: null, primaryColor: null, secondaryColor: null };

describe('planKkuBrandFill', () => {
  it('fills everything on a profile with no brand yet', () => {
    expect(planKkuBrandFill(EMPTY)).toEqual({ assets: ['logo-light', 'logo-dark', 'favicon'], colours: true });
  });

  it('never overwrites what an admin already set', () => {
    expect(planKkuBrandFill({ ...EMPTY, logoDarkKey: 'logo-dark/x.svg', secondaryColor: 'custom-b' })).toEqual({
      assets: ['logo-light', 'favicon'],
      colours: false,
    });
  });
});

describe('KKU_BRAND_COLOURS', () => {
  it("derive to today's coral and cardinal and pass the gate", () => {
    const r = deriveBrandTokens(KKU_BRAND_COLOURS.primary, KKU_BRAND_COLOURS.secondary);
    expect(r.ok).toBe(true);
    expect(r.tokens.light['accent-default']).toMatch(/^70\.0% 0\.15\d /);
    expect(r.tokens.light['brand-cardinal']).toMatch(/^44\.0% 0\.16\d /);
  });
});

describe('fillKkuBrand', () => {
  const mk = () => {
    const calls: string[] = [];
    let v = 3;
    return {
      calls,
      deps: {
        readFile: (f: string) => Buffer.from(f),
        putObject: async (k: string) => `${k}/abc.png`,
        setAsset: async (k: string, key: string) => {
          calls.push(`asset:${k}:${key}`);
          return { version: ++v };
        },
        saveColours: async (i: { expectedVersion: number }) => {
          calls.push(`colours:v${i.expectedVersion}`);
          return { version: ++v };
        },
        log: (l: string) => calls.push(`log:${l}`),
      },
    };
  };

  it('uploads planned assets then writes colours at the bumped version', async () => {
    const { calls, deps } = mk();
    await fillKkuBrand({ version: 3, ...EMPTY }, deps);
    expect(calls.filter((c) => !c.startsWith('log:'))).toEqual([
      'asset:logo-light:logo-light/abc.png',
      'asset:logo-dark:logo-dark/abc.png',
      'asset:favicon:favicon/abc.png',
      'colours:v6',
    ]);
  });

  it('writes nothing for fields already set', async () => {
    const { calls, deps } = mk();
    await fillKkuBrand(
      { version: 3, logoLightKey: 'a', logoDarkKey: 'b', faviconKey: 'c', primaryColor: 'custom-a', secondaryColor: null },
      deps,
    );
    expect(calls).toEqual(['log:brand: nothing to fill']);
  });

  it('still sets colours when object storage is not configured', async () => {
    const { calls, deps } = mk();
    await fillKkuBrand({ version: 3, ...EMPTY }, { ...deps, putObject: null });
    expect(calls).toEqual([
      'log:brand: object storage not configured — logos skipped',
      'colours:v3',
      'log:brand: colours set',
    ]);
  });
});
