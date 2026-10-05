import * as React from 'react';
import { cn } from '../lib/cn';

// Rows × columns of shaded cells. Two modes:
//   score — 0-100, banded like the health heatmap (< 40 / 40-65 / ≥ 65);
//   count — non-negative counts, shaded by size relative to the largest cell.
// A null cell is never 0: "—" / "No data" in score mode, "·" / "Not mapped"
// in count mode. A row with `detail` or `children` becomes a <details> row, so
// it opens without JavaScript and from the keyboard; children nest as further
// <details>, indented by depth. `total` is pinned after every row, bold, and
// never expands.

export interface ScoreGridRow {
  id: string;
  label: string;
  sublabel?: string;
  cells: Array<number | null>;
  /** Right-hand summary, e.g. a mean. */
  trailing?: string;
  detail?: React.ReactNode;
  /** Nested rows shown when this row is opened (drill-down). */
  children?: ScoreGridRow[];
  /** Makes the label a link. */
  href?: string;
}

export interface ScoreGridProps {
  columns: string[];
  rows: ScoreGridRow[];
  mode: 'score' | 'count';
  trailingLabel?: string;
  /** Summary row pinned after all rows; bold, never expandable. */
  total?: ScoreGridRow;
  emptyLabel?: string;
  className?: string;
}

function scoreClass(v: number): string {
  if (v < 40) return 'bg-danger-subtle text-danger';
  if (v < 65) return 'bg-warning-subtle text-warning';
  return 'bg-success-subtle text-success';
}

export function ScoreGrid({ columns, rows, mode, trailingLabel, total, emptyLabel = 'No data to show.', className }: ScoreGridProps) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">{emptyLabel}</p>;
  const flat = (rs: ScoreGridRow[]): ScoreGridRow[] => rs.flatMap((r) => [r, ...flat(r.children ?? [])]);
  const max = Math.max(1, ...flat(rows).flatMap((r) => r.cells.filter((c): c is number => c !== null && Number.isFinite(c))));
  const template = `minmax(180px, 1.6fr) repeat(${columns.length}, minmax(64px, 1fr))${trailingLabel ? ' minmax(64px, auto)' : ''}`;

  const cell = (v: number | null, i: number) => {
    if (v === null || !Number.isFinite(v)) {
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
    const alpha = Math.max(0.12, 0.12 + 0.6 * (v / max)).toFixed(2);
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

  const INDENT_PX = 16;
  const line = (r: ScoreGridRow, expandable: boolean, depth: number, bold = false) => (
    <div
      className={cn('grid items-center gap-1 px-2 py-1 text-xs', bold && 'font-semibold')}
      style={{ gridTemplateColumns: template }}
    >
      <span className="min-w-0" style={{ paddingLeft: `${depth * INDENT_PX}px` }}>
        <span className="block truncate text-text-primary">
          {expandable && (
            // Scoped to this row's own <summary>, so an open parent does not
            // rotate the chevrons of its closed children.
            <span aria-hidden className="mr-1 inline-block transition-transform [[open]>summary_&]:rotate-90">▸</span>
          )}
          {r.href ? (
            <a href={r.href} className="text-text-primary underline-offset-2 hover:underline focus-visible:underline">
              {r.label}
            </a>
          ) : (
            r.label
          )}
        </span>
        {r.sublabel && <span className="block truncate text-[10px] text-text-tertiary">{r.sublabel}</span>}
      </span>
      {r.cells.map(cell)}
      {trailingLabel && <span className="text-right font-tabular text-text-secondary">{r.trailing ?? '—'}</span>}
    </div>
  );

  const renderRow = (r: ScoreGridRow, depth: number): React.ReactNode => {
    const kids = r.children ?? [];
    if (!r.detail && kids.length === 0) {
      return (
        <div key={r.id} className={cn(depth === 0 ? 'border-b border-subtle last:border-b-0' : 'border-t border-subtle')}>
          {line(r, false, depth)}
        </div>
      );
    }
    return (
      <details key={r.id} className={cn(depth === 0 ? 'border-b border-subtle last:border-b-0' : 'border-t border-subtle')}>
        <summary className="cursor-pointer list-none hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-default/40">
          {line(r, true, depth)}
        </summary>
        {r.detail && <div className="px-4 py-2">{r.detail}</div>}
        {kids.map((k) => renderRow(k, depth + 1))}
      </details>
    );
  };

  return (
    <div className={cn('flex flex-col overflow-x-auto rounded-lg border border-default', className)}>
      <div
        className="sticky top-0 z-10 grid gap-1 border-b border-subtle bg-surface-2 px-2 py-2 text-[10px] uppercase tracking-wide text-text-tertiary"
        style={{ gridTemplateColumns: template }}
      >
        <span />
        {columns.map((c) => (
          <span key={c} className="text-center">{c}</span>
        ))}
        {trailingLabel && <span className="text-right">{trailingLabel}</span>}
      </div>
      {rows.map((r) => renderRow(r, 0))}
      {/* The total sticks to the bottom when the grid itself is the scroll box. */}
      {total && (
        <div data-total="true" className="sticky bottom-0 z-10 border-t border-strong bg-surface-2">
          {line({ ...total, children: undefined, detail: undefined }, false, 0, true)}
        </div>
      )}
    </div>
  );
}
