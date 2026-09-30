// Which source builds a person's publication list.
//
// WHY THIS EXISTS.
// The profile page has two ways to answer "what has this person published",
// and until now only one of them knew about the Google Scholar runner:
//
//   (a) The list itself was built by a LIVE read — Scopus by author id, with
//       the kkuscholar mirror as fallback — merged with the local
//       `research_outputs` rows as a gap-filler.
//   (b) The source-composition strip beside it counted `research_outputs`
//       directly, which is where the Scholar runner writes.
//
// So a successful Scholar fetch moved (b) and left (a) alone, and the page
// said "22 papers from Google Scholar" directly above a list that did not
// contain them. Worse, when the merge did eventually pick them up it listed
// them TWICE: a Scholar row carries no DOI, no Scopus id and no PMID, so the
// merge's dedupe keys cannot see that the live Scopus result and the Scholar
// row are the same paper. Measured on the first live record, 2026-09-09: 26
// distinct papers rendered as 34 entries.
//
// THE RULE.
// Once the Scholar runner has written a row for someone, their list is built
// from `research_outputs` alone and the live library read is not made. That is
// the operator's requirement — Scholar becomes the primary research data, the
// library index is the failover — and it is also what removes the double
// listing at its root, since the duplication was Scholar-row against
// live-Scopus-result.
//
// WHAT THIS RULE DOES *NOT* DO — and deliberately.
// It does not hide library rows already stored on the staff record. Two
// reasons, both load-bearing:
//
//   1. A Scholar run reports papers it FOUND, and a paper it found that was
//      already on the record is not re-inserted — the runner raises that row's
//      citation count and stamps `scholarPaperId` on it instead. On the first
//      live record those were 4 of the 26, and they are that person's 2024 and
//      2025 papers. "Scholar rows only" would drop the three most recent years
//      of a list whose whole point is to be current, and would make the
//      citation enrichment the runner performs invisible at the same time.
//   2. It keeps the rule MONOTONE: pressing sync can only ever add to the
//      list. Under a Scholar-rows-only rule, someone with 200 library papers
//      who fetched once and matched one paper would watch their publication
//      list collapse to a single entry. A display-precedence rule must not be
//      able to do that.
//
// Nothing is removed from any table by any of this. It decides which query
// builds the page, not what the database holds.

import {
  PUBLICATIONS_CACHE_INVALIDATED_MS,
  SCHOLAR_RESEARCH_OUTPUT_SOURCE,
} from './scholar-fetch';

/** The only field of a research row this decision reads. */
export interface PublicationSourceRow {
  source: string | null;
}

/**
 * True when the Scholar runner has written at least one row for this person.
 *
 * WHY "AT LEAST ONE ROW" AND NOT "A SUCCEEDED RUN".
 * The two are nearly the same test — this source label is stamped by the
 * runner and by nothing else, so a row cannot exist without a run having
 * succeeded — but they differ in the case that matters. A run that succeeded
 * and found nothing (a profile with no publications, or one that was already
 * fully covered by the library) would, under a run-keyed rule, switch off the
 * live library read and give back a list built from library rows the local
 * record may not hold. Keying on the rows means the switch only flips when
 * there is something to switch TO.
 *
 * The stray-single-row case is safe precisely because of the non-hiding rule
 * above: one Scholar row does not shrink a 200-paper list, it stops the live
 * lookup and serves the same 200 papers from the local record.
 */
export function hasScholarImport(rows: readonly PublicationSourceRow[]): boolean {
  return rows.some((row) => row.source === SCHOLAR_RESEARCH_OUTPUT_SOURCE);
}

// ── Cache freshness ────────────────────────────────────────────────────────

/** What a reader should do with the `staff_publications_cache` row it found. */
export type PublicationsCacheAction =
  /** No usable row: block on the recompute. */
  | 'compute'
  /** Fresh enough: return it and do nothing else. */
  | 'serve'
  /** Aged out: return it now, rebuild in the background. */
  | 'serve-and-revalidate';

export interface PublicationsCacheInput {
  /** `fetched_at` of the row, or null when there is no row. */
  cachedFetchedAtMs: number | null;
  nowMs: number;
  /** How long a row counts as fresh — the reader's own TTL. */
  freshForMs: number;
}

/**
 * Decide how to use a cached publication list.
 *
 * The branch that matters is the first one. Stale-while-revalidate is the
 * right behaviour for a row that simply aged past its TTL: the reader gets an
 * answer immediately and the next load is current. It is the WRONG behaviour
 * for a row the Scholar runner just invalidated, because the page load that
 * follows a sync is the one the user opened to see the result — serving the
 * pre-sync list there and rebuilding behind it is precisely how a working
 * import came to be reported as "the fetch worked but the list did not
 * change".
 *
 * So an invalidated row is a MISS, and the cost is one slow load, once, right
 * after an action the user asked for and is already waiting on. A row that
 * merely aged keeps the fast path.
 */
export function decidePublicationsCacheAction(
  input: PublicationsCacheInput,
): PublicationsCacheAction {
  const { cachedFetchedAtMs, nowMs, freshForMs } = input;
  if (cachedFetchedAtMs === null) return 'compute';
  if (cachedFetchedAtMs <= PUBLICATIONS_CACHE_INVALIDATED_MS) return 'compute';
  return nowMs - cachedFetchedAtMs > freshForMs ? 'serve-and-revalidate' : 'serve';
}
