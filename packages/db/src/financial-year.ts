/**
 * Picks the academic year the financial dimension should be scored on.
 *
 * ## Why this exists
 *
 * `FinancialMetric.fiscalYear` holds an ACADEMIC year (Jun–May), not a
 * fiscal year, despite the name — see the doc comment on that Prisma
 * field. An academic year's tuition is billed across TWO fiscal-year
 * cycles: semester 1 lands in the fiscal year the academic year starts
 * in, semester 2 (and any summer term) lands in the next one. So the
 * currently-running academic year has, by construction, only ever
 * collected semester 1's tuition — no matter how late in the calendar
 * you check, and no matter how healthy the program is. That is not a
 * data-quality problem to detect statistically; it is the billing
 * calendar, and it means the in-progress year must NEVER be selected for
 * scoring, full stop.
 *
 * ## The trap this deliberately avoids
 *
 * Do NOT swap the `currentAcademicYearCE` argument for
 * `AcademicYearContext.latestCompleteEntryYearBE` (converted to CE).
 * That field means *recruitment* for that year has finished, which
 * happens at the START of an academic year — roughly a full year before
 * that year's revenue is fully billed. Using it here would still select
 * a half-billed year, just behind a more convincing-looking rule. The
 * only correct authority for "is this year's tuition finished billing"
 * is "strictly before the year that is currently running"
 * (`row.fiscalYear < currentAcademicYearCE`).
 *
 * ## Why a ratio alone cannot do this job
 *
 * The historical implementation (duplicated in both scorers) tried to
 * catch a partial year with a ratio test alone: drop the latest year if
 * its tuition is under 30% of the prior year. That is not safe as the
 * PRIMARY test. Measured on real data, an in-progress year (one semester
 * billed) reads at a MEDIAN of ~44% of the prior complete year — but
 * with a long tail above 90%, because a growing intake, a fee change, or
 * a weak prior year can all push the ratio past any threshold you pick
 * while the year is still only half-billed. No threshold separates
 * "half-billed" from "genuinely healthy" using the ratio alone.
 *
 * So the ratio is demoted to a SECONDARY sanity check that can only ever
 * pull the picked year *further into the past* — catching a truncated or
 * failed ingestion of an otherwise-complete year. It can never promote a
 * year the calendar already says is in progress. And a genuine revenue
 * decline in a COMPLETE year — even a steep one — is left alone and
 * scored as-is: that is exactly the signal this module exists to
 * surface, not an artefact to explain away.
 */

/** A complete year's tuition is treated as a truncated/failed ingestion
 *  rather than a real figure once it falls below this share of the year
 *  before it. Secondary sanity check only — see the module doc comment.
 *  It can never promote a year the calendar says is in progress. */
const TRUNCATED_INGESTION_RATIO = 0.3;

export interface FinancialYearPick<T> {
  /** The row to score on. Null when there is nothing scoreable. */
  row: T | null;
  /** Why this row was chosen — surface it in provenance / UI notes so a
   *  reader can tell "latest complete" apart from "we had to fall back". */
  reason: 'latest-complete' | 'fell-back-truncated' | 'only-row' | 'none';
  /** The most recent still-being-billed academic year that was excluded
   *  from consideration, if the input carried a row for it. Null when no
   *  in-progress-or-later row existed. Present regardless of whether a
   *  complete row could ultimately be picked. */
  excludedInProgressYear: number | null;
}

/**
 * @param rowsAscending Financial rows for one program/scope, sorted
 *   ascending by `fiscalYear` (the academic year the tuition covers).
 * @param currentAcademicYearCE The academic year currently being taught
 *   and billed, in Common Era — i.e. `AcademicYearContext.currentAcademicYearBE
 *   - 543`. Any row at or after this year is still in flight and is
 *   never selected.
 * @param tuitionOf Extracts a plain number from a row's tuition figure
 *   (callers hold Prisma `Decimal`s; this keeps the helper decimal-
 *   library-agnostic and cast-free).
 */
export function pickFinancialYear<T extends { fiscalYear: number }>(
  rowsAscending: readonly T[],
  currentAcademicYearCE: number,
  tuitionOf: (row: T) => number,
): FinancialYearPick<T> {
  if (rowsAscending.length === 0) {
    return { row: null, reason: 'none', excludedInProgressYear: null };
  }

  const completeRows = rowsAscending.filter((r) => r.fiscalYear < currentAcademicYearCE);
  const inProgressRows = rowsAscending.filter((r) => r.fiscalYear >= currentAcademicYearCE);
  const excludedInProgressYear =
    inProgressRows.length === 0
      ? null
      : inProgressRows.reduce((max, r) => Math.max(max, r.fiscalYear), inProgressRows[0]!.fiscalYear);

  if (completeRows.length === 0) {
    return { row: null, reason: 'none', excludedInProgressYear };
  }
  if (completeRows.length === 1) {
    return { row: completeRows[0]!, reason: 'only-row', excludedInProgressYear };
  }

  // completeRows.length >= 2 here, so both indices below are in bounds.
  const last = completeRows[completeRows.length - 1]!;
  const prior = completeRows[completeRows.length - 2]!;
  const lastTuition = tuitionOf(last);
  const priorTuition = tuitionOf(prior);
  if (priorTuition > 0 && lastTuition < priorTuition * TRUNCATED_INGESTION_RATIO) {
    return { row: prior, reason: 'fell-back-truncated', excludedInProgressYear };
  }

  return { row: last, reason: 'latest-complete', excludedInProgressYear };
}
