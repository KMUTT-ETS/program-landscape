import * as React from 'react';

import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { fitLabel } from './fit-label';
import { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
import { INK, seriesColour } from './palette';
import { linear, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface RadarAxis {
  label: string;
  /** null when the dimension has no data — NOT zero. See the render-time
   *  comment below for how this primitive keeps that distinction visible. */
  value: number | null;
  /** Upper bound for this axis, e.g. 100. */
  max: number;
}

export interface RadarProps extends Omit<ChartCommonProps, 'heightMm'> {
  axes: readonly RadarAxis[];
  /** Outer ring radius in mm, centre to perimeter. */
  radiusMm?: number;
}

const DEFAULT_RADIUS_MM = 32;
/** Gap between the outer ring and where an axis label anchors. */
const LABEL_GAP_MM = 3;
/** Vertical allowance (above the top ring and below the bottom ring)
 * reserved for axis labels that land near 12/6 o'clock. */
const LABEL_BAND_MM = 10;
/** Per-axis label column budget handed to fitLabel. */
const LABEL_TEXT_BUDGET_MM = 34;
/** Concentric grid rings drawn behind the data, at 25/50/75/100% of radius. */
const RING_STEPS = 4;
const CENTRE_RADIUS_MM = 0.8;
const VERTEX_RADIUS_MM = 1.3;
/** Slightly larger than a real vertex so the hollow "no data" ring reads as
 * a deliberate marker, not a smaller/lesser version of a real point. */
const NULL_MARKER_RADIUS_MM = 1.7;
/** Where the null marker sits along its axis. Deliberately NOT at the
 * perimeter (which would read as "high"), the centre (which would read as
 * "zero"), or on any of the RING_STEPS grid rings (25/50/75/100%) — landing
 * exactly on a ring would let a reader who has internalised "this ring is
 * this fraction of max" misread the marker's distance as an actual value.
 * 0.6 sits squarely between the 50% and 75% rings, on no gridline at all. */
const NULL_MARKER_FRACTION = 0.6;
const VALUE_STROKE_WIDTH_MM = pt(1.1);
const VALUE_FILL_OPACITY = 0.22;
const GRID_STROKE_WIDTH_MM = pt(0.4);
const NULL_MARKER_DASH = `${pt(1.4)},${pt(1)}`;

interface Point {
  x: number;
  y: number;
}

function axisAngle(index: number, count: number): number {
  // Starts at 12 o'clock (-90°) and proceeds clockwise, the conventional
  // orientation for spider/radar charts.
  return -Math.PI / 2 + (index * 2 * Math.PI) / count;
}

function pointAt(cx: number, cy: number, angle: number, r: number): Point {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function closedPathD(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';
}

/** Narrows away the null case without an `as` cast — the only other `as` in
 * this library is `as const`, and this predicate is the mechanical way to
 * keep it that way here. */
function hasPlot<T extends { plot: Point | null }>(c: T): c is T & { plot: Point } {
  return c.plot !== null;
}

/** SVG text-anchor for a label planted along the direction (ux, uy) from centre. */
function labelAnchor(ux: number): 'start' | 'middle' | 'end' {
  if (Math.abs(ux) < 0.15) return 'middle';
  return ux > 0 ? 'start' : 'end';
}

/** Small baseline nudge so labels near 12/6 o'clock don't sit with their
 * anchor point bisecting the text. Side labels stay roughly vertically
 * centred on their anchor point. */
function labelDy(uy: number): number {
  if (uy < -0.5) return 0;
  if (uy > 0.5) return LABEL.axis * 0.85;
  return LABEL.axis * 0.35;
}

export function Radar({
  axes,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  radiusMm = DEFAULT_RADIUS_MM,
  emptyNote,
}: RadarProps): React.ReactElement {
  // A radar needs at least a triangle — two axes would render a degenerate
  // line, not a recognisable polygon web.
  if (axes.length < 3) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  if (!(radiusMm > 0)) {
    throw new RangeError(`Radar: radiusMm must be positive, received ${radiusMm}.`);
  }
  const badMaxAxis = axes.find((a) => !(a.max > 0));
  if (badMaxAxis) {
    // A non-positive max makes the value/max ratio undefined or nonsensical
    // (divide by zero, or a flipped sign) — this is a caller data bug, not
    // a legitimate "no data" state, so it fails loudly rather than silently
    // collapsing that axis's vertex to the centre or NaN.
    throw new RangeError(
      `Radar: axis "${badMaxAxis.label}" has max ${badMaxAxis.max} — max must be > 0.`,
    );
  }

  const cx = widthMm / 2;
  const heightMm = 2 * (radiusMm + LABEL_BAND_MM) + 2 * MARGIN_MM;
  const cy = MARGIN_MM + LABEL_BAND_MM + radiusMm;

  // Label text can extend sideways from a 3-o'clock/9-o'clock axis, so the
  // half-width left after the ring must have room for at least a short
  // label. Same posture as BarsH's plotWidth guard: fail loudly instead of
  // letting labels render off the edge of the viewBox with no error.
  const horizontalHalfBudgetMm = widthMm / 2 - radiusMm - LABEL_GAP_MM;
  if (horizontalHalfBudgetMm <= 0) {
    throw new RangeError(
      `Radar: no room for axis labels — widthMm ${widthMm} minus radiusMm ${radiusMm} and ` +
        `LABEL_GAP_MM ${LABEL_GAP_MM} leaves ${horizontalHalfBudgetMm}mm on each side. ` +
        'Widen widthMm or shrink radiusMm.',
    );
  }
  const labelWidthMm = Math.min(LABEL_TEXT_BUDGET_MM, horizontalHalfBudgetMm * 2);

  const count = axes.length;
  const computed = axes.map((axis, i) => {
    const angle = axisAngle(i, count);
    const outer = pointAt(cx, cy, angle, radiusMm);
    // linear() collapses a zero-width domain to the range start, but that
    // path is unreachable here — the max>0 guard above already ensures a
    // real [0, max] domain for every axis.
    const rScale = linear([0, axis.max], [0, radiusMm]);
    // Floored at 0, not clamped at radiusMm: an axis value above max is
    // real data (e.g. a metric exceeding its nominal ceiling) and is drawn
    // honestly past the outer ring rather than hidden at the boundary. A
    // negative radius, by contrast, isn't a "very bad" reading — it would
    // mirror the vertex to the opposite side of the wheel, which is a
    // geometry failure, not a data value, so it's the one case floored.
    const plot: Point | null = axis.value === null ? null : pointAt(cx, cy, angle, Math.max(0, rScale(axis.value)));
    return { axis, angle, outer, plot };
  });

  const plottedPoints = computed.filter(hasPlot).map((c) => c.plot);
  const anyPlotted = plottedPoints.length > 0;

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance} widthMm={widthMm} heightMm={heightMm}>
      {/* Concentric grid rings — the "web" background. Data-independent, so
          drawn identically regardless of which axes have values. */}
      {Array.from({ length: RING_STEPS }, (_, ringIndex) => {
        const ringRadius = (radiusMm * (ringIndex + 1)) / RING_STEPS;
        const ringPoints = computed.map((c) => pointAt(cx, cy, c.angle, ringRadius));
        return (
          <path key={ringIndex} className="radar-ring" d={closedPathD(ringPoints)} fill="none"
                stroke={INK.rule} strokeWidth={GRID_STROKE_WIDTH_MM} />
        );
      })}

      {/* Spokes, one per axis. Also data-independent — an axis with no
          value still gets a spoke, because the axis itself exists; only the
          vertex on it is missing. */}
      {computed.map((c, i) => (
        <line key={i} className="radar-spoke" x1={cx} y1={cy} x2={c.outer.x} y2={c.outer.y}
              stroke={INK.rule} strokeWidth={GRID_STROKE_WIDTH_MM} />
      ))}

      {/* The filled value polygon — built ONLY from axes with real data.
          A null axis is excluded from this point list entirely, so the
          boundary cuts a straight line directly between its two flanking
          known vertices instead of dipping to the centre. Dipping to the
          centre (i.e. treating null as 0) is exactly the methodology
          violation this primitive exists to prevent: health-score.v1
          explicitly EXCLUDES missing dimensions from the average rather
          than substituting 0, and a notch drawn at "no data" would read to
          a Council member as "this program scores terribly here" when the
          truth is "we have no data here." See the null-marker + label
          treatment below for how the gap is instead made visible. */}
      {anyPlotted && (
        <path className="radar-value" d={closedPathD(plottedPoints)} fill={seriesColour(0)}
              fillOpacity={VALUE_FILL_OPACITY} stroke={seriesColour(0)} strokeWidth={VALUE_STROKE_WIDTH_MM} />
      )}

      {/* Per-axis vertex marker (real data) or "no data" marker (null). */}
      {computed.map((c, i) => {
        if (c.plot) {
          return (
            <circle key={i} className="radar-vertex" cx={c.plot.x} cy={c.plot.y} r={VERTEX_RADIUS_MM}
                    fill={seriesColour(0)} stroke={INK.surface} strokeWidth={pt(0.6)} />
          );
        }
        // Hollow + dashed, parked at the midpoint of its spoke — never at a
        // radius that could be mistaken for a plotted value. Mirrors
        // LineTrend's "hollow = not an observation" language (there used
        // for projected points) so the visual vocabulary stays consistent
        // across the library: a filled mark is real data, a hollow one is
        // not.
        const midpoint = pointAt(cx, cy, c.angle, radiusMm * NULL_MARKER_FRACTION);
        return (
          <circle key={i} className="radar-null-marker" cx={midpoint.x} cy={midpoint.y}
                  r={NULL_MARKER_RADIUS_MM} fill={INK.surface} stroke={INK.muted}
                  strokeWidth={pt(0.7)} strokeDasharray={NULL_MARKER_DASH} />
        );
      })}

      <circle className="radar-centre" cx={cx} cy={cy} r={CENTRE_RADIUS_MM} fill={INK.rule} />

      {/* Axis labels, outside the perimeter. A null axis renders its label
          in the muted ink and appends an explicit "no data" note — the
          label itself is the clearest, most unambiguous way to mark a gap
          in a printed (non-interactive, no-hover) document. */}
      {computed.map((c, i) => {
        const anchor = labelAnchor(Math.cos(c.angle));
        const labelPoint = pointAt(cx, cy, c.angle, radiusMm + LABEL_GAP_MM);
        const dy = labelDy(Math.sin(c.angle));
        const isNull = c.plot === null;
        const labelFit = fitLabel(c.axis.label, labelWidthMm, LABEL.axis);
        return (
          <g key={i}>
            <text className="radar-axis-label" x={labelPoint.x} y={labelPoint.y + dy} textAnchor={anchor}
                  fontSize={LABEL.axis} fontFamily={LABEL.fontFamily}
                  fill={isNull ? INK.muted : INK.axis} {...labelFit}>
              {c.axis.label}
            </text>
            {isNull && (
              <text className="radar-axis-label-note" x={labelPoint.x} y={labelPoint.y + dy + LABEL.axis * 1.15}
                    textAnchor={anchor} fontSize={LABEL.legend} fontFamily={LABEL.fontFamily} fill={INK.muted}>
                no data
              </text>
            )}
          </g>
        );
      })}
    </ChartFrame>
  );
}
