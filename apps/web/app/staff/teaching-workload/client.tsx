'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { MultiSelectField } from '../multi-select';
import type {
  ByFacultyResponse,
  FilterOptions,
  HistogramResponse,
  Summary,
  TeachersResponse,
} from './types';

interface Props {
  summary: Summary | null;
  histogram: HistogramResponse | null;
  byFaculty: ByFacultyResponse | null;
  teachers: TeachersResponse | null;
  options: FilterOptions | null;
  initialFilters: {
    acadYearBE: number | undefined;
    semester: number | undefined;
    levelName: string[];
    onlyUnresolved: boolean;
  };
}

const SEMESTER_LABEL: Record<number, string> = {
  1: 'Sem 1 (main)',
  2: 'Sem 2 (main)',
  3: 'Sem 3 (summer)',
  4: 'Sem 4 (special)',
};

// KKU's nominal full-time teaching load for academic staff is ~9–12
// contact hrs/week. Colour-band the histogram:
//   UNDER  (0–8): may indicate non-teaching admin/research role
//   NORMAL (9–15): expected
//   OVER   (16+): risk of teaching fatigue / coverage failure
const BAND_COLOUR = {
  UNDER: '#f0a232',
  NORMAL: '#069c6a',
  OVER: '#a6192e',
} as const;

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US');
}

export function TeachingWorkloadClient({
  summary,
  histogram,
  byFaculty,
  teachers,
  options,
  initialFilters,
}: Props) {
  const router = useRouter();
  const [year, setYear] = React.useState<number | ''>(initialFilters.acadYearBE ?? '');
  const [semester, setSemester] = React.useState<number | ''>(initialFilters.semester ?? '');
  const [levels, setLevels] = React.useState<string[]>(initialFilters.levelName);
  const [onlyUnresolved, setOnlyUnresolved] = React.useState<boolean>(
    initialFilters.onlyUnresolved,
  );

  const apply = (next: Partial<typeof initialFilters>) => {
    const y = next.acadYearBE ?? (year === '' ? undefined : Number(year));
    const s = next.semester ?? (semester === '' ? undefined : Number(semester));
    const lvl = next.levelName ?? levels;
    const onlyU = next.onlyUnresolved ?? onlyUnresolved;
    const params = new URLSearchParams();
    if (y !== undefined && !Number.isNaN(y)) params.set('acadYearBE', String(y));
    if (s !== undefined && !Number.isNaN(s)) params.set('semester', String(s));
    lvl.forEach((l) => params.append('levelName', l));
    if (onlyU) params.set('onlyUnresolved', 'true');
    router.push(`/staff/teaching-workload${params.toString() ? `?${params}` : ''}`);
  };

  const snapLabel =
    summary && summary.acadYearBE && summary.semester
      ? `BE ${summary.acadYearBE} · ${SEMESTER_LABEL[summary.semester] ?? `Sem ${summary.semester}`}`
      : '—';

  // Max value for the faculty-bar normalisation.
  const facRows = byFaculty?.rows ?? [];
  const maxFacAvg = Math.max(
    1,
    ...facRows.map((r) => r.avgContactHrsPerTeacher),
    byFaculty?.unresolvedRow.avgContactHrsPerTeacher ?? 0,
  );

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
                <option key={y} value={y}>BE {y}</option>
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
                <option key={s} value={s}>{SEMESTER_LABEL[s] ?? `Sem ${s}`}</option>
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
              checked={onlyUnresolved}
              onChange={(e) => {
                setOnlyUnresolved(e.target.checked);
                apply({ onlyUnresolved: e.target.checked });
              }}
            />
            <span>Only unresolved teachers (deep-dive table)</span>
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
          <KpiTile label="Distinct teachers" value={fmt(summary.totalTeachers)} />
          <KpiTile
            label="Avg contact hrs/week"
            value={summary.avgContactHrsPerTeacher.toFixed(1)}
            hint="per teacher in scope"
          />
          <KpiTile
            label="Total contact hrs"
            value={fmt(summary.totalContactHrsPerWeek)}
            hint="Σ lecture + lab per week"
          />
          <KpiTile
            label="Team-taught sections"
            value={fmt(summary.teamTaughtSections)}
            hint={`of ${fmt(summary.totalSections)} sections`}
          />
          <KpiTile label="Students taught" value={fmt(summary.totalStudentsTaught)} />
          <KpiTile
            label="Resolved teachers"
            value={fmt(summary.resolvedTeachers)}
            hint="matched to FacultyMember"
          />
          <KpiTile
            label="Unresolved teachers"
            value={fmt(summary.unresolvedTeachers)}
            hint="external / HCM gap"
            tone={summary.unresolvedTeachers > 0 ? 'warning' : undefined}
          />
          <KpiTile label="Sections" value={fmt(summary.totalSections)} />
        </div>
      )}

      {/* ───── Viz 1: Workload distribution histogram ───── */}
      {histogram && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">
            Workload distribution — contact hours/week per teacher
          </h2>
          <p className="text-xs text-fg-3 mb-3">
            Each bar is a teacher count. KKU's nominal full-time academic load is
            9–15 hrs/week (green band). Bars in the over-load band (red) flag
            teachers carrying heavy delivery burden.
          </p>
          <div className="space-y-2">
            {histogram.buckets.map((b) => (
              <div key={b.bucket} className="grid grid-cols-[120px_1fr_140px] gap-2 items-center text-xs">
                <div className="text-fg-2">{b.bucket}</div>
                <div className="relative bg-surface-2 rounded-sm h-5 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: `${b.pctOfTotal}%`,
                      backgroundColor: BAND_COLOUR[b.band],
                    }}
                  />
                </div>
                <div className="text-right tabular-nums">
                  {fmt(b.teachers)} teachers ({b.pctOfTotal.toFixed(1)}%)
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-3 text-[10px] text-fg-3">
            <LegendDot colour={BAND_COLOUR.UNDER} label="Under-load (≤8 hrs)" />
            <LegendDot colour={BAND_COLOUR.NORMAL} label="Normal (9–15 hrs)" />
            <LegendDot colour={BAND_COLOUR.OVER} label="Over-load (16+ hrs)" />
          </div>
        </Card>
      )}

      {/* ───── Viz 2: Faculty workload pulse ───── */}
      {byFaculty && byFaculty.rows.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">Faculty workload pulse</h2>
          <p className="text-xs text-fg-3 mb-3">
            Average contact hours per teacher, by the teacher's home faculty
            (not the course's owning faculty — Math staff teaching service
            courses still count for Math). Sorted by total load.
          </p>
          <div className="space-y-2">
            {byFaculty.rows.map((r) => (
              <div key={r.facultyName} className="grid grid-cols-[200px_1fr_180px] gap-2 items-center text-xs">
                <div className="text-fg-2 truncate" title={r.facultyName}>
                  {r.facultyName}
                </div>
                <div className="relative bg-surface-2 rounded-sm h-4 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${(r.avgContactHrsPerTeacher / maxFacAvg) * 100}%`,
                      backgroundColor:
                        r.avgContactHrsPerTeacher >= 16
                          ? BAND_COLOUR.OVER
                          : r.avgContactHrsPerTeacher >= 9
                          ? BAND_COLOUR.NORMAL
                          : BAND_COLOUR.UNDER,
                    }}
                  />
                </div>
                <div className="text-right tabular-nums text-fg-3">
                  {r.avgContactHrsPerTeacher.toFixed(1)} hrs ·{' '}
                  {fmt(r.teachers)} teachers
                </div>
              </div>
            ))}
            {byFaculty.unresolvedRow.teachers > 0 && (
              <div className="grid grid-cols-[200px_1fr_180px] gap-2 items-center text-xs border-t border-line mt-2 pt-2">
                <div className="text-fg-3 italic">
                  Unresolved (external / HCM gap)
                </div>
                <div className="relative bg-surface-2 rounded-sm h-4 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm bg-gray-400"
                    style={{
                      width: `${(byFaculty.unresolvedRow.avgContactHrsPerTeacher / maxFacAvg) * 100}%`,
                    }}
                  />
                </div>
                <div className="text-right tabular-nums text-fg-3">
                  {byFaculty.unresolvedRow.avgContactHrsPerTeacher.toFixed(1)} hrs ·{' '}
                  {fmt(byFaculty.unresolvedRow.teachers)} teachers
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ───── Deep-dive table: per-teacher ───── */}
      {teachers && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">Per-teacher deep-dive</h2>
          <p className="text-xs text-fg-3 mb-3">
            One row per KKUMAIL. Sections + contact-hrs are computed assuming every
            co-teacher on a team-taught course carries the FULL workload (KKU's
            policy + the registrar's representation).
            {teachers.truncated && (
              <span className="ml-1 text-orange-600">Truncated to 500 rows — narrow filters to see more.</span>
            )}
          </p>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 bg-surface-1 z-10">
                <tr className="border-b border-line">
                  <th className="text-left px-2 py-1.5">Teacher</th>
                  <th className="text-left px-2 py-1.5">Rank</th>
                  <th className="text-left px-2 py-1.5">Faculty</th>
                  <th className="text-right px-2 py-1.5">Sections</th>
                  <th className="text-right px-2 py-1.5">Distinct courses</th>
                  <th className="text-right px-2 py-1.5">Contact hrs/wk</th>
                  <th className="text-right px-2 py-1.5">Students taught</th>
                  <th className="text-right px-2 py-1.5">Team sections</th>
                </tr>
              </thead>
              <tbody>
                {teachers.rows.map((r) => (
                  <tr
                    key={r.kkuEmail}
                    className={`border-b border-line/50 hover:bg-surface-2 ${
                      !r.facultyMemberId ? 'bg-orange-50/40' : ''
                    }`}
                  >
                    <td className="px-2 py-1">
                      <div>
                        {r.nameEn ?? r.kkuEmail.split('@')[0]}
                        {!r.facultyMemberId && (
                          <span
                            className="ml-1 inline-block px-1 rounded-sm text-[9px] bg-orange-100 text-orange-800"
                            title="No matching FacultyMember in HCM"
                          >
                            unresolved
                          </span>
                        )}
                      </div>
                      <div className="text-fg-3 text-[10px] font-mono">{r.kkuEmail}</div>
                      {r.nameTh && (
                        <div className="text-fg-3 text-[10px]">{r.nameTh}</div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-fg-2 whitespace-nowrap">
                      {r.rank ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-fg-2 whitespace-nowrap">
                      {r.facultyName ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.sections)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {fmt(r.distinctCourses)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded-sm text-white"
                        style={{
                          backgroundColor:
                            r.totalContactHrsPerWeek >= 16
                              ? BAND_COLOUR.OVER
                              : r.totalContactHrsPerWeek >= 9
                              ? BAND_COLOUR.NORMAL
                              : BAND_COLOUR.UNDER,
                        }}
                      >
                        {r.totalContactHrsPerWeek}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {fmt(r.studentsTaught)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {fmt(r.teamTaughtSections)}
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

function LegendDot({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block w-3 h-3 rounded-sm"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}
