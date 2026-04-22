'use client';

import * as React from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { useChartPalette } from './chart-theme';

// Minimal sparkline for inline use in KPIs and table cells. No axis,
// no tooltip — just the shape. Colour defaults to data-neutral unless
// `tone` is specified.

export interface SparklineProps {
  data: number[];
  tone?: 'neutral' | 'positive' | 'negative';
  strokeWidth?: number;
}

export function Sparkline({ data, tone = 'neutral', strokeWidth = 1.5 }: SparklineProps) {
  const palette = useChartPalette();
  const color =
    tone === 'positive'
      ? palette.positive
      : tone === 'negative'
        ? palette.negative
        : palette.neutral;
  const points = data.map((y, i) => ({ x: i, y }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line
          type="monotone"
          dataKey="y"
          stroke={color}
          strokeWidth={strokeWidth}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
