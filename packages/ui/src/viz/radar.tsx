'use client';

import * as React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import { useChartPalette } from './chart-theme';

// Radar for the 5-dim health score on the deep-dive header. Recharts'
// RadarChart with hand-tuned grid + axis colours via the palette hook.
// Width/height are explicit so it plays nicely with server-rendered
// parents (no ResponsiveContainer).

export interface RadarPoint {
  label: string;
  // 0-100, or null when no data (plotted at 0 with a subtle flag).
  value: number | null;
}

export interface RadarChartSmallProps {
  points: RadarPoint[];
  width?: number;
  height?: number;
  seriesLabel?: string;
}

export function RadarChartSmall({
  points,
  width = 280,
  height = 240,
  seriesLabel = 'Health',
}: RadarChartSmallProps) {
  const palette = useChartPalette();
  const data = points.map((p) => ({
    subject: p.label,
    value: p.value ?? 0,
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
      <Radar
        name={seriesLabel}
        dataKey="value"
        stroke={palette.series[0] ?? palette.text}
        fill={palette.series[0] ?? palette.text}
        fillOpacity={0.3}
        isAnimationActive={false}
      />
    </RadarChart>
  );
}
