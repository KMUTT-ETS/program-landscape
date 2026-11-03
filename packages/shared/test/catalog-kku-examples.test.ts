import { describe, expect, it } from 'vitest';
import { SOURCE_CATALOG, getCatalogEntry, isKkuExample } from '../src/ingestion/catalog';

describe('catalog KKU examples', () => {
  it('every kku-* and unicon-* slug is a KKU example', () => {
    const internal = SOURCE_CATALOG.filter(
      (e) => e.slug.startsWith('kku-') || e.slug.startsWith('unicon-'),
    );
    expect(internal.length).toBeGreaterThan(0);
    for (const e of internal) {
      expect(isKkuExample(e.slug), e.slug).toBe(true);
    }
  });

  it('no xlsx-* slug and none of the public sources is a KKU example', () => {
    for (const e of SOURCE_CATALOG.filter((x) => x.slug.startsWith('xlsx-'))) {
      expect(isKkuExample(e.slug), e.slug).toBe(false);
    }
    for (const slug of ['tcas', 'job-108', 'kmitl-skill-mapping', 'world-bank', 'openalex']) {
      expect(isKkuExample(slug), slug).toBe(false);
    }
    expect(isKkuExample('does-not-exist')).toBe(false);
  });

  it('jobthai ownerContact does not mention KKU', () => {
    const entry = getCatalogEntry('jobthai');
    expect(entry).toBeDefined();
    expect(entry?.ownerContact ?? '').not.toMatch(/KKU/);
  });

  it('no non-example ownerContact mentions KKU', () => {
    const offenders = SOURCE_CATALOG.filter(
      (e) => !isKkuExample(e.slug) && /KKU/.test(e.ownerContact ?? ''),
    ).map((e) => `${e.slug}: ${e.ownerContact}`);
    expect(offenders).toEqual([]);
  });
});
