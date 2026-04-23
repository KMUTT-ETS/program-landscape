'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// Two-column horizontal bar chart: demand (left, growing left) vs supply
// (right, growing right). Centre-origin layout so "gap = distance from
// zero in the dominant direction."
//
// Inline SVG (not Recharts) because:
//   - Recharts' BarChart can't do split-axis bars without kludgy
//     transform tricks.
//   - PDF export (Gotenberg) stays crisp — no ResponsiveContainer races.
//   - Theme-aware via useChartPalette; re-renders on data-theme flip.

export interface GapBarRow {
  id: string;
  label: string;
  sublabel?: string;
  demand: number;
  supply: number;
}

export interface GapBarsProps {
  rows: GapBarRow[];
  width?: number;
  // Row height including padding.
  rowHeight?: number;
  className?: string;
  valueFormat?: (n: number) => string;
  onRowClick?: (row: GapBarRow) => void;
}

export function GapBars({
  rows,
  width = 720,
  rowHeight = 32,
  className,
  valueFormat = (n) => (Math.round(n * 10) / 10).toString(),
  onRowClick,
}: GapBarsProps) {
  const palette = useChartPalette();

  if (rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-text-tertiary">
        No gap rows for this filter.
      </div>
    );
  }

  const max = Math.max(
    ...rows.map((r) => Math.max(r.demand, r.supply)),
    1,
  );

  const labelCol = 220; // left column for labels
  const centrePadding = 4; // gap around the zero axis
  const availableBarSpace = width - labelCol;
  const halfBarSpace = (availableBarSpace - centrePadding * 2) / 2;
  const centreX = labelCol + centrePadding + halfBarSpace;

  const height = rows.length * rowHeight + 40;

  return (
    <div className={cn('overflow-x-auto', className)}>
      <svg width={width} height={height} role="img" aria-label="Skill demand vs supply gap">
        {/* Headers */}
        <text x={labelCol + centrePadding + halfBarSpace / 2} y={14} textAnchor="middle" fontSize={11} fill={palette.text}>
          Demand (market)
        </text>
        <text x={centreX + centrePadding + halfBarSpace / 2} y={14} textAnchor="middle" fontSize={11} fill={palette.text}>
          Supply (KKU)
        </text>

        {/* Zero axis */}
        <line x1={centreX} y1={20} x2={centreX} y2={height - 8} stroke={palette.grid} strokeWidth={1} />

        {rows.map((r, i) => {
          const y = 28 + i * rowHeight;
          const demandWidth = (r.demand / max) * halfBarSpace;
          const supplyWidth = (r.supply / max) * halfBarSpace;
          const demandColor = palette.negative; // scarce supply → "at risk" colour
          const supplyColor = palette.series[1] ?? palette.positive;
          const centerLabelY = y + rowHeight / 2 + 4;

          return (
            <g
              key={r.id}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
            >
              {/* Hit area for full row */}
              <rect x={0} y={y} width={width} height={rowHeight} fill="transparent" />

              {/* Label */}
              <text
                x={labelCol - 12}
                y={centerLabelY}
                textAnchor="end"
                fontSize={12}
                fill={palette.text}
                className="font-medium"
              >
                {truncate(r.label, 28)}
              </text>
              {r.sublabel ? (
                <text x={labelCol - 12} y={centerLabelY + 12} textAnchor="end" fontSize={10} fill={palette.axis}>
                  {truncate(r.sublabel, 32)}
                </text>
              ) : null}

              {/* Demand bar (grows left from centre) */}
              <rect
                x={centreX - demandWidth}
                y={y + 6}
                width={demandWidth}
                height={rowHeight - 12}
                fill={demandColor}
                fillOpacity={0.85}
                rx={2}
              />
              <text x={centreX - demandWidth - 6} y={centerLabelY} textAnchor="end" fontSize={11} fill={palette.text}>
                {valueFormat(r.demand)}
              </text>

              {/* Supply bar (grows right from centre) */}
              <rect
                x={centreX + centrePadding}
                y={y + 6}
                width={supplyWidth}
                height={rowHeight - 12}
                fill={supplyColor}
                fillOpacity={0.85}
                rx={2}
              />
              <text x={centreX + centrePadding + supplyWidth + 6} y={centerLabelY} fontSize={11} fill={palette.text}>
                {valueFormat(r.supply)}
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
