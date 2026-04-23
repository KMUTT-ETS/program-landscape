'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// Tornado chart for sensitivity analysis.
//
// Each row shows one assumption with two bars:
//   - left bar (red)  = outcome delta when the assumption is bumped DOWN
//   - right bar (blue) = outcome delta when the assumption is bumped UP
//
// Rows should arrive pre-sorted by absolute impact — the most-sensitive
// at the top, canonical tornado layout.

export interface TornadoRow {
  assumptionKey: string;
  label?: string;
  lowOutcomeDelta: number;
  highOutcomeDelta: number;
}

export interface TornadoProps {
  rows: TornadoRow[];
  width?: number;
  rowHeight?: number;
  className?: string;
  valueFormat?: (n: number) => string;
}

export function Tornado({
  rows,
  width = 640,
  rowHeight = 28,
  className,
  valueFormat = (n) => Math.round(n).toLocaleString('en-US'),
}: TornadoProps) {
  const palette = useChartPalette();

  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-text-tertiary">
        No sensitivity data — run the scenario first.
      </div>
    );
  }

  const max = Math.max(
    ...rows.map((r) => Math.max(Math.abs(r.lowOutcomeDelta), Math.abs(r.highOutcomeDelta))),
    1,
  );

  const labelCol = 180;
  const centrePadding = 6;
  const availableBarSpace = width - labelCol;
  const halfBarSpace = (availableBarSpace - centrePadding * 2) / 2;
  const centreX = labelCol + centrePadding + halfBarSpace;

  const height = rows.length * rowHeight + 34;

  return (
    <div className={cn('overflow-x-auto', className)}>
      <svg width={width} height={height} role="img" aria-label="Sensitivity tornado">
        <text x={labelCol + halfBarSpace / 2} y={14} textAnchor="middle" fontSize={11} fill={palette.text}>
          Outcome ↓ if assumption ↓
        </text>
        <text x={centreX + halfBarSpace / 2} y={14} textAnchor="middle" fontSize={11} fill={palette.text}>
          Outcome ↑ if assumption ↑
        </text>

        <line x1={centreX} y1={22} x2={centreX} y2={height - 8} stroke={palette.grid} strokeWidth={1} />

        {rows.map((r, i) => {
          const y = 30 + i * rowHeight;
          const lowWidth = (Math.abs(r.lowOutcomeDelta) / max) * halfBarSpace;
          const highWidth = (Math.abs(r.highOutcomeDelta) / max) * halfBarSpace;
          // The left side shows "bump assumption down" impact. Use red if that
          // makes outcome worse (negative), blue if it improves outcome.
          const lowColor = r.lowOutcomeDelta < 0 ? palette.negative : palette.series[0] ?? palette.positive;
          const highColor = r.highOutcomeDelta < 0 ? palette.negative : palette.series[0] ?? palette.positive;
          const centreLabelY = y + rowHeight / 2 + 4;

          return (
            <g key={r.assumptionKey}>
              <text
                x={labelCol - 10}
                y={centreLabelY}
                textAnchor="end"
                fontSize={12}
                fill={palette.text}
                className="font-medium"
              >
                {truncate(r.label ?? r.assumptionKey, 26)}
              </text>

              {/* Low bar (bump-down) */}
              <rect
                x={centreX - lowWidth}
                y={y + 4}
                width={lowWidth}
                height={rowHeight - 10}
                fill={lowColor}
                fillOpacity={0.8}
                rx={2}
              />
              <text x={centreX - lowWidth - 4} y={centreLabelY} textAnchor="end" fontSize={10} fill={palette.text}>
                {valueFormat(r.lowOutcomeDelta)}
              </text>

              {/* High bar (bump-up) */}
              <rect
                x={centreX + centrePadding}
                y={y + 4}
                width={highWidth}
                height={rowHeight - 10}
                fill={highColor}
                fillOpacity={0.8}
                rx={2}
              />
              <text x={centreX + centrePadding + highWidth + 4} y={centreLabelY} fontSize={10} fill={palette.text}>
                {valueFormat(r.highOutcomeDelta)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
