// Pure trend-detection for the research monitor. No DB / IO — testable in
// isolation. The monitor aggregates Scopus-Q1 ResearchOutput counts per
// faculty for the two most recent years, then this decides which faculties
// show a notable RISE worth a RESEARCH trend signal.

export interface FacultyResearchRow {
  facultyId: string;
  facultyNameEn: string;
  facultyNameTh: string;
  /** Q1 publication count in the latest year (Y). */
  yCount: number;
  /** Q1 publication count in the prior year (Y-1). */
  prevCount: number;
}

export interface ResearchTrend {
  facultyId: string;
  facultyNameEn: string;
  facultyNameTh: string;
  year: number;
  yCount: number;
  prevCount: number;
  /** Percent rise vs the prior year; null when prior year was 0. */
  pct: number | null;
}

// Tunable — a faculty's Q1 output must rise by at least RISE_RATIO× AND by at
// least MIN_ABS_DELTA papers to surface (the abs floor suppresses small-faculty
// ratio noise). Change → note it in docs/trend-monitors.md. Rises only:
// a decline in the possibly-incomplete current year is an artifact, not a signal.
export const RISE_RATIO = 1.2;
export const MIN_ABS_DELTA = 10;

export function detectResearchTrends(
  rows: FacultyResearchRow[],
  year: number,
  opts: { riseRatio?: number; minAbsDelta?: number } = {},
): ResearchTrend[] {
  const riseRatio = opts.riseRatio ?? RISE_RATIO;
  const minAbsDelta = opts.minAbsDelta ?? MIN_ABS_DELTA;

  const out: ResearchTrend[] = [];
  for (const r of rows) {
    const delta = r.yCount - r.prevCount;
    if (delta < minAbsDelta) continue;
    // prevCount 0 → any rise meeting the abs floor qualifies (ratio undefined).
    if (r.prevCount > 0 && r.yCount < r.prevCount * riseRatio) continue;
    out.push({
      facultyId: r.facultyId,
      facultyNameEn: r.facultyNameEn,
      facultyNameTh: r.facultyNameTh,
      year,
      yCount: r.yCount,
      prevCount: r.prevCount,
      pct: r.prevCount > 0 ? Math.round((delta / r.prevCount) * 100) : null,
    });
  }
  return out;
}
