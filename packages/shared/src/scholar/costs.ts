// Scholar request kinds and their prices.
//
// SPLIT OUT OF `scrapingbee.ts` DELIBERATELY, AND THIS FILE MUST STAY PURE.
//
// The transport does I/O and owns the API key. This module is arithmetic and a
// URL classifier, and it is what the estimator and the API need — neither of
// them fetches anything. Keeping them together meant that importing a price
// pulled in the whole HTTP client, and `credits.ts` (which the barrel exports)
// did exactly that.
//
// The cost of that coupling was measured, not theorised: on 2026-09-09 a
// missing `zod` import inside the transport returned HTTP 500 for the entire
// `/profile` page. The chain was
//
//     apps/web/src/lib/profile-data.ts   (imports ONE constant at runtime)
//       -> @kku/shared barrel
//         -> scholar/index.ts
//           -> credits.ts
//             -> scrapingbee.ts          (the broken module)
//
// A user's profile page cannot render because of a defect in a Google scraping
// client it never calls. Splitting the prices out cuts that chain.
//
// So: no `fetch`, no `zod`, no environment reads in this file, ever. If
// something here starts needing any of those, it belongs in the transport.

/**
 * Which kind of Scholar page a request is aimed at. The two cost differently
 * and are proxied differently, so the distinction is load-bearing rather than
 * descriptive.
 */
export type ScrapingBeeRequestKind = 'profile' | 'search';

/**
 * ScrapingBee credits billed for a `/citations?user=` profile page.
 *
 * Measured 2026-09-09 on our account. ScrapingBee's docs quote 20 for a Google
 * page; the live `Spb-Cost` header reported 15 on every profile request.
 */
export const GOOGLE_PAGE_CREDIT_COST = 15;

/**
 * ScrapingBee credits billed for a `/scholar?q=` name search.
 *
 * Five times a profile page, because a search additionally needs
 * `stealth_proxy=true` — Google 403s ScrapingBee's plain `custom_google` pool
 * for searches specifically. Measured 2026-09-09 on our account.
 *
 * These two constants are for PRE-FLIGHT ESTIMATES only. The `Spb-Cost`
 * response header is authoritative for what a call actually cost, and every
 * run records it; a drift between these numbers and reality shows up in the
 * ledger rather than silently.
 */
export const GOOGLE_SEARCH_CREDIT_COST = 75;

/**
 * Classify a target URL by what it asks Google for.
 *
 * Derived from the URL rather than passed in by the caller on purpose: a
 * parameter can be passed wrongly at every call site forever, a URL cannot
 * disagree with itself.
 *
 * Anything unrecognised classifies as `search`, which is the safe default in
 * both directions — an unrecognised URL sent WITH stealth costs 60 credits too
 * many, while one sent WITHOUT it returns the silent HTTP 500 that is really a
 * Google 403. A malformed URL classifies rather than throwing.
 */
export function classifyScrapingBeeRequest(targetUrl: string): ScrapingBeeRequestKind {
  try {
    return new URL(targetUrl).pathname.includes('/citations') ? 'profile' : 'search';
  } catch {
    return 'search';
  }
}

/**
 * Detail pages fetched per sync for papers whose author list Scholar shortened.
 *
 * The profile list page cuts long author lines with "..."; only the paper's
 * own view_citation page carries the whole list, at a profile page's price. A
 * bound, current record pays this once per paper — a completed list is never
 * fetched again — so the cap only bounds the first sync of a large library,
 * and whatever it leaves is picked up by the next one.
 *
 * Lives here, not in the runner, because the bulk estimate prices it too: the
 * runner that spends it and the console that quotes it read one constant.
 */
export const SCHOLAR_AUTHOR_DETAIL_CAP = 20;

/** Pair a request kind with its price, so an estimator cannot re-derive it wrongly. */
export function creditCostForRequestKind(kind: ScrapingBeeRequestKind): number {
  return kind === 'search' ? GOOGLE_SEARCH_CREDIT_COST : GOOGLE_PAGE_CREDIT_COST;
}
