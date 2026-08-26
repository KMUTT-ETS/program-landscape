'use client';

import * as React from 'react';
import { Card } from '@kku/ui';
import { ChevronRight } from 'lucide-react';
import type { InternationalResponse } from '../types';
import { WorldCountryMap } from './world-map';

// International dashboard — 2 panels:
//   1. By country (top countries of origin, with bars)
//   2. Faculty → Program drill-down × Program Level columns
//
// The pivot here is a 2-level drill-down (not the shared 3-level one)
// because international has no Program Level mid-row dimension —
// program level IS the column.

interface Props {
  data: InternationalResponse;
}

export function InternationalClient({ data }: Props) {
  const total = data.totalNonThai;
  const maxCountry = Math.max(...data.byCountry.map((c) => c.count), 1);

  return (
    <div className="flex flex-col gap-4">
      {/* ── KPI ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiTile
          label="Total non-Thai students"
          value={total.toLocaleString('en-US')}
          subtitle="status code 10 — currently enrolled"
        />
        <KpiTile
          label="Countries represented"
          value={data.byCountry.length.toString()}
          subtitle="distinct nationalities (NATIONNAME)"
        />
        <KpiTile
          label="Programs hosting"
          value={data.rows
            .reduce((s, f) => s + f.children.length, 0)
            .toLocaleString('en-US')}
          subtitle="distinct (faculty × program) pairs"
        />
      </div>

      {/* ── World map choropleth ───────────────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold">World map of origins</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Each country is tinted by the number of non-Thai students currently
          enrolled. Hover for exact counts; click a country for detail.
        </p>
        <div className="mt-3">
          <WorldCountryMap byCountry={data.byCountry} />
        </div>
      </Card>

      {/* ── By country ──────────────────────────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold">By country of origin</h3>
        {data.byCountry.length === 0 ? (
          <p className="mt-2 text-xs text-text-tertiary">
            No non-Thai students in the cube.
          </p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {data.byCountry.map((c) => {
              const pct = total === 0 ? 0 : (c.count / total) * 100;
              const widthPct = (c.count / maxCountry) * 100;
              return (
                <li
                  key={c.country}
                  className="grid grid-cols-[14rem_minmax(0,1fr)_4.5rem_3.5rem] items-center gap-x-4 text-xs"
                >
                  <span className="truncate" title={c.country}>
                    {c.country}
                  </span>
                  <div
                    className="relative h-4 overflow-hidden rounded-sm"
                    style={{ background: 'rgba(120,120,120,0.18)' }}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.max(widthPct, 0.5)}%`,
                        background: '#664073',
                      }}
                    />
                  </div>
                  <span
                    className="text-right font-tabular font-semibold"
                    title={c.count.toLocaleString('en-US')}
                  >
                    {c.count.toLocaleString('en-US')}
                  </span>
                  <span className="text-right font-tabular text-text-tertiary">
                    {pct.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Pivot table — Faculty → Program × Program Level ─────── */}
      <Card>
        <h3 className="text-sm font-semibold">By faculty + program</h3>
        <p className="mt-1 mb-3 text-xs text-text-tertiary">
          Click a faculty row to expand the programs underneath. Columns are
          program levels.
        </p>
        <FacultyProgramPivot data={data} />
      </Card>
    </div>
  );
}

function KpiTile({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div className="mt-1 font-tabular text-3xl font-semibold">{value}</div>
      {subtitle && (
        <div className="mt-0.5 text-xs text-text-tertiary">{subtitle}</div>
      )}
    </Card>
  );
}

type IntlSortKey = string | '__total__';
type IntlSortDir = 'asc' | 'desc';
interface IntlSortState {
  key: IntlSortKey;
  dir: IntlSortDir;
}

function FacultyProgramPivot({ data }: { data: InternationalResponse }) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const [sort, setSort] = React.useState<IntlSortState | null>(null);
  const toggle = (name: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const cycleSort = (key: IntlSortKey) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'desc' };
      if (s.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  const valueAt = (
    cells: Record<string, number>,
    total: number,
    key: IntlSortKey,
  ) => (key === '__total__' ? total : cells[key] ?? 0);

  const sortedRows = React.useMemo(() => {
    if (!sort) return data.rows;
    const cmp = (a: number, b: number) =>
      sort.dir === 'desc' ? b - a : a - b;
    return [...data.rows]
      .map((f) => ({
        ...f,
        children: [...f.children].sort((a, b) =>
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
  }, [data.rows, sort]);

  if (data.rows.length === 0) {
    return (
      <p className="text-xs text-text-tertiary">No non-Thai students.</p>
    );
  }

  const fmt = (n: number | undefined) =>
    n === undefined || n === 0 ? '·' : n.toLocaleString('en-US');

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-medium">
              Faculty / Program
            </th>
            {data.programLevels.map((lvl) => (
              <IntlSortHeader
                key={lvl}
                label={lvl}
                sortKey={lvl}
                active={sort}
                onClick={cycleSort}
              />
            ))}
            <IntlSortHeader
              label="Total"
              sortKey="__total__"
              active={sort}
              onClick={cycleSort}
              borderLeft
            />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((faculty) => {
            const isOpen = open.has(faculty.facultyName);
            return (
              <React.Fragment key={faculty.facultyName}>
                <tr className="border-t border-border-subtle bg-surface-1 hover:bg-surface-2">
                  <td className="sticky left-0 bg-inherit px-3 py-1.5 font-semibold">
                    <button
                      onClick={() => toggle(faculty.facultyName)}
                      className="flex w-full items-center gap-1.5 text-left"
                    >
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
                        <ChevronRight
                          className={`size-icon-sm transition-transform ${
                            isOpen ? 'rotate-90' : ''
                          }`}
                        />
                      </span>
                      <span>{faculty.facultyName}</span>
                    </button>
                  </td>
                  {data.programLevels.map((lvl) => (
                    <td
                      key={lvl}
                      className="px-3 py-1.5 text-right font-tabular"
                      title={
                        faculty.cells[lvl]
                          ? faculty.cells[lvl]!.toLocaleString('en-US')
                          : undefined
                      }
                    >
                      {fmt(faculty.cells[lvl])}
                    </td>
                  ))}
                  <td
                    className="border-l border-border-subtle px-3 py-1.5 text-right font-tabular font-semibold"
                    title={faculty.total.toLocaleString('en-US')}
                  >
                    {faculty.total.toLocaleString('en-US')}
                  </td>
                </tr>
                {isOpen &&
                  faculty.children.map((p) => (
                    <tr
                      key={`${faculty.facultyName}|${p.programName}`}
                      className="border-t border-border-subtle"
                    >
                      <td className="sticky left-0 bg-surface-0 px-3 py-1.5 text-xs text-text-secondary">
                        <div className="flex w-full items-center gap-1.5">
                          {/* Match the depth-1 indent of DrillDownPivot
                              (24px + chevron-equivalent spacer) so the
                              program name aligns under the parent
                              faculty's chevron column. */}
                          <span
                            className="inline-flex h-3.5 w-3.5 shrink-0"
                            style={{ marginLeft: '24px' }}
                          />
                          <span>{p.programName}</span>
                        </div>
                      </td>
                      {data.programLevels.map((lvl) => (
                        <td
                          key={lvl}
                          className="px-3 py-1.5 text-right font-tabular text-xs text-text-tertiary"
                          title={
                            p.cells[lvl]
                              ? p.cells[lvl]!.toLocaleString('en-US')
                              : undefined
                          }
                        >
                          {fmt(p.cells[lvl])}
                        </td>
                      ))}
                      <td
                        className="border-l border-border-subtle px-3 py-1.5 text-right font-tabular text-xs text-text-tertiary"
                        title={p.total.toLocaleString('en-US')}
                      >
                        {p.total.toLocaleString('en-US')}
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
          <tr className="border-t-2 border-border-strong bg-surface-2 font-semibold">
            <td className="sticky left-0 bg-surface-2 px-3 py-2">
              Grand total
            </td>
            {data.programLevels.map((lvl) => (
              <td
                key={lvl}
                className="px-3 py-2 text-right font-tabular"
              >
                {fmt(data.totals.cells[lvl])}
              </td>
            ))}
            <td className="border-l border-border-subtle px-3 py-2 text-right font-tabular">
              {data.totals.total.toLocaleString('en-US')}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


function IntlSortHeader({
  label,
  sortKey,
  active,
  onClick,
  borderLeft,
}: {
  label: string;
  sortKey: IntlSortKey;
  active: IntlSortState | null;
  onClick: (k: IntlSortKey) => void;
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
      >
        <span>{label}</span>
        {arrow && <span className="text-[0.7rem] leading-none">{arrow}</span>}
      </button>
    </th>
  );
}
