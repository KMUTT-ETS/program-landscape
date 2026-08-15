import * as React from 'react';

import { needsRotatedLabels, ROTATE_ANGLE_DEG, ROTATED_LABEL_GAP_MM, rotatedLabelBudgetMm } from './axis-labels';
import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { fitLabel } from './fit-label';
import { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
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
  /**
   * Height in mm reserved below the plot for category labels.
   *
   * The default (9mm) is sized for upright labels; it is NOT enough for a
   * rotated category label (see `needsRotatedLabels` in axis-labels.ts) —
   * the diagonal budget a rotated label gets is derived from this value, so
   * a realistic Thai TCAS round name (e.g. "รอบที่ 1 : แฟ้มสะสมผลงาน
   * (Portfolio)") needs roughly 34mm here once it rotates. Widen this
   * explicitly for long category labels; see charts/README.md's "Sizing for
   * real KKU data" section.
   */
  labelHeightMm?: number;
  /** Height in mm reserved for the one-row segment legend. */
  legendRowHeightMm?: number;
}

/** Bar width as a fraction of its column slot — same ratio BarsH uses for row height. */
const BAR_WIDTH_RATIO = 0.62;

/** Legend swatch is sized off the legend text so the two align visually. */
const SWATCH_SIZE_MM = LABEL.legend;
const LEGEND_GAP_MM = 1.5;

/**
 * Legend entries by segment index, taking each label from the first category
 * that defines a segment at that index. Categories are expected to share the
 * same segment shape (see StackedCategory doc), including for segments that
 * are locally zero — a caller must send a zero-value segment, not omit it,
 * to keep every category's array aligned by index.
 *
 * That contract is enforced here, not just documented: two categories
 * disagreeing on the label at a shared index means colour and legend have
 * silently come apart — e.g. one year's data as [Active, Graduated,
 * Dropout] and another's as [Dropout, Active, Graduated] would paint
 * "Dropout" in the "Active" swatch colour for one of the two years, with no
 * visual sign anything is wrong. That is exactly the confidently-wrong
 * failure mode this library exists to prevent, so it fails loudly instead.
 */
function buildLegend(categories: readonly StackedCategory[]): string[] {
  const legend: string[] = [];
  const seenAt: string[] = []; // category label that first set legend[i], for the error message
  for (const cat of categories) {
    cat.segments.forEach((seg, i) => {
      const existing = legend[i];
      if (existing === undefined) {
        legend[i] = seg.label;
        seenAt[i] = cat.category;
      } else if (existing !== seg.label) {
        throw new RangeError(
          `BarsStacked: segment index ${i} is labelled "${existing}" in category ` +
            `"${seenAt[i]}" but "${seg.label}" in category "${cat.category}". Segment order ` +
            'must be consistent across every category — reorder or zero-fill the mismatched ' +
            'category instead of omitting a segment.',
        );
      }
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

  // Same content-driven escape hatch as Matrix's column headers (see
  // axis-labels.ts): a category label too wide to fit upright in its column
  // slot rotates into the label band below the baseline, rather than being
  // forced through fitLabel's squeeze-or-throw path alone. Decided once
  // across all categories so the row reads as one consistent treatment.
  const rotate = needsRotatedLabels(categories.map((cat) => cat.category), columnWidthMm, LABEL.axis);
  // Rotated labels read diagonally from a fixed anchor at the plot/label-band
  // seam, so the available run length is the diagonal of the label band
  // (labelHeightMm minus the small gap to the baseline), not the band height
  // itself — the same geometry Matrix uses, mirrored below the baseline
  // instead of above the grid.
  const rotatedBudgetMm = rotatedLabelBudgetMm(labelHeightMm, ROTATED_LABEL_GAP_MM);

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                widthMm={widthMm} heightMm={heightMm}>
      {categories.map((cat, i) => {
        const columnX = MARGIN_MM + i * columnWidthMm;
        const barWidth = columnWidthMm * BAR_WIDTH_RATIO;
        const barX = columnX + (columnWidthMm - barWidth) / 2;
        const anchorX = columnX + columnWidthMm / 2;

        let cumulative = 0;
        const categoryLabel = rotate ? (
          // text-anchor="end" plants the label's end at the anchor point
          // (the baseline seam for this column), then the rotation swings
          // the run down-and-left from that fixed point into the label
          // band — the conventional orientation for a rotated below-axis
          // category label.
          <text key="label" className="category-label" x={anchorX} y={baselineY + ROTATED_LABEL_GAP_MM}
                textAnchor="end" transform={`rotate(${ROTATE_ANGLE_DEG} ${anchorX} ${baselineY + ROTATED_LABEL_GAP_MM})`}
                fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis}
                {...fitLabel(cat.category, rotatedBudgetMm, LABEL.axis)}>
            {cat.category}
          </text>
        ) : (
          <text key="label" className="category-label" x={anchorX} y={categoryLabelY} textAnchor="middle"
                fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis}
                {...fitLabel(cat.category, columnWidthMm, LABEL.axis)}>
            {cat.category}
          </text>
        );

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
            {categoryLabel}
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
