'use client';

import * as React from 'react';
import { FunnelChart, Funnel, LabelList, Tooltip } from 'recharts';
import { useChartPalette } from './chart-theme';

// Funnel for the demand pipeline: Applications → Admitted → Enrolled →
// Year 2 retained → Graduated on time. Built on Recharts' built-in
// FunnelChart — gives us nicely scaled trapezoids out of the box.

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
}

export interface FunnelProps {
  stages: FunnelStage[];
  width?: number;
  height?: number;
}

export function FunnelPipeline({ stages, width = 560, height = 320 }: FunnelProps) {
  const palette = useChartPalette();
  // Bigger stages render first (top); Recharts FunnelChart doesn't
  // auto-sort, so we ensure descending order.
  const data = stages
    .map((s, i) => ({ ...s, fill: palette.series[i % palette.series.length] ?? palette.text }))
    .sort((a, b) => b.value - a.value);

  return (
    <FunnelChart width={width} height={height}>
      <Tooltip />
      <Funnel
        dataKey="value"
        data={data}
        isAnimationActive={false}
        stroke={palette.grid}
      >
        <LabelList
          position="right"
          fill={palette.text}
          stroke="none"
          dataKey="label"
        />
        <LabelList
          position="insideRight"
          fill={palette.text}
          stroke="none"
          dataKey="value"
          formatter={(v: number) => v.toLocaleString('en-US')}
        />
      </Funnel>
    </FunnelChart>
  );
}
