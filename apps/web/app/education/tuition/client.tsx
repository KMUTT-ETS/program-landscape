'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import type { TuitionResponse } from '../types';
import { DrillDownPivot } from '../drill-down-pivot';
import { MultiSelectField } from '../multi-select';

interface Props {
  data: TuitionResponse;
  initialFilters: {
    semester: string[];
    facultyName: string[];
  };
}

const fmtThb = (n: number): string => {
  if (n === 0) return '·';
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(n) >= 1_000) {
    return `${Math.round(n / 1_000).toLocaleString('en-US')}k`;
  }
  return n.toLocaleString('en-US');
};

const fmtThbExact = (n: number): string => n.toLocaleString('en-US');

export function TuitionClient({ data, initialFilters }: Props) {
  const router = useRouter();

  const [semester, setSemester] = React.useState(initialFilters.semester);
  const [faculty, setFaculty] = React.useState(initialFilters.facultyName);

  const apply = (next: { semester?: string[]; faculty?: string[] }) => {
    const params = new URLSearchParams();
    (next.semester ?? semester).forEach((v) => params.append('semester', v));
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    router.push(`/education/tuition?${params.toString()}`);
  };

  const total = data.totalRevenueThb;
  const maxYear = Math.max(...data.byAcademicYear.map((y) => y.revenueThb), 1);
  const maxFac = Math.max(...data.byFaculty.map((f) => f.revenueThb), 1);

  // Multi-select sorts options Thai-aware internally; we just need
  // the unique list (byFaculty is already deduped by faculty name).
  const facultyOptions = data.byFaculty.map((f) => f.facultyName);
  const anyFilter = semester.length > 0 || faculty.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter rail ─────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Semester"
            options={data.semesters.map((s) => ({ value: s, label: s }))}
            selected={semester}
            onChange={(vs) => {
              setSemester(vs);
              apply({ semester: vs });
            }}
            preserveOrder
          />
          <MultiSelectField
            label="Faculty"
            options={facultyOptions.map((f) => ({ value: f, label: f }))}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              apply({ faculty: vs });
            }}
          />
          {anyFilter && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setSemester([]);
                setFaculty([]);
                router.push('/education/tuition');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            Total revenue · {fmtThbExact(total)} THB
          </span>
        </div>
      </Card>

      {/* ── Breakdowns ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold">By academic year</h3>
          {data.byAcademicYear.length === 0 ? (
            <p className="mt-2 text-xs text-text-tertiary">No data.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {data.byAcademicYear.map((y) => {
                const widthPct = (y.revenueThb / maxYear) * 100;
                return (
                  <li
                    key={y.academicYearBe}
                    className="grid grid-cols-[6rem_minmax(0,1fr)_8rem] items-center gap-x-4 text-xs"
                  >
                    <span className="font-tabular">BE {y.academicYearBe}</span>
                    <div
                      className="relative h-4 overflow-hidden rounded-sm"
                      style={{ background: 'rgba(120,120,120,0.18)' }}
                    >
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.max(widthPct, 0.5)}%`,
                          background: '#069c6a',
                        }}
                      />
                    </div>
                    <span
                      className="text-right font-tabular font-semibold"
                      title={`${fmtThbExact(y.revenueThb)} THB`}
                    >
                      {fmtThb(y.revenueThb)} THB
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="text-sm font-semibold">By faculty (top 15)</h3>
          {data.byFaculty.length === 0 ? (
            <p className="mt-2 text-xs text-text-tertiary">No data.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {data.byFaculty.slice(0, 15).map((f) => {
                const widthPct = (f.revenueThb / maxFac) * 100;
                return (
                  <li
                    key={f.facultyName}
                    className="grid grid-cols-[16rem_minmax(0,1fr)_8rem] items-center gap-x-4 text-xs"
                  >
                    <span className="truncate" title={f.facultyName}>
                      {f.facultyName}
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
                      title={`${fmtThbExact(f.revenueThb)} THB`}
                    >
                      {fmtThb(f.revenueThb)} THB
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Pivot ───────────────────────────────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold">
          Drill-down: Faculty → Program Level → Program × Academic Year
        </h3>
        <p className="mb-3 mt-1 text-xs text-text-tertiary">
          Values shown in millions of Thai baht (or thousands when smaller).
          Click a faculty / program-level row to drill down.
        </p>
        <DrillDownPivot
          columns={data.academicYears}
          columnLabel={(c) => `BE ${c}`}
          rows={data.rows}
          totals={data.totals}
          leafLevel="program"
          format={fmtThb}
          rowHeaderLabel="Faculty / Program level / Program"
          totalLabel="Total (THB)"
        />
      </Card>
    </div>
  );
}
