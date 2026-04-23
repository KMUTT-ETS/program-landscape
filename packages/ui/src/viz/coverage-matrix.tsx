'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// Coverage matrix: rows = programs (KKU + peers), cols = skills,
// cells coloured by weight (0–1). Used on /benchmarking/programs/[id]
// to compare curriculum coverage side-by-side.
//
// Inline SVG so PDF export (Gotenberg) renders crisp. Theme-aware via
// useChartPalette — re-renders when data-theme flips.

export interface CoverageRow {
  id: string;
  label: string;
  sublabel?: string;
  highlight?: boolean;      // KKU's row gets highlighted border
  weights: Record<string, number>; // skillId → weight (0–1)
}

export interface CoverageSkill {
  id: string;
  label: string;
}

export interface CoverageMatrixProps {
  rows: CoverageRow[];
  skills: CoverageSkill[];
  width?: number;
  rowHeight?: number;
  labelCol?: number;
  className?: string;
}

export function CoverageMatrix({
  rows,
  skills,
  width = 900,
  rowHeight = 30,
  labelCol = 220,
  className,
}: CoverageMatrixProps) {
  const palette = useChartPalette();

  if (rows.length === 0 || skills.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-text-tertiary">
        No programs or skills to compare.
      </div>
    );
  }

  const cellWidth = Math.max(14, Math.min(42, Math.floor((width - labelCol - 16) / skills.length)));
  const headerHeight = 80;
  const totalWidth = labelCol + skills.length * cellWidth + 16;
  const totalHeight = headerHeight + rows.length * rowHeight + 10;

  return (
    <div className={cn('overflow-x-auto', className)}>
      <svg width={totalWidth} height={totalHeight} role="img" aria-label="Curriculum skill coverage matrix">
        {/* Column headers — rotated */}
        {skills.map((s, colIdx) => {
          const x = labelCol + colIdx * cellWidth + cellWidth / 2;
          return (
            <g key={s.id}>
              <text
                x={x}
                y={headerHeight - 4}
                fontSize={10}
                fill={palette.text}
                transform={`rotate(-52 ${x} ${headerHeight - 4})`}
                textAnchor="start"
              >
                {truncate(s.label, 16)}
              </text>
            </g>
          );
        })}

        {/* Rows */}
        {rows.map((r, rowIdx) => {
          const y = headerHeight + rowIdx * rowHeight;
          const labelY = y + rowHeight / 2 + 4;
          return (
            <g key={r.id}>
              {/* Row label */}
              <text
                x={labelCol - 10}
                y={labelY}
                fontSize={12}
                fill={palette.text}
                textAnchor="end"
                fontWeight={r.highlight ? 600 : 400}
              >
                {truncate(r.label, 26)}
              </text>
              {r.sublabel ? (
                <text
                  x={labelCol - 10}
                  y={labelY + 12}
                  fontSize={10}
                  fill={palette.axis}
                  textAnchor="end"
                >
                  {truncate(r.sublabel, 28)}
                </text>
              ) : null}

              {/* Highlight KKU row with a background */}
              {r.highlight ? (
                <rect
                  x={labelCol}
                  y={y + 2}
                  width={skills.length * cellWidth}
                  height={rowHeight - 4}
                  fill={palette.series[0] ?? palette.positive}
                  fillOpacity={0.05}
                  stroke={palette.series[0] ?? palette.positive}
                  strokeOpacity={0.3}
                  strokeWidth={1}
                  rx={2}
                />
              ) : null}

              {/* Cells */}
              {skills.map((s, colIdx) => {
                const w = r.weights[s.id] ?? 0;
                const x = labelCol + colIdx * cellWidth;
                return (
                  <rect
                    key={s.id}
                    x={x + 2}
                    y={y + 4}
                    width={cellWidth - 4}
                    height={rowHeight - 8}
                    fill={palette.series[r.highlight ? 0 : 1] ?? palette.neutral}
                    fillOpacity={w === 0 ? 0 : 0.15 + w * 0.7}
                    stroke={w > 0 ? palette.grid : 'transparent'}
                    strokeWidth={0.5}
                    rx={2}
                  >
                    <title>
                      {r.label} × {s.label}: {w === 0 ? 'not taught' : w.toFixed(2)}
                    </title>
                  </rect>
                );
              })}
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
