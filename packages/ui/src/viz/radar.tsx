'use client';

import * as React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
} from 'recharts';
import { useChartPalette } from './chart-theme';

// Radar for the 5-dim health score on the deep-dive header. Recharts'
// RadarChart with hand-tuned grid + axis colours via the palette hook.
// Width/height are explicit so it plays nicely with server-rendered
// parents (no ResponsiveContainer).
//
// Null handling — important for the Council audience:
//   - A null dimension means "no data", NOT "scored zero".
//   - We render the polygon ONLY across dimensions that have data
//     (drops the misleading "crashes to 0" line that the previous
//     version drew on null dims).
//   - Null axis labels are suffixed with a small marker so the
//     reader can see at-a-glance which dims have no underlying data.
//   - When EVERY dimension is null, we render a placeholder message
//     instead of an empty chart.

export interface RadarPoint {
  label: string;
  // 0-100, or null when no data.
  value: number | null;
}

export interface RadarChartSmallProps {
  points: RadarPoint[];
  width?: number;
  height?: number;
  seriesLabel?: string;
}

const NO_DATA_SUFFIX = ' · n/d';

export function RadarChartSmall({
  points,
  width = 280,
  height = 240,
  seriesLabel = 'Health',
}: RadarChartSmallProps) {
  const palette = useChartPalette();
  // Mount-guard: Recharts internals can produce slightly different
  // markup between SSR and the first client render (e.g. clip-path
  // ids, label positions), which Next 14 surfaces as a hydration
  // mismatch. Render a same-sized placeholder during SSR; mount on
  // the client.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center rounded-md border border-dashed border-border-subtle text-xs text-text-tertiary"
      >
        Loading…
      </div>
    );
  }
  const populated = points.filter((p) => p.value !== null);
  if (populated.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center rounded-md border border-dashed border-border-subtle text-xs text-text-tertiary"
      >
        Health radar unavailable — every dimension is missing data.
      </div>
    );
  }
  // Plot all 5 axes (so the radar's structure stays stable across
  // programs) but the value series is `null` on missing dims, which
  // Recharts renders as a gap — the polygon connects only the dims
  // with real data.
  const data = points.map((p) => ({
    subject: p.value === null ? p.label + NO_DATA_SUFFIX : p.label,
    value: p.value,
    hasData: p.value !== null,
  }));
  return (
    <RadarChart width={width} height={height} data={data}>
      <PolarGrid stroke={palette.grid} />
      <PolarAngleAxis
        dataKey="subject"
        stroke={palette.axis}
        tick={{ fill: palette.text, fontSize: 11 }}
      />
      <PolarRadiusAxis
        angle={90}
        domain={[0, 100]}
        tick={{ fill: palette.axis, fontSize: 10 }}
        stroke={palette.grid}
      />
      <Tooltip
        formatter={(v) =>
          v === null || v === undefined || v === '' ? 'no data' : String(Math.round(Number(v)))
        }
        contentStyle={{
          border: `1px solid ${palette.grid}`,
          fontSize: 12,
        }}
      />
      <Radar
        name={seriesLabel}
        dataKey="value"
        stroke={palette.series[0] ?? palette.text}
        fill={palette.series[0] ?? palette.text}
        fillOpacity={0.3}
        connectNulls={false}
        isAnimationActive={false}
        dot={{ r: 3 }}
      />
    </RadarChart>
  );
}
