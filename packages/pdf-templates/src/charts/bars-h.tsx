import * as React from 'react';

import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { INK, seriesColour } from './palette';
import { linear, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface BarRow {
  label: string;
  value: number;
  /**
   * Series index for colour. Defaults to 0 (indigo).
   * MUST be a non-negative integer — `seriesColour` throws otherwise, by
   * design, so a stray `-1` from `Array.findIndex()` fails loudly instead of
   * silently rendering a plausible-but-wrong colour.
   */
  series?: number;
}

export interface BarsHProps extends Omit<ChartCommonProps, 'heightMm'> {
  rows: readonly BarRow[];
  /** Width in mm reserved for row labels. */
  labelWidthMm?: number;
  /** Height of each bar row in mm, including its gap. */
  rowHeightMm?: number;
  emptyNote?: string;
}

/**
 * Minimum height for the empty-state block, independent of the
 * `rowHeightMm * rows.length` formula used for the populated chart. A height
 * derived from zero rows collapses to a box too short to hold a wrapped
 * `emptyNote` at ChartFrame's 13pt empty-state type size without visibly
 * overflowing its border.
 */
const EMPTY_HEIGHT_MM = 24;

export function BarsH({
  rows,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  labelWidthMm = 55,
  rowHeightMm = 9,
  emptyNote,
}: BarsHProps): React.ReactElement {
  if (rows.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  const heightMm = Math.max(rowHeightMm * rows.length + 4, 12);

  // Value labels sit to the right of each bar, so reserve room for them.
  const valueGutterMm = 14;
  const plotWidth = widthMm - labelWidthMm - valueGutterMm;
  const max = Math.max(...rows.map((r) => r.value), 0);
  // linear() collapses a zero-width domain to the range start, so an
  // all-zero series yields width 0 rather than NaN.
  const x = linear([0, max], [0, plotWidth]);
  const barHeight = rowHeightMm * 0.62;

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                widthMm={widthMm} heightMm={heightMm}>
      {rows.map((row, i) => {
        const yTop = 2 + i * rowHeightMm;
        const barWidth = x(row.value);
        return (
          // Keyed by index, not row.label: this is a generic primitive and
          // callers (e.g. two AI-readiness sub-scores that legitimately
          // share a name at different scopes) may pass duplicate labels.
          <g key={i}>
            <text x={0} y={yTop + barHeight * 0.78} fontSize={LABEL.axis}
                  fontFamily={LABEL.fontFamily} fill={INK.axis}>
              {row.label}
            </text>
            <rect className="bar" x={labelWidthMm} y={yTop}
                  width={barWidth} height={barHeight}
                  fill={seriesColour(row.series ?? 0)} />
            <text x={labelWidthMm + barWidth + 2} y={yTop + barHeight * 0.78}
                  fontSize={LABEL.value} fontFamily={LABEL.fontFamily} fill={INK.axis}>
              {row.value}
            </text>
          </g>
        );
      })}
      <line x1={labelWidthMm} y1={2} x2={labelWidthMm} y2={heightMm - 2}
            stroke={INK.rule} strokeWidth={pt(0.5)} />
    </ChartFrame>
  );
}
