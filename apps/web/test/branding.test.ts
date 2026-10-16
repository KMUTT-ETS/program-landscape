import { describe, expect, it, vi } from 'vitest';
import { brandMetadata, toBranding } from '../src/lib/branding';

// React's request-scoped cache() only exists in the server build; pass through under vitest.
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

const ROW = {
  id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.', shortNameEn: 'EXU',
  regionTh: null, regionEn: null, contactEmail: null, appUrl: 'https://x.example', version: 5,
  logoLightKey: `logo-light/${'a1'.repeat(32)}.png`, logoDarkKey: null, faviconKey: null,
  primaryColor: 'orange', secondaryColor: null,
  brandTokensJson: { light: { 'accent-default': '70.0% 0.150 45' }, dark: {} },
  updatedAt: new Date(), updatedBy: null,
} as never;

const noStoreMock = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ unstable_noStore: noStoreMock }));

describe('toBranding', () => {
  it('always points at the /brand route, stamped with the content token, and builds safe CSS', () => {
    const b = toBranding(ROW);
    expect(b.logoLightUrl).toBe('/brand/logo-light?v=5-a1a1a1a1a1a1');
    expect(b.faviconUrl).toBe('/brand/favicon?v=5');
    expect(b.hasOwnLogo).toBe(true);
    expect(b.tagline).toBe('EXU Curriculum Intelligence Platform');
    expect(b.css).toBe("html[data-theme='light']{--color-accent-default:70.0% 0.150 45;}");
  });

  it('serves the uploaded light logo in dark mode when only a light logo exists', () => {
    const b = toBranding(ROW);
    expect(b.logoDarkUrl).toBe(b.logoLightUrl);
  });

  it('serves the uploaded dark logo in light mode when only a dark logo exists', () => {
    const b = toBranding({ ...(ROW as object), logoLightKey: null, logoDarkKey: `logo-dark/${'d4'.repeat(32)}.svg` } as never);
    expect(b.logoLightUrl).toBe('/brand/logo-dark?v=5-d4d4d4d4d4d4');
    expect(b.logoDarkUrl).toBe(b.logoLightUrl);
  });

  it('keeps both product-mark URLs when no logo is uploaded', () => {
    const b = toBranding({ ...(ROW as object), logoLightKey: null } as never);
    expect(b.hasOwnLogo).toBe(false);
    expect(b.logoLightUrl).toBe('/brand/logo-light?v=5');
    expect(b.logoDarkUrl).toBe('/brand/logo-dark?v=5');
  });
});

vi.mock('@kku/db', async (orig) => ({
  ...(await orig<typeof import('@kku/db')>()),
  getOrganizationProfile: vi.fn(async () => {
    throw new Error('connect ECONNREFUSED');
  }),
}));

describe('brandingForRequest', () => {
  it('returns null instead of throwing when the database is unreachable (next build, outages)', async () => {
    const { brandingForRequest } = await import('../src/lib/branding');
    await expect(brandingForRequest()).resolves.toBeNull();
    expect(noStoreMock).toHaveBeenCalled();
  });
});

describe('brandMetadata', () => {
  it('names the organisation in the title template', () => {
    expect(brandMetadata(toBranding(ROW)).title).toEqual({
      default: 'Program Landscape — EXU Curriculum Intelligence Platform',
      template: '%s — EXU Curriculum Intelligence Platform',
    });
    expect(brandMetadata(toBranding(ROW)).icons).toEqual({ icon: '/brand/favicon?v=5' });
  });

  it('falls back to the bare product name when the install is not configured', () => {
    expect(brandMetadata(null)).toEqual({
      title: { default: 'Program Landscape', template: '%s — Program Landscape' },
      description: 'Program Landscape — curriculum intelligence for strategic decisions.',
      icons: { icon: '/brand/favicon' },
    });
  });
});
