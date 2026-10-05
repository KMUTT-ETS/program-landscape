import * as React from 'react';
import { cn } from '../lib/cn';

// Rows × columns of shaded cells. Two modes:
//   score — 0-100, banded like the health heatmap (< 40 / 40-65 / ≥ 65);
//   count — non-negative counts, shaded by size relative to the largest cell.
// A null cell is never 0: "—" / "No data" in score mode, "·" / "Not mapped"
// in count mode. A row with `detail` becomes a <details> row, so the detail
// opens without JavaScript and from the keyboard.

export interface ScoreGridRow {
  id: string;
  label: string;
  sublabel?: string;
  cells: Array<number | null>;
  /** Right-hand summary, e.g. a mean. */
  trailing?: string;
  detail?: React.ReactNode;
}

export interface ScoreGridProps {
  columns: string[];
  rows: ScoreGridRow[];
  mode: 'score' | 'count';
  trailingLabel?: string;
  emptyLabel?: string;
  className?: string;
}

function scoreClass(v: number): string {
  if (v < 40) return 'bg-danger-subtle text-danger';
  if (v < 65) return 'bg-warning-subtle text-warning';
  return 'bg-success-subtle text-success';
}

export function ScoreGrid({ columns, rows, mode, trailingLabel, emptyLabel = 'No data to show.', className }: ScoreGridProps) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">{emptyLabel}</p>;
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.filter((c): c is number => c !== null)));
  const template = `minmax(180px, 1.6fr) repeat(${columns.length}, minmax(64px, 1fr))${trailingLabel ? ' minmax(64px, auto)' : ''}`;

  const cell = (v: number | null, i: number) => {
    if (v === null) {
      return mode === 'score' ? (
        <span key={i} title="No data" className="py-1 text-center text-text-tertiary">—</span>
      ) : (
        <span key={i} title="Not mapped" className="py-1 text-center text-text-tertiary">·</span>
      );
    }
    if (mode === 'score') {
      return (
        <span key={i} className={cn('rounded-sm py-1 text-center font-tabular', scoreClass(v))}>
          {v.toFixed(0)}
        </span>
      );
    }
    const alpha = (0.12 + 0.6 * (v / max)).toFixed(2);
    return (
      <span
        key={i}
        className="rounded-sm py-1 text-center font-tabular text-text-primary"
        style={{ backgroundColor: `oklch(var(--color-data-positive) / ${alpha})` }}
      >
        {v}
      </span>
    );
  };

  const line = (r: ScoreGridRow) => (
    <div className="grid items-center gap-1 px-2 py-1 text-xs" style={{ gridTemplateColumns: template }}>
      <span className="min-w-0">
        <span className="block truncate text-text-primary">{r.label}</span>
        {r.sublabel && <span className="block truncate text-[10px] text-text-tertiary">{r.sublabel}</span>}
      </span>
      {r.cells.map(cell)}
      {trailingLabel && <span className="text-right font-tabular text-text-secondary">{r.trailing ?? '—'}</span>}
    </div>
  );

  return (
    <div className={cn('flex flex-col overflow-x-auto rounded-lg border border-default', className)}>
      <div
        className="grid gap-1 border-b border-subtle bg-surface-2 px-2 py-2 text-[10px] uppercase tracking-wide text-text-tertiary"
        style={{ gridTemplateColumns: template }}
      >
        <span />
        {columns.map((c) => (
          <span key={c} className="text-center">{c}</span>
        ))}
        {trailingLabel && <span className="text-right">{trailingLabel}</span>}
      </div>
      {rows.map((r) =>
        r.detail ? (
          <details key={r.id} className="border-b border-subtle last:border-b-0">
            <summary className="cursor-pointer list-none hover:bg-surface-2">{line(r)}</summary>
            <div className="px-4 py-2">{r.detail}</div>
          </details>
        ) : (
          <div key={r.id} className="border-b border-subtle last:border-b-0">{line(r)}</div>
        ),
      )}
    </div>
  );
}
