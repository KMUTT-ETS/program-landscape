'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '../lib/cn';

// Lightweight click-to-sort for hand-rolled <table>s — the dashboard
// tables that don't use <DataTable> because they carry custom cells
// (inline bars, badges, conditional colour, verdict chips).
//
// `useSortableTable` sorts the row array client-side; <SortableTh> is a
// drop-in <th> that renders the sort affordance. Before any header
// click the rows stay in their caller-provided (natural) order.

export type SortValue = string | number | null | undefined;
export type SortDir = 'asc' | 'desc';

export interface TableSort {
  /** Active sort column key, or null when the table is in its natural
   *  (caller-provided) order. */
  key: string | null;
  dir: SortDir;
  /** First click on a column sorts ascending; clicking the active
   *  column again flips direction. */
  toggle: (key: string) => void;
}

/**
 * Client-side sortable-table state. Pass the row array and a map of
 * column key → value accessor. Returns the sorted rows plus a `sort`
 * object to wire into <SortableTh>. null/undefined/'' values always
 * sink to the bottom regardless of direction.
 */
export function useSortableTable<T>(
  rows: T[],
  accessors: Record<string, (row: T) => SortValue>,
): { sorted: T[]; sort: TableSort } {
  const [key, setKey] = React.useState<string | null>(null);
  const [dir, setDir] = React.useState<SortDir>('asc');

  const toggle = React.useCallback((nextKey: string) => {
    setKey((prev) => {
      if (prev === nextKey) {
        setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setDir('asc');
      return nextKey;
    });
  }, []);

  const sorted = React.useMemo(() => {
    if (!key) return rows;
    const accessor = accessors[key];
    if (!accessor) return rows;
    const factor = dir === 'asc' ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const va = accessor(a.row);
        const vb = accessor(b.row);
        const aEmpty = va === null || va === undefined || va === '';
        const bEmpty = vb === null || vb === undefined || vb === '';
        if (aEmpty && bEmpty) return a.i - b.i;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        let cmp: number;
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        }
        // Stable: fall back to original index on ties.
        return cmp !== 0 ? cmp * factor : a.i - b.i;
      })
      .map((x) => x.row);
  }, [rows, key, dir, accessors]);

  return { sorted, sort: { key, dir, toggle } };
}

export interface SortableThProps
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Column key — must match a key in the useSortableTable accessors. */
  sortKey: string;
  sort: TableSort;
  /** Icon placement. Right-aligned (numeric) columns put the icon to
   *  the left of the label so it hugs the column edge. Default 'left'. */
  align?: 'left' | 'right' | 'center';
}

/**
 * Drop-in replacement for a <th> in a hand-rolled table. Pass the same
 * className the original <th> used so the table styling is unchanged.
 */
export function SortableTh({
  sortKey,
  sort,
  align = 'left',
  className,
  children,
  ...rest
}: SortableThProps) {
  const active = sort.key === sortKey;
  const icon = !active ? (
    <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
  ) : sort.dir === 'asc' ? (
    <ArrowUp className="h-3 w-3 text-accent-default" aria-hidden />
  ) : (
    <ArrowDown className="h-3 w-3 text-accent-default" aria-hidden />
  );
  return (
    <th className={className} {...rest}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-text-primary',
          align === 'right' && 'flex-row-reverse',
          align === 'center' && 'justify-center',
          active && 'text-text-primary',
        )}
        aria-label={
          active
            ? sort.dir === 'asc'
              ? 'Sorted ascending — click to reverse'
              : 'Sorted descending — click to reverse'
            : 'Click to sort'
        }
      >
        {children}
        {icon}
      </button>
    </th>
  );
}
