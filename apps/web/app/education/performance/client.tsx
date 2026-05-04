'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { ChevronRight } from 'lucide-react';
import type {
  EntryScoreResponse,
  PerformanceByLocationResponse,
  PerformanceByProgramResponse,
  PerformanceOverall,
  ThailandRegion,
} from '../types';
import { MultiSelectField } from '../multi-select';

interface Props {
  overall: PerformanceOverall;
  byProgram: PerformanceByProgramResponse | null;
  byLocation: PerformanceByLocationResponse | null;
  entryScores: EntryScoreResponse | null;
  initialFilters: {
    facultyName: string[];
    programLevel: string[];
    programName: string[];
    region: ThailandRegion[];
  };
}

const REGION_LABELS: Record<ThailandRegion, { th: string; en: string }> = {
  NORTH: { th: 'ภาคเหนือ', en: 'Northern' },
  NORTHEAST: { th: 'ภาคตะวันออกเฉียงเหนือ', en: 'Northeastern (Isan)' },
  CENTRAL: { th: 'ภาคกลาง', en: 'Central' },
  EAST: { th: 'ภาคตะวันออก', en: 'Eastern' },
  WEST: { th: 'ภาคตะวันตก', en: 'Western' },
  SOUTH: { th: 'ภาคใต้', en: 'Southern' },
};
const REGION_ORDER: ThailandRegion[] = [
  'NORTH',
  'NORTHEAST',
  'CENTRAL',
  'EAST',
  'WEST',
  'SOUTH',
];

const fmtGpa = (n: number | null): string =>
  n === null ? '—' : n.toFixed(2);
const fmtScore = (n: number): string => n.toFixed(1);
const fmtCount = (n: number): string => n.toLocaleString('en-US');

export function PerformanceClient({
  overall,
  byProgram,
  byLocation,
  entryScores,
  initialFilters,
}: Props) {
  const router = useRouter();

  const [faculty, setFaculty] = React.useState(initialFilters.facultyName);
  const [level, setLevel] = React.useState(initialFilters.programLevel);
  const [program, setProgram] = React.useState(initialFilters.programName);
  const [regions, setRegions] = React.useState<ThailandRegion[]>(
    initialFilters.region,
  );

  const apply = (next: Partial<typeof initialFilters>) => {
    const params = new URLSearchParams();
    const setMulti = (k: string, vs: string[]) => {
      params.delete(k);
      for (const v of vs) if (v.length > 0) params.append(k, v);
    };
    setMulti('facultyName', next.facultyName ?? faculty);
    setMulti('programLevel', next.programLevel ?? level);
    setMulti('programName', next.programName ?? program);
    setMulti('region', next.region ?? regions);
    router.push(`/education/performance?${params.toString()}`);
  };

  const filteredLevels = React.useMemo(() => {
    if (faculty.length === 0) return overall.filters.programLevels;
    const set = new Set(
      overall.filters.programs
        .filter((p) => faculty.includes(p.facultyName))
        .map((p) => p.programLevel),
    );
    return overall.filters.programLevels.filter((l) => set.has(l));
  }, [faculty, overall.filters]);

  const filteredPrograms = React.useMemo(
    () =>
      overall.filters.programs.filter(
        (p) =>
          (faculty.length === 0 || faculty.includes(p.facultyName)) &&
          (level.length === 0 || level.includes(p.programLevel)),
      ),
    [faculty, level, overall.filters],
  );

  const anyFilter =
    faculty.length > 0 ||
    level.length > 0 ||
    program.length > 0 ||
    regions.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter rail ─────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={overall.filters.faculties.map((f) => ({
              value: f,
              label: f,
            }))}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              setLevel([]);
              setProgram([]);
              apply({ facultyName: vs, programLevel: [], programName: [] });
            }}
          />
          <MultiSelectField
            label="Program level"
            options={filteredLevels.map((l) => ({ value: l, label: l }))}
            selected={level}
            onChange={(vs) => {
              setLevel(vs);
              setProgram([]);
              apply({ programLevel: vs, programName: [] });
            }}
            disabled={filteredLevels.length === 0}
            preserveOrder
          />
          <MultiSelectField
            label="Program"
            options={filteredPrograms.map((p) => ({
              value: p.programName,
              label: p.programName,
              hint: p.programLevel,
            }))}
            selected={program}
            onChange={(vs) => {
              setProgram(vs);
              apply({ programName: vs });
            }}
            disabled={filteredPrograms.length === 0}
          />
          <MultiSelectField
            label="School region"
            options={REGION_ORDER.map((r) => ({
              value: r,
              label: REGION_LABELS[r].en,
              hint: REGION_LABELS[r].th,
            }))}
            selected={regions as string[]}
            onChange={(vs) => {
              setRegions(vs as ThailandRegion[]);
              apply({ region: vs as ThailandRegion[] });
            }}
            preserveOrder
          />
          {anyFilter && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setLevel([]);
                setProgram([]);
                setRegions([]);
                router.push('/education/performance');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            {fmtCount(overall.totalStudents)} undergraduate students matching
          </span>
        </div>
      </Card>

      {/* ── Overall KPI strip ───────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Students" value={fmtCount(overall.totalStudents)} />
        <KpiTile
          label="Average GPA"
          value={fmtGpa(overall.averageGpa)}
          subtitle="current cumulative"
        />
        <KpiTile
          label="Average Entry GPA"
          value={fmtGpa(overall.averageEntryGpa)}
          subtitle="at admission"
        />
        <KpiTile
          label="Average English GPA"
          value={fmtGpa(overall.averageEnglishGpa)}
          subtitle="from VIEW_STUDENT_DETAIL"
        />
        <KpiTile label="Faculties" value={fmtCount(overall.facultyCount)} />
        <KpiTile label="Programs" value={fmtCount(overall.programCount)} />
      </div>

      {/* ── By Faculty → Program ───────────────────────────────── */}
      {byProgram && (
        <Card>
          <h3 className="text-sm font-semibold">
            Average GPA — Faculty → Program drill-down
          </h3>
          <p className="mt-1 mb-3 text-xs text-text-tertiary">
            Click a faculty row to expand its programs. Entry GPA is the GPA
            on file at admission; current GPA is the cumulative GPA observed
            today.
          </p>
          <ProgramPerformanceTable rows={byProgram.rows} totals={byProgram.totals} />
        </Card>
      )}

      {/* ── By Region → Province → School → Faculty → Program ─── */}
      {byLocation && (
        <Card>
          <h3 className="text-sm font-semibold">
            Average GPA — Region → Province → School → Faculty → Program
            drill-down
          </h3>
          <p className="mt-1 mb-3 text-xs text-text-tertiary">
            Track how cohorts from each origin school perform once enrolled.
            Click any row to drill in.
          </p>
          <LocationPerformanceTable
            rows={byLocation.rows}
            totals={byLocation.totals}
          />
        </Card>
      )}

      {/* ── Entry test score pivot ─────────────────────────────── */}
      {entryScores && entryScores.subjects.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold">
            Entry test scores — Faculty → Program × Subject
          </h3>
          <p className="mt-1 mb-3 text-xs text-text-tertiary">
            Average score per subject. Click a faculty row to drill into its
            programs.
          </p>
          <EntryScoreTable data={entryScores} />
        </Card>
      )}
      {entryScores && entryScores.subjects.length === 0 && (
        <Card>
          <h3 className="text-sm font-semibold">Entry test scores</h3>
          <p className="mt-2 text-xs text-text-tertiary">
            No entry-score data on file yet — the next refresh will populate
            this once the score view is reachable.
          </p>
        </Card>
      )}
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
      <div className="mt-1 font-tabular text-2xl font-semibold">{value}</div>
      {subtitle && (
        <div className="mt-0.5 text-[0.7rem] text-text-tertiary">
          {subtitle}
        </div>
      )}
    </Card>
  );
}

// Generic per-table sort state used by the three performance pivots.
type SortKey = string;
type SortDir = 'asc' | 'desc';
interface SortState {
  key: SortKey;
  dir: SortDir;
}
function useSortState() {
  const [sort, setSort] = React.useState<SortState | null>(null);
  const cycle = (key: SortKey) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'desc' };
      if (s.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };
  return [sort, cycle] as const;
}

function PerfSortHeader({
  label,
  sortKey,
  active,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortState | null;
  onClick: (k: SortKey) => void;
}) {
  const isActive = !!(active && active.key === sortKey);
  const arrow = isActive ? (active!.dir === 'asc' ? '▲' : '▼') : '';
  return (
    <th className="px-3 py-2 text-right font-medium font-tabular">
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

const sortNullable = (
  a: number | null,
  b: number | null,
  dir: SortDir,
): number => {
  // null sorts to the end regardless of direction (natural "no data
  // last" behaviour analysts expect).
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'desc' ? b - a : a - b;
};

// ── Program drill-down (Faculty → Program) ────────────────────────────

function ProgramPerformanceTable({
  rows,
  totals,
}: {
  rows: PerformanceByProgramResponse['rows'];
  totals: PerformanceByProgramResponse['totals'];
}) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const [sort, cycle] = useSortState();
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const valueOf = (
      r: { studentCount: number; averageEntryGpa: number | null; averageGpa: number | null },
    ) =>
      sort.key === 'studentCount'
        ? r.studentCount
        : sort.key === 'averageEntryGpa'
          ? r.averageEntryGpa
          : r.averageGpa;
    return [...rows]
      .map((f) => ({
        ...f,
        children: [...f.children].sort((a, b) =>
          sortNullable(valueOf(a), valueOf(b), sort.dir),
        ),
      }))
      .sort((a, b) => sortNullable(valueOf(a), valueOf(b), sort.dir));
  }, [rows, sort]);
  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-medium">
              Faculty / Program
            </th>
            <PerfSortHeader
              label="Students"
              sortKey="studentCount"
              active={sort}
              onClick={cycle}
            />
            <PerfSortHeader
              label="Entry GPA"
              sortKey="averageEntryGpa"
              active={sort}
              onClick={cycle}
            />
            <PerfSortHeader
              label="Current GPA"
              sortKey="averageGpa"
              active={sort}
              onClick={cycle}
            />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((f) => {
            const isOpen = open.has(f.facultyName);
            return (
              <React.Fragment key={f.facultyName}>
                <tr className="border-t border-border-subtle bg-surface-1 hover:bg-surface-2">
                  <td className="sticky left-0 bg-inherit px-3 py-1.5 font-semibold">
                    <button
                      onClick={() => toggle(f.facultyName)}
                      className="flex w-full items-center gap-1.5 text-left"
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 transition-transform ${
                          isOpen ? 'rotate-90' : ''
                        }`}
                      />
                      <span>{f.facultyName}</span>
                    </button>
                  </td>
                  <td
                    className="px-3 py-1.5 text-right font-tabular font-semibold"
                    title={fmtCount(f.studentCount)}
                  >
                    {fmtCount(f.studentCount)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-tabular font-semibold">
                    {fmtGpa(f.averageEntryGpa)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-tabular font-semibold">
                    {fmtGpa(f.averageGpa)}
                  </td>
                </tr>
                {isOpen &&
                  f.children.map((p) => (
                    <tr
                      key={`${f.facultyName}|${p.programName}`}
                      className="border-t border-border-subtle"
                    >
                      <td className="sticky left-0 bg-surface-0 px-3 py-1.5 text-xs text-text-secondary">
                        <div className="flex items-center gap-1.5">
                          <span style={{ marginLeft: '24px' }} />
                          <span>{p.programName}</span>
                        </div>
                      </td>
                      <td
                        className="px-3 py-1.5 text-right font-tabular text-xs text-text-tertiary"
                        title={fmtCount(p.studentCount)}
                      >
                        {fmtCount(p.studentCount)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-tabular text-xs text-text-tertiary">
                        {fmtGpa(p.averageEntryGpa)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-tabular text-xs text-text-tertiary">
                        {fmtGpa(p.averageGpa)}
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
            <td className="px-3 py-2 text-right font-tabular">
              {fmtCount(totals.studentCount)}
            </td>
            <td className="px-3 py-2 text-right font-tabular">
              {fmtGpa(totals.averageEntryGpa)}
            </td>
            <td className="px-3 py-2 text-right font-tabular">
              {fmtGpa(totals.averageGpa)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Region → Province → School → Faculty → Program drill-down ─────────

function LocationPerformanceTable({
  rows,
  totals,
}: {
  rows: PerformanceByLocationResponse['rows'];
  totals: PerformanceByLocationResponse['totals'];
}) {
  const [openKeys, setOpenKeys] = React.useState<Set<string>>(() => new Set());
  const [sort, cycle] = useSortState();
  const isOpen = (k: string) => openKeys.has(k);
  const toggle = (k: string) =>
    setOpenKeys((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // Recursive sort applied at every level of the Region → Province →
  // School → Faculty → Program tree by the same key. Server-side
  // ordering (Thai-aware) is preserved when no sort is active.
  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const valueOf = (r: {
      studentCount: number;
      averageEntryGpa: number | null;
      averageGpa: number | null;
    }) =>
      sort.key === 'studentCount'
        ? r.studentCount
        : sort.key === 'averageEntryGpa'
          ? r.averageEntryGpa
          : r.averageGpa;
    const sortArr = <T extends { studentCount: number; averageEntryGpa: number | null; averageGpa: number | null }>(arr: T[]) =>
      [...arr].sort((a, b) => sortNullable(valueOf(a), valueOf(b), sort.dir));
    return sortArr(
      rows.map((region) => ({
        ...region,
        children: sortArr(
          region.children.map((province) => ({
            ...province,
            children: sortArr(
              province.children.map((school) => ({
                ...school,
                children: sortArr(
                  school.children.map((faculty) => ({
                    ...faculty,
                    children: sortArr(faculty.children),
                  })),
                ),
              })),
            ),
          })),
        ),
      })),
    );
  }, [rows, sort]);

  // depth → indent px (0=region, 1=province, 2=school, 3=faculty, 4=program)
  const indentPx = (depth: number) =>
    depth === 0 ? 0 : depth === 1 ? 24 : depth === 2 ? 48 : depth === 3 ? 72 : 96;

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-medium">
              Region / Province / School / Faculty / Program
            </th>
            <PerfSortHeader
              label="Students"
              sortKey="studentCount"
              active={sort}
              onClick={cycle}
            />
            <PerfSortHeader
              label="Entry GPA"
              sortKey="averageEntryGpa"
              active={sort}
              onClick={cycle}
            />
            <PerfSortHeader
              label="Current GPA"
              sortKey="averageGpa"
              active={sort}
              onClick={cycle}
            />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((region) => {
            const rKey = `r|${region.region}`;
            const rOpen = isOpen(rKey);
            return (
              <React.Fragment key={rKey}>
                <Row
                  bg="bg-surface-1"
                  font="font-semibold"
                  depth={0}
                  expandable
                  open={rOpen}
                  onClick={() => toggle(rKey)}
                  label={region.label}
                  studentCount={region.studentCount}
                  entry={region.averageEntryGpa}
                  current={region.averageGpa}
                  indentPx={indentPx}
                />
                {rOpen &&
                  region.children.map((province) => {
                    const pKey = `${rKey}|${province.provinceName}`;
                    const pOpen = isOpen(pKey);
                    return (
                      <React.Fragment key={pKey}>
                        <Row
                          bg=""
                          font=""
                          depth={1}
                          expandable
                          open={pOpen}
                          onClick={() => toggle(pKey)}
                          label={province.provinceName}
                          studentCount={province.studentCount}
                          entry={province.averageEntryGpa}
                          current={province.averageGpa}
                          indentPx={indentPx}
                          tone="text-text-secondary"
                        />
                        {pOpen &&
                          province.children.map((school) => {
                            const sKey = `${pKey}|${school.schoolName}`;
                            const sOpen = isOpen(sKey);
                            return (
                              <React.Fragment key={sKey}>
                                <Row
                                  bg=""
                                  font=""
                                  depth={2}
                                  expandable
                                  open={sOpen}
                                  onClick={() => toggle(sKey)}
                                  label={school.schoolName}
                                  studentCount={school.studentCount}
                                  entry={school.averageEntryGpa}
                                  current={school.averageGpa}
                                  indentPx={indentPx}
                                  tone="text-text-secondary"
                                />
                                {sOpen &&
                                  school.children.map((faculty) => {
                                    const fKey = `${sKey}|${faculty.facultyName}`;
                                    const fOpen = isOpen(fKey);
                                    return (
                                      <React.Fragment key={fKey}>
                                        <Row
                                          bg=""
                                          font=""
                                          depth={3}
                                          expandable
                                          open={fOpen}
                                          onClick={() => toggle(fKey)}
                                          label={faculty.facultyName}
                                          studentCount={faculty.studentCount}
                                          entry={faculty.averageEntryGpa}
                                          current={faculty.averageGpa}
                                          indentPx={indentPx}
                                          tone="text-text-tertiary"
                                        />
                                        {fOpen &&
                                          faculty.children.map((prog) => (
                                            <Row
                                              key={`${fKey}|${prog.programName}`}
                                              bg=""
                                              font=""
                                              depth={4}
                                              expandable={false}
                                              label={prog.programName}
                                              studentCount={prog.studentCount}
                                              entry={prog.averageEntryGpa}
                                              current={prog.averageGpa}
                                              indentPx={indentPx}
                                              tone="text-text-tertiary"
                                              size="text-xs"
                                            />
                                          ))}
                                      </React.Fragment>
                                    );
                                  })}
                              </React.Fragment>
                            );
                          })}
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
            <td className="px-3 py-2 text-right font-tabular">
              {fmtCount(totals.studentCount)}
            </td>
            <td className="px-3 py-2 text-right font-tabular">
              {fmtGpa(totals.averageEntryGpa)}
            </td>
            <td className="px-3 py-2 text-right font-tabular">
              {fmtGpa(totals.averageGpa)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface RowProps {
  bg: string;
  font: string;
  depth: number;
  expandable: boolean;
  open?: boolean;
  onClick?: () => void;
  label: string;
  studentCount: number;
  entry: number | null;
  current: number | null;
  indentPx: (d: number) => number;
  tone?: string;
  size?: string;
}

function Row({
  bg,
  font,
  depth,
  expandable,
  open,
  onClick,
  label,
  studentCount,
  entry,
  current,
  indentPx,
  tone,
  size,
}: RowProps) {
  return (
    <tr className={`border-t border-border-subtle ${bg}`}>
      <td className={`sticky left-0 bg-inherit px-3 py-1.5 ${font} ${size ?? ''} ${tone ?? ''}`}>
        {expandable ? (
          <button
            onClick={onClick}
            className="flex w-full items-center gap-1.5 text-left"
          >
            <span
              style={{ paddingLeft: `${indentPx(depth)}px` }}
              className="flex shrink-0 items-center"
              aria-hidden
            >
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
                <ChevronRight
                  className={`h-3.5 w-3.5 transition-transform ${
                    open ? 'rotate-90' : ''
                  }`}
                />
              </span>
            </span>
            <span>{label}</span>
          </button>
        ) : (
          <div className="flex w-full items-center gap-1.5">
            <span
              style={{ paddingLeft: `${indentPx(depth)}px` }}
              className="flex shrink-0 items-center"
              aria-hidden
            >
              <span className="inline-flex h-3.5 w-3.5" />
            </span>
            <span>{label}</span>
          </div>
        )}
      </td>
      <td
        className={`px-3 py-1.5 text-right font-tabular ${font} ${size ?? ''} ${tone ?? ''}`}
        title={fmtCount(studentCount)}
      >
        {fmtCount(studentCount)}
      </td>
      <td
        className={`px-3 py-1.5 text-right font-tabular ${font} ${size ?? ''} ${tone ?? ''}`}
      >
        {fmtGpa(entry)}
      </td>
      <td
        className={`px-3 py-1.5 text-right font-tabular ${font} ${size ?? ''} ${tone ?? ''}`}
      >
        {fmtGpa(current)}
      </td>
    </tr>
  );
}

// ── Entry test score pivot (Faculty → Program × Subject) ──────────────

function EntryScoreTable({ data }: { data: EntryScoreResponse }) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const [sort, cycle] = useSortState();
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const valueOf = (
    r: { studentCount: number; cells: Record<string, number> },
  ): number | null => {
    if (sort?.key === 'studentCount') return r.studentCount;
    if (!sort) return null;
    const v = r.cells[sort.key];
    return v === undefined ? null : v;
  };

  const sortedRows = React.useMemo(() => {
    if (!sort) return data.rows;
    return [...data.rows]
      .map((f) => ({
        ...f,
        children: [...f.children].sort((a, b) =>
          sortNullable(valueOf(a), valueOf(b), sort.dir),
        ),
      }))
      .sort((a, b) => sortNullable(valueOf(a), valueOf(b), sort.dir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rows, sort]);
  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-medium">
              Faculty / Program
            </th>
            <PerfSortHeader
              label="Students"
              sortKey="studentCount"
              active={sort}
              onClick={cycle}
            />
            {data.subjects.map((s) => (
              <PerfSortHeader
                key={s.subjectCode}
                label={s.subjectCode}
                sortKey={s.subjectCode}
                active={sort}
                onClick={cycle}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((f) => {
            const isOpen = open.has(f.facultyName);
            return (
              <React.Fragment key={f.facultyName}>
                <tr className="border-t border-border-subtle bg-surface-1 hover:bg-surface-2">
                  <td className="sticky left-0 bg-inherit px-3 py-1.5 font-semibold">
                    <button
                      onClick={() => toggle(f.facultyName)}
                      className="flex w-full items-center gap-1.5 text-left"
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 transition-transform ${
                          isOpen ? 'rotate-90' : ''
                        }`}
                      />
                      <span>{f.facultyName}</span>
                    </button>
                  </td>
                  <td
                    className="px-3 py-1.5 text-right font-tabular font-semibold"
                    title={fmtCount(f.studentCount)}
                  >
                    {fmtCount(f.studentCount)}
                  </td>
                  {data.subjects.map((s) => {
                    const v = f.cells[s.subjectCode];
                    return (
                      <td
                        key={s.subjectCode}
                        className="px-3 py-1.5 text-right font-tabular font-semibold"
                        title={
                          v === undefined ? undefined : v.toLocaleString('en-US')
                        }
                      >
                        {v === undefined ? '·' : fmtScore(v)}
                      </td>
                    );
                  })}
                </tr>
                {isOpen &&
                  f.children.map((p) => (
                    <tr
                      key={`${f.facultyName}|${p.programName}`}
                      className="border-t border-border-subtle"
                    >
                      <td className="sticky left-0 bg-surface-0 px-3 py-1.5 text-xs text-text-secondary">
                        <div className="flex items-center gap-1.5">
                          <span style={{ marginLeft: '24px' }} />
                          <span>{p.programName}</span>
                        </div>
                      </td>
                      <td
                        className="px-3 py-1.5 text-right font-tabular text-xs text-text-tertiary"
                        title={fmtCount(p.studentCount)}
                      >
                        {fmtCount(p.studentCount)}
                      </td>
                      {data.subjects.map((s) => {
                        const v = p.cells[s.subjectCode];
                        return (
                          <td
                            key={s.subjectCode}
                            className="px-3 py-1.5 text-right font-tabular text-xs text-text-tertiary"
                            title={
                              v === undefined
                                ? undefined
                                : v.toLocaleString('en-US')
                            }
                          >
                            {v === undefined ? '·' : fmtScore(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
          <tr className="border-t-2 border-border-strong bg-surface-2 font-semibold">
            <td className="sticky left-0 bg-surface-2 px-3 py-2">
              Grand total
            </td>
            <td className="px-3 py-2 text-right font-tabular">
              {fmtCount(data.totals.studentCount)}
            </td>
            {data.subjects.map((s) => {
              const v = data.totals.cells[s.subjectCode];
              return (
                <td
                  key={s.subjectCode}
                  className="px-3 py-2 text-right font-tabular"
                  title={v === undefined ? undefined : v.toLocaleString('en-US')}
                >
                  {v === undefined ? '·' : fmtScore(v)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
