import { describe, expect, it } from 'vitest';
import { authorStatus, publicationTypeLabel, scopusRecordUrl, sourceLabel } from '@/lib/publication-meta';

describe('publicationTypeLabel', () => {
  it('labels real types and hides the Scholar placeholder', () => {
    expect(publicationTypeLabel('JOURNAL', 'openalex', 'en')).toBe('Journal article');
    expect(publicationTypeLabel('CONFERENCE', 'kku-publications:scopus', 'th')).toBe('บทความประชุมวิชาการ');
    expect(publicationTypeLabel('JOURNAL', 'google-scholar', 'en')).toBeNull();
  });
  it('never shows a source name as a type', () => {
    for (const t of ['scopus', 'pubmed', 'isi', 'tci', 'whatever']) expect(publicationTypeLabel(t, 'live:scopus', 'en')).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('names where a record came from', () => {
    expect(sourceLabel('google-scholar')).toBe('Google Scholar');
    expect(sourceLabel('kku-publications:scopus')).toBe('Scopus');
    expect(sourceLabel('kku-publications:pubmed')).toBe('PubMed');
    expect(sourceLabel('openalex')).toBe('OpenAlex');
    expect(sourceLabel('live:isi')).toBe('Web of Science');
    expect(sourceLabel('live:tci')).toBe('TCI');
    expect(sourceLabel(null)).toBeNull();
  });
});

describe('scopusRecordUrl', () => {
  it('builds a record link from either id form', () => {
    expect(scopusRecordUrl('2-s2.0-85012345678')).toBe('https://www.scopus.com/record/display.uri?eid=2-s2.0-85012345678&origin=resultslist');
    expect(scopusRecordUrl('85012345678')).toBe('https://www.scopus.com/record/display.uri?eid=2-s2.0-85012345678&origin=resultslist');
  });
});

describe('authorStatus', () => {
  it('distinguishes complete, shortened and unavailable', () => {
    expect(authorStatus({ authors: [{ family: 'A', given: null, initials: null }], authorsAreComplete: true, source: 'openalex' })).toBe('complete');
    expect(authorStatus({ authors: [{ family: 'A', given: null, initials: null }], authorsAreComplete: false, source: 'google-scholar' })).toBe('shortened');
    expect(authorStatus({ authors: [], authorsAreComplete: false, source: 'google-scholar' })).toBe('unavailable');
  });
});
