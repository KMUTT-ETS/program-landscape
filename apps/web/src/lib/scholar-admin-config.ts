// IMPORTANT — server-only. Never import this module from a 'use client'
// file: it reads process.env, which is empty in the browser and would make
// the cap silently fall back to the default.

/**
 * Server-side ceiling on a bulk Scholar fetch, mirrored from the API.
 *
 * `ScholarService.bulkMaxTargets()` reads the same variable and is the real
 * guard — it rejects an over-cap request outright. This copy exists so the
 * console knows the number BEFORE it asks the server to price anything: a
 * selection that is already over the cap can be refused at the toolbar,
 * instead of resolving several hundred accounts against the staff roster to
 * produce a quote that was never going to be sendable.
 *
 * If the two ever disagree the API wins, so the cost of drift is a confusing
 * refusal rather than an overspend.
 *
 * Not in `actions/scholar-admin.ts` because that module is `'use server'` and
 * every export there has to be an async server action; a plain synchronous
 * helper cannot live in it.
 */
const DEFAULT_BULK_MAX_TARGETS = 100;

export function scholarBulkMaxTargets(): number {
  const parsed = Number(process.env.SCHOLAR_BULK_MAX_TARGETS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BULK_MAX_TARGETS;
  return Math.floor(parsed);
}
