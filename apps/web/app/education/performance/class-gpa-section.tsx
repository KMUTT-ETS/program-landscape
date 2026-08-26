'use client';

// /education/performance — Class GPA section (v1.2.9).
//
// Faculty → Program → Course (Class) drill table with year columns and
// heat-mapped GPA cells. The semester multi-select filter at the top
// re-fetches the byProgram + courses payloads with the chosen
// semesters; defaults to 1+2 (main terms).
//
// Trend chart + KPI strip + distribution bar stay on the parent
// component (overall window — never filtered by semester).

import * as React from 'react';
import { Card } from '@kku/ui';
import { ChevronRight } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ClassGpaByProgramResponse,
  ClassGpaByProgramRow,
  ClassGpaCoursesResponse,
  ClassGpaCourseRow,
  ClassGpaOverall,
  ClassGpaTrendCell,
  ClassGpaTrendRow,
} from '../types';

interface Props {
  overall: ClassGpaOverall;
  trend: ClassGpaTrendRow[];
  byProgram: ClassGpaByProgramResponse;
  /** facultyName filter from the parent — needs to be threaded into the
   *  semester-filtered refetch so the rollup stays consistent. */
  facultyNameFilter: string[];
}

const fmtCount = (n: number): string => n.toLocaleString('en-US');
const fmtGpa = (n: number | null): string => (n === null ? '—' : n.toFixed(2));
const fmtPct = (n: number | null): string => (n === null ? '—' : (n * 100).toFixed(1) + '%');

const SEM_LINES = [
  { key: 'sem1', label: 'Semester 1', stroke: 'oklch(0.65 0.22 250)' },
  { key: 'sem2', label: 'Semester 2', stroke: 'oklch(0.65 0.20 145)' },
  { key: 'sem3', label: 'Summer (3)', stroke: 'oklch(0.70 0.18 60)' },
  { key: 'sem4', label: 'Intersession (4)', stroke: 'oklch(0.60 0.22 30)' },
] as const;

const SEM_OPTIONS = [
  { value: 1, label: 'Sem 1' },
  { value: 2, label: 'Sem 2' },
  { value: 3, label: 'Summer (3)' },
  { value: 4, label: 'Intersession (4)' },
] as const;

// GPA → heat colour. 4.0 = saturated green, 2.0 = amber, 0.0 = red.
function gpaHeatColor(gpa: number | null): string {
  if (gpa === null) return 'transparent';
  const clamp = Math.max(0, Math.min(4, gpa));
  const hue =
    clamp < 2 ? 25 + ((60 - 25) * clamp) / 2 : 60 + ((145 - 60) * (clamp - 2)) / 2;
  return `oklch(0.86 0.08 ${hue.toFixed(0)})`;
}

export function ClassGpaSection({ overall, trend, byProgram: initialByProgram, facultyNameFilter }: Props) {
  // Semester filter — drives the year-column table re-fetch. Defaults
  // to main terms (1 + 2). When changed, we refetch byProgram with the
  // semester narrowing applied; the trend + KPIs above stay unfiltered.
  const [selectedSemesters, setSelectedSemesters] = React.useState<number[]>([1, 2]);
  const [byProgram, setByProgram] = React.useState<ClassGpaByProgramResponse>(initialByProgram);
  const [tableLoading, setTableLoading] = React.useState(false);

  // Refetch whenever filter changes. Skip the initial render where state
  // matches the SSR payload — main-terms filter (1+2) doesn't match the
  // server's no-semester-filter default, so we trigger immediately.
  React.useEffect(() => {
    const ctrl = new AbortController();
    const qs = new URLSearchParams();
    facultyNameFilter.forEach((f) => qs.append('facultyName', f));
    selectedSemesters.forEach((s) => qs.append('semester', String(s)));
    setTableLoading(true);
    fetch(`/api/proxy/education/performance/class-gpa/by-program?${qs}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((env) => {
        const payload: ClassGpaByProgramResponse = env.data ?? env;
        setByProgram(payload);
      })
      .catch((e: unknown) => {
        // Ignore aborts; surface real errors.
        if (e instanceof Error && e.name === 'AbortError') return;
        // Fall back to initial payload so the UI doesn't go blank.
        setByProgram(initialByProgram);
      })
      .finally(() => setTableLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSemesters.join(','), facultyNameFilter.join(',')]);

  const chartData = React.useMemo(
    () =>
      trend.map((r) => ({
        year: r.acadYearBE,
        sem1: r.bySemester['1']?.averageClassGpa ?? null,
        sem2: r.bySemester['2']?.averageClassGpa ?? null,
        sem3: r.bySemester['3']?.averageClassGpa ?? null,
        sem4: r.bySemester['4']?.averageClassGpa ?? null,
      })),
    [trend],
  );

  return (
    <Card className="mt-6 flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary">
          Class GPA &mdash; trend &amp; Faculty → Program Level → Program → Class pivot
        </h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Average grade earned per class section, weighted by credits ×
          gradedCount, rolled up to faculty / program / course with
          year columns. Distinct from the student cumulative GPA above.
          Source: POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER grade columns.
          Method: <span className="font-mono">class-gpa.v1</span>.
        </p>
      </div>

      {/* KPI strip — overall (no semester filter applied) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Class sections" value={fmtCount(overall.totalClasses)} sub={`${fmtCount(overall.classesWithGrades)} with grades`} />
        <Kpi label="Avg class GPA" value={fmtGpa(overall.averageClassGpa)} sub="credit × graded weighted" />
        <Kpi label="Pass rate" value={fmtPct(overall.passRate)} sub="1 − (F / graded)" />
        <Kpi label="Withdrawal rate" value={fmtPct(overall.withdrawalRate)} sub="W / (graded + I + W)" />
        <Kpi
          label="Window"
          value={
            overall.windowYearsBE.start !== null
              ? `BE ${overall.windowYearsBE.start}–${overall.windowYearsBE.end}`
              : '—'
          }
          sub={`${fmtCount(overall.totalGradedCount)} graded students`}
        />
      </div>

      {/* Trend chart — 1 line per semester (unfiltered, the table below
          uses the filter instead) */}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--color-border-subtle) / 0.5)" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} tickFormatter={(v) => `BE ${v}`} />
            <YAxis domain={[2.0, 4.0]} ticks={[2.0, 2.5, 3.0, 3.5, 4.0]} tick={{ fontSize: 11 }} />
            <Tooltip
              labelFormatter={(v) => `BE ${v}`}
              formatter={(v) =>
                typeof v === 'number' ? v.toFixed(3) : v === null || v === undefined ? '—' : String(v)
              }
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {SEM_LINES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.stroke}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Letter distribution */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
          Letter distribution (across all matched sections, no semester filter)
        </p>
        <GradeDistributionBar dist={overall.gradeDistribution} />
      </div>

      {/* Semester filter + pivot table */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
            Faculty → Program Level → Program → Class pivot
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-tertiary">Semesters:</span>
            {SEM_OPTIONS.map((s) => {
              const active = selectedSemesters.includes(s.value);
              return (
                <button
                  key={s.value}
                  onClick={() => {
                    setSelectedSemesters((prev) =>
                      prev.includes(s.value)
                        ? prev.filter((x) => x !== s.value)
                        : [...prev, s.value].sort(),
                    );
                  }}
                  className={
                    'rounded border px-2 py-0.5 text-[11px] ' +
                    (active
                      ? 'border-accent-default bg-accent-subtle text-accent-default'
                      : 'border-border-subtle text-text-secondary hover:bg-surface-2')
                  }
                >
                  {s.label}
                </button>
              );
            })}
            {tableLoading && (
              <span className="ml-1 text-[11px] italic text-text-tertiary">refreshing…</span>
            )}
          </div>
        </div>
        <p className="mb-2 text-[11px] text-text-tertiary">
          GPA column is colour-graded — green = high, amber = mid, red = low.
          Click a faculty to expand its program levels; click a level to
          expand its programs; click a program to load its courses.
        </p>
        <PivotTable rows={byProgram.rows} yearsObserved={byProgram.yearsObserved} selectedSemesters={selectedSemesters} />
      </div>
    </Card>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
      <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="mt-1 font-tabular text-xl font-semibold tabular-nums text-text-primary">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-text-tertiary">{sub}</div>
    </div>
  );
}

function GpaHeatCell({ cell }: { cell: ClassGpaTrendCell | undefined }) {
  if (!cell || cell.averageClassGpa === null) {
    return <span className="text-text-tertiary">—</span>;
  }
  return (
    <span
      className="inline-block rounded px-2 py-0.5 font-tabular font-semibold tabular-nums text-text-primary"
      style={{ background: gpaHeatColor(cell.averageClassGpa), minWidth: '3.2rem', textAlign: 'right' }}
      title={`GPA ${cell.averageClassGpa.toFixed(3)} · ${cell.classCount} sections, ${cell.gradedCount.toLocaleString()} graded`}
    >
      {fmtGpa(cell.averageClassGpa)}
    </span>
  );
}

function GradeDistributionBar({
  dist,
}: {
  dist: Record<'A' | 'BPLUS' | 'B' | 'CPLUS' | 'C' | 'DPLUS' | 'D' | 'F', number>;
}) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (total === 0) return <div className="text-xs text-text-tertiary">No graded data.</div>;
  const segments = [
    { key: 'A', label: 'A', count: dist.A, color: 'oklch(0.66 0.18 145)' },
    { key: 'BPLUS', label: 'B+', count: dist.BPLUS, color: 'oklch(0.72 0.17 145)' },
    { key: 'B', label: 'B', count: dist.B, color: 'oklch(0.78 0.14 145)' },
    { key: 'CPLUS', label: 'C+', count: dist.CPLUS, color: 'oklch(0.78 0.14 90)' },
    { key: 'C', label: 'C', count: dist.C, color: 'oklch(0.75 0.16 60)' },
    { key: 'DPLUS', label: 'D+', count: dist.DPLUS, color: 'oklch(0.70 0.17 40)' },
    { key: 'D', label: 'D', count: dist.D, color: 'oklch(0.65 0.20 30)' },
    { key: 'F', label: 'F', count: dist.F, color: 'oklch(0.55 0.22 25)' },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-6 overflow-hidden rounded-sm">
        {segments.map((s) => {
          const pct = (s.count / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={s.key}
              style={{ width: `${pct}%`, background: s.color }}
              title={`${s.label}: ${s.count.toLocaleString()} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
            <span className="font-mono">{s.label}</span>
            <span className="tabular-nums">{s.count.toLocaleString()}</span>
            <span className="text-text-tertiary">({((s.count / total) * 100).toFixed(1)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Pivot table (Faculty → Program Level → Program → Course × year cols) ──

// Localised label for the Prisma ProgramLevel enum strings the API returns.
// Order matches academic seniority (BACHELOR → HGD → MASTER → DOCTORAL).
const LEVEL_LABEL: Record<string, string> = {
  BACHELOR: 'ปริญญาตรี (Bachelor)',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง (Higher Grad Diploma)',
  MASTER: 'ปริญญาโท (Master)',
  DOCTORAL: 'ปริญญาเอก (Doctoral)',
};
const LEVEL_ORDER: Record<string, number> = {
  BACHELOR: 1,
  HIGHER_GRAD_DIPLOMA: 2,
  MASTER: 3,
  DOCTORAL: 4,
};

interface ProgramLevelAgg {
  programLevel: string;
  classCount: number;
  gradedCount: number;
  weightedNumer: number;
  weightedDenom: number;
  averageClassGpa: number | null;
  byYear: Record<string, ClassGpaTrendCell>;
  programs: ClassGpaByProgramRow[];
}

interface FacultyAgg {
  facultyName: string;
  classCount: number;
  gradedCount: number;
  weightedNumer: number;
  weightedDenom: number;
  averageClassGpa: number | null;
  byYear: Record<string, ClassGpaTrendCell>;
  levels: ProgramLevelAgg[];
}

function PivotTable({
  rows,
  yearsObserved,
  selectedSemesters,
}: {
  rows: ClassGpaByProgramRow[];
  yearsObserved: number[];
  selectedSemesters: number[];
}) {
  // Faculty → Program Level → Program rollup. Merge per-year cells at
  // each tier using credit-weighted averaging (approximated via
  // gradedCount at the client side; the back-end has the exact value).
  const facultyRows = React.useMemo<FacultyAgg[]>(() => {
    // Helper: merge a (gradedCount, gpa) cell into a running aggregate.
    const mergeYearCell = (
      bag: Record<string, ClassGpaTrendCell>,
      yr: string,
      cell: ClassGpaTrendCell,
    ) => {
      const existing = bag[yr];
      const wNew = cell.averageClassGpa !== null ? cell.gradedCount : 0;
      const wOld =
        existing && existing.averageClassGpa !== null ? existing.gradedCount : 0;
      const numer =
        (existing?.averageClassGpa ?? 0) * wOld + (cell.averageClassGpa ?? 0) * wNew;
      const denom = wOld + wNew;
      bag[yr] = {
        classCount: (existing?.classCount ?? 0) + cell.classCount,
        gradedCount: (existing?.gradedCount ?? 0) + cell.gradedCount,
        averageClassGpa: denom > 0 ? numer / denom : null,
      };
    };

    const fMap = new Map<string, Map<string, ProgramLevelAgg>>();
    for (const p of rows) {
      let levelsMap = fMap.get(p.facultyName);
      if (!levelsMap) {
        levelsMap = new Map<string, ProgramLevelAgg>();
        fMap.set(p.facultyName, levelsMap);
      }
      const levelEntry =
        levelsMap.get(p.programLevel) ?? {
          programLevel: p.programLevel,
          classCount: 0,
          gradedCount: 0,
          weightedNumer: 0,
          weightedDenom: 0,
          averageClassGpa: null,
          byYear: {},
          programs: [],
        };
      levelEntry.classCount += p.classCount;
      levelEntry.gradedCount += p.gradedCount;
      if (p.averageClassGpa !== null && p.gradedCount > 0) {
        const w = p.gradedCount;
        levelEntry.weightedNumer += p.averageClassGpa * w;
        levelEntry.weightedDenom += w;
      }
      for (const [yr, cell] of Object.entries(p.byYear)) mergeYearCell(levelEntry.byYear, yr, cell);
      levelEntry.programs.push(p);
      levelsMap.set(p.programLevel, levelEntry);
    }

    // Finalise faculty-level aggregates by combining levels.
    const out: FacultyAgg[] = [];
    for (const [facultyName, levelsMap] of fMap) {
      const faculty: FacultyAgg = {
        facultyName,
        classCount: 0,
        gradedCount: 0,
        weightedNumer: 0,
        weightedDenom: 0,
        averageClassGpa: null,
        byYear: {},
        levels: [],
      };
      for (const lvl of levelsMap.values()) {
        lvl.averageClassGpa =
          lvl.weightedDenom > 0 ? lvl.weightedNumer / lvl.weightedDenom : null;
        lvl.programs.sort((a, b) => {
          const av = a.averageClassGpa ?? -Infinity;
          const bv = b.averageClassGpa ?? -Infinity;
          return bv - av;
        });
        faculty.classCount += lvl.classCount;
        faculty.gradedCount += lvl.gradedCount;
        faculty.weightedNumer += lvl.weightedNumer;
        faculty.weightedDenom += lvl.weightedDenom;
        for (const [yr, cell] of Object.entries(lvl.byYear)) mergeYearCell(faculty.byYear, yr, cell);
        faculty.levels.push(lvl);
      }
      faculty.averageClassGpa =
        faculty.weightedDenom > 0 ? faculty.weightedNumer / faculty.weightedDenom : null;
      faculty.levels.sort((a, b) => (LEVEL_ORDER[a.programLevel] ?? 99) - (LEVEL_ORDER[b.programLevel] ?? 99));
      out.push(faculty);
    }
    out.sort((a, b) => {
      const av = a.averageClassGpa ?? -Infinity;
      const bv = b.averageClassGpa ?? -Infinity;
      return bv - av;
    });
    return out;
  }, [rows]);

  const [openFaculties, setOpenFaculties] = React.useState<Set<string>>(new Set());
  // Keyed by `${facultyName}::${programLevel}` so two faculties' Bachelor
  // tiers can be opened independently.
  const [openLevels, setOpenLevels] = React.useState<Set<string>>(new Set());
  const [openPrograms, setOpenPrograms] = React.useState<Set<string>>(new Set());
  const [coursesCache, setCoursesCache] = React.useState<
    Map<string, { loading: boolean; data: ClassGpaCoursesResponse | null }>
  >(new Map());

  // Hoist the fetch out of the toggle handler so the semester-change
  // effect can call it for already-open programs. Without this, the
  // initial bug was: change semester → cache wiped → open program rows
  // show 'Loading…' permanently because nothing refetches.
  const fetchCoursesForProgram = React.useCallback(
    (programId: string) => {
      setCoursesCache((prev) => {
        const next = new Map(prev);
        next.set(programId, { loading: true, data: null });
        return next;
      });
      const qs = new URLSearchParams();
      selectedSemesters.forEach((s) => qs.append('semester', String(s)));
      fetch(`/api/proxy/education/performance/class-gpa/courses/${programId}?${qs}`)
        .then((r) => r.json())
        .then((env) => {
          const data: ClassGpaCoursesResponse = env.data ?? env;
          setCoursesCache((prev) => {
            const next = new Map(prev);
            next.set(programId, { loading: false, data });
            return next;
          });
        })
        .catch(() => {
          setCoursesCache((prev) => {
            const next = new Map(prev);
            next.set(programId, { loading: false, data: null });
            return next;
          });
        });
    },
    // Re-create when the semester set changes so the closure captures
    // the new value. eslint-disable for the .join() pattern — depending
    // on the array itself would re-create on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSemesters.join(',')],
  );

  // Refetch any currently-open programs whenever the semester filter
  // changes. Effect runs only on the filter change — adding openPrograms
  // to the deps would re-fire whenever the user opens a new row,
  // duplicating the toggle-handler's own fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (openPrograms.size === 0) {
      // No open rows — just wipe the now-stale cache so the next
      // expand triggers a fresh fetch.
      setCoursesCache(new Map());
      return;
    }
    for (const programId of openPrograms) {
      fetchCoursesForProgram(programId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSemesters.join(','), fetchCoursesForProgram]);

  const toggleFaculty = (fname: string) => {
    setOpenFaculties((prev) => {
      const next = new Set(prev);
      if (next.has(fname)) next.delete(fname);
      else next.add(fname);
      return next;
    });
  };

  const toggleLevel = (key: string) => {
    setOpenLevels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleProgram = (programId: string) => {
    setOpenPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(programId)) {
        next.delete(programId);
      } else {
        next.add(programId);
        // Lazy-fetch on first expand. Re-expands hit the cache. The
        // semester-change effect handles refetches for already-open
        // rows.
        if (!coursesCache.has(programId)) {
          fetchCoursesForProgram(programId);
        }
      }
      return next;
    });
  };

  if (facultyRows.length === 0) {
    return <div className="text-xs text-text-tertiary">No programs match the current filter.</div>;
  }

  const colSpan = 4 + yearsObserved.length; // entity / sections / students / GPA + N year cols

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-text-tertiary">
          <tr>
            <th className="sticky left-0 z-10 min-w-[320px] bg-surface-2 px-3 py-2 text-left font-medium">
              Faculty / Level / Program / Class
            </th>
            <th className="px-3 py-2 text-right font-medium">Sections</th>
            <th
              className="px-3 py-2 text-right font-medium"
              title="Cumulative graded students across the selected semesters + displayed years"
            >
              Students
            </th>
            <th className="px-3 py-2 text-right font-medium">All-year GPA</th>
            {yearsObserved.map((y) => (
              <th key={y} className="px-3 py-2 text-right font-medium font-mono">
                BE {y}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {facultyRows.map((f) => {
            const isFacultyOpen = openFaculties.has(f.facultyName);
            return (
              <React.Fragment key={f.facultyName}>
                <tr
                  onClick={() => toggleFaculty(f.facultyName)}
                  className="cursor-pointer border-t border-border-subtle bg-surface-1 hover:bg-surface-2"
                >
                  <td className="sticky left-0 bg-inherit px-3 py-1.5 font-semibold">
                    <div className="flex items-center gap-1.5">
                      <ChevronRight
                        className={`size-icon-sm transition-transform ${isFacultyOpen ? 'rotate-90' : ''}`}
                      />
                      <span>{f.facultyName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right font-tabular tabular-nums">{fmtCount(f.classCount)}</td>
                  <td className="px-3 py-1.5 text-right font-tabular tabular-nums">{fmtCount(f.gradedCount)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <GpaHeatCell
                      cell={{
                        classCount: f.classCount,
                        gradedCount: f.gradedCount,
                        averageClassGpa: f.averageClassGpa,
                      }}
                    />
                  </td>
                  {yearsObserved.map((y) => (
                    <td key={y} className="px-3 py-1.5 text-right">
                      <GpaHeatCell cell={f.byYear[String(y)]} />
                    </td>
                  ))}
                </tr>
                {isFacultyOpen &&
                  f.levels.map((lvl) => {
                    const levelKey = `${f.facultyName}::${lvl.programLevel}`;
                    const isLevelOpen = openLevels.has(levelKey);
                    return (
                      <React.Fragment key={levelKey}>
                        <tr
                          onClick={() => toggleLevel(levelKey)}
                          className="cursor-pointer border-t border-border-subtle bg-surface-0 hover:bg-surface-2"
                        >
                          <td className="sticky left-0 bg-inherit px-3 py-1.5 text-text-secondary">
                            <div className="flex items-center gap-1.5 pl-6">
                              <ChevronRight
                                className={`size-icon-xs text-text-tertiary transition-transform ${isLevelOpen ? 'rotate-90' : ''}`}
                              />
                              <span className="font-medium">
                                {LEVEL_LABEL[lvl.programLevel] ?? lvl.programLevel}
                              </span>
                              <span className="text-[10px] text-text-tertiary">
                                {lvl.programs.length} program{lvl.programs.length === 1 ? '' : 's'}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-right font-tabular tabular-nums">
                            {fmtCount(lvl.classCount)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-tabular tabular-nums">
                            {fmtCount(lvl.gradedCount)}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <GpaHeatCell
                              cell={{
                                classCount: lvl.classCount,
                                gradedCount: lvl.gradedCount,
                                averageClassGpa: lvl.averageClassGpa,
                              }}
                            />
                          </td>
                          {yearsObserved.map((y) => (
                            <td key={y} className="px-3 py-1.5 text-right">
                              <GpaHeatCell cell={lvl.byYear[String(y)]} />
                            </td>
                          ))}
                        </tr>
                        {isLevelOpen &&
                          lvl.programs.map((p) => {
                            const isProgramOpen = openPrograms.has(p.programId);
                            const cache = coursesCache.get(p.programId);
                            return (
                              <React.Fragment key={p.programId}>
                                <tr
                                  onClick={() => toggleProgram(p.programId)}
                                  className="cursor-pointer border-t border-border-subtle hover:bg-surface-2"
                                >
                                  <td className="sticky left-0 bg-surface-0 px-3 py-1.5 text-text-secondary">
                                    <div className="flex items-center gap-1.5 pl-12">
                                      <ChevronRight
                                        className={`size-icon-xs text-text-tertiary transition-transform ${isProgramOpen ? 'rotate-90' : ''}`}
                                      />
                                      <span>{p.programName}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-tabular tabular-nums">
                                    {fmtCount(p.classCount)}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-tabular tabular-nums">
                                    {fmtCount(p.gradedCount)}
                                  </td>
                                  <td className="px-3 py-1.5 text-right">
                                    <GpaHeatCell
                                      cell={{
                                        classCount: p.classCount,
                                        gradedCount: p.gradedCount,
                                        averageClassGpa: p.averageClassGpa,
                                      }}
                                    />
                                  </td>
                                  {yearsObserved.map((y) => (
                                    <td key={y} className="px-3 py-1.5 text-right">
                                      <GpaHeatCell cell={p.byYear[String(y)]} />
                                    </td>
                                  ))}
                                </tr>
                                {isProgramOpen && (
                                  <CourseRows
                                    cache={cache}
                                    yearsObserved={yearsObserved}
                                    colSpan={colSpan}
                                  />
                                )}
                              </React.Fragment>
                            );
                          })}
                      </React.Fragment>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CourseRows({
  cache,
  yearsObserved,
  colSpan,
}: {
  cache: { loading: boolean; data: ClassGpaCoursesResponse | null } | undefined;
  yearsObserved: number[];
  colSpan: number;
}) {
  if (!cache || cache.loading) {
    return (
      <tr className="border-t border-border-subtle">
        <td colSpan={colSpan} className="px-3 py-2 pl-20 text-text-tertiary">
          Loading courses…
        </td>
      </tr>
    );
  }
  const data = cache.data;
  if (!data || data.rows.length === 0) {
    return (
      <tr className="border-t border-border-subtle">
        <td colSpan={colSpan} className="px-3 py-2 pl-20 text-text-tertiary">
          No courses with graded data for this program in the selected semesters.
        </td>
      </tr>
    );
  }
  return (
    <>
      {data.rows.map((c: ClassGpaCourseRow) => (
        <tr key={c.courseCode} className="border-t border-border-subtle">
          <td className="sticky left-0 bg-surface-0 px-3 py-1.5 text-[11px]">
            {/* Visible gap between code and name — gap-3 plus the
                font-change provides clear separation. */}
            <div className="flex items-center gap-3 pl-20">
              <span className="font-mono text-text-secondary">{c.courseCode}</span>
              <span className="text-text-primary">
                {c.courseNameTh ?? c.courseNameEn ?? '—'}
              </span>
            </div>
          </td>
          <td className="px-3 py-1.5 text-right font-tabular tabular-nums">{fmtCount(c.classCount)}</td>
          <td className="px-3 py-1.5 text-right font-tabular tabular-nums">{fmtCount(c.gradedCount)}</td>
          <td className="px-3 py-1.5 text-right">
            <GpaHeatCell
              cell={{
                classCount: c.classCount,
                gradedCount: c.gradedCount,
                averageClassGpa: c.averageClassGpa,
              }}
            />
          </td>
          {yearsObserved.map((y) => (
            <td key={y} className="px-3 py-1.5 text-right">
              <GpaHeatCell cell={c.byYear[String(y)]} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
