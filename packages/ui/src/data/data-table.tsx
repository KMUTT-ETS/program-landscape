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
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from '../primitives/button';
import { HoverTooltip } from '../primitives/tooltip';
import { humanizeNumber } from '../lib/humanize';

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
  /** When `onRowClick` is set, append a right-aligned chevron column that
   *  visually signals "click to drill in". Mirrors the chevron column on
   *  /education/active-pivot. Defaults to true when `onRowClick` is
   *  provided. Set false to opt out (e.g. when the row itself carries an
   *  inline action that the chevron would conflict with). */
  drillIndicator?: boolean;
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
  drillIndicator,
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
  const showDrillCol = drillIndicator ?? Boolean(onRowClick);
  const colSpanWithDrill = table.getAllColumns().length + (showDrillCol ? 1 : 0);

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
                  const sortDir = header.column.getIsSorted();
                  const sortIcon =
                    sortDir === 'asc' ? (
                      <ArrowUp className="size-icon-xs text-accent-default" aria-hidden />
                    ) : sortDir === 'desc' ? (
                      <ArrowDown className="size-icon-xs text-accent-default" aria-hidden />
                    ) : (
                      <ArrowUpDown className="size-icon-xs opacity-60" aria-hidden />
                    );
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
                          className={cn(
                            'inline-flex items-center gap-1 hover:text-text-primary',
                            align === 'right' && 'flex-row-reverse',
                            sortDir && 'text-text-primary',
                          )}
                          aria-label={
                            sortDir === 'asc'
                              ? 'Sorted ascending'
                              : sortDir === 'desc'
                                ? 'Sorted descending'
                                : 'Click to sort'
                          }
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortIcon}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
                {showDrillCol && (
                  <th
                    aria-label="Open detail"
                    className="w-8 px-1 py-[var(--density-cell-py)]"
                  />
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpanWithDrill}
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
                    'group border-b border-border-subtle last:border-b-0 h-[var(--density-row-h)]',
                    onRowClick && 'cursor-pointer hover:bg-surface-2',
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as
                      | {
                          numeric?: boolean;
                          align?: 'left' | 'right' | 'center';
                          /** When the rendered cell is compact (3.2M), pass
                           *  the raw value so a hover tooltip can show the
                           *  exact humanized number. */
                          rawValue?: (row: T) => number | null | undefined;
                          /** Override the tooltip body for the cell. When
                           *  set, this wins over `rawValue`. */
                          tooltip?: (row: T) => React.ReactNode;
                        }
                      | undefined;
                    const align =
                      meta?.align ?? (meta?.numeric ? 'right' : 'left');
                    const rendered = flexRender(cell.column.columnDef.cell, cell.getContext());
                    const tooltipBody = meta?.tooltip
                      ? meta.tooltip(row.original)
                      : meta?.rawValue
                        ? humanizeNumber(meta.rawValue(row.original))
                        : null;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-[var(--density-cell-px)] py-[var(--density-cell-py)] align-middle text-text-primary',
                          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
                          meta?.numeric && 'font-tabular',
                        )}
                      >
                        {tooltipBody !== null && tooltipBody !== undefined ? (
                          <HoverTooltip content={tooltipBody}>
                            <span className="inline-block">{rendered}</span>
                          </HoverTooltip>
                        ) : (
                          rendered
                        )}
                      </td>
                    );
                  })}
                  {showDrillCol && (
                    <td className="w-8 px-1 align-middle">
                      <ChevronRight
                        className="size-icon-md text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </td>
                  )}
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
          <ChevronLeft className="size-icon-md" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="Next page"
        >
          <ChevronRight className="size-icon-md" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// Re-export ColumnDef so callers don't need a direct dependency.
export type { ColumnDef } from '@tanstack/react-table';
