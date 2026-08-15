import * as React from 'react';

import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
import { INK, seriesColour } from './palette';
import { linear, niceTicks, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface TrendPoint {
  /** Year (or other numeric x value). */
  x: number;
  /** null means no data for that x — NEVER rendered as zero. */
  y: number | null;
}

export interface LineTrendProps extends Omit<ChartCommonProps, 'heightMm'> {
  /** Assumed already in ascending x order — this primitive does not sort. */
  points: readonly TrendPoint[];
  /** x value at/after which the line renders as a dashed projection. */
  projectedFrom?: number;
  /** Height in mm of the plotting area, excluding the axis label bands. */
  plotHeightMm?: number;
  /** Width in mm reserved on the left for y-axis tick labels. */
  leftGutterMm?: number;
  /** Height in mm reserved below the plot for x-axis (year) tick labels. */
  bottomAxisHeightMm?: number;
  /** Ticks requested from niceTicks() for the y axis. */
  yTickCount?: number;
}

const MARKER_RADIUS_MM = 1.1;
const LINE_STROKE_WIDTH_MM = pt(1.1);
/** Long enough to read clearly as "dashed" at print scale, not a fine stipple. */
const PROJECTED_DASH = `${pt(2.2)},${pt(1.6)}`;
/** Slightly larger than a real vertex, same rationale as Radar's
 * NULL_MARKER_RADIUS_MM — the hollow "no data" mark should read as a
 * deliberate marker, not a smaller/lesser version of a real point. */
const NULL_MARKER_RADIUS_MM = 1.4;
const NULL_MARKER_DASH = `${pt(1.4)},${pt(1)}`;

function isPlottable(point: TrendPoint): point is TrendPoint & { y: number } {
  return point.y !== null;
}

interface RunPoint {
  x: number;
  y: number;
}

interface Subpath {
  dashed: boolean;
  pts: readonly RunPoint[];
}

/**
 * Splits one contiguous run of plottable points at `projectedFrom`, so the
 * solid and dashed halves render as two separate <path> elements that still
 * share the boundary point — no visible gap at the actual/projected seam.
 */
function splitRun(run: readonly RunPoint[], projectedFrom: number | undefined): Subpath[] {
  if (projectedFrom === undefined) return [{ dashed: false, pts: run }];
  const splitIndex = run.findIndex((p) => p.x >= projectedFrom);
  if (splitIndex === -1) return [{ dashed: false, pts: run }]; // entirely before the projection
  if (splitIndex === 0) return [{ dashed: true, pts: run }]; // entirely at/after the projection
  return [
    { dashed: false, pts: run.slice(0, splitIndex + 1) },
    { dashed: true, pts: run.slice(splitIndex) },
  ];
}

function pathD(pts: readonly RunPoint[], x: (v: number) => number, y: (v: number) => number): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x)},${y(p.y)}`).join(' ');
}

export function LineTrend({
  points,
  projectedFrom,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  plotHeightMm = 50,
  leftGutterMm = 14,
  bottomAxisHeightMm = 8,
  yTickCount = 5,
  emptyNote,
}: LineTrendProps): React.ReactElement {
  if (points.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  const valid = points.filter(isPlottable);
  if (valid.length === 0) {
    // Every x has a null y — genuinely nothing to plot. Same "data gap, not
    // zero" posture as the empty-array case above, never a flat line at 0.
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  const plotWidth = widthMm - leftGutterMm - MARGIN_MM;
  if (plotWidth <= 0) {
    // Same posture as BarsH's plotWidth guard: a silent non-positive width
    // would map every x to the same (or a negative) pixel — SVG doesn't
    // error, it just draws a degenerate line that reads as "no trend."
    throw new RangeError(
      `LineTrend: no room to plot — widthMm ${widthMm} minus leftGutterMm ${leftGutterMm} ` +
        `leaves ${plotWidth}mm. Widen widthMm or narrow leftGutterMm.`,
    );
  }

  const heightMm = MARGIN_MM + plotHeightMm + bottomAxisHeightMm + MARGIN_MM;
  const plotTopY = MARGIN_MM;
  const plotBottomY = plotTopY + plotHeightMm;

  // x domain spans every point, including ones with a null y, so the axis
  // still shows the full requested timeline even where data is missing.
  const xValues = points.map((p) => p.x);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const x = linear([xMin, xMax], [leftGutterMm, leftGutterMm + plotWidth]);

  const yValues = valid.map((p) => p.y);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  // niceTicks() also seeds the axis domain bounds, not just the tick labels
  // — rounder bounds than the raw min/max read better on a printed axis. But
  // niceTicks' rounding can land INSIDE the true data range (e.g. min 90,
  // max 200, count 5 → first tick 100) — Math.min/max below guarantee every
  // point still lands within [plotTopY, plotBottomY] rather than
  // extrapolating past the axis and colliding with the x-axis label band.
  // A degenerate (all-equal) series collapses domainMin === domainMax, which
  // linear() turns into a flat line rather than NaN.
  const ticks = niceTicks(yMin, yMax, yTickCount);
  const domainMin = Math.min(ticks[0] ?? yMin, yMin);
  const domainMax = Math.max(ticks[ticks.length - 1] ?? yMax, yMax);
  // SVG y grows downward, so the range is inverted relative to the domain:
  // the larger domain value must map to the SMALLER (higher-up) pixel y.
  const y = linear([domainMin, domainMax], [plotBottomY, plotTopY]);

  const colour = seriesColour(0);

  // Contiguous runs of plottable points, broken at every null y. A null is
  // never bridged by a line segment — that would draw a value nobody
  // observed, which this document must never do.
  const runs: RunPoint[][] = [];
  let current: RunPoint[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push({ x: p.x, y: p.y });
    }
  }
  if (current.length > 0) runs.push(current);

  const subpaths = runs.flatMap((run) => splitRun(run, projectedFrom));

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                widthMm={widthMm} heightMm={heightMm}>
      {/* y-axis ticks. Values are our own generated numbers (niceTicks), not
          arbitrary caller text, so they go through pt()-sized <text> plainly
          rather than fitLabel — fitLabel targets long categorical strings. */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={leftGutterMm - 1.5} y1={y(t)} x2={leftGutterMm} y2={y(t)}
                stroke={INK.rule} strokeWidth={pt(0.5)} />
          <text x={leftGutterMm - 2.5} y={y(t) + LABEL.axis * 0.35} textAnchor="end"
                fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.muted}>
            {t}
          </text>
        </g>
      ))}
      <line x1={leftGutterMm} y1={plotTopY} x2={leftGutterMm} y2={plotBottomY}
            stroke={INK.rule} strokeWidth={pt(0.5)} />
      <line x1={leftGutterMm} y1={plotBottomY} x2={leftGutterMm + plotWidth} y2={plotBottomY}
            stroke={INK.rule} strokeWidth={pt(0.5)} />

      {/* x-axis labels. Like the y ticks above, no fitLabel: TrendPoint.x is
          typed `number`, so it can never carry a long arbitrary string — the
          overflow problem fitLabel solves for caller-supplied categorical
          text does not apply here. */}
      {points.map((p, i) => (
        <text key={i} x={x(p.x)} y={plotBottomY + bottomAxisHeightMm * 0.7} textAnchor="middle"
              fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.muted}>
          {p.x}
        </text>
      ))}

      {subpaths.map((sp, i) =>
        sp.pts.length < 2 ? null : (
          <path key={i} d={pathD(sp.pts, x, y)} fill="none" stroke={colour}
                strokeWidth={LINE_STROKE_WIDTH_MM}
                strokeDasharray={sp.dashed ? PROJECTED_DASH : undefined} />
        ),
      )}

      {valid.map((p, i) => {
        // Projected markers render hollow so "this is a forecast, not an
        // observation" is visible even without colour (greyscale printing).
        const dashed = projectedFrom !== undefined && p.x >= projectedFrom;
        return (
          <circle key={i} className="point" cx={x(p.x)} cy={y(p.y)} r={MARKER_RADIUS_MM}
                  fill={dashed ? INK.surface : colour} stroke={colour} strokeWidth={pt(0.6)} />
        );
      })}

      {/* A null y is never bridged by a line segment (see the `runs` comment
          above) — a connector line across the gap would draw a value nobody
          observed, exactly what this library exists to prevent. But leaving
          the gap as a bare absence was easy to miss on close inspection and
          wasn't part of the same visual vocabulary Radar's null-axis marker
          and Matrix's hatched null cell already use. A hollow marker sitting
          ON the x-axis at the missing x — never at a y, since no y is known
          — flags the gap without implying any value: "hollow = not
          observed" is the same rule as this file's own projected-point
          treatment above, just anchored to the axis instead of a data
          point. */}
      {points.map((p, i) =>
        p.y === null ? (
          <circle key={`null-${i}`} className="linetrend-null-marker" cx={x(p.x)} cy={plotBottomY}
                  r={NULL_MARKER_RADIUS_MM} fill={INK.surface} stroke={INK.muted} strokeWidth={pt(0.7)}
                  strokeDasharray={NULL_MARKER_DASH} />
        ) : null,
      )}
    </ChartFrame>
  );
}
