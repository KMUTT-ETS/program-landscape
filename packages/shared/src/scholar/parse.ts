// packages/shared/src/scholar/parse.ts
//
// Pure parser for ScrapingBee's raw Google Scholar HTML responses. No
// network calls, no DOM, no HTML parser dependency — Scholar's markup is
// simple enough (and this package is imported by client bundles, where a
// full HTML-parsing library is dead weight) that targeted regexes on known,
// verified structure are the right tool. See the module-level notes below
// for exactly what was verified and what was not.
//
// `SCHOLAR_PARSER_VERSION` is stamped onto `ScholarFetchArchive.parserVersion`
// (Task 6) so an archived raw payload can be reprocessed under a later parser
// instead of re-scraping.
import type { ScholarPaper } from './merge';

export const SCHOLAR_PARSER_VERSION = 'scholar-parse.v1';

export interface ScholarCandidate {
  /** The Scholar `user=` id — what a confirmed binding stores as `scholarProfileId`. */
  profileId: string;
  name: string;
  affiliation: string | null;
  otherNames: string[];
  interests: string[];
  paperCount: number | null;
}

// ── HTML text helpers ─────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

/** Decodes the small set of entities Scholar actually emits, plus numeric entities generally. */
function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

/** Strips any inner tags (Scholar's list markup is plain text today, but titles/venues are defended anyway) and decodes entities. */
function cleanText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

// ── Publications ───────────────────────────────────────────────────────────
//
// Verified against two real captures of a public profile's "My citations"
// list (`citations?user=<id>&cstart=<n>&pagesize=100`), one page of the
// 100 most-cited works and one deep page (cstart=700) that surfaces the
// sparse/old-entry cases:
//
//   <tr class="gsc_a_tr">
//     <td class="gsc_a_t">
//       <a href="/citations?view_op=view_citation&...&citation_for_view=<PROFILE>:<PAPER>"
//          class="gsc_a_at">TITLE</a>
//       <div class="gs_gray">AUTHORS</div>
//       <div class="gs_gray">VENUE<span class="gs_oph">, YEAR</span></div>
//     </td>
//     <td class="gsc_a_c"><a href="..." class="gsc_a_ac gs_ibl">CITATIONS</a></td>
//     <td class="gsc_a_y"><span class="gsc_a_h gsc_a_hc gs_ibl">YEAR</span></td>
//   </tr>
//
// Confirmed real variations (not invented — all observed in the captures):
//   - the second `gs_gray` div (venue) can be entirely empty, with no
//     `gs_oph` year span at all
//   - the `gsc_a_y` year span can be empty (year genuinely unknown to
//     Scholar) — occasionally paired with a `gs_oph` value of literal "0"
//   - the citation-count anchor can have empty href AND empty text (0
//     citations rendered as nothing, not "0")
//   - titles and venues can carry `&amp;` / `&quot;` etc.
//
// NOT present anywhere in either capture, confirmed by full-text search:
//   - a DOI. Scholar's list view never carries one — only the per-paper
//     citation detail page might, and this parser only ever sees the list
//     page. `doi` is therefore always null from this parser; a future
//     enrichment pass against the detail page is a separate concern.
//   - an explicit publication "type". Scholar's list view has no type
//     field at all — `type` is therefore always null from this parser,
//     matching the spec's "no type" case for effectively every row.
const ROW_RE = /<tr class="gsc_a_tr">([\s\S]*?)<\/tr>/g;
const TITLE_RE = /href="[^"]*citation_for_view=([^"&]+)"[^>]*class="gsc_a_at">([\s\S]*?)<\/a>/;
const VENUE_RE = /<div class="gs_gray">[\s\S]*?<\/div>\s*<div class="gs_gray">([\s\S]*?)<\/div>/;
const CITATIONS_RE = /class="gsc_a_c">\s*<a[^>]*class="gsc_a_ac gs_ibl">(\d*)<\/a>/;
const YEAR_RE = /class="gsc_a_y">\s*<span class="gsc_a_h gsc_a_hc gs_ibl">(\d*)<\/span>/;
const TRAILING_YEAR_SPAN_RE = /<span class="gs_oph">[^<]*<\/span>\s*$/;

/**
 * Parses a Scholar profile's publication-list page (one `cstart` page) into
 * `ScholarPaper[]`.
 *
 * A row with no resolvable year is DROPPED, never emitted with a guessed or
 * sentinel year — `ScholarPaper.year` is non-null and feeds year-banded
 * aggregates downstream (`ResearchOutput.year`), and a wrong year there is
 * worse than a missing paper. This is confirmed real Scholar behaviour, not
 * a hypothetical: some rows carry no year in either the `gsc_a_y` column or
 * the venue string.
 *
 * Never throws. A page with no recognisable rows (empty input, an error
 * page, a redirect shell) returns `[]`.
 */
export function parseScholarPublications(html: string): ScholarPaper[] {
  if (!html) return [];

  const out: ScholarPaper[] = [];
  for (const rowMatch of html.matchAll(ROW_RE)) {
    const row = rowMatch[1] ?? '';

    const titleMatch = TITLE_RE.exec(row);
    if (!titleMatch) continue; // not a real publication row — skip, don't guess
    const scholarPaperId = decodeHtmlEntities(titleMatch[1]!);
    const title = cleanText(titleMatch[2]!);
    if (!scholarPaperId || !title) continue;

    const yearMatch = YEAR_RE.exec(row);
    const yearText = yearMatch?.[1] ?? '';
    if (!yearText) continue; // genuinely unknown year — drop, per the contract above
    const year = Number(yearText);
    if (!Number.isFinite(year) || year <= 0) continue;

    const venueMatch = VENUE_RE.exec(row);
    const venueRaw = venueMatch?.[1] ?? '';
    const venueText = cleanText(venueRaw.replace(TRAILING_YEAR_SPAN_RE, ''));
    const venue = venueText.length > 0 ? venueText : null;

    const citationsMatch = CITATIONS_RE.exec(row);
    const citationsText = citationsMatch?.[1] ?? '';
    const citations = citationsText ? Number(citationsText) : 0;

    out.push({
      scholarPaperId,
      title,
      year,
      doi: null, // never present on the list page — see notes above
      citations: Number.isFinite(citations) ? citations : 0,
      venue,
      type: null, // never present on the list page — see notes above
    });
  }
  return out;
}

// ── Candidates (author search) ──────────────────────────────────────────
//
// UNIMPLEMENTED — deliberately, not an oversight.
//
// Google Scholar's `citations?view_op=search_authors&mauthors=<name>` page
// could not be captured this session. Every attempt through ScrapingBee —
// default proxy, `premium_proxy=true`, `stealth_proxy=true`, `render_js`
// both on and off, `country_code=us` (default) and `country_code=th`, with
// and without a `Referer` header pointing at a real profile page, across
// multiple names — deterministically returned an HTTP-level 302 redirect
// to `accounts.google.com/.../signin` instead of the search results. The
// *same session's* fetch of an individual profile page
// (`citations?user=<id>`) and of the bare Scholar homepage both succeeded
// cleanly with no such wall, so this is specific to `view_op=search_authors`
// — Google appears to require an authenticated session for that view now,
// independent of proxy quality. See the captured
// `author-search-blocked-signin-wall.html` fixture (the real response) and
// the Task 4 session report for the full diagnostic trail.
//
// Per the design's own rule — a parser tested against imagined markup is
// worse than no parser — this function does NOT guess at
// `search_authors`'s field layout from general knowledge of older Scholar
// HTML. It safely returns `[]` for any input. The shape below
// (`ScholarCandidate`) is real: it is transcribed from the design doc's
// disambiguation requirements, not from markup. Implementing extraction
// needs either a real capture (a session where the wall does not trigger,
// or a ScrapingBee tier/technique that gets past it) or a design change
// (e.g. bind-by-profile-URL instead of search-by-name) — flagged upstream,
// not silently worked around here.
export function parseScholarCandidates(html: string): ScholarCandidate[] {
  void html;
  return [];
}
