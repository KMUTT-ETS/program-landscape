'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { HoverTooltip } from '../primitives/tooltip';

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
  // Optional Thai-primary / English-secondary labels — when both are
  // present the Unit cell renders two lines (Thai top, EN small grey
  // below). Falls back to `label` if not provided. Used by the cockpit
  // rollup so faculty/department/program rows show both names without
  // the "EN · TH" concatenation in a single line.
  labelTh?: string;
  labelEn?: string;
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
                <td className="sticky left-0 bg-surface-1 px-3 py-2">
                  {row.labelTh && row.labelEn ? (
                    <div className="flex flex-col leading-tight">
                      <span className="font-medium" lang="th">{row.labelTh}</span>
                      <span className="text-[11px] text-text-tertiary">{row.labelEn}</span>
                    </div>
                  ) : (
                    <span className="font-medium">{row.label}</span>
                  )}
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
      <td className="px-2 py-2 text-center text-text-tertiary">
        <HoverTooltip content="No data">
          <span className="inline-block">—</span>
        </HoverTooltip>
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
  const tooltipBody = (
    <div className="flex flex-col gap-1.5 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
          Score
        </span>
        <span className="font-tabular text-sm font-semibold">
          {Math.round(cell.score)}
        </span>
      </div>
      {cell.drivers && cell.drivers.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-border-subtle pt-1.5">
          {cell.drivers.map((d) => (
            <div
              key={d.label}
              className="flex items-baseline justify-between gap-3 text-[11px]"
            >
              <span className="text-text-secondary">{d.label}</span>
              <span className="font-tabular text-text-primary">
                {d.value === null ? '—' : Math.round(d.value)}
              </span>
            </div>
          ))}
        </div>
      )}
      {cell.dataCompletenessPct < 100 && (
        <div className="border-t border-border-subtle pt-1 text-[10px] text-text-tertiary">
          Completeness {Math.round(cell.dataCompletenessPct)}%
        </div>
      )}
    </div>
  );
  return (
    <td
      className={cn('px-2 py-2 text-center font-tabular text-sm font-medium', tint)}
    >
      <HoverTooltip content={tooltipBody} className="min-w-[180px] p-3">
        <span className="inline-block">{Math.round(cell.score)}</span>
      </HoverTooltip>
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
