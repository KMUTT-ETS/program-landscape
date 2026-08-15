import * as React from 'react';

import { needsRotatedLabels, ROTATE_ANGLE_DEG, ROTATED_LABEL_GAP_MM, rotatedLabelBudgetMm } from './axis-labels';
import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { estimateTextWidthMm, fitLabel } from './fit-label';
import { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
import { INK, seriesColour } from './palette';
import { linear, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface MatrixRow {
  label: string;
  /** One cell per column, in column order. null = unknown, NOT zero. */
  cells: readonly (number | null)[];
}

export interface MatrixProps extends Omit<ChartCommonProps, 'heightMm'> {
  columns: readonly string[];
  rows: readonly MatrixRow[];
  /** Width in mm reserved for row labels. */
  labelWidthMm?: number;
  /** Width in mm of each column slot, including its cell gap. */
  columnWidthMm?: number;
  /** Height in mm of each row slot, including its cell gap. */
  rowHeightMm?: number;
  /** Height in mm reserved above the grid for column headers. */
  headerHeightMm?: number;
}

/** Breathing room inside each cell slot so adjacent cells read as distinct cells, not one solid block. */
const CELL_GAP_MM = 0.5;
/** Padding kept clear on either side of an in-cell value so its glyphs never
 * touch the cell's border stroke. */
const VALUE_TEXT_PADDING_MM = 0.3;
/** A cell fill at or above this fraction of the domain is dark enough that
 * dark (INK.axis) text loses contrast against it — switch to the light
 * (near-white) ink instead. 0.55 sits just past the ramp's midpoint, which
 * is where PRINT_PALETTE's indigo becomes the visually dominant channel. */
const DARK_FILL_TEXT_THRESHOLD = 0.55;
/** Height in mm reserved below the grid for the colour-scale legend — a
 * Gotenberg-rendered PDF is static, so a reader has no hover to recover what
 * a shade means; the legend is what lets them calibrate it by eye instead. */
const LEGEND_BAND_HEIGHT_MM = 10;
const LEGEND_SWATCH_SIZE_MM = LABEL.legend;
const LEGEND_GAP_MM = 1.5;
/** Horizontal space between the "min" swatch+label pair and the "max" pair. */
const LEGEND_ITEM_GAP_MM = 10;

/**
 * Parse a `#RRGGBB` string into channels. This only ever sees
 * `seriesColour(0)`, i.e. an entry from PRINT_PALETTE — the RangeError is a
 * "the palette's own format changed underneath this function" guard, not an
 * expected caller-input failure, which is why it throws rather than
 * returning a fallback colour that would silently mis-render the ramp.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(hex);
  const r = match?.[1];
  const g = match?.[2];
  const b = match?.[3];
  if (r === undefined || g === undefined || b === undefined) {
    throw new RangeError(`Matrix: expected a 6-digit hex colour, received "${hex}".`);
  }
  return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
}

function channelToHex(value: number): string {
  const clamped = Math.round(Math.min(255, Math.max(0, value)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Single-hue ramp: white at fraction 0, the full series colour at fraction
 * 1. Every channel of seriesColour(0) is below 255 (it is a real colour,
 * not white), so all three channels move monotonically as fraction
 * increases — there is no fraction where the ramp reverses direction, which
 * is what makes "more saturated = larger value" a safe reading of the grid.
 */
function intensityColour(fraction: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const hue = hexToRgb(seriesColour(0));
  const r = 255 + (hue.r - 255) * clamped;
  const g = 255 + (hue.g - 255) * clamped;
  const b = 255 + (hue.b - 255) * clamped;
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

export function Matrix({
  columns,
  rows,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  labelWidthMm = 45,
  columnWidthMm = 10,
  rowHeightMm = 8,
  headerHeightMm = 26,
  emptyNote,
}: MatrixProps): React.ReactElement {
  if (rows.length === 0 || columns.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  const badRow = rows.find((r) => r.cells.length !== columns.length);
  if (badRow) {
    // A short (or long) cells array would shift every cell after the
    // mismatch into the wrong column — a confidently wrong chart, not a
    // cosmetic gap. Same posture as BarsStacked's segment-order guard, on
    // this primitive's other axis.
    throw new RangeError(
      `Matrix: row "${badRow.label}" has ${badRow.cells.length} cells but there are ${columns.length} ` +
        'columns. Every row\'s cells array must have exactly one entry per column (use null for ' +
        'unknown, never a missing/short array).',
    );
  }

  const negativeCell = rows
    .flatMap((row) => row.cells.map((value) => ({ row, value })))
    .find((c) => c.value !== null && c.value < 0);
  if (negativeCell) {
    // The single-hue ramp below assumes a [0, max] domain — a negative
    // value would clamp to fraction 0 and render visually IDENTICAL to a
    // true zero, silently erasing the difference between "none" and
    // "negative". That is a data bug, not a state this ramp can honestly
    // represent, so it fails loudly rather than passing the anomaly through.
    throw new RangeError(
      `Matrix: row "${negativeCell.row.label}" has a negative cell value (${String(negativeCell.value)}). ` +
        'Matrix cells must be non-negative (or null for unknown) — the single-hue intensity ramp has ' +
        'no way to honestly represent a negative value.',
    );
  }

  // The column axis is horizontal and bounded by widthMm — same posture as
  // BarsStacked's / Waterfall's column-axis guard: a column count that
  // doesn't fit must fail loudly rather than silently overflow the page.
  const neededWidth = labelWidthMm + columnWidthMm * columns.length;
  if (neededWidth > widthMm) {
    throw new RangeError(
      `Matrix: ${columns.length} columns at columnWidthMm ${columnWidthMm} plus labelWidthMm ` +
        `${labelWidthMm} need ${neededWidth}mm but only ${widthMm}mm is available. Reduce ` +
        'columnWidthMm, reduce the column count, narrow labelWidthMm, or widen widthMm.',
    );
  }

  const heightMm =
    MARGIN_MM + headerHeightMm + rowHeightMm * rows.length + LEGEND_BAND_HEIGHT_MM + MARGIN_MM;
  const gridTopY = MARGIN_MM + headerHeightMm;
  const gridWidth = columnWidthMm * columns.length;
  const gridHeight = rowHeightMm * rows.length;
  const gridBottomY = gridTopY + gridHeight;
  const legendY = gridBottomY + LEGEND_BAND_HEIGHT_MM * 0.65;
  const legendSwatchY = legendY - LEGEND_SWATCH_SIZE_MM;

  // Domain spans the WHOLE matrix, not each row independently — like
  // DotRange's shared x domain, two cells with the same value anywhere in
  // the grid must render the same fill. A per-row domain would make the
  // chart lie by comparison.
  const values = rows.flatMap((r) => r.cells).filter((c): c is number => c !== null);
  const domainMax = Math.max(...values, 0);
  // linear() collapses a zero-width domain to the range start, so an
  // all-null-or-all-zero matrix yields fraction 0 (the palest tint)
  // everywhere rather than NaN.
  const intensity = linear([0, domainMax], [0, 1]);

  // Legend label x-positions are computed from the min label's own
  // estimated width (not a fixed offset) so a multi-digit domainMax never
  // collides with the min swatch/label pair to its left.
  const legendMinLabel = '0';
  const legendMaxLabel = String(domainMax);
  const legendMinSwatchX = labelWidthMm;
  const legendMinLabelX = legendMinSwatchX + LEGEND_SWATCH_SIZE_MM + LEGEND_GAP_MM;
  const legendMaxSwatchX =
    legendMinLabelX + estimateTextWidthMm(legendMinLabel, LABEL.legend) + LEGEND_ITEM_GAP_MM;
  const legendMaxLabelX = legendMaxSwatchX + LEGEND_SWATCH_SIZE_MM + LEGEND_GAP_MM;

  // Content-driven, not count-driven: rotate whenever the longest header
  // would not fit upright in its column slot, regardless of how many columns
  // there are. A column-count threshold (the previous rule here) is
  // orthogonal to the actual constraint — 5 columns of long skill phrases
  // need to rotate just as readily as 13 columns of short ones, and a count
  // threshold alone can gate a caller into a dead end: at columnWidthMm
  // narrow enough to fit many columns within widthMm, fitLabel's 85% floor
  // rejects long upright labels; at columnWidthMm wide enough to satisfy
  // fitLabel, the neededWidth guard above rejects the layout. Rotating
  // whenever content demands it (not counting columns) removes that trap.
  const rotate = needsRotatedLabels(columns, columnWidthMm, LABEL.axis);
  // Rotated labels read diagonally from a fixed anchor at the header/grid
  // seam, so the available run length is the diagonal of the header band
  // (headerHeightMm minus the small gap to the grid), not the header
  // height itself.
  const rotatedBudgetMm = rotatedLabelBudgetMm(headerHeightMm, ROTATED_LABEL_GAP_MM);

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance} widthMm={widthMm} heightMm={heightMm}>
      {columns.map((column, j) => {
        const columnX = labelWidthMm + j * columnWidthMm;
        const anchorX = columnX + columnWidthMm / 2;

        if (rotate) {
          const anchorY = gridTopY - ROTATED_LABEL_GAP_MM;
          const labelFit = fitLabel(column, rotatedBudgetMm, LABEL.axis);
          return (
            // text-anchor="end" plants the label's end (not its start) at
            // the anchor point, then the rotation swings the whole run
            // up-and-left from that fixed point — so the anchor stays
            // pinned to its own column regardless of label length.
            <text key={j} className="matrix-column-header" x={anchorX} y={anchorY} textAnchor="end"
                  transform={`rotate(${ROTATE_ANGLE_DEG} ${anchorX} ${anchorY})`}
                  fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis} {...labelFit}>
              {column}
            </text>
          );
        }

        const labelFit = fitLabel(column, columnWidthMm, LABEL.axis);
        return (
          <text key={j} className="matrix-column-header" x={anchorX} y={MARGIN_MM + LABEL.axis}
                textAnchor="middle" fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis}
                {...labelFit}>
            {column}
          </text>
        );
      })}

      {rows.map((row, i) => {
        const rowY = gridTopY + i * rowHeightMm;
        const labelFit = fitLabel(row.label, labelWidthMm, LABEL.axis);
        return (
          // Keyed by index, not row.label: this is a generic primitive and
          // callers may pass duplicate peer/institution names at different
          // scopes.
          <g key={i}>
            <text className="matrix-row-label" x={0} y={rowY + rowHeightMm / 2 + LABEL.axis * 0.35}
                  fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis} {...labelFit}>
              {row.label}
            </text>
            {row.cells.map((value, j) => {
              const cellX = labelWidthMm + j * columnWidthMm + CELL_GAP_MM / 2;
              const cellY = rowY + CELL_GAP_MM / 2;
              const cellW = columnWidthMm - CELL_GAP_MM;
              const cellH = rowHeightMm - CELL_GAP_MM;
              const columnLabel = columns[j] ?? '';

              if (value === null) {
                // Hollow (surface fill, not palette), dashed border, plus an
                // explicit crosshatch — the "no data" vocabulary this
                // library already uses for Radar's null-axis marker and
                // LineTrend's projected points, adapted to a filled shape:
                // a plain pale fill alone (the zero-value treatment below)
                // would not be distinct enough at a glance or in
                // greyscale print.
                return (
                  <g key={j}>
                    <title>{`${row.label} × ${columnLabel}: no data`}</title>
                    <rect className="matrix-cell-null" x={cellX} y={cellY} width={cellW} height={cellH}
                          fill={INK.surface} stroke={INK.muted} strokeWidth={pt(0.5)}
                          strokeDasharray={`${pt(1.2)},${pt(1)}`} />
                    <line x1={cellX} y1={cellY} x2={cellX + cellW} y2={cellY + cellH}
                          stroke={INK.muted} strokeWidth={pt(0.35)} />
                    <line x1={cellX + cellW} y1={cellY} x2={cellX} y2={cellY + cellH}
                          stroke={INK.muted} strokeWidth={pt(0.35)} />
                  </g>
                );
              }

              // A cell's number is Council-load-bearing content, not
              // decoration — the <title> tooltip below is real (it helps a
              // reader who DOES have a mouse, e.g. reviewing the PDF on
              // screen before print), but it must never be the ONLY place
              // the value appears: Gotenberg renders a static PDF with no
              // hover, so a tooltip-only value is invisible in the delivered
              // artifact. Rendered in-cell only when it actually fits —
              // never truncated or overlapping — with the <title> as the
              // permanent fallback either way.
              const fraction = intensity(value);
              const fill = intensityColour(fraction);
              const displayValue = String(value);
              const valueTextWidthMm = estimateTextWidthMm(displayValue, LABEL.value);
              const valueFits = valueTextWidthMm <= cellW - 2 * VALUE_TEXT_PADDING_MM;
              // A saturated (high-value) fill is dark enough that dark text
              // loses contrast — flip to the light ink past the threshold so
              // the number stays legible across the whole ramp, not just its
              // pale end.
              const valueFill = fraction >= DARK_FILL_TEXT_THRESHOLD ? INK.surface : INK.axis;
              return (
                <g key={j}>
                  <title>{`${row.label} × ${columnLabel}: ${value}`}</title>
                  <rect className="matrix-cell" x={cellX} y={cellY} width={cellW} height={cellH}
                        fill={fill} stroke={INK.rule} strokeWidth={pt(0.4)} />
                  {valueFits && (
                    <text className="matrix-cell-value" x={cellX + cellW / 2} y={cellY + cellH / 2 + LABEL.value * 0.35}
                          textAnchor="middle" fontSize={LABEL.value} fontFamily={LABEL.fontFamily} fill={valueFill}>
                      {displayValue}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      <rect className="matrix-grid-border" x={labelWidthMm} y={gridTopY} width={gridWidth} height={gridHeight}
            fill="none" stroke={INK.rule} strokeWidth={pt(0.5)} />

      {/* Colour-scale legend. Without it a reader sees relative shading with
          nothing to calibrate against — this is what lets them recover what
          a shade actually means. Two swatches (the ramp's floor and ceiling,
          [0, domainMax] — the same domain `intensity` uses above, not the
          data's own min/max) with their numeric values; label x-positions
          are computed from the min label's own estimated width so a
          multi-digit domainMax never collides with the min swatch. */}
      <g className="matrix-legend">
        <rect className="matrix-legend-swatch" x={legendMinSwatchX} y={legendSwatchY}
              width={LEGEND_SWATCH_SIZE_MM} height={LEGEND_SWATCH_SIZE_MM}
              fill={intensityColour(0)} stroke={INK.rule} strokeWidth={pt(0.4)} />
        <text x={legendMinLabelX} y={legendY} fontSize={LABEL.legend} fontFamily={LABEL.fontFamily} fill={INK.axis}>
          {legendMinLabel}
        </text>
        <rect className="matrix-legend-swatch" x={legendMaxSwatchX} y={legendSwatchY}
              width={LEGEND_SWATCH_SIZE_MM} height={LEGEND_SWATCH_SIZE_MM}
              fill={intensityColour(1)} stroke={INK.rule} strokeWidth={pt(0.4)} />
        <text x={legendMaxLabelX} y={legendY} fontSize={LABEL.legend} fontFamily={LABEL.fontFamily} fill={INK.axis}>
          {legendMaxLabel}
        </text>
      </g>
    </ChartFrame>
  );
}
