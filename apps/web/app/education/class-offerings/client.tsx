'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { MultiSelectField } from '../multi-select';
import type {
  DeepDiveResponse,
  DistributionResponse,
  FilterOptions,
  GeResponse,
  HeatmapResponse,
  Summary,
} from './types';

interface Props {
  summary: Summary | null;
  heatmap: HeatmapResponse | null;
  distribution: DistributionResponse | null;
  ge: GeResponse | null;
  deepDive: DeepDiveResponse | null;
  options: FilterOptions | null;
  initialFilters: {
    acadYearBE: number | undefined;
    semester: number | undefined;
    levelName: string[];
    geOnly: boolean;
  };
}

// Colour ramp for fill rate — keyed against the design-token chart
// palette evaluated for the light theme. Cells use these direct hex
// values via inline style to avoid Tailwind alpha quirks.
function fillRateColour(rate: number): string {
  if (rate <= 0) return '#e7e5e1'; // empty
  if (rate < 0.25) return '#fde7ad';
  if (rate < 0.5) return '#facd6a';
  if (rate < 0.75) return '#f0a232';
  if (rate < 1) return '#dc7a20';
  return '#a6192e';
}

const SEMESTER_LABEL: Record<number, string> = {
  1: 'Sem 1 (main)',
  2: 'Sem 2 (main)',
  3: 'Sem 3 (summer)',
  4: 'Sem 4 (special)',
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US');
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function ClassOfferingsClient({
  summary,
  heatmap,
  distribution,
  ge,
  deepDive,
  options,
  initialFilters,
}: Props) {
  const router = useRouter();
  const [year, setYear] = React.useState<number | ''>(initialFilters.acadYearBE ?? '');
  const [semester, setSemester] = React.useState<number | ''>(initialFilters.semester ?? '');
  const [levels, setLevels] = React.useState<string[]>(initialFilters.levelName);
  const [geOnly, setGeOnly] = React.useState<boolean>(initialFilters.geOnly);

  const apply = (next: Partial<typeof initialFilters>) => {
    const y = next.acadYearBE ?? (year === '' ? undefined : Number(year));
    const s = next.semester ?? (semester === '' ? undefined : Number(semester));
    const lvl = next.levelName ?? levels;
    const ge = next.geOnly ?? geOnly;
    const params = new URLSearchParams();
    if (y !== undefined && !Number.isNaN(y)) params.set('acadYearBE', String(y));
    if (s !== undefined && !Number.isNaN(s)) params.set('semester', String(s));
    lvl.forEach((l) => params.append('levelName', l));
    if (ge) params.set('geOnly', 'true');
    router.push(`/education/class-offerings${params.toString() ? `?${params}` : ''}`);
  };

  const snapLabel =
    summary && summary.acadYearBE && summary.semester
      ? `BE ${summary.acadYearBE} · ${SEMESTER_LABEL[summary.semester] ?? `Sem ${summary.semester}`}`
      : '—';

  return (
    <div className="space-y-6">
      {/* ───── filter bar ───── */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <label className="block text-xs">
            <span className="text-fg-2 mb-1 block">Academic year (BE)</span>
            <select
              className="w-full bg-surface-2 border border-line rounded-md px-2 py-1.5"
              value={year}
              onChange={(e) => {
                const v = e.target.value === '' ? '' : Number(e.target.value);
                setYear(v);
                apply({ acadYearBE: v === '' ? undefined : (v as number) });
              }}
            >
              <option value="">Latest completed</option>
              {(options?.years ?? []).map((y) => (
                <option key={y} value={y}>
                  BE {y}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-fg-2 mb-1 block">Semester</span>
            <select
              className="w-full bg-surface-2 border border-line rounded-md px-2 py-1.5"
              value={semester}
              onChange={(e) => {
                const v = e.target.value === '' ? '' : Number(e.target.value);
                setSemester(v);
                apply({ semester: v === '' ? undefined : (v as number) });
              }}
            >
              <option value="">Default</option>
              {(options?.semesters ?? []).map((s) => (
                <option key={s} value={s}>
                  {SEMESTER_LABEL[s] ?? `Sem ${s}`}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs">
            <span className="text-fg-2 mb-1 block">Program level</span>
            <MultiSelectField
              label="Levels"
              selected={levels}
              options={(options?.levels ?? []).map((l) => ({ value: l, label: l }))}
              onChange={(next) => {
                setLevels(next);
                apply({ levelName: next });
              }}
              placeholder="All levels"
            />
          </div>
          <label className="text-xs flex items-center gap-2 cursor-pointer self-end pb-1">
            <input
              type="checkbox"
              checked={geOnly}
              onChange={(e) => {
                setGeOnly(e.target.checked);
                apply({ geOnly: e.target.checked });
              }}
            />
            <span>GE courses only</span>
          </label>
        </div>
        <p className="text-[11px] text-fg-3 mt-3">
          Showing: <strong>{snapLabel}</strong>
          {options?.faculties && options.faculties.length > 0 && (
            <> · scope: {options.faculties.length} faculty{options.faculties.length === 1 ? '' : 'ies'}</>
          )}
        </p>
      </Card>

      {/* ───── KPI summary ───── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile label="Sections opened" value={fmt(summary.totalSections)} />
          <KpiTile
            label="Seat fill rate"
            value={pct(summary.fillRate)}
            hint={`${fmt(summary.totalSeatsFilled)} / ${fmt(summary.totalSeatsOffered)} seats`}
          />
          <KpiTile label="Distinct courses" value={fmt(summary.distinctCourses)} />
          <KpiTile
            label="Distinct teachers"
            value={fmt(summary.distinctTeachers)}
            hint="from KKUMAIL"
          />
          <KpiTile
            label="Credits delivered"
            value={fmt(summary.totalCreditsDelivered)}
            hint="Σ CREDITTOTAL · faculty-load weight"
          />
          <KpiTile
            label="Zero-enrolment sections"
            value={fmt(summary.zeroEnrollmentSections)}
            hint={`${pct(summary.zeroEnrollmentSections / Math.max(summary.totalSections, 1))} of total`}
            tone="warning"
          />
          <KpiTile
            label="GE sections"
            value={fmt(summary.geSections)}
            hint="general-education catalogue"
          />
          <KpiTile
            label="Faculties teaching"
            value={fmt(summary.distinctFaculties)}
          />
        </div>
      )}

      {/* ───── Viz 1: Seat-fill heatmap ───── */}
      {heatmap && heatmap.rows.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">Seat-fill heatmap — faculty × semester</h2>
          <p className="text-xs text-fg-3 mb-3">
            Rows: registrar's owning faculty. Cells: average fill rate weighted by seats
            (Σ enrolled ÷ Σ total seats). Hover for section count.
          </p>
          <div className="overflow-x-auto">
            <table className="text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1 sticky left-0 bg-surface-1">Faculty</th>
                  {heatmap.yearSemesters.map((ys) => (
                    <th
                      key={`${ys.acadYearBE}-${ys.semester}`}
                      className="px-1.5 py-1 text-fg-2 font-medium whitespace-nowrap"
                    >
                      {ys.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.rows.map((row) => {
                  const cellMap = new Map(
                    row.cells.map((c) => [`${c.acadYearBE}-${c.semester}`, c]),
                  );
                  return (
                    <tr key={row.facultyName}>
                      <td className="px-2 py-1 sticky left-0 bg-surface-1 whitespace-nowrap font-medium">
                        {row.facultyName}
                      </td>
                      {heatmap.yearSemesters.map((ys) => {
                        const c = cellMap.get(`${ys.acadYearBE}-${ys.semester}`);
                        const rate = c?.fillRate ?? 0;
                        return (
                          <td key={`${ys.acadYearBE}-${ys.semester}`} className="p-0.5">
                            <div
                              className="text-center text-[10px] py-1 px-1 rounded-sm cursor-default"
                              style={{
                                backgroundColor: fillRateColour(rate),
                                color: rate >= 0.5 ? '#fff' : '#000',
                                minWidth: 56,
                              }}
                              title={
                                c
                                  ? `${c.sections} sections · ${fmt(c.seatsFilled)} / ${fmt(c.seatsOffered)} (${pct(c.fillRate)})`
                                  : 'no data'
                              }
                            >
                              {c ? pct(c.fillRate) : '—'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-fg-3 mt-2">
            Legend: lighter = empty • amber = under-filled • deep amber/red = at capacity.
          </p>
        </Card>
      )}

      {/* ───── Viz 2: Section utilisation distribution ───── */}
      {distribution && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">Section utilisation distribution</h2>
          <p className="text-xs text-fg-3 mb-3">
            How well-filled are sections? Each bar is a fill-rate band; the 0% bar surfaces
            sections that opened but never enrolled a student.
          </p>
          <div className="space-y-2">
            {distribution.buckets.map((b) => (
              <div key={b.bucket} className="grid grid-cols-[110px_1fr_80px] gap-2 items-center text-xs">
                <div className="text-fg-2">{b.bucket}</div>
                <div className="relative bg-surface-2 rounded-sm h-5 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: `${b.pctOfTotal}%`,
                      backgroundColor:
                        b.rangeLowerPct === 0 && b.rangeUpperPct === 0
                          ? '#a6192e'
                          : b.rangeUpperPct < 50
                          ? '#facd6a'
                          : b.rangeUpperPct <= 99
                          ? '#069c6a'
                          : '#2b4ba4',
                    }}
                  />
                </div>
                <div className="text-right tabular-nums">
                  {fmt(b.sections)} ({b.pctOfTotal.toFixed(1)}%)
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ───── Viz 3: GE breakdown ───── */}
      {ge && ge.totals.sections > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">General education — who's teaching it?</h2>
          <p className="text-xs text-fg-3 mb-3">
            GE = course codes <code>00____</code> or <code>GE____</code>, plus the GE
            Institute & Language Institute catalogues. Every KKU undergrad takes these,
            so fill rates are usually high — under-filled GE bars deserve attention.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-medium mb-2 text-fg-2">By provider</h3>
              <div className="space-y-1.5">
                {ge.byProvider.slice(0, 10).map((p) => (
                  <div key={p.registryFacultyName} className="text-[11px]">
                    <div className="flex justify-between">
                      <span className={p.isGeInstitute ? 'font-semibold' : ''}>
                        {p.registryFacultyName}
                        {p.isGeInstitute && (
                          <span className="ml-1 text-fg-3">(GE owner)</span>
                        )}
                      </span>
                      <span className="text-fg-3">
                        {fmt(p.sections)} sections · {pct(p.fillRate)}
                      </span>
                    </div>
                    <div className="relative bg-surface-2 rounded-sm h-2 mt-0.5">
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${Math.min(p.fillRate * 100, 100)}%`,
                          backgroundColor: p.isGeInstitute ? '#664073' : '#2b4ba4',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-medium mb-2 text-fg-2">Trend across semesters</h3>
              <div className="space-y-1">
                {ge.trend.map((t) => (
                  <div key={t.label} className="text-[11px] grid grid-cols-[90px_1fr_70px] gap-2 items-center">
                    <span className="text-fg-2">{t.label}</span>
                    <div className="relative bg-surface-2 rounded-sm h-3">
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm"
                        style={{
                          width: `${Math.min(t.fillRate * 100, 100)}%`,
                          backgroundColor: '#069c6a',
                        }}
                      />
                    </div>
                    <span className="text-right tabular-nums text-fg-3">
                      {fmt(t.sections)} · {pct(t.fillRate)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-fg-3 mt-3">
            GE totals (across all scope): {fmt(ge.totals.sections)} sections ·{' '}
            {fmt(ge.totals.seatsFilled)} / {fmt(ge.totals.seatsOffered)} seats ·{' '}
            {pct(ge.totals.fillRate)} fill.
          </p>
        </Card>
      )}

      {/* ───── Deep-dive table ───── */}
      {deepDive && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">Course deep-dive</h2>
          <p className="text-xs text-fg-3 mb-3">
            One row per (course × faculty) in the active snapshot. "Programs" = programs
            whose curriculum PDF lists this course (from PROGRAM_DIGEST extraction).
            {deepDive.truncated && (
              <span className="ml-1 text-orange-600">Truncated to 500 rows — narrow filters to see the long tail.</span>
            )}
          </p>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 bg-surface-1 z-10">
                <tr className="border-b border-line">
                  <th className="text-left px-2 py-1.5">Code</th>
                  <th className="text-left px-2 py-1.5">Course name</th>
                  <th className="text-left px-2 py-1.5">Faculty</th>
                  <th className="text-left px-2 py-1.5">Level</th>
                  <th className="text-right px-2 py-1.5">Sections</th>
                  <th className="text-right px-2 py-1.5">Enrolled / Offered</th>
                  <th className="text-right px-2 py-1.5">Fill rate</th>
                  <th className="text-right px-2 py-1.5">Credits</th>
                  <th className="text-right px-2 py-1.5">Programs</th>
                </tr>
              </thead>
              <tbody>
                {deepDive.rows.map((r) => (
                  <tr
                    key={`${r.courseCode}-${r.registryFacultyName}`}
                    className="border-b border-line/50 hover:bg-surface-2"
                  >
                    <td className="px-2 py-1 font-mono">
                      {r.courseCode}
                      {r.isGeneralEducation && (
                        <span
                          className="ml-1 inline-block px-1 rounded-sm text-[9px] bg-purple-100 text-purple-700"
                          title="General-education catalogue"
                        >
                          GE
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <div>{r.courseNameEn ?? '—'}</div>
                      {r.courseNameTh && (
                        <div className="text-fg-3 text-[10px]">{r.courseNameTh}</div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-fg-2 whitespace-nowrap">
                      {r.registryFacultyName}
                    </td>
                    <td className="px-2 py-1 text-fg-2">{r.levelName}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.sections)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {fmt(r.seatsFilled)} / {fmt(r.seatsOffered)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded-sm text-white"
                        style={{ backgroundColor: fillRateColour(r.fillRate) }}
                      >
                        {pct(r.fillRate)}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.creditTotal ?? 0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {fmt(r.programsCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warning';
}) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-fg-3">{label}</div>
      <div
        className={`text-xl font-semibold mt-1 tabular-nums ${
          tone === 'warning' ? 'text-orange-600' : ''
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-fg-3 mt-1">{hint}</div>}
    </Card>
  );
}
