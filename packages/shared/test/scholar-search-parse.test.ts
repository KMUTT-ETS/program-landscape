// packages/shared/test/scholar-search-parse.test.ts
//
// Exercises the Scholar SEARCH-page parsers against real ScrapingBee captures
// under test/fixtures/scholar/ — see the README there for what each capture
// contains, what it cost, and which shapes could not be obtained.
//
// One piece of hand-written markup appears in this file, clearly labelled: a
// `[CITATION]`-only row, which ten live searches failed to produce and
// which is the only case where the raw and filtered row counts diverge.
// Everything else is a real Scholar response.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SCHOLAR_SEARCH_PAGE_SIZE,
  SCHOLAR_SEARCH_PARSER_VERSION,
  parseScholarProfileCluster,
  parseScholarSearchHits,
  parseScholarSearchPage,
} from '../src/scholar/search-parse';
import { matchesScholarAuthorName } from '../src/scholar/name-match';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'scholar');
const read = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf-8');

/** `as_vis=1`, full page, NO cluster, 9 byline profile links. */
const asVisChindaprasirt = read('search-as-vis-chindaprasirt.html');
/** Same name without `as_vis` — still no cluster, and a SHORT page. */
const noVisChindaprasirt = read('search-novis-chindaprasirt.html');
/** One profile card, header on an `h3`. */
const sripa = read('search-novis-sripa.html');
/** A second one-card cluster; affiliation contains a comma. */
const wanapat = read('search-novis-wanapat.html');
/** Plain-text bylines — zero extractable author ids. */
const plainTextBylines = read('search-novis-sawanyawisuth.html');
/** Thai-language results; carries the only row with no parseable year. */
const thaiQuery = read('search-novis-thai-query.html');
/** Not a search page at all: the real sign-in wall from `search_authors`. */
const signinWall = read('author-search-blocked-signin-wall.html');

describe('SCHOLAR_SEARCH_PARSER_VERSION', () => {
  it('is the versioned string an archived search payload gets stamped with', () => {
    expect(SCHOLAR_SEARCH_PARSER_VERSION).toBe('scholar-search-parse.v1');
  });
});

describe('parseScholarProfileCluster', () => {
  it('reads the single card, its name and its affiliation', () => {
    expect(parseScholarProfileCluster(sripa)).toEqual([
      {
        authorId: '1oFnFuEAAAAJ',
        name: 'Banchob Sripa',
        affiliation: 'Khon Kaen University',
      },
    ]);
  });

  it('keeps an affiliation that contains a comma intact', () => {
    expect(parseScholarProfileCluster(wanapat)).toEqual([
      {
        authorId: 'ba5L6LwAAAAJ',
        name: 'Metha Wanapat',
        affiliation: 'Professor of Animal Science, Khon Kaen University',
      },
    ]);
  });

  // THE cluster-parsing trap. This page carries nine `/citations?user=`
  // anchors — every one of them a co-author byline link — and no cluster at
  // all. A fallback selector that forgets to exclude `.gs_a` reads all nine as
  // profile cards, and the four-case resolution then binds a co-author's
  // publications to this person's staff record.
  //
  // MUTATION-TESTED: deleting the `.gs_a` guard in the fallback makes this
  // return 9 cards and fails here.
  it('returns nothing when the page has no cluster, however many byline links it carries', () => {
    expect(/\/citations\?user=wmV9HqoAAAAJ/.test(asVisChindaprasirt)).toBe(true);
    expect(parseScholarProfileCluster(asVisChindaprasirt)).toEqual([]);
    expect(parseScholarProfileCluster(noVisChindaprasirt)).toEqual([]);
  });

  // The fallback's POSITIVE path — Scholar inlining a card with no "User
  // profiles" header — was not captured live, so it is provoked by removing
  // that header text from a REAL cluster page. The markup under test is
  // unaltered; only the heading Scholar wrote is taken away.
  //
  // MUTATION-TESTED: deleting the fallback block entirely fails here while
  // every other test still passes.
  it('still finds an inlined card when the "User profiles" header is absent', () => {
    const headerless = sripa.replace(/User profiles for/g, 'Results for');
    expect(/user profiles/i.test(headerless)).toBe(false);
    expect(parseScholarProfileCluster(headerless)).toEqual([
      {
        authorId: '1oFnFuEAAAAJ',
        name: 'Banchob Sripa',
        affiliation: 'Khon Kaen University',
      },
    ]);
  });

  it('returns [] rather than throwing for a page that is not a search page', () => {
    expect(parseScholarProfileCluster(signinWall)).toEqual([]);
    expect(parseScholarProfileCluster('')).toEqual([]);
    expect(parseScholarProfileCluster('<html><body>nothing here</body></html>')).toEqual([]);
  });
});

describe('parseScholarSearchHits', () => {
  it('reads a fully-populated result row', () => {
    const { hits } = parseScholarSearchHits(asVisChindaprasirt);
    const first = hits[0];
    expect(first).toBeDefined();
    expect(first?.title).toBe(
      'Workability and strength of coarse high calcium fly ash geopolymer',
    );
    expect(first?.year).toBe(2007);
    expect(first?.venue).toBe('Cement and concrete …');
    expect(first?.link).toMatch(/^https:\/\/www\.sciencedirect\.com\//);
    expect(first?.authorsLine).toContain('P Chindaprasirt');
  });

  it('extracts the per-author byline profile links', () => {
    const { hits } = parseScholarSearchHits(asVisChindaprasirt);
    expect(hits[1]?.authorLinks).toEqual([
      { name: 'P Chindaprasirt', authorId: 'wmV9HqoAAAAJ' },
      { name: 'C Jaturapitakkul', authorId: '7ZXE3BoAAAAJ' },
    ]);
  });

  // The measured case the design rests on: this search returned NO profile
  // cluster, yet a byline anchor carries the subject's own id. Task 4 resolves
  // from it; this asserts the parser hands over what that needs — including
  // that the abbreviated anchor text is a form the Task 2 matcher accepts.
  it('carries the subject own author id on a page with no cluster', () => {
    const { hits } = parseScholarSearchHits(asVisChindaprasirt);
    const links = hits.flatMap((hit) => hit.authorLinks);
    const own = links.find((link) => link.authorId === 'wmV9HqoAAAAJ');
    expect(own?.name).toBe('P Chindaprasirt');
    expect(matchesScholarAuthorName('Prinya Chindaprasirt', own?.name ?? '')).toBe(true);
    // …and the co-authors on the same page are NOT the subject.
    const coAuthor = links.find((link) => link.authorId === '7ZXE3BoAAAAJ');
    expect(matchesScholarAuthorName('Prinya Chindaprasirt', coAuthor?.name ?? '')).toBe(false);
  });

  // A whole page of unlinked bylines. Real, common, and not a failure.
  it('returns zero author ids without throwing when every byline is plain text', () => {
    const { hits, rawRowCount } = parseScholarSearchHits(plainTextBylines);
    expect(rawRowCount).toBe(4);
    expect(hits).toHaveLength(4);
    expect(hits.every((hit) => hit.authorLinks.length === 0)).toBe(true);
    expect(hits.every((hit) => hit.authorsLine.length > 0)).toBe(true);
    expect(hits[0]?.title).toContain('Pineal calcification');
  });

  it('reports year null rather than guessing when Scholar gives no year', () => {
    const { hits } = parseScholarSearchHits(thaiQuery);
    const undated = hits.filter((hit) => hit.year === null);
    expect(undated).toHaveLength(1);
    // Everything else on the page still parses a year, so this is a property
    // of the row and not of the parser giving up on Thai script.
    expect(hits.filter((hit) => hit.year !== null).length).toBe(hits.length - 1);
  });

  it('does not mistake the profile cluster row for a result row', () => {
    const { hits, rawRowCount } = parseScholarSearchHits(sripa);
    expect(rawRowCount).toBe(10);
    expect(hits).toHaveLength(10);
    expect(hits.every((hit) => hit.title !== 'User profiles for Banchob Sripa')).toBe(true);
  });

  it('returns nothing rather than throwing for a page with no result rows', () => {
    expect(parseScholarSearchHits(signinWall)).toEqual({
      hits: [],
      rawRowCount: 0,
      pageWasFull: false,
    });
    expect(parseScholarSearchHits('')).toEqual({ hits: [], rawRowCount: 0, pageWasFull: false });
  });
});

describe('truncation is judged on the raw row count', () => {
  it('calls a page that filled up full, and a short one short', () => {
    expect(SCHOLAR_SEARCH_PAGE_SIZE).toBe(10);
    expect(parseScholarSearchHits(asVisChindaprasirt).pageWasFull).toBe(true);
    expect(parseScholarSearchHits(sripa).pageWasFull).toBe(true);
    // Same person, same day, no `as_vis`: two rows. Scholar serves a different
    // article set per request — which is exactly why a count off a search page
    // is a floor and never a total.
    expect(parseScholarSearchHits(noVisChindaprasirt).rawRowCount).toBe(2);
    expect(parseScholarSearchHits(noVisChindaprasirt).pageWasFull).toBe(false);
    expect(parseScholarSearchHits(plainTextBylines).pageWasFull).toBe(false);
  });

  // ── THE ONE PIECE OF HAND-WRITTEN MARKUP IN THIS FILE ────────────────────
  //
  // Ten live searches (see the fixtures README) produced no `[CITATION]`
  // row, and `as_vis=1` hides them by construction — so the single case where
  // the raw and filtered counts diverge could not be captured. The rows below
  // are the minimal structure needed to state the contract: the `gs_ctc` /
  // `gs_ct1` nesting is copied verbatim from the captures, where it carries
  // `[PDF]`, `[HTML]` and `[BOOK]`; only the badge word is written by hand,
  // and it is the word the reference implementation matches on in production.
  //
  // Replace this with a real capture the first time one appears.
  //
  // MUTATION-TESTED: moving `rawRowCount += 1` below the citation-only skip —
  // i.e. counting what survived instead of what Scholar rendered — makes this
  // report 1 and 1, and fails here.
  it('counts a filtered-out row toward truncation and not toward the results', () => {
    const citationOnlyRow =
      '<div class="gs_r gs_or gs_scl"><div class="gs_ri">' +
      '<h3 class="gs_rt"><span class="gs_ctc"><span class="gs_ct1">[CITATION]</span>' +
      '<span class="gs_ct2">[C]</span></span> A work Scholar has no record of</h3>' +
      '<div class="gs_a">S Someone - A Journal, 2011</div></div></div>';
    const realRow =
      '<div class="gs_r gs_or gs_scl"><div class="gs_ri">' +
      '<h3 class="gs_rt"><a href="https://example.org/paper">A work with a record</a></h3>' +
      '<div class="gs_a">S Someone - A Journal, 2012</div></div></div>';

    const parsed = parseScholarSearchHits(`<html><body>${citationOnlyRow}${realRow}</body></html>`);
    expect(parsed.rawRowCount).toBe(2);
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]?.title).toBe('A work with a record');
  });

  it('keeps a [PDF]- or [HTML]-badged row, which is a real result', () => {
    // Guards the citation-only test above from being written as "any gs_ctc
    // badge means skip". `gs_ctc` carries [PDF], [HTML] and [BOOK] across the
    // captures, and all three are results. `toContain` is deliberately not
    // used — a failure would print the whole 180 KB page.
    expect(/gs_ct1">\[PDF\]/.test(wanapat)).toBe(true);
    expect(/gs_ct1">\[HTML\]/.test(sripa)).toBe(true);
    expect(parseScholarSearchHits(wanapat).hits).toHaveLength(10);
    expect(parseScholarSearchHits(sripa).hits).toHaveLength(10);
  });
});

describe('parseScholarSearchPage', () => {
  it('answers both questions from one parse of one 75-credit response', () => {
    const page = parseScholarSearchPage(sripa);
    expect(page.profileCards).toHaveLength(1);
    expect(page.profileCards[0]?.authorId).toBe('1oFnFuEAAAAJ');
    expect(page.hits).toHaveLength(10);
    expect(page.rawRowCount).toBe(10);
    expect(page.pageWasFull).toBe(true);
  });

  it('degrades to empty on input that is not a search page', () => {
    expect(parseScholarSearchPage(signinWall)).toEqual({
      profileCards: [],
      hits: [],
      rawRowCount: 0,
      pageWasFull: false,
    });
  });
});
