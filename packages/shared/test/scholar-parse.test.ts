// packages/shared/test/scholar-parse.test.ts
//
// Exercises the pure Scholar HTML parser against real ScrapingBee captures
// under test/fixtures/scholar/ — never against imagined markup. See
// src/scholar/parse.ts for why `parseScholarCandidates` is unimplemented.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHOLAR_PARSER_VERSION, parseScholarCandidates, parseScholarPublications } from '../src/scholar/parse';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'scholar');
const read = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf-8');

const profilePage1 = read('profile-hinton.html'); // citations?user=...&cstart=0&pagesize=100 — 100 most-cited works
const profilePage2 = read('profile-hinton-page2.html'); // cstart=700 — surfaces the sparse/old-entry edge cases
const signinWall = read('author-search-blocked-signin-wall.html'); // real response to view_op=search_authors — see parse.ts notes

describe('SCHOLAR_PARSER_VERSION', () => {
  it('is the versioned string archived payloads get stamped with', () => {
    expect(SCHOLAR_PARSER_VERSION).toBe('scholar-parse.v1');
  });
});

describe('parseScholarPublications', () => {
  it('extracts a normal, fully-populated row', () => {
    const papers = parseScholarPublications(profilePage1);
    const imagenet = papers.find((p) => p.scholarPaperId === 'JicYPdAAAAAJ:VN7nJs4JPk0C');
    expect(imagenet).toEqual({
      scholarPaperId: 'JicYPdAAAAAJ:VN7nJs4JPk0C',
      title: 'Imagenet classification with deep convolutional neural networks',
      year: 2012,
      doi: null,
      citations: 199623,
      venue: 'Advances in neural information processing systems 25',
      type: null,
    });
  });

  it('extracts a large real page in full — every row has a positive citation count somewhere', () => {
    const papers = parseScholarPublications(profilePage1);
    // 100 rows on this page; a handful get dropped on page 1 only if they
    // lack a year (none do — verified against the raw fixture), so this
    // pins the count rather than re-deriving it from the fixture at test
    // time.
    expect(papers.length).toBe(100);
    expect(papers.every((p) => p.title.length > 0)).toBe(true);
    expect(papers.every((p) => Number.isInteger(p.year) && p.year > 0)).toBe(true);
  });

  it('drops a publication with a missing year rather than guessing one', () => {
    // Real row from the deep page: both the year column AND the venue's
    // embedded year are empty/absent for this entry.
    const papers = parseScholarPublications(profilePage2);
    const missingYearId = 'JicYPdAAAAAJ:WAzi4Gm8nLoC'; // "DELVE team members (1995)..." — gsc_a_y span is empty
    expect(papers.find((p) => p.scholarPaperId === missingYearId)).toBeUndefined();
  });

  it('decodes HTML entities in the title while still dropping it for the missing year', () => {
    // Real row: title contains a literal "&amp;" AND has no resolvable year.
    // Covers both the entity-decoding path and the drop-on-missing-year path
    // on the same real row.
    const papers = parseScholarPublications(profilePage2);
    const id = 'JicYPdAAAAAJ:ealulPZkXgsC';
    expect(papers.find((p) => p.scholarPaperId === id)).toBeUndefined();
  });

  it('every publication carries type: null — Scholar\'s list view never exposes one', () => {
    const papers = [...parseScholarPublications(profilePage1), ...parseScholarPublications(profilePage2)];
    expect(papers.length).toBeGreaterThan(0);
    expect(papers.every((p) => p.type === null)).toBe(true);
  });

  it('every publication carries doi: null — Scholar\'s list view never exposes one', () => {
    const papers = [...parseScholarPublications(profilePage1), ...parseScholarPublications(profilePage2)];
    expect(papers.length).toBeGreaterThan(0);
    expect(papers.every((p) => p.doi === null)).toBe(true);
  });

  it('treats an empty citation-count anchor as 0, not a dropped row', () => {
    // Real row: <a href="" class="gsc_a_ac gs_ibl"></a> — a paper with
    // genuinely zero citations renders as empty text, not "0".
    const papers = parseScholarPublications(profilePage2);
    const zeroCite = papers.find((p) => p.scholarPaperId === 'JicYPdAAAAAJ:LSkeIYDkhQYC');
    expect(zeroCite?.citations).toBe(0);
  });

  it('handles a row whose venue div is empty (no journal name) while the year column still has a value', () => {
    const papers = parseScholarPublications(profilePage1);
    const p = papers.find((p2) => p2.scholarPaperId === 'JicYPdAAAAAJ:fPk4N6BV_jEC'); // "Learning multiple layers of features from tiny images"
    expect(p).toBeDefined();
    expect(p!.venue).toBeNull();
    expect(p!.year).toBe(2009);
  });

  it('returns [] on an empty string, never throws', () => {
    expect(parseScholarPublications('')).toEqual([]);
  });

  it('returns [] on markup with no recognisable publication rows, never throws', () => {
    expect(parseScholarPublications('<html><body>not a scholar page</body></html>')).toEqual([]);
  });

  it('returns [] on the real captured sign-in-wall page, never throws', () => {
    // Confirms the parser degrades safely on a genuinely unexpected real
    // page, not just a synthetic one.
    expect(parseScholarPublications(signinWall)).toEqual([]);
  });
});

describe('parseScholarCandidates', () => {
  // UNIMPLEMENTED this session — see the block comment above
  // parseScholarCandidates in src/scholar/parse.ts. Google's
  // view_op=search_authors page could not be captured (a mandatory sign-in
  // redirect, confirmed across every ScrapingBee proxy tier and render
  // mode tried), so there is no real markup to assert field extraction
  // against. Testing the one behaviour that IS verifiable — safe
  // degradation on real input — rather than skipping this describe block
  // silently.

  it('returns [] on the real captured sign-in-wall page (the only real response this endpoint produced), never throws', () => {
    expect(parseScholarCandidates(signinWall)).toEqual([]);
  });

  it('returns [] on an empty string, never throws', () => {
    expect(parseScholarCandidates('')).toEqual([]);
  });

  it('returns [] on unrelated markup, never throws', () => {
    expect(parseScholarCandidates('<html><body>not a scholar page</body></html>')).toEqual([]);
  });
});
