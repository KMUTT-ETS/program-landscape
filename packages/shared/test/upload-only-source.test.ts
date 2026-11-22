import { describe, expect, it } from 'vitest';
import { SOURCE_CATALOG, uploadDatasetForSource } from '../src/ingestion';

describe('uploadDatasetForSource', () => {
  it('maps a spreadsheet-import source to its dataset slug', () => {
    expect(uploadDatasetForSource('xlsx-faculties')).toBe('faculties');
    expect(uploadDatasetForSource('xlsx-career-skill-demand')).toBe('career-skill-demand');
  });

  it('returns null for sources that have a connector', () => {
    expect(uploadDatasetForSource('kku-registry')).toBeNull();
    expect(uploadDatasetForSource('tcas')).toBeNull();
  });

  it('covers every xlsx-* entry in the catalogue', () => {
    const xlsx = SOURCE_CATALOG.filter((e) => e.slug.startsWith('xlsx-'));
    expect(xlsx.length).toBeGreaterThan(0);
    for (const entry of xlsx) {
      expect(uploadDatasetForSource(entry.slug)).toBe(entry.slug.slice('xlsx-'.length));
    }
  });
});
