// packages/shared/src/scholar/credits.ts
//
// What a Scholar run costs, in ScrapingBee credits.
//
// This lives in @kku/shared rather than beside the endpoint that enqueues,
// because TWO surfaces have to agree on the number and they run in different
// processes: `apps/api`'s bulk endpoint prices the run it is about to enqueue,
// and `apps/web`'s admin console prices the same run one round trip EARLIER,
// to put a figure in front of the operator before anything is spent. A second
// copy of the rule in the console would be a second opinion about money, and
// the first time the rule changed the confirmation dialog would quote the old
// one.

import { creditCostForRequestKind } from './costs';

/**
 * Floor price of a bulk run, in ScrapingBee credits.
 *
 * A target costs nothing only if it is stopped by a gate `runScholarFetch`
 * puts in front of the network. There is now exactly ONE such gate left, and
 * which one it is changed on 2026-09-09:
 *
 *   step 2, QUOTA — a person already fetched inside the 30-day window is
 *   refused here, before anything else. Checked BEFORE binding, so a target
 *   that is both unlinked and inside its window is a quota refusal and spends
 *   exactly zero.
 *
 *   step 4, BINDING — this USED to be the second free gate: no linked
 *   profile, no fetch, no spend. It is not a refusal any more. An unlinked
 *   target is now searched for by English full name, and a search is the
 *   dearest call this system makes.
 *
 * So the two prices are:
 *
 *   linked      1 profile page                     = 15
 *   unlinked    1 stealth search + 1 profile page  = 75 + 15 = 90
 *
 * WHY THIS REVERSES A FIX MADE ON 2026-09-08. Until the name-resolution work
 * landed, an unlinked target was priced at 0 and that was correct — the runner
 * refused at the binding gate before touching the network. Charging it two
 * pages before that (a carry-over from an even earlier design) made the quote
 * roughly 10x too high at rollout. Pricing it at 0 now is the same error in the
 * opposite direction and a far more expensive one: a 100-person bulk of
 * unlinked staff quotes free and bills roughly 9,000 credits.
 *
 * "AT LEAST", AND THE ONE CASE THAT IS NOT. This remains a floor for every
 * target that reaches a profile: a prolific researcher's profile runs to
 * several pages (up to SCHOLAR_MAX_PAGES = 10) and nothing can know how many
 * without fetching it. The single case the figure can EXCEED is an unlinked
 * target whose search resolves no profile at all — that spends the 75-credit
 * search and stops, 15 short of the 90 quoted for it. Callers must therefore
 * say both things: "at least" for the run, and separately that an unlinked
 * person spends the search whether or not it finds anyone. The console's
 * confirmation dialog does exactly that; do not reduce it to the single
 * number.
 *
 * `quotaBlocked` is OPTIONAL and defaults to false, so a caller that has not
 * consulted the quota still gets the binding-blind price rather than a type
 * error. That is the conservative direction — it over-quotes, never under.
 *
 * Both unit prices come from `creditCostForRequestKind`, which reads the
 * measured constants in ./scrapingbee. Never inline 15 or 75 here: the
 * transport is what actually chooses the flags that set the price, so it is
 * the only honest place for the numbers to live.
 */
export function estimateScholarBulkCredits(
  targets: ReadonlyArray<{ profileBound: boolean; quotaBlocked?: boolean }>,
): number {
  return targets.reduce((sum, target) => {
    // Refused at step 2, before either the search or the profile walk.
    if (target.quotaBlocked) return sum;
    const search = target.profileBound ? 0 : creditCostForRequestKind('search');
    return sum + search + creditCostForRequestKind('profile');
  }, 0);
}
