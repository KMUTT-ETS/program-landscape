'use client';

import * as React from 'react';

// Resolves the chart palette at runtime by reading CSS variables from the
// document. Recharts accepts literal colour strings only (not CSS vars
// inside SVG attributes reliably), so we flatten `oklch(var(--...))` to
// the computed colour string at render time. When the theme toggles, we
// re-read and force a Recharts re-render.

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
}

export function readChartPalette(): ChartPalette {
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
  };
}

// Subscribes to theme changes on the <html> element so charts re-read
// their palette when the user flips light/dark.
export function useChartPalette(): ChartPalette {
  const [palette, setPalette] = React.useState<ChartPalette>(() => readChartPalette());
  React.useEffect(() => {
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
