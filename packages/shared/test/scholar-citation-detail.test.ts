import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScholarCitationAuthors, buildScholarCitationUrl } from '../src/scholar/citation-detail';

// Captured live 2026-10-01 (one ScrapingBee profile-kind request, 15 credits):
// the detail page for "Deep neural networks for acoustic modeling in speech
// recognition", which the profile list page (profile-hinton.html) shortens to
// "G Hinton, L Deng, D Yu, GE Dahl, A Mohamed, N Jaitly, A Senior, ...".
const html = readFileSync(join(__dirname, 'fixtures', 'scholar', 'citation-detail-hinton.html'), 'utf8');

describe('parseScholarCitationAuthors', () => {
  it('reads the complete author list from a real detail page', () => {
    const parsed = parseScholarCitationAuthors(html);
    expect(parsed?.complete).toBe(true);
    const names = parsed?.names;
    expect(names).toEqual([
      'Geoffrey Hinton',
      'Li Deng',
      'Dong Yu',
      'George E Dahl',
      'Abdel-rahman Mohamed',
      'Navdeep Jaitly',
      'Andrew Senior',
      'Vincent Vanhoucke',
      'Patrick Nguyen',
      'Tara N Sainath',
      'Brian Kingsbury',
    ]);
    expect(names!.length).toBeGreaterThan(7); // the list page showed 7 + "..."
    expect(names!.every((n) => !n.includes('...'))).toBe(true);
  });

  it('reads an Inventors field the same way (patents)', () => {
    const patent =
      '<div class="gsc_oci_field">Inventors</div><div class="gsc_oci_value">Ada Lovelace, Charles Babbage</div>';
    expect(parseScholarCitationAuthors(patent)).toEqual({ names: ['Ada Lovelace', 'Charles Babbage'], complete: true });
  });

  it('strips a trailing ellipsis on a detail page and reports the list incomplete', () => {
    const cut = (tail: string) =>
      `<div class="gsc_oci_field">Authors</div><div class="gsc_oci_value">Ada Lovelace, Charles Babbage${tail}</div>`;
    expect(parseScholarCitationAuthors(cut(', ...'))).toEqual({
      names: ['Ada Lovelace', 'Charles Babbage'],
      complete: false,
    });
    expect(parseScholarCitationAuthors(cut(' …'))).toEqual({
      names: ['Ada Lovelace', 'Charles Babbage'],
      complete: false,
    });
  });

  it('returns null for a page without an Authors field (a wall or a bad page)', () => {
    expect(parseScholarCitationAuthors('<html><body>Please show you are not a robot</body></html>')).toBeNull();
    expect(parseScholarCitationAuthors('')).toBeNull();
  });

  it('returns null for an Authors field with no names in it', () => {
    expect(
      parseScholarCitationAuthors('<div class="gsc_oci_field">Authors</div><div class="gsc_oci_value"> , </div>'),
    ).toBeNull();
  });
});

describe('buildScholarCitationUrl', () => {
  it('targets the citation view for the profile and paper', () => {
    expect(buildScholarCitationUrl('JicYPdAAAAAJ', 'JicYPdAAAAAJ:VN7nJs4JPk0C')).toBe(
      'https://scholar.google.com/citations?view_op=view_citation&hl=en&user=JicYPdAAAAAJ&citation_for_view=JicYPdAAAAAJ%3AVN7nJs4JPk0C',
    );
  });
});
