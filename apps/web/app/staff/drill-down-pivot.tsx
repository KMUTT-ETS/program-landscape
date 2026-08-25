'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';

// Generic 3-level drill-down with multiple sortable metric columns.
// Used by the Staff dashboards: faculty-by-program, research producers,
// and compensation. Differs from Education's DrillDownPivot (which has
// one numeric dimension spread across columns) — here every column is
// a distinct metric (publications / citations / h-index / etc).

export interface DrillRowBadge {
  text: string;
  tone: 'success' | 'muted';
}

export interface DrillRow {
  label: string;
  emphasis?: 'warn' | 'success' | 'muted';
  /** Optional chip rendered after the label — e.g. a Talent marker. */
  badge?: DrillRowBadge;
  metrics: Record<string, number | null>;
  children?: DrillRow[];
}

export interface DrillColumn {
  key: string;
  label: string;
  format?: 'int' | 'decimal1' | 'decimal2' | 'thb' | 'raw';
  align?: 'left' | 'right';
}

export interface DrillDownPivotProps {
  rows: DrillRow[];
  columns: DrillColumn[];
  rowHeaderLabel?: string;
  maxDepth?: number;
}

type SortDir = 'asc' | 'desc';
interface SortState {
  key: string;
  dir: SortDir;
}

function fmt(value: number | null | undefined, format: DrillColumn['format'] = 'int'): string {
  if (value === null || value === undefined) return '—';
  if (format === 'decimal1') return value.toFixed(1);
  if (format === 'decimal2') return value.toFixed(2);
  if (format === 'thb') return '฿' + Math.round(value).toLocaleString('en-US');
  if (format === 'raw') return String(value);
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Numeric comparison that keeps missing values at the bottom in BOTH
 * directions.
 *
 * Returning a plain sign and letting the caller negate it for `desc`
 * flipped the nulls to the top — and the first click on any column is
 * `desc`, so on a null-dense table (a dash for every withheld or
 * untaken figure) the first click filled the screen with dashes. A
 * missing value is not the largest value; it is not a value. The
 * direction is applied here so it can only ever affect the rows that
 * have something to compare.
 */
function compareNullable(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDir,
): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  return dir === 'asc' ? a - b : b - a;
}

function sortRows(rows: DrillRow[], sort: SortState | null): DrillRow[] {
  if (!sort) return rows;
  const sorted = [...rows].sort((a, b) => {
    if (sort.key === '__label__') {
      const c = a.label.localeCompare(b.label, 'th');
      return sort.dir === 'asc' ? c : -c;
    }
    const av = a.metrics[sort.key] ?? null;
    const bv = b.metrics[sort.key] ?? null;
    return compareNullable(av, bv, sort.dir);
  });
  return sorted.map((r) => (r.children ? { ...r, children: sortRows(r.children, sort) } : r));
}

function emphasisClass(e: DrillRow['emphasis']): string {
  if (e === 'warn') return 'bg-warning-subtle/40';
  if (e === 'success') return 'bg-success-subtle/30';
  if (e === 'muted') return 'opacity-70';
  return '';
}

export function DrillDownPivot({
  rows,
  columns,
  rowHeaderLabel = 'Row',
  maxDepth = 3,
}: DrillDownPivotProps) {
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const sortedRows = React.useMemo(() => sortRows(rows, sort), [rows, sort]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clickSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-surface-1">
          <tr className="border-b border-border-subtle text-left text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            <th
              className="px-2 py-1.5 font-medium cursor-pointer select-none hover:text-text-primary"
              onClick={() => clickSort('__label__')}
            >
              {rowHeaderLabel}
              {sort?.key === '__label__' && (sort.dir === 'desc' ? ' ↓' : ' ↑')}
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                className="px-2 py-1.5 text-right font-medium cursor-pointer select-none hover:text-text-primary"
                onClick={() => clickSort(c.key)}
              >
                {c.label}
                {sort?.key === c.key && (sort.dir === 'desc' ? ' ↓' : ' ↑')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <PivotRow
              key={`${i}-${row.label}`}
              row={row}
              columns={columns}
              depth={0}
              path={`${i}-${row.label}`}
              expanded={expanded}
              toggle={toggle}
              maxDepth={maxDepth}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PivotRow({
  row,
  columns,
  depth,
  path,
  expanded,
  toggle,
  maxDepth,
}: {
  row: DrillRow;
  columns: DrillColumn[];
  depth: number;
  path: string;
  expanded: Set<string>;
  toggle: (key: string) => void;
  maxDepth: number;
}) {
  const hasChildren = row.children && row.children.length > 0 && depth + 1 < maxDepth;
  const isOpen = expanded.has(path);
  const padPx = depth === 0 ? 0 : depth === 1 ? 24 : 56;

  return (
    <>
      <tr
        className={`border-b border-border-subtle ${emphasisClass(row.emphasis)} ${
          depth === 0 ? 'font-semibold' : ''
        }`}
      >
        <td className="px-2 py-1" style={{ paddingLeft: 8 + padPx }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(path)}
              className="inline-flex items-center gap-1 hover:text-accent"
            >
              <ChevronRight
                className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
              <span className="truncate" title={row.label}>
                {row.label}
              </span>
            </button>
          ) : (
            <span className="ml-4 truncate" title={row.label}>
              {row.label}
            </span>
          )}
          {row.badge && (
            <span
              className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[0.6rem] font-medium ${
                row.badge.tone === 'success'
                  ? 'bg-success-subtle text-success'
                  : 'bg-surface-2 text-text-tertiary'
              }`}
            >
              {row.badge.text}
            </span>
          )}
        </td>
        {columns.map((c) => (
          <td
            key={c.key}
            className={`px-2 py-1 font-tabular ${c.align === 'left' ? '' : 'text-right'}`}
          >
            {fmt(row.metrics[c.key], c.format)}
          </td>
        ))}
      </tr>
      {isOpen &&
        hasChildren &&
        row.children!.map((child, i) => (
          <PivotRow
            key={`${path}-${i}`}
            row={child}
            columns={columns}
            depth={depth + 1}
            path={`${path}-${i}-${child.label}`}
            expanded={expanded}
            toggle={toggle}
            maxDepth={maxDepth}
          />
        ))}
    </>
  );
}
