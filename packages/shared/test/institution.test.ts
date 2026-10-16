import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KKU_REFERENCE_ORGANIZATION,
  OrganizationNotConfiguredError,
  OrganizationNotLoadedError,
  getInstitution,
  getOrganizationCacheGeneration,
  isOrganizationLoaded,
  isOwnInstitution,
  outboundUserAgent,
  setOrganizationCache,
  setOrganizationForTest,
  type Institution,
} from '../src';

const EXAMPLE: Institution = {
  nameTh: 'มหาวิทยาลัยตัวอย่าง',
  nameEn: 'Example University',
  shortNameEn: 'EXU',
  shortNameTh: 'มต.',
  regionTh: null,
  regionEn: null,
  contactEmail: 'landscape@example.ac.th',
  appUrl: 'https://landscape.example.ac.th',
};

beforeEach(() => setOrganizationForTest(undefined));
afterEach(() => setOrganizationForTest(KKU_REFERENCE_ORGANIZATION));

describe('getInstitution', () => {
  it('throws OrganizationNotLoadedError before anything is loaded — never a KKU fallback', () => {
    expect(() => getInstitution()).toThrow(OrganizationNotLoadedError);
  });

  it('throws OrganizationNotConfiguredError when loaded but no row exists', () => {
    setOrganizationCache(null);
    expect(() => getInstitution()).toThrow(OrganizationNotConfiguredError);
  });

  it('returns the cached identity once loaded', () => {
    setOrganizationCache(EXAMPLE);
    expect(getInstitution()).toEqual(EXAMPLE);
  });
});

describe('outboundUserAgent', () => {
  it('includes purpose, app URL and contact email', () => {
    setOrganizationCache(EXAMPLE);
    expect(outboundUserAgent('discovery')).toBe(
      'Program-Landscape/1.0 discovery (+https://landscape.example.ac.th; landscape@example.ac.th)',
    );
  });

  it('omits the email when none is configured', () => {
    setOrganizationCache({ ...EXAMPLE, contactEmail: null });
    expect(outboundUserAgent()).toBe('Program-Landscape/1.0 (+https://landscape.example.ac.th)');
  });
});

describe('isOwnInstitution', () => {
  it('matches the configured Thai name, ignoring surrounding whitespace', () => {
    setOrganizationCache(EXAMPLE);
    expect(isOwnInstitution(' มหาวิทยาลัยตัวอย่าง ')).toBe(true);
    expect(isOwnInstitution('มหาวิทยาลัยขอนแก่น')).toBe(false);
    expect(isOwnInstitution(null)).toBe(false);
  });
});

describe('cache shared across module copies in one process', () => {
  it('a second copy of the module sees the identity the first copy loaded', async () => {
    // Next.js bundles @kku/shared into the web server while @kku/db loads it
    // from node_modules — two module instances in one process. The cache
    // lives on globalThis so both see the same identity.
    setOrganizationCache(EXAMPLE);
    vi.resetModules();
    const copy = await import('../src/institution');
    expect(copy.getInstitution()).toEqual(EXAMPLE);
    copy.setOrganizationForTest(undefined);
    expect(() => getInstitution()).toThrow(OrganizationNotLoadedError);
    expect(copy.isOrganizationLoaded()).toBe(false);
  });

  it('bumps the generation on every cache write', () => {
    const before = getOrganizationCacheGeneration();
    setOrganizationCache(EXAMPLE);
    setOrganizationCache(null);
    expect(getOrganizationCacheGeneration()).toBe(before + 2);
    expect(isOrganizationLoaded()).toBe(true);
  });
});
