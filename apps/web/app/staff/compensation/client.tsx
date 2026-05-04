'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { MultiSelectField } from '../multi-select';
import { DrillDownPivot, type DrillRow } from '../drill-down-pivot';
import type { CompensationResponse, FilterOptions } from '../types';

interface Props {
  data: CompensationResponse;
  options: FilterOptions;
  initialFilters: { facultyName: string[]; track: Array<'ACADEMIC' | 'SUPPORT'>; budgetId: string[] };
}

export function CompensationClient({ data, options, initialFilters }: Props) {
  const router = useRouter();
  const [faculty, setFaculty] = React.useState<string[]>(initialFilters.facultyName);
  const [track, setTrack] = React.useState<Array<'ACADEMIC' | 'SUPPORT'>>(initialFilters.track);
  const [budget, setBudget] = React.useState<string[]>(initialFilters.budgetId);

  const apply = (next: { faculty?: string[]; track?: Array<'ACADEMIC' | 'SUPPORT'>; budget?: string[] }) => {
    const params = new URLSearchParams();
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.track ?? track).forEach((v) => params.append('track', v));
    (next.budget ?? budget).forEach((v) => params.append('budgetId', v));
    router.push(`/staff/compensation${params.toString() ? `?${params}` : ''}`);
  };

  // Build the 3-level drill-down
  const drillRows: DrillRow[] = data.drillDown.map((fac) => ({
    label: fac.facultyName,
    metrics: {
      headcount: fac.headcount,
      mean: fac.meanSalary,
      min: fac.minSalary,
      max: fac.maxSalary,
    },
    children: fac.children.map((tk) => ({
      label: tk.track === 'ACADEMIC' ? 'สายวิชาการ — Academic' : 'สายสนับสนุน — Support',
      metrics: {
        headcount: tk.headcount,
        mean: tk.meanSalary,
        min: tk.minSalary,
        max: tk.maxSalary,
      },
      children: tk.children.map((fund) => ({
        label: fund.salType,
        metrics: {
          headcount: fund.headcount,
          mean: fund.meanSalary,
          min: fund.minSalary,
          max: fund.maxSalary,
        },
      })),
    })),
  }));

  const totalHeadcount = data.drillDown.reduce((a, b) => a + b.headcount, 0);
  const maxBudget = Math.max(...data.budgetByTrack.map((b) => b.total), 1);

  return (
    <div className="flex flex-col gap-4">
      {/* Filter rail */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={options.faculties.map((f) => ({ value: f, label: f }))}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              apply({ faculty: vs });
            }}
          />
          <MultiSelectField
            label="Staff type"
            options={options.tracks.map((t) => ({ value: t.id, label: t.label }))}
            selected={track as string[]}
            onChange={(vs) => {
              const v = vs as Array<'ACADEMIC' | 'SUPPORT'>;
              setTrack(v);
              apply({ track: v });
            }}
            preserveOrder
          />
          <MultiSelectField
            label="Funding source"
            options={options.budgets.map((b) => ({ value: b.id, label: b.label }))}
            selected={budget}
            onChange={(vs) => {
              setBudget(vs);
              apply({ budget: vs });
            }}
          />
          {(faculty.length + track.length + budget.length) > 0 && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setTrack([]);
                setBudget([]);
                router.push('/staff/compensation');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {/* Funding source × track stacked bar */}
      <Card>
        <h3 className="text-sm font-semibold">Where salaries come from</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Each person's salary is paid from one of these sources — government allocation, university revenue, or special funds. Bars split academic (purple) and support (teal).
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.budgetByTrack.map((row) => {
            const widthPct = (row.total / maxBudget) * 100;
            const acaPct = row.total > 0 ? (row.academic / row.total) * 100 : 0;
            return (
              <li
                key={row.source}
                className="grid grid-cols-[16rem_minmax(0,1fr)_4rem_4rem_4rem] items-center gap-x-4 text-xs"
              >
                <span className="truncate" title={row.source}>{row.source}</span>
                <div className="h-4 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.max(widthPct, 0.5)}%`,
                      background: `linear-gradient(90deg, #6366f1 ${acaPct}%, #14b8a6 ${acaPct}%)`,
                    }}
                  />
                </div>
                <span className="text-right font-tabular text-accent">{row.academic.toLocaleString('en-US')}</span>
                <span className="text-right font-tabular text-text-secondary">{row.support.toLocaleString('en-US')}</span>
                <span className="text-right font-tabular font-semibold">{row.total.toLocaleString('en-US')}</span>
              </li>
            );
          })}
          <li className="grid grid-cols-[16rem_minmax(0,1fr)_4rem_4rem_4rem] gap-x-4 pt-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            <span></span>
            <span></span>
            <span className="text-right">Academic</span>
            <span className="text-right">Support</span>
            <span className="text-right">Total</span>
          </li>
        </ul>
      </Card>

      {/* Income band bars */}
      <Card>
        <h3 className="text-sm font-semibold">Monthly income range</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          People grouped by income bracket (in baht per month). Bars split academic (purple) and support (teal).
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {data.incomeByTrack.map((r) => {
            const total = r.academic + r.support;
            const max = Math.max(...data.incomeByTrack.map((x) => x.academic + x.support), 1);
            const widthPct = (total / max) * 100;
            const acaPct = total > 0 ? (r.academic / total) * 100 : 0;
            return (
              <li
                key={r.bandId}
                className="grid grid-cols-[10rem_minmax(0,1fr)_4rem_4rem_4rem] items-center gap-x-4 text-xs"
              >
                <span className="font-tabular">{r.bandLabel}</span>
                <div className="h-4 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.max(widthPct, 0.5)}%`,
                      background: `linear-gradient(90deg, #6366f1 ${acaPct}%, #14b8a6 ${acaPct}%)`,
                    }}
                  />
                </div>
                <span className="text-right font-tabular text-accent">{r.academic.toLocaleString('en-US')}</span>
                <span className="text-right font-tabular text-text-secondary">{r.support.toLocaleString('en-US')}</span>
                <span className="text-right font-tabular font-semibold">{total.toLocaleString('en-US')}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Drill-down compensation pivot */}
      <Card>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Salary by faculty, staff type, and funding source</h3>
          <span className="text-xs text-text-tertiary">
            {totalHeadcount.toLocaleString('en-US')} people across {data.sources.compensationCells} buckets
          </span>
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          Click a faculty to see academic vs support, then drill into the funding source.
          Only buckets with at least 5 people are shown. Divisions (กอง) are rolled up under
          the Office of the President; rows with no funding source recorded are shown as
          เงินรายได้ (university revenue).
        </p>
        <div className="mt-3">
          <DrillDownPivot
            rowHeaderLabel="Faculty / staff type / funding source"
            rows={drillRows}
            columns={[
              { key: 'headcount', label: 'People', format: 'int' },
              { key: 'min', label: 'Min', format: 'thb' },
              { key: 'mean', label: 'Average', format: 'thb' },
              { key: 'max', label: 'Max', format: 'thb' },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
