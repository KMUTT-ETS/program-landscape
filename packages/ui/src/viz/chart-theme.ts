'use client';

import * as React from 'react';

// Resolves the chart palette at runtime by reading CSS variables from the
// document. Recharts accepts literal colour strings only (not CSS vars
// inside SVG attributes reliably), so we flatten `oklch(var(--...))` to
// the computed colour string at render time. When the theme toggles, we
// re-read and force a Recharts re-render.
//
// During SSR + the brief moment before the post-mount effect fires there
// is no `document` to compute styles from. Without a fallback, every
// resolveColor() returned `'currentColor'` — Recharts then painted every
// series, axis, grid and label in inherited text colour, producing a
// flash of black-and-white charts on first paint. Use the static
// FALLBACK_PALETTE below (light-mode hex evaluated from
// packages/design/src/css/tokens.css) as the SSR / pre-mount seed.

// ── Static light-mode evaluation of the palette tokens ────────────────
//
// This block is the one place in the app that is *allowed* to spell colours
// out: it exists precisely because there is no document to read tokens from
// during SSR. It mirrors packages/design/src/css/tokens.css and is exempt
// from the no-hardcoded-colour rule for the same reason that file is —
// everywhere else, resolve through `useChartPalette()` or a CSS var.
/* eslint-disable no-restricted-syntax */
// Sourced literally from packages/design/src/css/tokens.css under
// [data-theme='light']. Using oklch() strings instead of approximated
// hex means the SSR/pre-mount paint matches the live CSS exactly — no
// "looks slightly off" flash. If the design tokens shift, mirror the
// change here. (PRINT_PALETTE in @kku/pdf-templates uses hex because
// older Chromium-on-Gotenberg renderers don't support oklch reliably;
// at runtime the browser does, so we use it directly.)
const FALLBACK_SERIES = [
  'oklch(65.0% 0.155 50)',  // chart-1
  'oklch(70.0% 0.150 75)',  // chart-2
  'oklch(75.0% 0.140 95)',  // chart-3
  'oklch(70.0% 0.110 130)', // chart-4
  'oklch(62.0% 0.110 195)', // chart-5
  'oklch(65.0% 0.115 225)', // chart-6
  'oklch(58.0% 0.150 250)', // chart-7
  'oklch(55.0% 0.165 280)', // chart-8
  'oklch(58.0% 0.150 310)', // chart-9
  'oklch(60.0% 0.165 345)', // chart-10
  'oklch(64.0% 0.155 25)',  // chart-11
  'oklch(55.0% 0.080 55)',  // chart-12
];

const FALLBACK_PALETTE: ChartPalette = {
  series: FALLBACK_SERIES,
  axis: 'oklch(54.0% 0.015 50)',
  grid: 'oklch(92.5% 0.014 60)',
  text: 'oklch(38.0% 0.018 50)',
  positive: 'oklch(56.0% 0.155 150)',
  negative: 'oklch(58.0% 0.205 25)',
  neutral: 'oklch(60.0% 0.018 60)',
  warning: 'oklch(70.0% 0.170 75)',
};
/* eslint-enable no-restricted-syntax */

function resolveColor(varName: string): string {
  if (typeof window === 'undefined') return 'currentColor';
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return 'currentColor';
  return `oklch(${raw})`;
}

export interface ChartPalette {
  series: string[];
  axis: string;
  grid: string;
  text: string;
  positive: string;
  negative: string;
  neutral: string;
  // The middle band of a good/caution/bad encoding. `positive` and
  // `negative` alone can't express a three-state severity scale
  // (OK / WARN / CRITICAL, LOW / MEDIUM / HIGH automation risk).
  warning: string;
}

export function readChartPalette(): ChartPalette {
  // SSR (and the few ms before the first useEffect fires) has no live
  // CSS to read — fall back to the static light-mode palette so Recharts
  // doesn't paint everything in `currentColor` (= grey/black). Dark-mode
  // users see one quick re-render to the real dark palette after mount.
  if (typeof window === 'undefined') return FALLBACK_PALETTE;
  return {
    series: [
      resolveColor('--color-chart-1'),
      resolveColor('--color-chart-2'),
      resolveColor('--color-chart-3'),
      resolveColor('--color-chart-4'),
      resolveColor('--color-chart-5'),
      resolveColor('--color-chart-6'),
      resolveColor('--color-chart-7'),
      resolveColor('--color-chart-8'),
      resolveColor('--color-chart-9'),
      resolveColor('--color-chart-10'),
      resolveColor('--color-chart-11'),
      resolveColor('--color-chart-12'),
    ],
    axis: resolveColor('--color-text-tertiary'),
    grid: resolveColor('--color-border-subtle'),
    text: resolveColor('--color-text-secondary'),
    positive: resolveColor('--color-data-positive'),
    negative: resolveColor('--color-data-negative'),
    neutral: resolveColor('--color-data-neutral'),
    warning: resolveColor('--color-warning-default'),
  };
}

// Subscribes to theme changes on the <html> element so charts re-read
// their palette when the user flips light/dark.
// Layout effect on the client so a chart mounting after hydration in dark mode
// never paints a frame in the light fallback; plain effect on the server.
const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export function useChartPalette(): ChartPalette {
  // Seed with the static palette on BOTH server and client. Seeding from
  // readChartPalette() on the client made the first client render differ
  // from the SSR markup in dark mode; React does not patch mismatched
  // attributes during hydration, and the effect below then set an equal
  // value, so the light-mode SSR colours stayed on screen.
  const [palette, setPalette] = React.useState<ChartPalette>(FALLBACK_PALETTE);
  useIsoLayoutEffect(() => {
    const recompute = () => setPalette(readChartPalette());
    // Initial resolve now that we're on the client.
    recompute();
    const observer = new MutationObserver(recompute);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'data-density'],
    });
    return () => observer.disconnect();
  }, []);
  return palette;
}
