'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';

// Reusable multi-level drill-down pivot table. Three of the Education
// dashboards share this shape (active-pivot, international, tuition):
// columns are a single dimension (entry year / program level / academic
// year); rows nest Faculty → Program Level → Program. Any of the three
// row tiers can be made a leaf by passing it as `leafLevel`.
//
// Cells render via a caller-supplied formatter so currency, integer,
// and percentage views all use the same component.

export type PivotColumnKey = string | number;

export interface PivotLeafRow {
  programName: string;
  cells: Record<PivotColumnKey, number>;
  total: number;
}

export interface PivotMidRow {
  programLevel: string;
  children: PivotLeafRow[];
  cells: Record<PivotColumnKey, number>;
  total: number;
}

export interface PivotTopRow {
  facultyName: string;
  children: PivotMidRow[];
  cells: Record<PivotColumnKey, number>;
  total: number;
}

export interface DrillDownPivotProps {
  columns: PivotColumnKey[];
  columnLabel?: (c: PivotColumnKey) => string;
  rows: PivotTopRow[];
  totals: { cells: Record<PivotColumnKey, number>; total: number };
  /** Highest detail to render. 'program' shows full Faculty → Level → Program;
   *  'level' stops at Faculty → Program Level (used by international view). */
  leafLevel?: 'program' | 'level';
  /** Formatter for numeric cells. Defaults to en-US locale integer. */
  format?: (n: number) => string;
  /** Header label for the pivot row column. */
  rowHeaderLabel?: string;
  /** Header label for the totals column at the right edge. */
  totalLabel?: string;
}

// Sort key — either a column index (referring to one of `columns`)
// or the literal string 'total' for the right-edge totals column.
type SortKey = PivotColumnKey | '__total__';
type SortDir = 'asc' | 'desc';
interface SortState {
  key: SortKey;
  dir: SortDir;
}

export function DrillDownPivot({
  columns,
  columnLabel = (c) => String(c),
  rows,
  totals,
  leafLevel = 'program',
  format = (n) => n.toLocaleString('en-US'),
  rowHeaderLabel = 'Faculty / Program level / Program',
  totalLabel = 'Total',
}: DrillDownPivotProps) {
  // Track expansion state. Row keys are stable across renders; the user
  // expands by clicking the chevron.
  const [openFaculties, setOpenFaculties] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [openLevels, setOpenLevels] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [sort, setSort] = React.useState<SortState | null>(null);

  // Click-cycle sort: unsorted → desc → asc → unsorted.
  const cycleSort = (key: SortKey) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'desc' };
      if (s.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  const valueAt = (cells: Record<PivotColumnKey, number>, total: number, key: SortKey): number => {
    if (key === '__total__') return total;
    return cells[key] ?? 0;
  };

  // Sort rows recursively at every level — top → mid → leaf — by the
  // active sort key. Returns NEW arrays so React's identity check
  // re-renders. When no sort is active, defer to the server-side
  // ordering (Thai-aware faculty + level rank + Thai-aware program).
  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const cmp = (a: number, b: number) =>
      sort.dir === 'desc' ? b - a : a - b;
    return [...rows]
      .map((faculty) => ({
        ...faculty,
        children: [...faculty.children]
          .map((mid) => ({
            ...mid,
            children: [...mid.children].sort((a, b) =>
              cmp(
                valueAt(a.cells, a.total, sort.key),
                valueAt(b.cells, b.total, sort.key),
              ),
            ),
          }))
          .sort((a, b) =>
            cmp(
              valueAt(a.cells, a.total, sort.key),
              valueAt(b.cells, b.total, sort.key),
            ),
          ),
      }))
      .sort((a, b) =>
        cmp(
          valueAt(a.cells, a.total, sort.key),
          valueAt(b.cells, b.total, sort.key),
        ),
      );
  }, [rows, sort]);

  const toggleFaculty = (name: string) => {
    setOpenFaculties((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const toggleLevel = (key: string) => {
    setOpenLevels((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    const fac = new Set<string>();
    const lvl = new Set<string>();
    for (const f of sortedRows) {
      fac.add(f.facultyName);
      for (const m of f.children) {
        lvl.add(`${f.facultyName}|${m.programLevel}`);
      }
    }
    setOpenFaculties(fac);
    setOpenLevels(lvl);
  };
  const collapseAll = () => {
    setOpenFaculties(new Set());
    setOpenLevels(new Set());
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-1 p-6 text-center text-sm text-text-tertiary">
        No data to pivot.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={expandAll}
          className="rounded border border-border-subtle bg-surface-1 px-2 py-1 hover:bg-surface-2"
        >
          Expand all
        </button>
        <button
          onClick={collapseAll}
          className="rounded border border-border-subtle bg-surface-1 px-2 py-1 hover:bg-surface-2"
        >
          Collapse all
        </button>
        <span className="ml-auto text-text-tertiary">
          {rows.length} faculties · {columns.length} columns
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-medium">
                {rowHeaderLabel}
              </th>
              {columns.map((c) => (
                <SortHeader
                  key={String(c)}
                  label={columnLabel(c)}
                  sortKey={c}
                  active={sort}
                  onClick={cycleSort}
                />
              ))}
              <SortHeader
                label={totalLabel}
                sortKey="__total__"
                active={sort}
                onClick={cycleSort}
                borderLeft
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((faculty) => {
              const fOpen = openFaculties.has(faculty.facultyName);
              return (
                <React.Fragment key={faculty.facultyName}>
                  <tr className="border-t border-border-subtle bg-surface-1 hover:bg-surface-2">
                    <td className="sticky left-0 bg-inherit px-3 py-1.5 font-semibold">
                      <button
                        onClick={() => toggleFaculty(faculty.facultyName)}
                        className="flex w-full items-center gap-1.5 text-left"
                      >
                        <Indent depth={0} hasChevron chevronOpen={fOpen} />
                        <span>{faculty.facultyName}</span>
                      </button>
                    </td>
                    {columns.map((c) => (
                      <PivotCell key={String(c)} value={faculty.cells[c]} format={format} />
                    ))}
                    <PivotCell
                      value={faculty.total}
                      format={format}
                      bold
                      borderLeft
                    />
                  </tr>
                  {fOpen &&
                    faculty.children.map((midRow) => {
                      const levelKey = `${faculty.facultyName}|${midRow.programLevel}`;
                      const lOpen = openLevels.has(levelKey);
                      const canExpand = leafLevel === 'program';
                      return (
                        <React.Fragment key={levelKey}>
                          <tr className="border-t border-border-subtle">
                            <td className="sticky left-0 bg-surface-0 px-3 py-1.5 text-text-secondary">
                              {canExpand ? (
                                <button
                                  onClick={() => toggleLevel(levelKey)}
                                  className="flex w-full items-center gap-1.5 text-left"
                                >
                                  <Indent
                                    depth={1}
                                    hasChevron
                                    chevronOpen={lOpen}
                                  />
                                  <span>{midRow.programLevel}</span>
                                </button>
                              ) : (
                                <div className="flex w-full items-center gap-1.5">
                                  <Indent depth={1} hasChevron={false} />
                                  <span>{midRow.programLevel}</span>
                                </div>
                              )}
                            </td>
                            {columns.map((c) => (
                              <PivotCell
                                key={String(c)}
                                value={midRow.cells[c]}
                                format={format}
                                muted
                              />
                            ))}
                            <PivotCell
                              value={midRow.total}
                              format={format}
                              muted
                              borderLeft
                            />
                          </tr>
                          {canExpand &&
                            lOpen &&
                            midRow.children.map((leaf) => (
                              <tr
                                key={`${levelKey}|${leaf.programName}`}
                                className="border-t border-border-subtle"
                              >
                                <td className="sticky left-0 bg-surface-0 px-3 py-1.5 text-xs text-text-tertiary">
                                  <div className="flex w-full items-center gap-1.5">
                                    <Indent depth={2} hasChevron={false} />
                                    <span>{leaf.programName}</span>
                                  </div>
                                </td>
                                {columns.map((c) => (
                                  <PivotCell
                                    key={String(c)}
                                    value={leaf.cells[c]}
                                    format={format}
                                    leaf
                                  />
                                ))}
                                <PivotCell
                                  value={leaf.total}
                                  format={format}
                                  leaf
                                  borderLeft
                                />
                              </tr>
                            ))}
                        </React.Fragment>
                      );
                    })}
                </React.Fragment>
              );
            })}
            <tr className="border-t-2 border-border-strong bg-surface-2 font-semibold">
              <td className="sticky left-0 bg-surface-2 px-3 py-2">
                Grand total
              </td>
              {columns.map((c) => (
                <PivotCell
                  key={String(c)}
                  value={totals.cells[c]}
                  format={format}
                  bold
                />
              ))}
              <PivotCell
                value={totals.total}
                format={format}
                bold
                borderLeft
              />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Click-to-sort header for a numeric column. Cycles desc → asc →
// unsorted on each click; the arrow glyph reflects the active state.
function SortHeader({
  label,
  sortKey,
  active,
  onClick,
  borderLeft,
}: {
  label: string;
  sortKey: SortKey;
  active: SortState | null;
  onClick: (k: SortKey) => void;
  borderLeft?: boolean;
}) {
  const isActive = !!(active && active.key === sortKey);
  const arrow = isActive ? (active!.dir === 'asc' ? '▲' : '▼') : '';
  return (
    <th
      className={`px-3 py-2 text-right font-medium font-tabular ${
        borderLeft ? 'border-l border-border-subtle' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-baseline gap-1 hover:text-text-primary ${
          isActive ? 'text-accent' : ''
        }`}
        title={
          isActive
            ? `Sorted ${active!.dir === 'asc' ? 'ascending' : 'descending'} — click to ${active!.dir === 'desc' ? 'sort ascending' : 'clear'}`
            : 'Click to sort descending'
        }
      >
        <span>{label}</span>
        {arrow && <span className="text-[0.7rem] leading-none">{arrow}</span>}
      </button>
    </th>
  );
}

// Hierarchical indent. Depth 0 = top-level (faculty), depth 1 = mid
// (program level), depth 2 = leaf (program). The step grows with depth
// so the third level reads as clearly nested:
//   depth 0 → 0px
//   depth 1 → 24px
//   depth 2 → 56px  (24 + 32 — extra step to widen the program rows)
// A fixed-width chevron box keeps the row's name text starting at a
// consistent x-coordinate whether or not the row is expandable.
function Indent({
  depth,
  hasChevron,
  chevronOpen,
}: {
  depth: number;
  hasChevron: boolean;
  chevronOpen?: boolean;
}) {
  const padPx = depth === 0 ? 0 : depth === 1 ? 24 : 56;
  return (
    <span
      className="flex shrink-0 items-center"
      style={{ paddingLeft: `${padPx}px` }}
      aria-hidden
    >
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
        {hasChevron && (
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${
              chevronOpen ? 'rotate-90' : ''
            }`}
          />
        )}
      </span>
    </span>
  );
}

function PivotCell({
  value,
  format,
  bold,
  muted,
  leaf,
  borderLeft,
}: {
  value: number | undefined;
  format: (n: number) => string;
  bold?: boolean;
  muted?: boolean;
  leaf?: boolean;
  borderLeft?: boolean;
}) {
  const empty = value === undefined || value === 0;
  // Always provide the exact comma-formatted value as a tooltip — the
  // displayed value may be abbreviated (e.g. "3.2M") to fit the cell.
  const title =
    !empty && value !== undefined ? value.toLocaleString('en-US') : undefined;
  const display = empty ? '·' : format(value!);
  const sizeClass = leaf ? 'text-xs' : '';
  const toneClass = muted
    ? 'text-text-secondary'
    : leaf
      ? 'text-text-tertiary'
      : '';
  const weightClass = bold ? 'font-semibold' : '';
  const borderClass = borderLeft ? 'border-l border-border-subtle' : '';
  return (
    <td
      className={`px-3 py-1.5 text-right font-tabular ${sizeClass} ${toneClass} ${weightClass} ${borderClass}`}
      title={title}
    >
      {display}
    </td>
  );
}
