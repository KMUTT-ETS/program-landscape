import { describe, expect, it } from 'vitest';
import { formatApa, type AuthorName, type PublicationEntry } from '../src/staff-profile/types';

const a = (family: string, given: string | null = null, initials: string | null = null): AuthorName => ({
  family,
  given,
  initials,
});

function pub(authors: AuthorName[], authorsAreComplete: boolean, extra: Partial<PublicationEntry> = {}): PublicationEntry {
  return {
    id: 'p1',
    year: 2024,
    title: 'A title',
    venue: 'Journal',
    citations: 0,
    doi: null,
    scopusId: null,
    pmid: null,
    openalexId: null,
    type: 'JOURNAL_ARTICLE',
    kkuAuthors: [],
    authors,
    authorsAreComplete,
    source: null,
    scholarPaperId: null,
    ...extra,
  };
}

describe('formatApa — complete author lists', () => {
  it('joins the last author with ", &"', () => {
    expect(formatApa(pub([a('Smith', 'John'), a('Lee', 'Ann'), a('Wong', 'Kim')], true))).toBe(
      'Smith, J., Lee, A., & Wong, K. (2024). A title. *Journal*.',
    );
  });

  it('never doubles the period after a final initial', () => {
    const out = formatApa(pub([a('Wong', 'Kim')], true));
    expect(out).toBe('Wong, K. (2024). A title. *Journal*.');
    expect(out).not.toContain('..');
    expect(formatApa(pub([a('Lee', 'Ann'), a('Wong', null, 'K.')], true))).toBe(
      'Lee, A., & Wong, K. (2024). A title. *Journal*.',
    );
  });

  it('truncates 21+ authors to the first 19, "...", and the last (APA 7 §9.8)', () => {
    const many = Array.from({ length: 25 }, (_, i) => a(`F${i}`, 'Given'));
    const out = formatApa(pub(many, true));
    expect(out).toContain('F18, G., ... F24, G.');
    expect(out).not.toContain('F19,');
  });
});

describe('formatApa — incomplete author lists', () => {
  it('names every author it has and ends with ", …" — no ampersand', () => {
    const out = formatApa(pub([a('Hinton', null, 'G.'), a('Deng', null, 'L.'), a('Yu', null, 'D.')], false));
    expect(out).toBe('Hinton, G., Deng, L., Yu, D., … (2024). A title. *Journal*.');
    expect(out).not.toContain('&');
  });

  it('does not apply the 21+ truncation to a partial list', () => {
    const many = Array.from({ length: 25 }, (_, i) => a(`F${i}`, 'Given'));
    const out = formatApa(pub(many, false));
    expect(out).toContain('F19, G., F20, G.');
    expect(out).toContain('F24, G., … (2024)');
    expect(out).not.toContain('...');
  });

  it('marks a single known author as partial too', () => {
    expect(formatApa(pub([a('Soodphakdee', null, 'D.')], false))).toBe(
      'Soodphakdee, D., … (2024). A title. *Journal*.',
    );
  });

  it('treats the KKU-authors-only fallback by the same flag', () => {
    expect(formatApa(pub([], false, { kkuAuthors: ['Jaidee, S.', 'Example, A.'] }))).toBe(
      'Jaidee, S., Example, A., … (2024). A title. *Journal*.',
    );
  });
});
