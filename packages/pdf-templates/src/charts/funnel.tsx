import * as React from 'react';

import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
import { INK, SEMANTIC, seriesColour } from './palette';
import { linear } from './scale';
import type { ChartCommonProps } from './types';

export interface FunnelStage {
  label: string;
  value: number;
}

export interface FunnelProps extends Omit<ChartCommonProps, 'heightMm'> {
  /**
   * Stages in the given order — a stage exceeding the one before it (a real
   * possibility from transfers, re-entries, or a provenance error) is
   * rendered exactly where it was given, never reordered or clamped. See
   * the anomaly handling below.
   */
  stages: readonly FunnelStage[];
  /** Height of each stage row in mm, including its gap. */
  rowHeightMm?: number;
  /** Width in mm reserved for stage labels. */
  labelWidthMm?: number;
  /** Width in mm reserved to the right of each band for its value/conversion label. */
  valueGutterMm?: number;
}

/** Band height as a fraction of its row slot — same ratio BarsH/BarsStacked use. */
const BAND_HEIGHT_RATIO = 0.62;

/**
 * Conversion percentage against the immediately preceding stage.
 * `previous === 0` makes the ratio undefined (division by zero), not zero
 * and not Infinity — rendered as "—" rather than a fabricated number.
 */
function conversionPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current / previous) * 100;
}

export function Funnel({
  stages,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  rowHeightMm = 11,
  labelWidthMm = 40,
  valueGutterMm = 60,
  emptyNote,
}: FunnelProps): React.ReactElement {
  if (stages.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  const negativeStage = stages.find((s) => s.value < 0);
  if (negativeStage) {
    // A negative count isn't a real funnel value — mapped through the
    // [0, max] domain below it would extrapolate to a negative width, which
    // SVG drops silently (the same "reads as zero" failure BarsH's
    // plotWidth guard exists to prevent). This is a data-integrity bug,
    // not an anomaly the chart should visualise, so it fails loudly.
    throw new RangeError(
      `Funnel: stage "${negativeStage.label}" has a negative value (${negativeStage.value}). ` +
        'Funnel stage counts cannot be negative.',
    );
  }

  const plotWidth = widthMm - labelWidthMm - valueGutterMm;
  if (plotWidth <= 0) {
    // Same posture as BarsH: a non-positive plot width would draw every
    // band at zero or negative width, which reads as "every stage is
    // empty" rather than the true "no room to plot" layout problem.
    throw new RangeError(
      `Funnel: no room to plot — widthMm ${widthMm} minus labelWidthMm ${labelWidthMm} and ` +
        `valueGutterMm ${valueGutterMm} leaves ${plotWidth}mm. Widen widthMm or narrow the label/gutter columns.`,
    );
  }

  const heightMm = Math.max(rowHeightMm * stages.length + 4, 12);
  const max = Math.max(...stages.map((s) => s.value), 0);
  // linear() collapses a zero-width domain to the range start, so an
  // all-zero series yields width 0 for every band rather than NaN.
  const width = linear([0, max], [0, plotWidth]);
  const bandHeight = rowHeightMm * BAND_HEIGHT_RATIO;

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance} widthMm={widthMm} heightMm={heightMm}>
      {stages.map((stage, i) => {
        const yTop = MARGIN_MM + i * rowHeightMm;
        const bandWidth = width(stage.value);
        // Bands are centred in the plot column (not left-aligned like
        // BarsH) so a normal, monotonically narrowing funnel reads as a
        // symmetric taper — the conventional funnel silhouette. This also
        // means an anomalous WIDER band visibly bulges back out past its
        // neighbours on both sides, rather than only on one, making the
        // anomaly easier to spot at a glance.
        const bandX = labelWidthMm + (plotWidth - bandWidth) / 2;

        const previous = i > 0 ? stages[i - 1] : undefined;
        // An increase over the previous stage is a real possibility in this
        // data (transfers, re-entries, a provenance error) and must be
        // surfaced, not hidden. It is never used to reorder, clamp, or
        // sort the stages — the band width above is computed from the
        // stage's own honest value, and the row still renders in its given
        // position. The only difference here is colour + an explicit note,
        // per the brief: SEMANTIC.warning with a note.
        const isAnomalous = previous !== undefined && stage.value > previous.value;

        const pct = previous !== undefined ? conversionPct(stage.value, previous.value) : null;
        const pctLabel = previous === undefined ? '' : pct === null ? ' · —' : ` · ${Math.round(pct)}%`;
        const valueText = `${stage.value}${pctLabel}`;

        const fill = isAnomalous ? SEMANTIC.warning : seriesColour(0);
        const textFill = isAnomalous ? SEMANTIC.warning : INK.axis;

        return (
          <g key={i}>
            <text x={0} y={yTop + bandHeight * 0.78} fontSize={LABEL.axis}
                  fontFamily={LABEL.fontFamily} fill={INK.axis}>
              {stage.label}
            </text>
            <rect className={isAnomalous ? 'funnel-band anomalous' : 'funnel-band'} x={bandX} y={yTop}
                  width={bandWidth} height={bandHeight} fill={fill} />
            <text x={labelWidthMm + plotWidth + 2} y={yTop + bandHeight * 0.78}
                  fontSize={LABEL.value} fontFamily={LABEL.fontFamily} fill={textFill}>
              {valueText}
            </text>
            {isAnomalous && (
              <text className="funnel-anomaly-note" x={labelWidthMm + plotWidth + 2}
                    y={yTop + bandHeight * 0.78 + LABEL.legend * 1.1} fontSize={LABEL.legend}
                    fontFamily={LABEL.fontFamily} fill={SEMANTIC.warning}>
                {'▲ higher than previous stage'}
              </text>
            )}
          </g>
        );
      })}
    </ChartFrame>
  );
}
