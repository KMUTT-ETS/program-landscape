// Shared decision + geometry for primitives that may need to rotate a row of
// labels to fit a narrow per-slot width: Matrix's column headers,
// BarsStacked's and Waterfall's category labels. `fitLabel` (fit-label.ts)
// answers "how do I squeeze this text to fit". This module answers the prior
// question: "should this text run diagonally instead of squeezing at all" —
// squeezing has a floor (fitLabel's 85% minScale), and a narrow repeating
// slot (a matrix column, a bar-chart category) hits that floor on ordinary
// KKU data (long English phrases, longer Thai phrases) far more easily than
// a one-off label like a row name ever does.

import { estimateTextWidthMm } from './fit-label';

/** Rotation angle used everywhere a label needs to run diagonally instead of
 * squeezing upright. -45° with `textAnchor="end"` is the conventional
 * treatment for a rotated axis/category/column label: the anchor stays
 * pinned to its own column/category, and the label runs diagonally away from
 * the plot into the band reserved for it. */
export const ROTATE_ANGLE_DEG = -45;

/** Gap between the plot/grid seam and where a rotated label's anchor sits. */
export const ROTATED_LABEL_GAP_MM = 1.5;

/**
 * Whether a row of labels needs to rotate to fit their shared per-slot width
 * upright. Content-driven, not count-driven: a chart with a FEW long labels
 * rotates just as readily as one with MANY short labels, and a chart with
 * many short labels never rotates just because there happen to be a lot of
 * them.
 *
 * Checked against every label, not just the longest, because the primitives
 * that call this render every label in the row at the SAME orientation — one
 * label needing to rotate means they all do, so the header/category row
 * reads as one consistent treatment rather than a mix of upright and
 * diagonal text. In practice the longest label is what decides it, but
 * `.some` is the correct predicate to state that contract, not a manual
 * longest-label lookup.
 *
 * This is a plain "does the natural width exceed the slot" comparison — it
 * does NOT credit `fitLabel`'s squeeze tolerance (down to 85% of natural
 * width) before deciding to rotate. A label that could have squeezed upright
 * rotates instead. That is a deliberate simplification: it keeps the
 * rotate-or-not decision a single cheap width comparison instead of a second
 * fitLabel-shaped calculation, at the cost of rotating a little more eagerly
 * than the absolute minimum necessary.
 */
export function needsRotatedLabels(
  labels: readonly string[],
  slotWidthMm: number,
  fontSizeMm: number,
): boolean {
  return labels.some((label) => estimateTextWidthMm(label, fontSizeMm) > slotWidthMm);
}

/**
 * Diagonal run length available to a label rotated at `ROTATE_ANGLE_DEG`,
 * anchored at the seam between its own reserved band (of `bandHeightMm`) and
 * the plot it sits against. A 45°-diagonal that must stay within a band of
 * height H (measured from the seam) can run up to `H * sqrt(2)` before it
 * would cross the far edge of that band — the same geometry regardless of
 * whether the band sits above the plot (Matrix's column headers, above the
 * grid) or below it (BarsStacked's / Waterfall's category labels, below the
 * baseline).
 */
export function rotatedLabelBudgetMm(bandHeightMm: number, gapMm: number = ROTATED_LABEL_GAP_MM): number {
  return (bandHeightMm - gapMm) * Math.SQRT2;
}
