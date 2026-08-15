// Shared layout constants for the print chart primitives.
// Sizes are millimetres — SVG user units in this library are mm.

/**
 * Height of the empty-state block. Independent of any row-count formula:
 * a row-derived height collapses to a few mm when there are no rows, which
 * is too short to read a message in.
 */
export const EMPTY_HEIGHT_MM = 24;

/** Breathing room between the chart edge and its plot area. */
export const MARGIN_MM = 2;
