// Trend-series helpers shared by the attractiveness and financial scorers.

import { HEALTH_SCORE_TUNING } from './tuning';

export interface SeriesPoint { year: number; value: number }

/**
 * Drops any point at or after `currentAcademicYearCE` — the academic year
 * still being taught and billed — from a trend series. ONLY the tuition
 * driver (`tuition_trend_slope`) calls this. It deliberately does NOT run
 * on the enrolment-based series feeding `enrollment_trend_slope` /
 * `kku_intake_policy` a few lines above: those two calendars diverge
 * within the same academic year. Recruitment for an academic year is
 * finished at that year's START, so the in-progress year's headcount can
 * be a real, complete figure. Tuition for that same year is billed across
 * TWO fiscal-year cycles and isn't fully collected until roughly a year
 * AFTER it starts — see `packages/db/src/financial-year.ts` for the full
 * reasoning and `pickFinancialYear`, which this mirrors for head
 * selection. Do not "unify" this with `applyPartialYearDrop` below without
 * re-deriving that distinction first.
 */
export function excludeInProgressYear(series: SeriesPoint[], currentAcademicYearCE: number): SeriesPoint[] {
  return series.filter((p) => p.year < currentAcademicYearCE);
}

// Ratio-based partial-year guard. Used AS-IS (no year exclusion) by the
// enrolment drivers above; used by the tuition driver only AFTER
// excludeInProgressYear has already removed the in-progress year — see
// that function's doc comment for why the two call sites differ.
export function applyPartialYearDrop(series: SeriesPoint[]): SeriesPoint[] {
  if (series.length < 2) return series;
  const last = series[series.length - 1]!.value;
  const prior = series[series.length - 2]!.value;
  if (prior > 0 && last < prior * HEALTH_SCORE_TUNING.shared.partialYearBelowShareOfPrior) return series.slice(0, -1);
  return series;
}

export function linearSlope(series: SeriesPoint[]): number {
  if (series.length < 2) return 0;
  const n = series.length;
  const meanX = series.reduce((s, p) => s + p.year, 0) / n;
  const meanY = series.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of series) {
    num += (p.year - meanX) * (p.value - meanY);
    den += (p.year - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}
