// packages/shared/src/scholar/credits.ts
//
// What a Scholar run costs, in ScrapingBee credits.
//
// This lives in @kku/shared rather than beside the endpoint that enqueues,
// because TWO surfaces have to agree on the number and they run in different
// processes: `apps/api`'s bulk endpoint prices the run it is about to enqueue,
// and `apps/web`'s admin console prices the same run one round trip EARLIER,
// to put a figure in front of the operator before anything is spent. A second
// copy of `bound × 15` in the console would be a second opinion about money,
// and the first time the rule changed the confirmation dialog would quote the
// old one.

import { GOOGLE_PAGE_CREDIT_COST } from './scrapingbee';

/**
 * Floor price of a bulk run, in ScrapingBee credits.
 *
 * A target costs pages only if it gets past EVERY gate `runScholarFetch` puts
 * in front of the network, and the two that matter here are checked in this
 * order:
 *
 *   step 2, QUOTA — a person already fetched inside the 30-day window is
 *   refused here, before anything else. This is checked BEFORE binding, so a
 *   bound-and-recently-fetched person spends exactly zero even though every
 *   other signal says they are ready.
 *
 *   step 4, BINDING — no linked profile, no fetch. `fetchAllPages` is never
 *   reached, so an unbound target spends exactly zero too.
 *
 * An earlier version of this charged unbound targets two pages — one for the
 * walk, one for "the bind" — a carry-over from the superseded name-search
 * design that Google's sign-in wall killed. It made the quote roughly 10x too
 * high at rollout, when almost nobody is bound yet: 50 people with 40 unbound
 * quoted 1,350 credits against a real floor of 150. Omitting the quota gate is
 * the same class of error in the same direction: a faculty of 90 people all
 * refreshed three weeks ago quotes 1,350 credits against a real floor of 0.
 *
 * `quotaBlocked` is OPTIONAL and defaults to false, so a caller that has not
 * consulted the quota still gets the binding-only floor rather than a type
 * error. That is the conservative direction — it over-quotes, never under.
 *
 * It is a FLOOR, not a forecast: a prolific researcher's profile runs to
 * several pages (up to SCHOLAR_MAX_PAGES = 10) and this cannot know how many
 * without fetching. Callers must present it as "at least", and should say
 * separately how many targets will refuse and at which gate.
 */
export function estimateScholarBulkCredits(
  targets: ReadonlyArray<{ profileBound: boolean; quotaBlocked?: boolean }>,
): number {
  const pages = targets.reduce(
    (sum, t) => sum + (t.profileBound && !t.quotaBlocked ? 1 : 0),
    0,
  );
  return pages * GOOGLE_PAGE_CREDIT_COST;
}
