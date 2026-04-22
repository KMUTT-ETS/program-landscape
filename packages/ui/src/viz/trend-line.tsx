'use client';

import * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartPalette } from './chart-theme';

export interface TrendLinePoint {
  /** X value — typically a label like a year or month. */
  x: string | number;
  /** Named series values. Keys appear as legend labels. */
  [series: string]: string | number;
}

export interface TrendLineProps {
  data: TrendLinePoint[];
  /** Ordered list of series keys to render. Order = stacking + palette order. */
  series: string[];
  /** y-axis formatter for tick labels (e.g. (v) => `${v}%`). */
  yTickFormatter?: (value: number) => string;
  /** Accessible label for the chart (screen reader). */
  ariaLabel?: string;
}

export function TrendLine({
  data,
  series,
  yTickFormatter,
  ariaLabel,
}: TrendLineProps) {
  const palette = useChartPalette();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
        aria-label={ariaLabel}
        role="img"
      >
        <CartesianGrid
          vertical={false}
          stroke={palette.grid}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="x"
          stroke={palette.axis}
          tick={{ fill: palette.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke={palette.axis}
          tick={{ fill: palette.text, fontSize: 11 }}
          tickFormatter={yTickFormatter}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'oklch(var(--color-surface-1))',
            border: '1px solid oklch(var(--color-border-default))',
            borderRadius: 6,
            fontSize: 12,
          }}
          labelStyle={{ color: 'oklch(var(--color-text-primary))' }}
        />
        {series.map((s, i) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            stroke={palette.series[i % palette.series.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
