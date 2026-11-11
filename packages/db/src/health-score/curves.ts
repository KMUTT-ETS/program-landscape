// Pure score curves: raw figure in, 0-100 driver score out. No database
// access, so each curve can be unit-tested directly. The numbers they use
// come from ./tuning.ts — change them there, not here.

import type { SfrBand } from '@prisma/client';
import { HEALTH_SCORE_TUNING, type CurvePoints } from './tuning';

const T = HEALTH_SCORE_TUNING;

export function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Piecewise-linear score from [input, score] points (inputs ascending).
 * Below the first point → the first score; at or above the last point →
 * the last score; otherwise linear on the segment whose start the value
 * has reached.
 */
export function scoreOnCurve(value: number, points: CurvePoints): number {
  const first = points[0];
  if (!first) throw new Error('scoreOnCurve: a curve needs at least one point');
  if (value < first[0]) return first[1];
  for (let i = points.length - 1; i >= 0; i--) {
    const [x0, y0] = points[i]!;
    if (value < x0) continue;
    const next = points[i + 1];
    if (!next) return y0;
    const [x1, y1] = next;
    return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
  }
  return first[1];
}

/** `tcas_competition_ratio` — applicants per planned seat. */
export function scoreCompetitionRatio(ratio: number): number {
  return scoreOnCurve(ratio, T.attractiveness.competitionRatio);
}

/** `tcas_fill_rate` — admitted per planned seat. */
export function scoreFillRate(fill: number): number {
  const fullAt = T.attractiveness.fillRateFullAt;
  return fill >= fullAt ? 100 : clamp((fill / fullAt) * 100);
}

/** `tcas_registration_yield` — reported per seat sent to Clearinghouse. */
export function scoreRegistrationYield(yieldRate: number): number {
  return scoreOnCurve(yieldRate, T.attractiveness.registrationYield);
}

/**
 * The band for a faculty: its stored teaching mode, or the default band
 * when none is set. Faculties on a fresh install carry none; KKU's were
 * backfilled by migration 20261103120000_faculty_sfr_band.
 */
export function sfrBandFor(sfrBand: SfrBand | null | undefined): SfrBand {
  return sfrBand ?? T.capability.defaultStudentFacultyBand;
}

/** Thresholds of one teaching-mode band (also surfaced in the driver raw). */
export function sfrBandThresholds(band: SfrBand): { lower: number; upper: number } {
  return T.capability.studentFacultyRatioBands[band];
}

/** `student_faculty_ratio` — at or below the band's lower bound → 100, at or
 *  above its upper bound → 0, linear between. */
export function scoreStudentFacultyRatio(ratio: number, band: SfrBand): number {
  const { lower, upper } = sfrBandThresholds(band);
  if (ratio <= lower) return 100;
  if (ratio >= upper) return 0;
  return 100 - ((ratio - lower) / (upper - lower)) * 100;
}

/** `further_study_rate` — sweet-spot curve; both extremes score low. */
export function scoreFurtherStudyRate(rate: number): number {
  const c = T.outcomes.furtherStudy;
  if (rate <= c.risingTo) return c.scoreAtZero + (rate / c.risingTo) * (100 - c.scoreAtZero);
  if (rate <= c.plateauTo) return 100;
  if (rate <= c.decliningTo) {
    return 100 - ((rate - c.plateauTo) / (c.decliningTo - c.plateauTo)) * (100 - c.scoreAtDecliningEnd);
  }
  return Math.max(
    c.floor,
    c.scoreAtDecliningEnd - ((rate - c.decliningTo) / c.taperSpan) * (c.scoreAtDecliningEnd - c.floor),
  );
}
