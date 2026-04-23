'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// A minimal waterfall for the financial section: a sequence of stages
// where each contributes positive/negative to the running total. The
// final "total" bar starts at zero and shows the absolute landing
// position.
//
// Rendered as inline SVG because:
//   - Recharts' Bar+ComposedChart can do waterfalls but the state
//     management for the floating stacks is painful and per-bar
//     colouring via `fill` prop doesn't reliably read CSS vars.
//   - SVG keeps PDF export crisp (prompt 02c's PDF template can inline
//     this shape directly without a round-trip through Chromium's
//     Recharts).

export interface WaterfallStep {
  label: string;
  // Positive = positive contribution (revenue, etc.).
  // Negative = negative contribution (cost).
  // "total" marks a summary bar that starts from zero at the running
  // position, not from the previous bar's end.
  value: number;
  kind: 'positive' | 'negative' | 'total';
}

export interface WaterfallProps {
  steps: WaterfallStep[];
  width?: number;
  height?: number;
  className?: string;
  valueFormat?: (n: number) => string;
}

export function Waterfall({
  steps,
  width = 560,
  height = 260,
  className,
  valueFormat = (n) => n.toLocaleString('en-US'),
}: WaterfallProps) {
  const palette = useChartPalette();
  const M = { top: 24, right: 32, bottom: 40, left: 72 };
  const W = width - M.left - M.right;
  const H = height - M.top - M.bottom;

  // Compute running tallies + per-bar y-range.
  let running = 0;
  const bars = steps.map((s) => {
    if (s.kind === 'total') {
      const from = 0;
      const to = s.value;
      running = s.value;
      return { ...s, from, to };
    }
    const from = running;
    const to = running + s.value;
    running = to;
    return { ...s, from, to };
  });

  const allVals = bars.flatMap((b) => [b.from, b.to]);
  const yMin = Math.min(0, ...allVals);
  const yMax = Math.max(...allVals);
  const range = yMax - yMin || 1;
  const yScale = (v: number) => M.top + H - ((v - yMin) / range) * H;

  const barW = Math.max(20, (W / bars.length) * 0.7);
  const gap = (W - barW * bars.length) / (bars.length + 1);

  return (
    <div className={cn('overflow-hidden', className)}>
      <svg width={width} height={height} role="img" aria-label="Financial waterfall">
        {/* Axes */}
        <line
          x1={M.left}
          x2={M.left + W}
          y1={yScale(0)}
          y2={yScale(0)}
          stroke={palette.grid}
          strokeDasharray="3 3"
        />
        {/* Bars */}
        {bars.map((b, i) => {
          const x = M.left + gap + i * (barW + gap);
          const y = Math.min(yScale(b.from), yScale(b.to));
          const h = Math.abs(yScale(b.to) - yScale(b.from));
          const color =
            b.kind === 'positive'
              ? palette.positive
              : b.kind === 'negative'
                ? palette.negative
                : palette.neutral;
          return (
            <g key={b.label}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(1, h)}
                fill={color}
                fillOpacity={b.kind === 'total' ? 0.9 : 0.65}
                stroke={color}
                strokeOpacity={0.9}
                strokeWidth={1.2}
              />
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize={11}
                fill={palette.text}
              >
                {valueFormat(b.value)}
              </text>
              <text
                x={x + barW / 2}
                y={height - M.bottom + 16}
                textAnchor="middle"
                fontSize={11}
                fill={palette.axis}
              >
                {b.label}
              </text>
              {i < bars.length - 1 && b.kind !== 'total' && (
                <line
                  x1={x + barW}
                  y1={yScale(b.to)}
                  x2={x + barW + gap}
                  y2={yScale(b.to)}
                  stroke={palette.grid}
                  strokeDasharray="2 2"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
