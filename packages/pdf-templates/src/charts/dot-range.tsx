import * as React from 'react';

import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { fitLabel } from './fit-label';
import { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
import { INK, SEMANTIC, seriesColour } from './palette';
import { linear, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface DotRangeRow {
  label: string;
  /** This program's value. */
  value: number;
  /** Peer range floor and ceiling. */
  min: number;
  max: number;
}

export interface DotRangeProps extends Omit<ChartCommonProps, 'heightMm'> {
  rows: readonly DotRangeRow[];
  /** Width in mm reserved for row labels. */
  labelWidthMm?: number;
  /** Height of each row band in mm. */
  rowHeightMm?: number;
  /** Width in mm reserved to the right of the range for its value/range text. */
  valueGutterMm?: number;
}

const RANGE_STROKE_WIDTH_MM = pt(1.4);
const CAP_HALF_HEIGHT_MM = 1.6;
const DOT_RADIUS_MM = 1.5;

/** En dash, matching the "60–75" convention used for numeric ranges elsewhere in the app. */
const RANGE_DASH = '–';

export function DotRange({
  rows,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  labelWidthMm = 55,
  rowHeightMm = 10,
  valueGutterMm = 44,
  emptyNote,
}: DotRangeProps): React.ReactElement {
  if (rows.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  const badRow = rows.find((r) => r.min > r.max);
  if (badRow) {
    // A range with min > max maps to a negative-width bar — SVG drops it
    // silently, which would read as "no peer range" rather than the true
    // data bug. Same posture as Funnel's negative-value guard.
    throw new RangeError(
      `DotRange: row "${badRow.label}" has min ${badRow.min} greater than max ${badRow.max}. ` +
        'A peer range cannot have a floor above its ceiling.',
    );
  }

  const plotWidth = widthMm - labelWidthMm - valueGutterMm;
  if (plotWidth <= 0) {
    // Same posture as BarsH's plotWidth guard: a non-positive plot width
    // would collapse every dot to the same x, which reads as "identical
    // values" rather than the true "no room to plot" layout problem.
    throw new RangeError(
      `DotRange: no room to plot — widthMm ${widthMm} minus labelWidthMm ${labelWidthMm} and ` +
        `valueGutterMm ${valueGutterMm} leaves ${plotWidth}mm. Widen widthMm or narrow the label/gutter columns.`,
    );
  }

  const heightMm = Math.max(rowHeightMm * rows.length + 4, 12);

  // The shared axis must include every row's peer range AND every row's
  // value — an out-of-range value EXPANDS the domain rather than being
  // clamped or dropped. Computed across ALL rows (not per-row), so two rows
  // with different peer ranges still plot on one comparable axis — see the
  // "shares one x domain" test. linear() collapses a zero-width domain to
  // the range start, so an all-zero fixture yields x=0 everywhere rather
  // than NaN.
  const domainMin = Math.min(...rows.map((r) => Math.min(r.min, r.value)));
  const domainMax = Math.max(...rows.map((r) => Math.max(r.max, r.value)));
  const x = linear([domainMin, domainMax], [0, plotWidth]);

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance} widthMm={widthMm} heightMm={heightMm}>
      {rows.map((row, i) => {
        const rowMidY = MARGIN_MM + i * rowHeightMm + rowHeightMm / 2;
        // A real possibility in this data: a program's own value falls
        // outside the peer band computed for it (an admissions cutoff drift,
        // or a provenance error). Rendered honestly on the shared axis, in
        // SEMANTIC.warning, with an explicit note — never silently clamped
        // into the range, which would erase the evidence.
        const outOfRange = row.value < row.min || row.value > row.max;

        const labelFit = fitLabel(row.label, labelWidthMm, LABEL.axis);
        const rangeX1 = labelWidthMm + x(row.min);
        const rangeX2 = labelWidthMm + x(row.max);
        const dotX = labelWidthMm + x(row.value);

        const dotFill = outOfRange ? SEMANTIC.warning : seriesColour(0);
        const rangeText = `${row.value} (peer ${row.min}${RANGE_DASH}${row.max})`;

        return (
          <g key={i}>
            <text x={0} y={rowMidY + LABEL.axis * 0.35} fontSize={LABEL.axis}
                  fontFamily={LABEL.fontFamily} fill={INK.axis} {...labelFit}>
              {row.label}
            </text>

            <line className="dotrange-range" x1={rangeX1} y1={rowMidY} x2={rangeX2} y2={rowMidY}
                  stroke={INK.muted} strokeWidth={RANGE_STROKE_WIDTH_MM} />
            <line className="dotrange-cap" x1={rangeX1} y1={rowMidY - CAP_HALF_HEIGHT_MM} x2={rangeX1}
                  y2={rowMidY + CAP_HALF_HEIGHT_MM} stroke={INK.muted} strokeWidth={pt(0.6)} />
            <line className="dotrange-cap" x1={rangeX2} y1={rowMidY - CAP_HALF_HEIGHT_MM} x2={rangeX2}
                  y2={rowMidY + CAP_HALF_HEIGHT_MM} stroke={INK.muted} strokeWidth={pt(0.6)} />

            <circle className="dotrange-value" cx={dotX} cy={rowMidY} r={DOT_RADIUS_MM} fill={dotFill}
                    stroke={INK.surface} strokeWidth={pt(0.6)} />

            <text x={labelWidthMm + plotWidth + 2} y={rowMidY + LABEL.value * 0.35} fontSize={LABEL.value}
                  fontFamily={LABEL.fontFamily} fill={outOfRange ? SEMANTIC.warning : INK.axis}>
              {rangeText}
            </text>
            {outOfRange && (
              <text className="dotrange-anomaly-note" x={labelWidthMm + plotWidth + 2}
                    y={rowMidY + LABEL.value * 0.35 + LABEL.legend * 1.1} fontSize={LABEL.legend}
                    fontFamily={LABEL.fontFamily} fill={SEMANTIC.warning}>
                {'▲ outside peer range'}
              </text>
            )}
          </g>
        );
      })}
      <line x1={labelWidthMm} y1={MARGIN_MM} x2={labelWidthMm} y2={heightMm - MARGIN_MM}
            stroke={INK.rule} strokeWidth={pt(0.5)} />
    </ChartFrame>
  );
}
