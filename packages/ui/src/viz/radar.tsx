'use client';

import * as React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
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

// Optional benchmark overlays (e.g. University / Faculty averages on the
// deep-dive Health radar). Each comparison's points align by index with
// the main `points`. Rendered as stroke-only dashed polygons over the
// filled primary series, with a legend.
export interface RadarComparison {
  label: string;
  points: RadarPoint[];
}

export interface RadarChartSmallProps {
  points: RadarPoint[];
  width?: number;
  height?: number;
  seriesLabel?: string;
  comparisons?: RadarComparison[];
}

const NO_DATA_SUFFIX = ' · n/d';

export function RadarChartSmall({
  points,
  width = 280,
  height = 240,
  seriesLabel = 'Health',
  comparisons = [],
}: RadarChartSmallProps) {
  const palette = useChartPalette();
  // Mount-guard: Recharts internals can produce slightly different
  // markup between SSR and the first client render (e.g. clip-path
  // ids, label positions), which Next 14 surfaces as a hydration
  // mismatch. Render a same-sized placeholder during SSR; mount on
  // the client.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // Series the user has toggled off via the legend (by dataKey:
  // 'value' = this program, 'cmp<i>' = a comparison overlay).
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const toggleSeries = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
  // with real data. Comparison overlays (University / Faculty averages)
  // ride alongside as `cmp<i>` keys, aligned by index.
  const data = points.map((p, i) => {
    const row: Record<string, string | number | boolean | null> = {
      subject: p.value === null ? p.label + NO_DATA_SUFFIX : p.label,
      value: p.value,
      hasData: p.value !== null,
    };
    comparisons.forEach((c, ci) => {
      row[`cmp${ci}`] = c.points[i]?.value ?? null;
    });
    return row;
  });
  const hasComparisons = comparisons.length > 0;
  // Make room for the legend when overlays are present.
  const chartHeight = hasComparisons ? height + 28 : height;
  return (
    <RadarChart width={width} height={chartHeight} data={data}>
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
      {hasComparisons && (
        <Legend
          wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
          iconSize={10}
          onClick={(entry) => {
            // Our series use string dataKeys ('value' / 'cmp<i>'); ignore
            // the (typed-but-never-used-here) function-dataKey case.
            if (typeof entry?.dataKey === 'string') toggleSeries(entry.dataKey);
          }}
        />
      )}
      <Radar
        name={seriesLabel}
        dataKey="value"
        stroke={palette.series[0] ?? palette.text}
        fill={palette.series[0] ?? palette.text}
        fillOpacity={0.3}
        connectNulls={false}
        isAnimationActive={false}
        dot={{ r: 3 }}
        hide={hidden.has('value')}
      />
      {comparisons.map((c, ci) => {
        const stroke = palette.series[(ci + 1) % palette.series.length] ?? palette.text;
        return (
          <Radar
            key={`cmp${ci}`}
            name={c.label}
            dataKey={`cmp${ci}`}
            stroke={stroke}
            fill="none"
            strokeWidth={1.75}
            strokeDasharray="4 3"
            connectNulls={false}
            isAnimationActive={false}
            dot={{ r: 2 }}
            hide={hidden.has(`cmp${ci}`)}
          />
        );
      })}
    </RadarChart>
  );
}
