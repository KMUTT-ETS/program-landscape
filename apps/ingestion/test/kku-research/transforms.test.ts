// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for kku-research transforms (kku-publications mirror edition).
//
// Pure-function tests; no DB, no fixtures. They guard:
//   - aggregation_type → ResearchOutputType mapping (Scopus's ~6 values
//     collapse to our 4-value enum without losing a category)
//   - DOI normalisation (https://doi.org/ prefix stripped, lowercased)
//   - year extraction (cover_date parsing + sanity bounds)
//   - faculty-member resolution (nameEn lowercased exact, nameTh exact,
//     no-match fallback)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  buildFacultyMemberLookup,
  normaliseDoi,
  pubmedPublicationTypeToOurs,
  resolveAuthor,
  scopusAggregationToOurs,
  yearOf,
} from '../../src/connectors/sources/kku-research/transforms';

describe('scopusAggregationToOurs', () => {
  it('routes "Conference Proceeding" → CONFERENCE', () => {
    expect(scopusAggregationToOurs('Conference Proceeding')).toBe('CONFERENCE');
    expect(scopusAggregationToOurs('Conference Proceedings')).toBe('CONFERENCE');
  });
  it('routes "Book" / "Book Series" → BOOK', () => {
    expect(scopusAggregationToOurs('Book')).toBe('BOOK');
    expect(scopusAggregationToOurs('Book Series')).toBe('BOOK');
  });
  it('falls back to JOURNAL for journals, trade journals, reports, null', () => {
    expect(scopusAggregationToOurs('Journal')).toBe('JOURNAL');
    expect(scopusAggregationToOurs('Trade Journal')).toBe('JOURNAL');
    expect(scopusAggregationToOurs('Report')).toBe('JOURNAL');
    expect(scopusAggregationToOurs(null)).toBe('JOURNAL');
    expect(scopusAggregationToOurs('')).toBe('JOURNAL');
  });
  it('is case-insensitive', () => {
    expect(scopusAggregationToOurs('CONFERENCE PROCEEDING')).toBe('CONFERENCE');
    expect(scopusAggregationToOurs('book series')).toBe('BOOK');
  });
});

describe('pubmedPublicationTypeToOurs', () => {
  it('always returns JOURNAL — PubMed indexes journal-published papers', () => {
    expect(pubmedPublicationTypeToOurs(null)).toBe('JOURNAL');
    expect(pubmedPublicationTypeToOurs('Review')).toBe('JOURNAL');
    expect(pubmedPublicationTypeToOurs('Editorial')).toBe('JOURNAL');
  });
});

describe('normaliseDoi', () => {
  it('strips the doi.org prefix and lowercases', () => {
    expect(normaliseDoi('https://doi.org/10.1038/NATURE12373')).toBe('10.1038/nature12373');
    expect(normaliseDoi('http://doi.org/10.1038/NATURE12373')).toBe('10.1038/nature12373');
    expect(normaliseDoi('http://dx.doi.org/10.1016/J.JCH.2020.10.012')).toBe('10.1016/j.jch.2020.10.012');
  });
  it('passes through bare DOIs (lowercased)', () => {
    expect(normaliseDoi('10.1038/nature12373')).toBe('10.1038/nature12373');
    expect(normaliseDoi('10.1038/NATURE12373')).toBe('10.1038/nature12373');
  });
  it('returns null for empty / null', () => {
    expect(normaliseDoi(null)).toBeNull();
    expect(normaliseDoi(undefined)).toBeNull();
    expect(normaliseDoi('')).toBeNull();
    expect(normaliseDoi('   ')).toBeNull();
  });
});

describe('yearOf', () => {
  it('extracts UTC year from a Date', () => {
    expect(yearOf(new Date('2024-06-15T00:00:00Z'))).toBe(2024);
    expect(yearOf(new Date('1999-12-31T23:59:59Z'))).toBe(1999);
  });
  it('returns null for null / missing date', () => {
    expect(yearOf(null)).toBeNull();
  });
  it('returns null for nonsensical years (sanity bounds)', () => {
    expect(yearOf(new Date('1850-01-01T00:00:00Z'))).toBeNull();
    expect(yearOf(new Date('2200-01-01T00:00:00Z'))).toBeNull();
  });
});

describe('resolveAuthor', () => {
  const lookup = buildFacultyMemberLookup([
    { id: 'fm-1', nameEn: 'Somchai Saengthong', nameTh: 'สมชาย แสงทอง' },
    { id: 'fm-2', nameEn: 'Anong Suksai', nameTh: 'อนงค์ สุขใส' },
  ]);

  it('matches by nameEn (lowercased exact)', () => {
    const r = resolveAuthor(
      {
        firstname_en: 'Somchai',
        lastname_en: 'Saengthong',
        firstname: null,
        lastname: null,
      },
      lookup,
    );
    expect(r.facultyMemberId).toBe('fm-1');
    expect(r.matchedBy).toBe('name_en');
    expect(r.authorDisplayName).toBe('Somchai Saengthong');
  });

  it('matches by nameEn case-insensitively', () => {
    const r = resolveAuthor(
      {
        firstname_en: 'SOMCHAI',
        lastname_en: 'SAENGTHONG',
        firstname: null,
        lastname: null,
      },
      lookup,
    );
    expect(r.facultyMemberId).toBe('fm-1');
    expect(r.matchedBy).toBe('name_en');
  });

  it('falls back to nameTh exact when nameEn does not match', () => {
    const r = resolveAuthor(
      {
        firstname_en: null,
        lastname_en: null,
        firstname: 'อนงค์',
        lastname: 'สุขใส',
      },
      lookup,
    );
    expect(r.facultyMemberId).toBe('fm-2');
    expect(r.matchedBy).toBe('name_th');
  });

  it('returns null facultyMemberId when neither lookup hits', () => {
    const r = resolveAuthor(
      {
        firstname_en: 'Mystery',
        lastname_en: 'Person',
        firstname: 'นิรนาม',
        lastname: 'นามสมมติ',
      },
      lookup,
    );
    expect(r.facultyMemberId).toBeNull();
    expect(r.matchedBy).toBe('unmatched');
    expect(r.authorDisplayName).toBe('Mystery Person');
  });

  it('uses Thai display name when English is missing', () => {
    const r = resolveAuthor(
      {
        firstname_en: null,
        lastname_en: null,
        firstname: 'นิรนาม',
        lastname: 'นามสมมติ',
      },
      lookup,
    );
    expect(r.facultyMemberId).toBeNull();
    expect(r.authorDisplayName).toBe('นิรนาม นามสมมติ');
  });

  it('handles null/whitespace name parts gracefully', () => {
    const r = resolveAuthor(
      {
        firstname_en: '  ',
        lastname_en: null,
        firstname: null,
        lastname: '',
      },
      lookup,
    );
    expect(r.facultyMemberId).toBeNull();
    expect(r.authorDisplayName).toBeNull();
  });
});

describe('buildFacultyMemberLookup', () => {
  it('first-write wins when names collide (deterministic per snapshot order)', () => {
    const lookup = buildFacultyMemberLookup([
      { id: 'fm-A', nameEn: 'John Smith', nameTh: 'จอห์น สมิธ' },
      { id: 'fm-B', nameEn: 'John Smith', nameTh: 'จอห์น สมิธ' },
    ]);
    expect(lookup.byNameEn.get('john smith')).toBe('fm-A');
    expect(lookup.byNameTh.get('จอห์น สมิธ')).toBe('fm-A');
  });
  it('skips empty / whitespace-only names so they do not eat the lookup', () => {
    const lookup = buildFacultyMemberLookup([
      { id: 'fm-1', nameEn: '   ', nameTh: '' },
      { id: 'fm-2', nameEn: 'Real Person', nameTh: 'บุคคลจริง' },
    ]);
    expect(lookup.byNameEn.size).toBe(1);
    expect(lookup.byNameEn.get('real person')).toBe('fm-2');
  });
});
