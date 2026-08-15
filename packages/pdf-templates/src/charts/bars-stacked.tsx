import * as React from 'react';

import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { fitLabel } from './fit-label';
import { INK, seriesColour } from './palette';
import { linear, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface StackedSegment {
  label: string;
  value: number;
}

export interface StackedCategory {
  /** x-axis label, e.g. a cohort entry year ('2569') or a TCAS round name. */
  category: string;
  /**
   * Stacked bottom-up in array order. Segment *n*'s colour is
   * `seriesColour(n)` — callers should keep segment order consistent across
   * categories (e.g. always Active/Graduated/Dropout) so colour and legend
   * stay meaningful from column to column.
   */
  segments: readonly StackedSegment[];
}

export interface BarsStackedProps extends Omit<ChartCommonProps, 'heightMm'> {
  categories: readonly StackedCategory[];
  /** Height in mm of the plotting area (the columns themselves). */
  plotHeightMm?: number;
  /**
   * Width in mm reserved for each category column, including its gap to the
   * next. Unlike BarsH's `rowHeightMm` (which only grows the auto-computed
   * height), this axis is bounded by `widthMm` — see the RangeError thrown
   * below when categories don't fit.
   */
  columnWidthMm?: number;
  /** Height in mm reserved below the plot for category labels. */
  labelHeightMm?: number;
  /** Height in mm reserved for the one-row segment legend. */
  legendRowHeightMm?: number;
}

/** Same rationale as BarsH's EMPTY_HEIGHT_MM: tall enough for a wrapped emptyNote. */
const EMPTY_HEIGHT_MM = 24;

/** Inset from the SVG edges, mirroring BarsH's "2" top/bottom inset. */
const MARGIN_MM = 2;

/** Bar width as a fraction of its column slot — same ratio BarsH uses for row height. */
const BAR_WIDTH_RATIO = 0.62;

/** Legend swatch is sized off the legend text so the two align visually. */
const SWATCH_SIZE_MM = LABEL.legend;
const LEGEND_GAP_MM = 1.5;

/**
 * Legend entries by segment index, taking each label from the first category
 * that defines a segment at that index. Categories are expected to share the
 * same segment shape (see StackedCategory doc); this is a defensive fallback
 * for the rare case one category's array is short.
 */
function buildLegend(categories: readonly StackedCategory[]): string[] {
  const legend: string[] = [];
  for (const cat of categories) {
    cat.segments.forEach((seg, i) => {
      if (legend[i] === undefined) legend[i] = seg.label;
    });
  }
  return legend;
}

export function BarsStacked({
  categories,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  plotHeightMm = 55,
  columnWidthMm = 16,
  labelHeightMm = 9,
  legendRowHeightMm = 8,
  emptyNote,
}: BarsStackedProps): React.ReactElement {
  if (categories.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  // Unlike BarsH's row axis (vertical, auto-height, effectively unbounded on
  // a printed page), the category axis here is horizontal and IS bounded by
  // widthMm. A column count that doesn't fit must fail loudly rather than
  // silently overflow the page margin.
  const plotWidth = widthMm - 2 * MARGIN_MM;
  const neededWidth = columnWidthMm * categories.length;
  if (neededWidth > plotWidth) {
    throw new RangeError(
      `BarsStacked: ${categories.length} categories at columnWidthMm ${columnWidthMm} need ` +
        `${neededWidth}mm but only ${plotWidth}mm is available within widthMm ${widthMm}. ` +
        'Reduce columnWidthMm, reduce the category count, or widen widthMm.',
    );
  }

  const legend = buildLegend(categories);
  const legendHeightMm = legend.length > 0 ? legendRowHeightMm : 0;
  const heightMm = MARGIN_MM + plotHeightMm + labelHeightMm + legendHeightMm + MARGIN_MM;

  const totals = categories.map((cat) => cat.segments.reduce((sum, seg) => sum + seg.value, 0));
  const maxTotal = Math.max(...totals, 0);
  // linear() collapses a zero-width domain to the range start, so an
  // all-zero series yields height 0 rather than NaN.
  const height = linear([0, maxTotal], [0, plotHeightMm]);

  const plotTopY = MARGIN_MM;
  const baselineY = plotTopY + plotHeightMm;
  const categoryLabelY = baselineY + labelHeightMm * 0.78;
  const legendY = baselineY + labelHeightMm + legendRowHeightMm * 0.7;

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                widthMm={widthMm} heightMm={heightMm}>
      {categories.map((cat, i) => {
        const columnX = MARGIN_MM + i * columnWidthMm;
        const barWidth = columnWidthMm * BAR_WIDTH_RATIO;
        const barX = columnX + (columnWidthMm - barWidth) / 2;
        const labelFit = fitLabel(cat.category, columnWidthMm, LABEL.axis);

        let cumulative = 0;
        return (
          // Keyed by index, not cat.category: entry years repeat cleanly,
          // but this is a generic primitive and callers may pass duplicate
          // category labels at different scopes.
          <g key={i} data-category={cat.category}>
            {cat.segments.map((seg, j) => {
              // A zero-value segment renders no <rect> at all — a
              // zero-height one would be invisible but still shift nothing
              // and pollute the mark count with a stray stroke.
              if (seg.value === 0) return null;
              const segHeight = height(seg.value);
              const segY = baselineY - cumulative - segHeight;
              cumulative += segHeight;
              return (
                <rect key={j} className="segment" x={barX} y={segY}
                      width={barWidth} height={segHeight} fill={seriesColour(j)} />
              );
            })}
            <text x={columnX + columnWidthMm / 2} y={categoryLabelY} textAnchor="middle"
                  fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis}
                  {...labelFit}>
              {cat.category}
            </text>
          </g>
        );
      })}
      <line x1={MARGIN_MM} y1={baselineY} x2={widthMm - MARGIN_MM} y2={baselineY}
            stroke={INK.rule} strokeWidth={pt(0.5)} />
      {legend.map((label, i) => {
        const itemWidth = widthMm / legend.length;
        const itemX = i * itemWidth;
        const textAvailable = itemWidth - SWATCH_SIZE_MM - LEGEND_GAP_MM;
        const labelFit = fitLabel(label, textAvailable, LABEL.legend);
        return (
          <g key={i}>
            <rect x={itemX} y={legendY - SWATCH_SIZE_MM} width={SWATCH_SIZE_MM} height={SWATCH_SIZE_MM}
                  fill={seriesColour(i)} />
            <text x={itemX + SWATCH_SIZE_MM + LEGEND_GAP_MM} y={legendY} fontSize={LABEL.legend}
                  fontFamily={LABEL.fontFamily} fill={INK.axis} {...labelFit}>
              {label}
            </text>
          </g>
        );
      })}
    </ChartFrame>
  );
}
