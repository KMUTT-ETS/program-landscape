/**
 * Radial scale for every DQ module radar.
 *
 * Shared by `/education/student-dq` and the programme deep-dive's
 * digital-competency section. It lives here rather than beside either
 * one because two copies of a chart-scale rule is how two radars end up
 * disagreeing about what a floor of 60 means — and a floor is a claim
 * about the data, not a styling choice.
 *
 * DQ scores cluster hard against the top of the scale: university-wide
 * the 13 theory means span 67.6-89.7, and a faculty is much the same.
 * Plotted on a 0-100 axis every one of them sits in the outer quarter
 * of the radius and the polygon reads as a circle — the shape carries
 * no information, which is the whole point of a radar.
 *
 * So the axis floor drops to the plotted data's decade instead of 0.
 * Two constraints make that honest rather than flattering:
 *
 *  1. The floor is computed across BOTH series. Using one series' own
 *     minimum would clip the other wherever it scores lower, silently
 *     drawing it at the centre.
 *  2. It is never raised above FLOOR_CAP. Programme-level cells go as
 *     low as 5.6 in this data (30 cells below 60, 9 below 50); a fixed
 *     60 floor would render a programme scoring 5.6 exactly like one
 *     scoring 60. When the data goes low, the axis follows it down.
 *
 * In the common case this yields 60-100 for every scope, so scopes stay
 * comparable with each other; an outlier widens instead of lying.
 *
 * A non-zero floor magnifies differences, which is exactly how radar
 * charts mislead. Every caller must state the floor in words beside the
 * chart — the axis ticks show it, but nobody scanning shapes reads axis
 * ticks. `RadarChartSmall`'s `domain` prop documents the same
 * obligation.
 */
const FLOOR_CAP = 60;

/** Client-safe by construction: a pure function over plain numbers, so
 *  neither caller drags a package barrel into the browser bundle. */
export function dqRadarDomain(
  series: ReadonlyArray<ReadonlyArray<{ mean: number | null }>>,
): [number, number] {
  const values = series
    .flat()
    .map((c) => c.mean)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return [0, 100];
  const floor = Math.floor(Math.min(...values) / 10) * 10;
  return [Math.max(0, Math.min(FLOOR_CAP, floor)), 100];
}
