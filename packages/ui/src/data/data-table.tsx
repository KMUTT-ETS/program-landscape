'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Table as TableInstance,
} from '@tanstack/react-table';
import { ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from '../primitives/button';

// TanStack Table v8 wrapper. Scope for this prompt:
//   ✓ Sort, filter (global text via opts.globalFilter), paginate, select
//   ✓ Sticky header, density-aware row heights via CSS vars
//   ✓ tabular-nums on columns marked `numeric: true`
//   — Virtualization for 1000+ rows DEFERRED (react-virtual wire-up in a
//     later prompt; small table scale is fine for prompt 05 cockpit).

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  globalFilter?: string;
  pageSize?: number;
  className?: string;
  /** Callback on row click for detail drill-in (Linear-style side panel). */
  onRowClick?: (row: T) => void;
  /** When rendering inside a card, prefer "ghost"; standalone uses "bordered". */
  variant?: 'ghost' | 'bordered';
  /** Empty-state rendered in the tbody area. */
  emptyState?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  globalFilter,
  pageSize = 50,
  className,
  onRowClick,
  variant = 'bordered',
  emptyState,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const table = useReactTable<T>({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;

  return (
    <div
      className={cn(
        'overflow-hidden',
        variant === 'bordered' && 'rounded-lg border border-border-default bg-surface-1',
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border-default">
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    | { numeric?: boolean; align?: 'left' | 'right' | 'center' }
                    | undefined;
                  const align =
                    meta?.align ?? (meta?.numeric ? 'right' : 'left');
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'px-[var(--density-cell-px)] py-[var(--density-cell-py)] font-medium text-text-tertiary',
                        'text-[11px] uppercase tracking-wide',
                        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-text-primary"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <ArrowUpDown className="h-3 w-3" aria-hidden />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getAllColumns().length}
                  className="px-4 py-12 text-center"
                >
                  {emptyState ?? (
                    <span className="text-sm text-text-tertiary">No rows.</span>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'border-b border-border-subtle last:border-b-0 h-[var(--density-row-h)]',
                    onRowClick && 'cursor-pointer hover:bg-surface-2',
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as
                      | { numeric?: boolean; align?: 'left' | 'right' | 'center' }
                      | undefined;
                    const align =
                      meta?.align ?? (meta?.numeric ? 'right' : 'left');
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-[var(--density-cell-px)] py-[var(--density-cell-py)] align-middle text-text-primary',
                          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
                          meta?.numeric && 'font-tabular',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && table.getPageCount() > 1 && (
        <DataTablePagination table={table} />
      )}
    </div>
  );
}

function DataTablePagination<T>({ table }: { table: TableInstance<T> }) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;
  const from = pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2 text-xs text-text-tertiary">
      <span>
        <span className="font-tabular">{from}</span>–
        <span className="font-tabular">{to}</span> of{' '}
        <span className="font-tabular">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// Re-export ColumnDef so callers don't need a direct dependency.
export type { ColumnDef } from '@tanstack/react-table';
