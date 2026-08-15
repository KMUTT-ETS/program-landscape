/* eslint-disable no-restricted-syntax --
 * Hex literals are correct here. PDFs are always light theme, and CSS custom
 * properties cannot be resolved inside server-rendered SVG — Gotenberg gets
 * markup with no <html data-theme> to read from. These are the light-mode
 * values of packages/design/src/css/tokens.css, evaluated offline. Mirror any
 * token change here in the same commit.
 */

/** Categorical series colours, in assignment order. */
export const PRINT_PALETTE = [
  '#2B4BA4', // chart-1 — indigo
  '#9C1D2E', // chart-2 — KKU cardinal
  '#046C4E', // chart-3 — green
  '#A15C00', // chart-4 — amber
  '#5E2D90', // chart-5 — violet
  '#00716B', // chart-6 — teal
] as const;

/** Status colours, matching base-css.ts `.danger` / `.warning` / `.success` / `.info`. */
export const SEMANTIC = {
  danger: '#B42318',
  warning: '#A15C00',
  success: '#046C4E',
  info: '#2B4BA4',
} as const;

/** Neutral furniture — axes, rules, gridlines, muted labels. */
export const INK = {
  axis: '#111111',
  rule: '#DDDDDD',
  muted: '#777777',
  surface: '#F6F4F0',
} as const;

/** Series colour by index, wrapping when there are more series than colours. */
export function seriesColour(index: number): string {
  return PRINT_PALETTE[index % PRINT_PALETTE.length] as string;
}
