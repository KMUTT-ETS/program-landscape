'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

// Heatmap for the Portfolio Overview Cockpit (prompt 05). Rows are scope
// children (faculties / departments / programs depending on current
// scope), columns are health dimensions (0-100 scored). Cells are
// colour-tinted by score with explicit "low data" treatment.
//
// Design intent:
//   - Rows render as clickable buttons so drill-in is obvious.
//   - Cells with null scores show "—" + tertiary text so the reader
//     isn't fooled into thinking 0 means "zero quality" instead of
//     "we don't know".
//   - Data-completeness < 50% on the row gets a subtle warning icon
//     (surface-2 background tint) to push the reader at methodology
//     rather than the number.
//   - Hover on a cell reveals the drivers (the 3 sub-metrics that
//     combined to produce this score) via a Radix Tooltip.

export interface HeatmapCell {
  // 0-100 or null when every underlying metric was null.
  score: number | null;
  // 0-100
  dataCompletenessPct: number;
  drivers?: Array<{ label: string; value: number | null }>;
}

export interface HeatmapRow {
  id: string;
  label: string;
  // Required — caller picks e.g. [demand, financial, quality, relevance, capability].
  cells: HeatmapCell[];
  overall: HeatmapCell;
  // Optional parentId for nested expansion (faculty → department → program).
  // Not used for auto-nesting yet (we render flat rows); reserved for
  // the tree-expand feature that lands in a follow-up prompt.
  parentId?: string | null;
}

export interface HeatmapProps {
  rows: HeatmapRow[];
  columnLabels: string[];           // exactly matches row.cells length
  onRowClick?: (row: HeatmapRow) => void;
  className?: string;
  // Label for the right-most column (default "Overall"). Kept
  // separate from columnLabels because the overall cell is a
  // different semantic weight — bold, right-aligned.
  overallLabel?: string;
}

export function Heatmap({
  rows,
  columnLabels,
  onRowClick,
  className,
  overallLabel = 'Overall',
}: HeatmapProps) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border-default bg-surface-1', className)}>
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-text-secondary">
          <tr>
            <th className="sticky left-0 bg-surface-2 px-3 py-2 text-left">Unit</th>
            {columnLabels.map((lbl) => (
              <th key={lbl} className="px-3 py-2 text-center">
                {lbl}
              </th>
            ))}
            <th className="px-3 py-2 text-right">{overallLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const lowData = row.overall.dataCompletenessPct < 50;
            return (
              <tr
                key={row.id}
                className={cn(
                  'border-t border-border-subtle transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-surface-2',
                  lowData && 'bg-surface-2/50',
                )}
                onClick={() => onRowClick?.(row)}
              >
                <td className="sticky left-0 bg-surface-1 px-3 py-2 font-medium">
                  {row.label}
                </td>
                {row.cells.map((cell, i) => (
                  <Cell key={i} cell={cell} />
                ))}
                <td className="px-3 py-2 text-right">
                  <OverallCell cell={row.overall} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ cell }: { cell: HeatmapCell }) {
  if (cell.score === null) {
    return (
      <td className="px-2 py-2 text-center text-text-tertiary" title="No data">
        —
      </td>
    );
  }
  const tone =
    cell.score < 40 ? 'danger' : cell.score < 65 ? 'warning' : 'success';
  const tint =
    tone === 'danger'
      ? 'bg-danger-subtle text-danger'
      : tone === 'warning'
        ? 'bg-warning-subtle text-warning'
        : 'bg-success-subtle text-success';
  const driversText = cell.drivers?.length
    ? cell.drivers
        .map((d) => `${d.label}: ${d.value === null ? '—' : Math.round(d.value)}`)
        .join('  ·  ')
    : '';
  const completenessNote =
    cell.dataCompletenessPct < 100
      ? `  (completeness ${Math.round(cell.dataCompletenessPct)}%)`
      : '';
  return (
    <td
      className={cn('px-2 py-2 text-center font-tabular text-sm font-medium', tint)}
      title={`${Math.round(cell.score)} · ${driversText}${completenessNote}`}
    >
      {Math.round(cell.score)}
    </td>
  );
}

function OverallCell({ cell }: { cell: HeatmapCell }) {
  if (cell.score === null) {
    return <span className="text-text-tertiary">—</span>;
  }
  const tone =
    cell.score < 40 ? 'text-danger' : cell.score < 65 ? 'text-warning' : 'text-success';
  return <span className={cn('font-tabular font-semibold', tone)}>{Math.round(cell.score)}</span>;
}
