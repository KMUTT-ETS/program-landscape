import * as React from 'react';

import { needsRotatedLabels, ROTATE_ANGLE_DEG, ROTATED_LABEL_GAP_MM, rotatedLabelBudgetMm } from './axis-labels';
import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { fitLabel } from './fit-label';
import { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
import { INK, SEMANTIC, seriesColour } from './palette';
import { linear, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface WaterfallBar {
  label: string;
  /** Signed contribution. Negative bars draw downward from the running total. */
  delta: number;
  /**
   * When true this bar is an absolute total, drawn from zero rather than
   * from the running total — e.g. a closing "Net margin" bar. Bars that
   * follow a total continue from the total's own value: a total is a real
   * checkpoint in the sequence, not a rendering-only annotation.
   */
  isTotal?: boolean;
}

export interface WaterfallProps extends Omit<ChartCommonProps, 'heightMm'> {
  bars: readonly WaterfallBar[];
  /** Height in mm of the plotting area, excluding the label/value bands. */
  plotHeightMm?: number;
  /** Width in mm reserved for each bar column, including its gap to the next. */
  columnWidthMm?: number;
  /**
   * Height in mm reserved below the plot for bar labels.
   *
   * The default (9mm) is sized for upright labels; it is NOT enough for a
   * rotated bar label (see `needsRotatedLabels` in axis-labels.ts) — the
   * diagonal budget a rotated label gets is derived from this value, so a
   * realistic Thai TCAS round name (e.g. "รอบที่ 1 : แฟ้มสะสมผลงาน
   * (Portfolio)") needs roughly 34mm here once it rotates. Widen this
   * explicitly for long bar labels; see charts/README.md's "Sizing for real
   * KKU data" section.
   */
  labelHeightMm?: number;
  /**
   * Formats each bar's magnitude in its value label (before the '+' sign
   * this primitive itself prepends for a rising non-total bar). Defaults to
   * the bar's raw number stringified (this primitive's original behaviour)
   * — pass this to render a rounded value rather than a full-precision
   * float. Opt-in so existing callers at the default are unaffected.
   */
  formatValue?: (v: number) => string;
}

/** Bar width as a fraction of its column slot — same ratio BarsH/BarsStacked/Funnel use. */
const BAR_WIDTH_RATIO = 0.62;

/**
 * Fixed vertical allowance reserved above AND below the plot for value
 * labels that land at the domain extremes (the tallest positive bar, the
 * deepest negative bar). Data-independent — same posture as Radar's
 * LABEL_BAND_MM — so the viewBox height doesn't depend on which bar happens
 * to be the extreme one at render time.
 */
const VALUE_LABEL_BAND_MM = 6;
const VALUE_LABEL_GAP_MM = 1.2;

interface ComputedBar {
  bar: WaterfallBar;
  valueStart: number;
  valueEnd: number;
}

/**
 * Running-total walk. A non-total bar starts where the previous bar ended
 * and moves by `delta`. A total bar is an absolute value drawn from zero —
 * per the brief, a total silently drawn from the running total instead of
 * zero would still "look like a bar" but land at the wrong height with no
 * visible error, which is exactly the bug this primitive must not have.
 */
function walkRunningTotal(bars: readonly WaterfallBar[]): ComputedBar[] {
  let runningTotal = 0;
  return bars.map((bar) => {
    const valueStart = bar.isTotal ? 0 : runningTotal;
    const valueEnd = bar.isTotal ? bar.delta : runningTotal + bar.delta;
    runningTotal = valueEnd;
    return { bar, valueStart, valueEnd };
  });
}

export function Waterfall({
  bars,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  plotHeightMm = 55,
  columnWidthMm = 26,
  labelHeightMm = 9,
  formatValue,
  emptyNote,
}: WaterfallProps): React.ReactElement {
  if (bars.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  // The bar axis is horizontal and bounded by widthMm — same posture as
  // BarsStacked's identical category-axis guard: a bar count that doesn't
  // fit must fail loudly rather than silently overflow the page margin.
  const plotWidth = widthMm - 2 * MARGIN_MM;
  const neededWidth = columnWidthMm * bars.length;
  if (neededWidth > plotWidth) {
    throw new RangeError(
      `Waterfall: ${bars.length} bars at columnWidthMm ${columnWidthMm} need ${neededWidth}mm ` +
        `but only ${plotWidth}mm is available within widthMm ${widthMm}. Reduce columnWidthMm, ` +
        'reduce the bar count, or widen widthMm.',
    );
  }

  const computed = walkRunningTotal(bars);
  const allValues = computed.flatMap((c) => [c.valueStart, c.valueEnd]);
  // 0 is always in the domain — the zero baseline rule is drawn regardless
  // of whether any bar actually touches it.
  const domainMin = Math.min(0, ...allValues);
  const domainMax = Math.max(0, ...allValues);

  const heightMm =
    MARGIN_MM + VALUE_LABEL_BAND_MM + plotHeightMm + VALUE_LABEL_BAND_MM + labelHeightMm + MARGIN_MM;
  const plotTopY = MARGIN_MM + VALUE_LABEL_BAND_MM;
  const plotBottomY = plotTopY + plotHeightMm;
  const labelBandTopY = plotBottomY + VALUE_LABEL_BAND_MM;
  const categoryLabelY = labelBandTopY + labelHeightMm * 0.78;

  // SVG y grows downward, so (like LineTrend) the range is inverted
  // relative to the domain: the larger domain value maps to the SMALLER
  // pixel y. A degenerate all-zero series collapses domainMin === domainMax,
  // which linear() turns into a flat baseline at plotBottomY rather than NaN.
  const y = linear([domainMin, domainMax], [plotBottomY, plotTopY]);
  const zeroY = y(0);

  const barWidth = columnWidthMm * BAR_WIDTH_RATIO;
  const barXFor = (index: number): number => MARGIN_MM + index * columnWidthMm + (columnWidthMm - barWidth) / 2;

  // Same content-driven escape hatch as Matrix's column headers and
  // BarsStacked's category labels (see axis-labels.ts): a bar label too wide
  // to fit upright in its column slot rotates into the label band below the
  // plot, rather than being forced through fitLabel's squeeze-or-throw path
  // alone. Decided once across all bars so the row reads as one consistent
  // treatment.
  const rotateLabels = needsRotatedLabels(bars.map((b) => b.label), columnWidthMm, LABEL.axis);
  // Diagonal run length available in the label band — same geometry Matrix
  // uses above its grid, mirrored below the plot instead.
  const rotatedBudgetMm = rotatedLabelBudgetMm(labelHeightMm, ROTATED_LABEL_GAP_MM);

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance} widthMm={widthMm} heightMm={heightMm}>
      <line className="waterfall-zero-line" x1={MARGIN_MM} y1={zeroY} x2={widthMm - MARGIN_MM} y2={zeroY}
            stroke={INK.rule} strokeWidth={pt(0.6)} />

      {computed.map((c, i) => {
        const columnX = MARGIN_MM + i * columnWidthMm;
        const barX = barXFor(i);

        const yStart = y(c.valueStart);
        const yEnd = y(c.valueEnd);
        const barTop = Math.min(yStart, yEnd);
        const barHeight = Math.abs(yEnd - yStart);

        const isTotal = c.bar.isTotal === true;
        const kind = isTotal ? 'total' : c.bar.delta < 0 ? 'negative' : 'positive';
        const fill = isTotal ? seriesColour(0) : c.bar.delta < 0 ? SEMANTIC.danger : SEMANTIC.success;

        // A rising bar's (positive delta, or a non-negative total) meaningful
        // edge is its top — the label sits just above it. A falling bar's
        // meaningful edge is its bottom — the label sits just below it, so
        // the label never overlaps the bar it describes.
        const labelAbove = c.bar.delta >= 0;
        const labelY = labelAbove
          ? barTop - VALUE_LABEL_GAP_MM
          : barTop + barHeight + VALUE_LABEL_GAP_MM + LABEL.value * 0.8;

        // Totals show their absolute value plainly — they are not a "gain"
        // relative to anything, so no leading '+'. Non-total bars show a
        // signed contribution; Number's own toString already prefixes '-'
        // for negative deltas, only the '+' needs adding by hand. formatValue
        // (when given) formats the magnitude only — the sign/prefix logic
        // here stays in charge of the leading '+', so a caller's formatter
        // (e.g. rounding) never has to reimplement it.
        const magnitude = formatValue ? formatValue(c.bar.delta) : String(c.bar.delta);
        const displayValue = isTotal ? magnitude : `${c.bar.delta > 0 ? '+' : ''}${magnitude}`;

        // Bar labels sit in the fixed columnWidthMm slot below the plot —
        // the same fixed-width-column situation fitLabel was built for (see
        // bars-stacked.tsx's category label). When the label doesn't fit
        // upright, it rotates into the label band instead (see axis-labels.ts).
        const anchorX = columnX + columnWidthMm / 2;
        const categoryLabel = rotateLabels ? (
          <text key="label" className="waterfall-category-label" x={anchorX} y={labelBandTopY + ROTATED_LABEL_GAP_MM}
                textAnchor="end"
                transform={`rotate(${ROTATE_ANGLE_DEG} ${anchorX} ${labelBandTopY + ROTATED_LABEL_GAP_MM})`}
                fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis}
                {...fitLabel(c.bar.label, rotatedBudgetMm, LABEL.axis)}>
            {c.bar.label}
          </text>
        ) : (
          <text key="label" className="waterfall-category-label" x={anchorX} y={categoryLabelY} textAnchor="middle"
                fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis}
                {...fitLabel(c.bar.label, columnWidthMm, LABEL.axis)}>
            {c.bar.label}
          </text>
        );

        // Connector between this bar's end and the next bar's start. They
        // are always the same value by construction (see walkRunningTotal)
        // for two ordinary bars in a row. A total bar is deliberately
        // excluded on either side of the connector: it does NOT continue
        // from the running total (it restarts at zero), so a staircase line
        // into or out of it would visually assert a continuity that isn't
        // real — the exact kind of confidently-wrong mark this library
        // exists to avoid.
        const next = computed[i + 1];
        const showConnector = !isTotal && next !== undefined && next.bar.isTotal !== true;
        const connector = showConnector ? (
          <line className="waterfall-connector" x1={barX + barWidth} y1={yEnd} x2={barXFor(i + 1)} y2={yEnd}
                stroke={INK.muted} strokeWidth={pt(0.5)} strokeDasharray={`${pt(1.2)},${pt(1)}`} />
        ) : null;

        return (
          <g key={i} data-kind={kind}>
            <rect className={`waterfall-bar ${kind}`} x={barX} y={barTop} width={barWidth} height={barHeight}
                  fill={fill} />
            <text x={barX + barWidth / 2} y={labelY} textAnchor="middle" fontSize={LABEL.value}
                  fontFamily={LABEL.fontFamily} fill={INK.axis}>
              {displayValue}
            </text>
            {categoryLabel}
            {connector}
          </g>
        );
      })}
    </ChartFrame>
  );
}
