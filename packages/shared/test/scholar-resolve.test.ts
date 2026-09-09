// packages/shared/test/scholar-resolve.test.ts
//
// The four-case resolution decision, plus the fifth case (byline links) the
// reference implementation parses and never uses.
//
// Driven off the REAL ScrapingBee captures in test/fixtures/scholar/ wherever
// a real page can state the case — parsing a genuine 176 KB Scholar response
// and feeding the real shapes through is evidence; a hand-built object graph
// is only a restatement of what the author already believed.
//
// Two kinds of non-captured input appear, both labelled at the point of use:
//
//  1. `search-derived-multicard.html` — a DERIVED fixture. A cluster carrying
//     more than one card could not be obtained (ten live searches, see the
//     fixtures README), so a real second card is spliced into a real cluster.
//     The first test below proves both halves are verbatim from the captures.
//  2. Hand-built `ScholarProfileCard` / `ScholarSearchHit` objects for the
//     cap-at-three rule and the two-matching-bylines refusal. Those are this
//     function's INPUT type, not Scholar markup — nothing is being invented
//     about what Scholar returns, only about what the parser hands over.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScholarSearchPage } from '../src/scholar/search-parse';
import type { ScholarSearchHit } from '../src/scholar/search-parse';
import {
  SCHOLAR_DISAMBIGUATION_CAP,
  SCHOLAR_RESOLUTION_VERSION,
  resolveScholarDisambiguation,
  resolveScholarProfile,
} from '../src/scholar/resolve';
import type { ScholarResolutionInput } from '../src/scholar/resolve';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'scholar');
const read = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf-8');

/** Real. `as_vis=1`, FULL page (10 raw rows), NO cluster, 9 byline anchors —
 *  one of them the subject's own (`wmV9HqoAAAAJ`). The measured case the
 *  byline path rests on. */
const asVisChindaprasirt = read('search-as-vis-chindaprasirt.html');
/** Real. Same person, no `as_vis`: SHORT page (2 rows), no cluster, and its
 *  FIRST byline anchor is a co-author rather than the subject. */
const noVisChindaprasirt = read('search-novis-chindaprasirt.html');
/** Real. One profile card (`1oFnFuEAAAAJ`, Banchob Sripa) over 10 rows. */
const sripa = read('search-novis-sripa.html');
/** Real. A second one-card cluster (`ba5L6LwAAAAJ`, Metha Wanapat). */
const wanapat = read('search-novis-wanapat.html');
/** Real. SHORT page, no cluster, plain-text bylines — zero author ids. */
const plainTextBylines = read('search-novis-sawanyawisuth.html');
/** DERIVED, not captured — see the header comment inside the file itself. */
const derivedMultiCard = read('search-derived-multicard.html');

/** Parse a page the way the runner does — one parse of one 75-credit fetch —
 *  and pose the resolution question against it. */
function resolveFrom(html: string, queryName: string) {
  const page = parseScholarSearchPage(html);
  const input: ScholarResolutionInput = {
    queryName,
    profileCards: page.profileCards,
    searchHits: page.hits,
    searchPageWasFull: page.pageWasFull,
  };
  return resolveScholarProfile(input);
}

describe('SCHOLAR_RESOLUTION_VERSION', () => {
  it('names the ruleset a recorded binding was decided under', () => {
    expect(SCHOLAR_RESOLUTION_VERSION).toBe('scholar-resolution.v1');
    expect(SCHOLAR_DISAMBIGUATION_CAP).toBe(3);
  });
});

describe('the import path the runner uses', () => {
  // `packages/db` (Task 5) typechecks under moduleResolution 'node', which
  // ignores the `exports` map and resolves only a deep path — while Node at
  // RUNTIME honours the map and refuses any path it does not list. So the deep
  // specifier has to be a key in its own right, or the module typechecks and
  // then throws ERR_PACKAGE_PATH_NOT_EXPORTED the first time it is loaded.
  // Measured both ways from packages/db on 2026-09-09.
  it('is listed in the exports map, so it resolves at runtime and not only in tsc', () => {
    const pkg: unknown = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    const exportsMap = (pkg as { exports?: Record<string, string> }).exports ?? {};
    expect(exportsMap['./src/scholar/resolve']).toBe('./src/scholar/resolve.ts');
  });

  it('stays off the barrel, which reaches client components', async () => {
    const barrel: Record<string, unknown> = await import('../src/index');
    expect(Object.keys(barrel)).not.toContain('resolveScholarProfile');
    const scholarBarrel: Record<string, unknown> = await import('../src/scholar/index');
    expect(Object.keys(scholarBarrel)).not.toContain('resolveScholarProfile');
  });
});

describe('the derived multi-card fixture is derived, and says so', () => {
  // Case (d) is the one branch with no real input anywhere in the world we
  // could reach, so the substitute has to be auditable: every byte of markup
  // under test came out of a capture, and only the ARRANGEMENT is ours.
  it('is built from card rows that appear verbatim in two real captures', () => {
    expect(derivedMultiCard.startsWith('<!--')).toBe(true);
    expect(derivedMultiCard).toContain('DERIVED FIXTURE — NOT A CAPTURE');

    const cardRow = (html: string): string => {
      const cluster = html.indexOf('User profiles for');
      const start = html.indexOf('<tbody>', cluster) + '<tbody>'.length;
      const end = html.indexOf('</tbody>', cluster);
      return html.slice(start, end);
    };
    expect(derivedMultiCard).toContain(cardRow(sripa));
    expect(derivedMultiCard).toContain(cardRow(wanapat));

    // …and it really does present two cards, which is the shape no capture has.
    expect(parseScholarSearchPage(derivedMultiCard).profileCards.map((c) => c.authorId)).toEqual([
      '1oFnFuEAAAAJ',
      'ba5L6LwAAAAJ',
    ]);
  });
});

describe('case (a) — no profile card', () => {
  // THE MEASURED CASE. This search returned no cluster at all, and a byline
  // anchor carried `wmV9HqoAAAAJ` — verified by fetching it: Chindaprasirt, P,
  // Professor, Department of Civil Engineering, 40 publication rows.
  it('resolves from the byline anchor whose text names the person searched for', () => {
    const decision = resolveFrom(asVisChindaprasirt, 'Prinya Chindaprasirt');
    expect(decision).toMatchObject({
      kind: 'use-profile',
      authorId: 'wmV9HqoAAAAJ',
      via: 'byline-link',
      matchedName: 'P Chindaprasirt',
    });
    // The article rows survive as the degraded fallback if the profile fetch
    // fails, flagged as the sample they are — this page was full.
    expect(decision.kind === 'use-profile' && decision.searchHits.length).toBe(10);
    expect(decision.kind === 'use-profile' && decision.searchHitsAreSample).toBe(true);
  });

  // MUTATION-TESTED (the anchor-match check): deleting the
  // `matchesScholarAuthorName` guard from `matchingBylineAuthorIds` makes this
  // bind `cfNL0DMAAAAJ` (T Phoo-ngernkham, a co-author who happens to be
  // listed first). Measured: 3 of the 22 tests fail under that mutation, this
  // one among them, and it is the only one that pins the ORDER — on the
  // `as_vis` page above the subject is the first anchor anyway.
  it('picks the subject own anchor, not the first anchor on the page', () => {
    const links = parseScholarSearchPage(noVisChindaprasirt).hits.flatMap((h) => h.authorLinks);
    expect(links[0]?.authorId).toBe('cfNL0DMAAAAJ');
    expect(resolveFrom(noVisChindaprasirt, 'Prinya Chindaprasirt')).toMatchObject({
      kind: 'use-profile',
      authorId: 'wmV9HqoAAAAJ',
      via: 'byline-link',
    });
  });

  // The same page read for a different person resolves to that person. Byline
  // anchors are selected by NAME, never by position or prominence.
  it('resolves a co-author on the same page when it is the co-author being searched', () => {
    expect(resolveFrom(asVisChindaprasirt, 'Chalermchai Jaturapitakkul')).toMatchObject({
      kind: 'use-profile',
      authorId: '7ZXE3BoAAAAJ',
      via: 'byline-link',
    });
  });

  // A byline anchor that does not match is a CO-AUTHOR, and this page carries
  // nine of them for a person who is not on it at all.
  //
  // NOT mutation-sensitive on its own, and said so rather than claimed
  // otherwise: with the anchor-match guard deleted this page yields four
  // distinct matching ids, the uniqueness rule below refuses them, and the
  // decision comes out `probe-without-as-vis` either way. The guard is caught
  // by the two tests above; this one states the contract at the surface the
  // runner reads.
  it('binds nothing from bylines for someone the page does not name', () => {
    const decision = resolveFrom(asVisChindaprasirt, 'Denpong Soodphakdee');
    expect(decision.kind).toBe('probe-without-as-vis');
  });

  // MUTATION-TESTED (the short-page probe guard): removing the
  // `if (searchPageWasFull)` condition makes this ask for a second 75-credit
  // search on a page Scholar had already answered in full. Measured: 2 tests
  // fail under that mutation, this one and the two-matching-bylines refusal.
  it('does not ask for the 75-credit probe when the page came back short', () => {
    const page = parseScholarSearchPage(plainTextBylines);
    expect(page.pageWasFull).toBe(false);
    expect(page.profileCards).toEqual([]);
    // A whole page of plain-text bylines: no anchors to resolve from either.
    expect(page.hits.every((hit) => hit.authorLinks.length === 0)).toBe(true);

    const decision = resolveFrom(plainTextBylines, 'Kittisak Sawanyawisuth');
    expect(decision.kind).toBe('use-articles');
    expect(decision.kind === 'use-articles' && decision.searchHits.length).toBe(4);
    // A short page is the whole answer, so its rows are not a sample.
    expect(decision.kind === 'use-articles' && decision.searchHitsAreSample).toBe(false);
  });

  it('asks for the probe when the page was full and no byline named the person', () => {
    const page = parseScholarSearchPage(asVisChindaprasirt);
    expect(page.pageWasFull).toBe(true);
    const decision = resolveFrom(asVisChindaprasirt, 'Denpong Soodphakdee');
    expect(decision).toMatchObject({ kind: 'probe-without-as-vis', searchHitsAreSample: true });
    // The rows travel with the decision so a probe that resolves nothing still
    // has something honest to fall back on.
    expect(decision.kind === 'probe-without-as-vis' && decision.searchHits.length).toBe(10);
  });

  // Two DIFFERENT ids answering to the same written name on one page is the
  // namesake problem in miniature, and this page carries nothing that could
  // separate them. Refuse, and let the probe or a pasted URL settle it.
  it('refuses to bind when two different byline anchors both match', () => {
    const hit = (links: ScholarSearchHit['authorLinks']): ScholarSearchHit => ({
      title: 'A paper',
      link: null,
      authorsLine: 'P Chindaprasirt - A Journal, 2020',
      authorLinks: links,
      year: 2020,
      venue: 'A Journal',
    });
    const decision = resolveScholarProfile({
      queryName: 'Prinya Chindaprasirt',
      profileCards: [],
      searchHits: [
        hit([{ name: 'P Chindaprasirt', authorId: 'wmV9HqoAAAAJ' }]),
        hit([{ name: 'Prinya Chindaprasirt', authorId: 'someOtherIdAAAAJ' }]),
      ],
      searchPageWasFull: false,
    });
    expect(decision.kind).toBe('use-articles');
  });
});

describe('case (b) — one card, displayed name matches', () => {
  it('binds the card and keeps the article rows as a fallback', () => {
    const decision = resolveFrom(sripa, 'Banchob Sripa');
    expect(decision).toMatchObject({
      kind: 'use-profile',
      authorId: '1oFnFuEAAAAJ',
      via: 'primary-card',
      matchedName: 'Banchob Sripa',
    });
    expect(decision.kind === 'use-profile' && decision.searchHits.length).toBe(10);
    expect(decision.kind === 'use-profile' && decision.searchHitsAreSample).toBe(true);
  });

  it('accepts the abbreviated and title-carrying forms of the same query name', () => {
    // The Task 2 matcher's job, exercised through this decision rather than
    // restated: these are the forms a KKU staff record actually holds.
    for (const queryName of ['Assoc. Prof. Banchob Sripa', 'Banchob B Sripa']) {
      expect(resolveFrom(sripa, queryName)).toMatchObject({
        kind: 'use-profile',
        authorId: '1oFnFuEAAAAJ',
        via: 'primary-card',
      });
    }
  });
});

describe('case (c) — one card, displayed name does NOT match (the alias path)', () => {
  // `Bunchob Sripha` is a transliteration variant of the same Thai name —
  // exactly the kind of spelling a staff record carries and a Scholar profile
  // lists under "Other names". One card came back for it, so GOOGLE matched
  // the query through an index we cannot see. We trust that; what we do not
  // trust is the article rows the same query returned.
  //
  // MUTATION-TESTED: making this branch carry the parsed hits (`...carry`
  // instead of `...carryNothing`) fails the two alias tests in this block and
  // nothing else — emptiness here is a contract, not an accident of the page.
  it('binds the card and returns NO article results', () => {
    const decision = resolveFrom(sripa, 'Bunchob Sripha');
    expect(decision).toMatchObject({
      kind: 'use-profile',
      authorId: '1oFnFuEAAAAJ',
      via: 'alias-card',
      matchedName: 'Banchob Sripa',
    });
    expect(decision.kind === 'use-profile' && decision.searchHits).toEqual([]);
    // …and not merely empty: nothing downstream may read them as a truncated
    // sample of the subject's work either.
    expect(decision.kind === 'use-profile' && decision.searchHitsAreSample).toBe(false);
    // The page really did have ten rows to drop.
    expect(parseScholarSearchPage(sripa).hits).toHaveLength(10);
  });

  it('takes the alias path on the second real one-card capture too', () => {
    const decision = resolveFrom(wanapat, 'Metha Wanaphat');
    expect(decision).toMatchObject({
      kind: 'use-profile',
      authorId: 'ba5L6LwAAAAJ',
      via: 'alias-card',
    });
    expect(decision.kind === 'use-profile' && decision.searchHits).toEqual([]);
  });
});

describe('case (d) — several cards (DERIVED input; unproven in the wild)', () => {
  it('prefers the card whose displayed name matches, and drops the mixed rows', () => {
    const decision = resolveFrom(derivedMultiCard, 'Banchob Sripa');
    expect(decision).toMatchObject({
      kind: 'use-profile',
      authorId: '1oFnFuEAAAAJ',
      via: 'multi-card-primary',
      matchedName: 'Banchob Sripa',
    });
    // Several cards means several people answer to this name on this page, so
    // its article rows are a mixture. Same reasoning as the alias path.
    expect(decision.kind === 'use-profile' && decision.searchHits).toEqual([]);
  });

  it('hands back the candidates when no displayed name matches, rather than guessing', () => {
    const decision = resolveFrom(derivedMultiCard, 'Bunchob Sripha');
    expect(decision).toEqual({
      kind: 'disambiguate',
      candidateIds: ['1oFnFuEAAAAJ', 'ba5L6LwAAAAJ'],
    });
  });

  // Hand-built cards: this is the function's INPUT type, and the rule under
  // test is arithmetic on a list rather than anything about Scholar's markup.
  it('caps the candidates at three profile fetches', () => {
    const decision = resolveScholarProfile({
      queryName: 'Bunchob Sripha',
      profileCards: [
        { authorId: 'aAAAAAAAAAJ', name: 'Somchai Jaidee', affiliation: null },
        { authorId: 'bAAAAAAAAAJ', name: 'Metha Wanapat', affiliation: null },
        { authorId: 'cAAAAAAAAAJ', name: 'Banchob Sripa', affiliation: null },
        { authorId: 'dAAAAAAAAAJ', name: 'Nopporn Sripa', affiliation: null },
      ],
      searchHits: [],
      searchPageWasFull: false,
    });
    expect(decision).toEqual({
      kind: 'disambiguate',
      candidateIds: ['aAAAAAAAAAJ', 'bAAAAAAAAAJ', 'cAAAAAAAAAJ'],
    });
  });
});

describe('a blank query name resolves nothing', () => {
  // Without a name, every comparison in the function is vacuous — and case (c)
  // consults no comparison at all, so an unguarded blank query would bind the
  // first card it saw on no evidence whatsoever.
  it('refuses even when a single card is sitting there', () => {
    for (const blank of ['', '   ']) {
      const decision = resolveFrom(sripa, blank);
      expect(decision.kind).toBe('use-articles');
    }
    expect(resolveScholarDisambiguation({
      queryName: '  ',
      candidates: [{ authorId: 'aAAAAAAAAAJ', primaryName: 'Banchob Sripa', otherNames: [] }],
    })).toEqual({ kind: 'no-binding' });
  });
});

describe('resolveScholarDisambiguation — how much an Other name counts', () => {
  const candidate = (
    authorId: string,
    primaryName: string,
    otherNames: readonly string[] = [],
  ) => ({ authorId, primaryName, otherNames });

  it('lets a primary-name match win outright, ahead of any Other name', () => {
    expect(
      resolveScholarDisambiguation({
        queryName: 'Prinya Chindaprasirt',
        candidates: [
          candidate('aAAAAAAAAAJ', 'Somchai Jaidee', ['Prinya Chindaprasirt']),
          candidate('bAAAAAAAAAJ', 'Prinya Chindaprasirt'),
        ],
      }),
    ).toEqual({
      kind: 'use-profile',
      authorId: 'bAAAAAAAAAJ',
      via: 'primary-name',
      matchedName: 'Prinya Chindaprasirt',
    });
  });

  it('accepts an Other name that clears the same bar every other comparison clears', () => {
    // Neither primary name matches — the second is a different transliteration
    // — so the decision can only come from the Other-names field, in Scholar's
    // own abbreviated house style.
    expect(
      resolveScholarDisambiguation({
        queryName: 'Prinya Chindaprasirt',
        candidates: [
          candidate('aAAAAAAAAAJ', 'Somchai Jaidee'),
          candidate('bAAAAAAAAAJ', 'Prinya Chindaprasert', ['P Chindaprasirt']),
        ],
      }),
    ).toEqual({
      kind: 'use-profile',
      authorId: 'bAAAAAAAAAJ',
      via: 'other-name',
      matchedName: 'P Chindaprasirt',
    });
  });

  it('refuses a mononym or initials-only Other name, and binds nothing', () => {
    // "Other names" is free text its owner controls. `Chindaprasirt` alone
    // names every Chindaprasirt; `P.C.` names most of a university. Neither is
    // enough to attach a person's publications to a staff record — and both
    // are refused by the matcher's own two-token floor, which is the point of
    // holding this check to the same matcher rather than a looser one.
    for (const otherName of ['Chindaprasirt', 'P.C.', 'P. C.', 'Prinya']) {
      expect(
        resolveScholarDisambiguation({
          queryName: 'Prinya Chindaprasirt',
          candidates: [candidate('aAAAAAAAAAJ', 'Somchai Jaidee', [otherName])],
        }),
      ).toEqual({ kind: 'no-binding' });
    }
  });

  it('refuses when nothing matches at all', () => {
    expect(
      resolveScholarDisambiguation({
        queryName: 'Prinya Chindaprasirt',
        candidates: [
          candidate('aAAAAAAAAAJ', 'Somchai Jaidee', ['S Jaidee']),
          candidate('bAAAAAAAAAJ', 'Metha Wanapat', ['M Wanapat']),
        ],
      }),
    ).toEqual({ kind: 'no-binding' });
  });

  it('honours the cap even if the caller hands over more than three', () => {
    expect(
      resolveScholarDisambiguation({
        queryName: 'Prinya Chindaprasirt',
        candidates: [
          candidate('aAAAAAAAAAJ', 'Somchai Jaidee'),
          candidate('bAAAAAAAAAJ', 'Metha Wanapat'),
          candidate('cAAAAAAAAAJ', 'Banchob Sripa'),
          candidate('dAAAAAAAAAJ', 'Prinya Chindaprasirt'),
        ],
      }),
    ).toEqual({ kind: 'no-binding' });
  });
});
