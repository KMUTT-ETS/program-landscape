// packages/shared/src/scholar/search-parse.ts
//
// SERVER-ONLY SUBPATH — `@kku/shared/scholar/search-parse`.
//
// Deliberately NOT re-exported from `./index.ts`, and therefore not from the
// `@kku/shared` barrel: this module depends on `cheerio`, a large server-only
// HTML parser, and the barrel is imported all over apps/web. Keeping it on its
// own subpath means a bundle only pays for cheerio if it actually parses a
// Scholar search page. `@kku/shared/scholar/parse` — the pasted-URL validator
// a CLIENT component imports — must never import this module; that is the
// boundary this file exists on the far side of.
//
// ── What this parses, and why it is not `parse.ts` ────────────────────────
//
// `parse.ts` reads a Scholar PROFILE page (`/citations?user=<id>`) with
// targeted regexes: that markup is a small, stable table and the regexes are
// cheap enough to ship to a browser. This module reads a Scholar SEARCH page
// (`/scholar?q=<name>`), which is a different problem: the result rows nest
// several optional blocks, the author byline carries a variable number of
// anchors, and the profile cluster's own markup varies between layouts. Real
// HTML parsing is the right tool there, and the reference implementation this
// is ported from (`~/projects/mhesi-program-review`, in production) uses
// cheerio for exactly this markup.
//
// ── Verified against ──────────────────────────────────────────────────────
//
// Every selector below was checked against REAL ScrapingBee captures
// committed under `test/fixtures/scholar/` (see the README there for what
// each one contains and what it cost). Nothing here is guessed from general
// knowledge of Scholar's HTML. Where a shape could NOT be captured it is
// marked UNVERIFIED and the code degrades to returning nothing rather than
// inventing a reading.

import * as cheerio from 'cheerio';

export const SCHOLAR_SEARCH_PARSER_VERSION = 'scholar-search-parse.v1';

/**
 * Rows Scholar puts on one search page. Not configurable — `num=` is silently
 * rejected by ScrapingBee's `custom_google` proxy (HTTP 500), so we always get
 * Scholar's default page.
 *
 * This number is the whole basis of `pageWasFull`, which is the basis of every
 * "this is a sample, not a count" flag downstream. Measured across the
 * committed captures: 10 on each of the three full pages; 2, 4 and 8 on the
 * short ones.
 */
export const SCHOLAR_SEARCH_PAGE_SIZE = 10;

/** A card in the "User profiles for X" cluster at the top of a search page. */
export interface ScholarProfileCard {
  /** The Scholar `user=` id — what a binding stores as `scholarProfileId`. */
  authorId: string;
  /** The name the card displays. May be an alias of the queried name. */
  name: string;
  /** The card's affiliation line, when Scholar renders one. */
  affiliation: string | null;
}

/**
 * One `/citations?user=` anchor inside a result's author byline.
 *
 * `name` is the ANCHOR TEXT, which is Scholar's abbreviated house style
 * (`P Chindaprasirt`) — not a full name. `matchesScholarAuthorName` is built
 * for exactly that form; do not compare it with `personNamesMatch`.
 *
 * A byline link whose name does NOT match the person being searched for is a
 * CO-AUTHOR. Binding it would attach one person's publications to another's
 * staff record, which is the mis-attribution error this whole feature is
 * organised to avoid. The matching decision is Task 4's, not this parser's;
 * this module only reports what the page says.
 */
export interface ScholarBylineAuthorLink {
  name: string;
  authorId: string;
}

/** One article result on a search page. */
export interface ScholarSearchHit {
  title: string;
  /** Absolute URL. Scholar's relative hrefs are resolved against the base. */
  link: string | null;
  /** The whole `div.gs_a` byline, whitespace-collapsed. */
  authorsLine: string;
  /** Per-author profile links found inside the byline. Often empty — see the
   *  plain-text-byline fixture; that is a real Scholar shape, not a failure. */
  authorLinks: ScholarBylineAuthorLink[];
  year: number | null;
  venue: string | null;
}

export interface ScholarSearchResults {
  hits: ScholarSearchHit[];
  /**
   * Result rows Scholar rendered, BEFORE any filtering — citation-only rows
   * and title-less rows included.
   *
   * TRUNCATION IS JUDGED ON THIS NUMBER, never on `hits.length`. A full page
   * that filters down to three rows is still a truncated page, and reporting
   * its filtered count as a total is a real production bug the reference
   * implementation hit. Keep the two apart.
   */
  rawRowCount: number;
  /** `rawRowCount >= SCHOLAR_SEARCH_PAGE_SIZE` — i.e. Scholar had more to
   *  give. When true, any count derived from this page is a FLOOR. */
  pageWasFull: boolean;
}

export interface ScholarSearchPage extends ScholarSearchResults {
  profileCards: ScholarProfileCard[];
}

const SCHOLAR_BASE = 'https://scholar.google.com';

/** `/citations?user=<id>&hl=en&oi=ao` → `<id>`. Null for anything else. */
function extractAuthorId(href: string | undefined): string | null {
  if (!href) return null;
  const match = /[?&]user=([^&]+)/.exec(href);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A malformed percent-escape is not worth throwing over — the id is
    // unusable either way, and this parser must never throw on real input.
    return match[1];
  }
}

function absoluteLink(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? `${SCHOLAR_BASE}${trimmed}` : null;
}

/** `\s` covers the `&nbsp;` (U+00A0) Scholar uses throughout its bylines. */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// ── Profile cluster ────────────────────────────────────────────────────────
//
// VERIFIED shape (test/fixtures/scholar/search-novis-sripa.html and
// -wanapat.html, captured 2026-09-09):
//
//   <div class="gs_r">
//     <h3 class="gs_rt">
//       <a href="/citations?view_op=search_authors&mauthors=…">
//         User profiles for <b>Banchob Sripa</b></a></h3>
//     <table><tbody><tr>
//       <td>…feather image…</td>
//       <td><h4 class="gs_rt2">
//             <a href="/citations?user=1oFnFuEAAAAJ&hl=en&oi=ao">
//               <b>Banchob Sripa</b></a></h4>
//           <div class="gs_nph">Khon Kaen University</div>
//           <div>Verified email at kku.ac.th</div>
//           <div>Cited by 21444</div></td>
//     </tr></tbody></table>
//   </div>
//
// DIVERGENCE from the reference: it looks for an `h4` whose text contains
// "user profile". In every capture we took, that text is in the `h3.gs_rt`
// HEADER and the `h4.gs_rt2` holds the PERSON'S NAME — so the reference's
// primary selector finds nothing here and the run silently falls through to
// its fallback. We therefore accept the header text on any heading level.
// This is strictly wider than the reference, so a layout the reference
// handles still resolves.
//
// The fallback (any `/citations?user=` anchor not inside a `.gs_a` byline)
// is kept verbatim in spirit, and it is load-bearing rather than defensive:
// it is what caught the single card in both cluster captures before the
// heading-level fix, and it is what would catch a card Scholar inlines with
// no header at all.
//
// UNVERIFIED: a cluster carrying MORE THAN ONE card. Ten live searches on
// 2026-09-09 (three real KKU researchers, two bare surnames, a bare given
// name, two deliberately common Western names and a Thai-language query)
// produced a cluster three times, each time with exactly one card. The per-anchor `closest('td')` walk below is
// written so that N cards yield N entries whatever the surrounding layout —
// but it has not been seen to do so, and the dedupe-by-id Map means a
// repeated card collapses rather than duplicating. Treat multi-card as
// designed-for, not proven.

const PROFILE_CLUSTER_HEADING = 'user profile';

/**
 * Parse the "User profiles for X" cluster off a Scholar search page.
 *
 * Returns `[]` — never throws — for a page with no cluster, an error page, a
 * sign-in wall, or empty input. "No cluster" is the COMMON case: four of our
 * six captures have none, including one for a professor who demonstrably has
 * a profile. An empty result means "the page did not say", not "this person
 * has no Scholar profile".
 */
export function parseScholarProfileCluster(html: string): ScholarProfileCard[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const cards = new Map<string, ScholarProfileCard>();

  // Takes primitives rather than a Cheerio selection so the two call sites
  // below share the decision without either of them needing a cast.
  const addCard = (href: string | undefined, rawName: string, rawAffiliation: string): void => {
    if (!href?.includes('/citations?user=')) return;
    const authorId = extractAuthorId(href);
    const name = collapse(rawName);
    if (!authorId || !name) return;
    if (cards.has(authorId)) return;
    const affiliation = collapse(rawAffiliation);
    cards.set(authorId, {
      authorId,
      name,
      affiliation: affiliation.length > 0 ? affiliation : null,
    });
  };

  $('h1, h2, h3, h4').each((_, heading) => {
    if (!$(heading).text().toLowerCase().includes(PROFILE_CLUSTER_HEADING)) return;
    $(heading)
      .closest('div.gs_r')
      .find('a')
      .each((__, anchor) => {
        const $anchor = $(anchor);
        // The affiliation sits in a sibling `div.gs_nph` inside the same card
        // cell. Scoped to the anchor's own `<td>` so a multi-card cluster
        // cannot hand one card another card's affiliation.
        addCard(
          $anchor.attr('href'),
          $anchor.text(),
          $anchor.closest('td').find('div.gs_nph').first().text(),
        );
      });
  });

  if (cards.size === 0) {
    $('a[href*="/citations?user="]').each((_, anchor) => {
      const $anchor = $(anchor);
      // Per-paper author bylines live inside `div.gs_a`. Those are co-authors
      // of a result, not profile cards, and reading them as cards is exactly
      // how the wrong person gets bound.
      if ($anchor.closest('.gs_a').length > 0) return;
      addCard(
        $anchor.attr('href'),
        $anchor.text(),
        $anchor.closest('td').find('div.gs_nph').first().text(),
      );
    });
  }

  return [...cards.values()];
}

// ── Search hits ────────────────────────────────────────────────────────────
//
// VERIFIED shape (all five committed search captures):
//
//   <div class="gs_r gs_or gs_scl" data-cid="…">
//     …
//     <div class="gs_ri">
//       <h3 class="gs_rt">
//         <span class="gs_ctc"><span class="gs_ct1">[PDF]</span>…</span>
//         <a id="…" href="https://…">TITLE</a></h3>
//       <div class="gs_a">
//         <a href="/citations?user=…&hl=en&oi=sra">P <b>Chindaprasirt</b></a>,
//         C Jaturapitakkul&nbsp;- Cement and Concrete&nbsp;…, 2007 - Elsevier
//       </div>
//       …
//
// The byline is EITHER anchored or plain text, per author and per row. The
// `search-novis-sawanyawisuth.html` capture is an entire page of plain-text
// bylines: four results, zero extractable ids. That page is not a failure and
// must not be treated as one.
//
// `span.gs_ctc` carries both the `[PDF]` badge and the `[CITATION]` marker, so
// the citation-only test matches on the WORD, exactly as the reference does —
// a `[PDF]` row is a real result and must survive.

const CITATION_ONLY_MARKER = 'CITATION';
const YEAR_RE = /\b(19|20)\d{2}\b/;

/**
 * Parse the article results off a Scholar search page.
 *
 * Never throws. A page with no result rows returns zero hits, `rawRowCount`
 * 0 and `pageWasFull` false.
 */
export function parseScholarSearchHits(html: string): ScholarSearchResults {
  if (!html) return { hits: [], rawRowCount: 0, pageWasFull: false };
  const $ = cheerio.load(html);
  const hits: ScholarSearchHit[] = [];
  let rawRowCount = 0;

  $('div.gs_r.gs_or').each((_, row) => {
    // Counted BEFORE any skip below. See `rawRowCount`'s contract: the
    // truncation question is "did Scholar fill the page", not "how many rows
    // survived our filters".
    rawRowCount += 1;

    const heading = $(row).find('h3.gs_rt').first();
    if ($(row).find('span.gs_ctc').text().includes(CITATION_ONLY_MARKER)) return;

    const titleAnchor = heading.find('a').first();
    const title = collapse(titleAnchor.text()) || collapse(heading.text());
    if (!title) return;

    const bylineBlock = $(row).find('div.gs_a').first();
    const authorsLine = collapse(bylineBlock.text());

    const authorLinks: ScholarBylineAuthorLink[] = [];
    const seenAuthorIds = new Set<string>();
    bylineBlock.find('a').each((__, anchor) => {
      const authorId = extractAuthorId($(anchor).attr('href'));
      const name = collapse($(anchor).text());
      if (!authorId || !name) return;
      // One row can list the same profile twice (Scholar repeats a linked
      // author across the "…" elision). Keep the first.
      if (seenAuthorIds.has(authorId)) return;
      seenAuthorIds.add(authorId);
      authorLinks.push({ name, authorId });
    });

    const yearMatch = YEAR_RE.exec(authorsLine);
    const year = yearMatch ? Number(yearMatch[0]) : null;

    hits.push({
      title,
      link: absoluteLink(titleAnchor.attr('href')),
      authorsLine,
      authorLinks,
      year: year !== null && Number.isFinite(year) ? year : null,
      venue: extractVenue(authorsLine),
    });
  });

  return { hits, rawRowCount, pageWasFull: rawRowCount >= SCHOLAR_SEARCH_PAGE_SIZE };
}

/**
 * The venue out of a byline line.
 *
 * Scholar's byline is `AUTHORS - VENUE, YEAR - PUBLISHER`. Both the year and
 * the trailing publisher are stripped; what is left is the venue, which is
 * itself frequently elided by Scholar to `Cement and Concrete …`. That
 * ellipsis is Scholar's, not ours, and is kept — a truncated venue is honest,
 * a reconstructed one is not.
 */
function extractVenue(authorsLine: string): string | null {
  if (!authorsLine.includes(' - ')) return null;
  const afterAuthors = authorsLine.split(' - ').slice(1).join(' - ');
  const venue = afterAuthors
    .replace(/,?\s*\b(19|20)\d{2}\b.*$/, '')
    .replace(/\s*-\s*[^-]+$/, '')
    .trim();
  return venue.length > 0 ? venue : null;
}

/**
 * Both halves of one search response — the profile cluster and the article
 * results — from a single parse of a single fetch.
 *
 * A search costs 75 credits, so the page is read once and asked both
 * questions; never fetch twice to answer them separately.
 */
export function parseScholarSearchPage(html: string): ScholarSearchPage {
  return {
    profileCards: parseScholarProfileCluster(html),
    ...parseScholarSearchHits(html),
  };
}
