'use client';

// /education/satisfaction — Student-evaluation dashboard.
//
// Course-aggregated only (no per-instructor names). Per-instructor data
// lives on /staff/teaching with tiered visibility. Sections:
//   - KPI strip (overall mean rating, respondents, courses, instructors)
//   - Trend chart (window-wide rating per (year × sem))
//   - Faculty → Program Level → Program → Course pivot table with year
//     columns, semester filter, and per-course hover tooltip showing
//     the question-by-question breakdown.
//
// Heatmap palette is narrowed to [3.5, 5.0] because raw scores are
// ceiling-biased (87% ≥ 4.0). A full [0, 5] palette would make almost
// every cell look identical green; the narrow palette gives visual
// differentiation in the bulk of the data.

import * as React from 'react';
import { Card, useSortableTable, SortableTh } from '@kku/ui';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, X } from 'lucide-react';
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

interface OverallResult {
  methodologyVersion: string;
  ratingAvg: number | null;
  totalRespondents: number;
  cellCount: number;
  courseCount: number;
  instructorCount: number;
  questionCount: number;
  bucketCount: number;
  ratingMin: number | null;
  ratingMax: number | null;
  freshness: string | null;
}

interface CourseCell {
  ratingAvg: number;
  respondentCount: number;
  cellCount: number;
  instructorCount: number;
}

interface ProgramCourseRow {
  facultyId: string;
  facultyName: string;
  programLevel: string;
  programId: string;
  programName: string;
  courseCode: string;
  courseName: string | null;
  overall: CourseCell;
  byYear: Record<string, CourseCell>;
  yearsObserved: number[];
}

interface ByProgramResult {
  methodologyVersion: string;
  rows: ProgramCourseRow[];
  yearsObserved: number[];
}

interface TrendPoint {
  acadYearBE: number;
  semester: number;
  label: string;
  ratingAvg: number | null;
  respondentCount: number;
  cellCount: number;
  courseCount: number;
}

interface TrendResult {
  methodologyVersion: string;
  points: TrendPoint[];
}

interface CourseQuestionDetail {
  questionId: string;
  questionIdRegistrar: string;
  questionTextTh: string;
  questionTextEn: string | null;
  questionTextEnOverride: string | null;
  themeTag: string | null;
  ratingAvg: number;
  respondentCount: number;
  cellCount: number;
}

interface CourseQuestionsResult {
  methodologyVersion: string;
  courseCode: string;
  programId: string | null;
  questions: CourseQuestionDetail[];
  overall: { ratingAvg: number; respondentCount: number; cellCount: number };
}

interface CourseDetailResult {
  methodologyVersion: string;
  programId: string;
  courseCode: string;
  summary: {
    ratingAvg: number;
    totalRespondents: number;
    cellCount: number;
    courseSectionCount: number;
    classCount: number;
    instructorCount: number;
    questionCount: number;
    semestersObserved: number;
    yearsObserved: number[];
  };
  trend: TrendPoint[];
  byQuestion: Array<
    CourseQuestionDetail & {
      byYear: Record<string, { ratingAvg: number; respondentCount: number }>;
    }
  >;
}

interface Props {
  overall: OverallResult | null;
  trend: TrendResult | null;
  byProgramInitial: ByProgramResult | null;
  facultyNameFilter: string[];
}

const fmt = (n: number): string => n.toLocaleString('en-US');
const fmtRating = (n: number | null): string => (n === null ? '—' : n.toFixed(2));

const SEM_OPTIONS = [
  { value: 1, label: 'Sem 1' },
  { value: 2, label: 'Sem 2' },
  { value: 3, label: 'Summer (3)' },
  { value: 4, label: 'Intersession (4)' },
] as const;

// Heat: narrow palette [3.0, 5.0] mapped across the hue arc.
function ratingHeat(rating: number | null): string {
  if (rating === null) return 'transparent';
  const clamp = Math.max(3.0, Math.min(5, rating));
  let hue: number;
  if (clamp <= 3.75) hue = 25 + ((60 - 25) * (clamp - 3.0)) / 0.75;
  else if (clamp <= 4.5) hue = 60 + ((130 - 60) * (clamp - 3.75)) / 0.75;
  else hue = 130 + ((145 - 130) * (clamp - 4.5)) / 0.5;
  return `oklch(0.86 0.10 ${hue.toFixed(0)})`;
}

const LEVEL_LABELS: Record<string, string> = {
  BACHELOR: 'Bachelor’s degree',
  MASTER: 'Master’s degree',
  DOCTORAL: 'Doctoral degree',
  HIGHER_GRAD_DIPLOMA: 'Higher graduate diploma',
};
const LEVEL_LABELS_TH: Record<string, string> = {
  BACHELOR: 'ปริญญาตรี',
  MASTER: 'ปริญญาโท',
  DOCTORAL: 'ปริญญาเอก',
  HIGHER_GRAD_DIPLOMA: 'ประกาศนียบัตรบัณฑิตชั้นสูง',
};
const LEVEL_ORDER: Record<string, number> = {
  BACHELOR: 1,
  HIGHER_GRAD_DIPLOMA: 2,
  MASTER: 3,
  DOCTORAL: 4,
};

// Buddhist Era → Common Era for the humanised year column.
const beToCe = (be: number): number => be - 543;

// Pluralise English count phrasing.
const pl = (n: number, word: string): string => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

const THEME_LABELS: Record<string, string> = {
  'active-learning': 'Active learning',
  ethics: 'Ethics',
  assessment: 'Assessment',
  feedback: 'Feedback / Q&A',
  'content-design': 'Content & design',
  'english-skills': 'English skills',
};

// ── Lazy hover-tooltip for per-cell question detail ────────────────────
//
// Every rating cell in the pivot — faculty/level/program/course rows
// crossed with Overall/year columns — opens a tooltip showing the
// per-question score breakdown for THAT cell's scope. The fetch is
// deferred 250ms (so hover-flicking doesn't spam the API), responses
// are cached by `cacheKey(scope, qs)`, and concurrent hovers on the
// same key share one promise.

interface CellScope {
  facultyId?: string;
  programLevel?: string;
  programId?: string;
  courseCode?: string;
  acadYearBE?: number;
}

interface CellQuestionsResult {
  methodologyVersion: string;
  scope: CellScope;
  questions: CourseQuestionDetail[];
  overall: { ratingAvg: number; respondentCount: number; cellCount: number };
}

const questionsCache = new Map<string, CellQuestionsResult>();
const inflight = new Map<string, Promise<CellQuestionsResult | null>>();

function scopeKey(scope: CellScope, qs: string): string {
  return [
    scope.facultyId ?? '',
    scope.programLevel ?? '',
    scope.programId ?? '',
    scope.courseCode ?? '',
    scope.acadYearBE ?? '',
    qs,
  ].join('|');
}

function buildScopeQs(scope: CellScope): string {
  const out = new URLSearchParams();
  if (scope.facultyId) out.set('facultyId', scope.facultyId);
  if (scope.programLevel) out.set('programLevel', scope.programLevel);
  if (scope.programId) out.set('programId', scope.programId);
  if (scope.courseCode) out.set('courseCode', scope.courseCode);
  if (scope.acadYearBE !== undefined)
    out.set('acadYearBE', String(scope.acadYearBE));
  return out.toString();
}

async function fetchCellQuestions(
  scope: CellScope,
  qs: string,
): Promise<CellQuestionsResult | null> {
  const key = scopeKey(scope, qs);
  const cached = questionsCache.get(key);
  if (cached) return cached;
  const ongoing = inflight.get(key);
  if (ongoing) return ongoing;
  const p = (async (): Promise<CellQuestionsResult | null> => {
    const scopeQs = buildScopeQs(scope);
    const url = `/api/proxy/education/satisfaction/course-questions?${qs}${scopeQs ? `&${scopeQs}` : ''}`;
    try {
      const res = await fetch(url);
      const payload = (await res.json()) as { data: CellQuestionsResult | null };
      if (payload.data) {
        questionsCache.set(key, payload.data);
        return payload.data;
      }
      return null;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Tooltip content — renders the per-question table for any scope.
function CellTooltipContent({
  scope,
  qs,
  scopeLabel,
}: {
  scope: CellScope;
  qs: string;
  scopeLabel: string;
}): React.ReactNode {
  const [data, setData] = React.useState<CellQuestionsResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCellQuestions(scope, qs).then((r) => {
      if (cancelled) return;
      setData(r);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // scope is rebuilt every render but its stringified form is stable —
    // depend on the key explicitly so React doesn't re-fetch on every
    // render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey(scope, qs)]);

  if (loading) {
    return <div className="p-3 text-xs text-text-tertiary">Loading question detail…</div>;
  }
  if (!data || data.questions.length === 0) {
    return (
      <div className="p-3 text-xs text-text-tertiary">
        No per-question detail available in window.
      </div>
    );
  }
  return (
    <div className="p-2 text-xs">
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-border-subtle pb-1">
        <div className="font-medium text-text-primary">{scopeLabel}</div>
        <div className="text-text-tertiary">
          overall{' '}
          <span className="font-medium text-text-primary">
            {fmtRating(data.overall.ratingAvg)}
          </span>
          {' · '}
          n={fmt(data.overall.respondentCount)}
        </div>
      </div>
      <table className="w-full">
        <tbody>
          {data.questions
            .slice()
            .sort((a, b) => a.ratingAvg - b.ratingAvg)
            .map((q) => {
              const enText = q.questionTextEnOverride ?? q.questionTextEn;
              return (
                <tr
                  key={q.questionIdRegistrar}
                  className="border-b border-border-subtle/60 last:border-0"
                >
                  <td className="py-1 pr-2 font-mono text-[10px] text-text-tertiary align-top">
                    {q.questionIdRegistrar}
                  </td>
                  <td className="py-1 pr-2 align-top">
                    <div className="text-text-primary">{enText ?? q.questionTextTh}</div>
                    {q.themeTag && (
                      <div className="text-[10px] text-text-tertiary">
                        {THEME_LABELS[q.themeTag] ?? q.themeTag}
                      </div>
                    )}
                  </td>
                  <td
                    className="py-1 pr-1 text-right align-top font-mono"
                    style={{ backgroundColor: ratingHeat(q.ratingAvg) }}
                  >
                    {fmtRating(q.ratingAvg)}
                  </td>
                  <td className="py-1 pl-2 text-right text-text-tertiary align-top">
                    n={fmt(q.respondentCount)}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

// ── <RatingCell> ───────────────────────────────────────────────────────
// Wraps a <td> rating cell with the hover-tooltip behaviour. The scope
// + scopeLabel describe what the tooltip should aggregate.
//
// `align` defaults to 'right' (numeric column convention).
function RatingCell({
  rating,
  scope,
  qs,
  scopeLabel,
  className,
  rightAlign = true,
  paddingClass = 'px-2 py-2',
  showN,
  onClick,
}: {
  rating: number | null;
  scope: CellScope;
  qs: string;
  scopeLabel: string;
  className?: string;
  rightAlign?: boolean;
  paddingClass?: string;
  showN?: number;
  onClick?: (e: React.MouseEvent) => void;
}): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEnter = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), 250);
  };
  const handleLeave = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(false), 100);
  };
  return (
    <td
      className={
        'relative ' +
        paddingClass +
        ' ' +
        (rightAlign ? 'text-right' : '') +
        ' ' +
        (className ?? '')
      }
      style={{ backgroundColor: ratingHeat(rating) }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={onClick}
    >
      {fmtRating(rating)}
      {showN !== undefined && (
        <span className="ml-1 text-[10px] text-text-tertiary">n={fmt(showN)}</span>
      )}
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-[640px] max-w-[90vw] rounded-md border border-border-subtle bg-surface-1 text-left shadow-lg"
          style={{ backgroundColor: 'oklch(var(--color-surface-1))' }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <CellTooltipContent scope={scope} qs={qs} scopeLabel={scopeLabel} />
        </div>
      )}
    </td>
  );
}

// Course-name cell — a plain `<td>` (NOT a `<RatingCell>`) that, when
// clicked, opens the course-detail panel below the table. The hover
// tooltip on the actual Overall/year cells provides the per-question
// detail; the course name itself just shows code + name + click cursor.
function CourseNameCell({
  courseCode,
  courseName,
  onClick,
  isSelected,
}: {
  courseCode: string;
  courseName: string | null;
  onClick: () => void;
  isSelected: boolean;
}): React.ReactNode {
  return (
    <td
      className={
        'cursor-pointer py-1.5 pl-20 text-xs hover:bg-surface-2 ' +
        (isSelected ? 'bg-accent-subtle' : '')
      }
      onClick={onClick}
    >
      <span className="font-mono text-xs text-text-secondary">{courseCode}</span>
      {courseName && <span className="ml-1 text-xs text-text-primary">{courseName}</span>}
    </td>
  );
}

// ── Main section ───────────────────────────────────────────────────────

export function SatisfactionSection({
  overall,
  trend,
  byProgramInitial,
  facultyNameFilter,
}: Props) {
  const [selectedSemesters, setSelectedSemesters] = React.useState<number[]>([1, 2]);
  const [byProgram, setByProgram] = React.useState<ByProgramResult | null>(byProgramInitial);
  const [tableLoading, setTableLoading] = React.useState(false);

  // Build a shared qs string for the tooltip endpoint so it inherits the
  // page's filter window.
  const tooltipQs = React.useMemo(() => {
    const qs = new URLSearchParams();
    facultyNameFilter.forEach((f) => qs.append('facultyName', f));
    selectedSemesters.forEach((s) => qs.append('semester', String(s)));
    return qs.toString();
  }, [facultyNameFilter, selectedSemesters]);

  const refetchByProgram = React.useCallback(
    async (semesters: number[]) => {
      setTableLoading(true);
      try {
        const qs = new URLSearchParams();
        facultyNameFilter.forEach((f) => qs.append('facultyName', f));
        semesters.forEach((s) => qs.append('semester', String(s)));
        const res = await fetch(`/api/proxy/education/satisfaction/by-program?${qs}`);
        const payload = (await res.json()) as { data: ByProgramResult | null };
        if (payload.data) setByProgram(payload.data);
        // Clear the per-cell tooltip cache — filter window changed.
        questionsCache.clear();
      } finally {
        setTableLoading(false);
      }
    },
    [facultyNameFilter],
  );

  const toggleSem = (sem: number): void => {
    setSelectedSemesters((prev) => {
      const next = prev.includes(sem) ? prev.filter((s) => s !== sem) : [...prev, sem].sort();
      if (next.length === 0) return prev;
      void refetchByProgram(next);
      return next;
    });
  };

  // ── KPI strip ─────────────────────────────────────────────────────────
  const kpis = overall ? (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Average rating</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">
          {fmtRating(overall.ratingAvg)}
        </div>
        <div className="text-xs text-text-tertiary">out of 5</div>
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Students who responded</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">
          {fmt(overall.totalRespondents)}
        </div>
        <div className="text-xs text-text-tertiary">in this window</div>
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Anonymous cells</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">{fmt(overall.cellCount)}</div>
        <div className="text-xs text-text-tertiary">≥ 5 respondents each</div>
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Courses evaluated</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">{fmt(overall.courseCount)}</div>
        <div className="text-xs text-text-tertiary">unique course codes</div>
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Teachers rated</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">
          {fmt(overall.instructorCount)}
        </div>
        <div className="text-xs text-text-tertiary">across all courses</div>
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Questions asked</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">
          {fmt(overall.questionCount)}
        </div>
        <div className="text-xs text-text-tertiary">
          over {pl(overall.bucketCount, 'semester')}
        </div>
      </Card>
    </div>
  ) : null;

  // ── Trend chart ───────────────────────────────────────────────────────
  const trendData = (trend?.points ?? []).map((p) => ({
    label: p.label,
    rating: p.ratingAvg,
    respondents: p.respondentCount,
    courses: p.courseCount,
  }));

  // ── 4-level nested pivot — Faculty → Level → Program → Course ────────
  const yearCols = byProgram?.yearsObserved ?? [];

  type ProgramAgg = {
    programId: string;
    programName: string;
    courses: ProgramCourseRow[];
  };
  type LevelAgg = {
    level: string;
    programs: ProgramAgg[];
  };
  type FacultyAgg = {
    facultyId: string;
    facultyName: string;
    levels: LevelAgg[];
  };

  const facultyTree = React.useMemo<FacultyAgg[]>(() => {
    if (!byProgram) return [];
    // Group: facultyId → level → programId → courses[]
    const fmap = new Map<string, { name: string; lmap: Map<string, Map<string, { name: string; courses: ProgramCourseRow[] }>> }>();
    for (const r of byProgram.rows) {
      let fac = fmap.get(r.facultyId);
      if (!fac) {
        fac = { name: r.facultyName, lmap: new Map() };
        fmap.set(r.facultyId, fac);
      }
      let lmap = fac.lmap.get(r.programLevel);
      if (!lmap) {
        lmap = new Map();
        fac.lmap.set(r.programLevel, lmap);
      }
      let prog = lmap.get(r.programId);
      if (!prog) {
        prog = { name: r.programName, courses: [] };
        lmap.set(r.programId, prog);
      }
      prog.courses.push(r);
    }
    // Materialise as ordered arrays.
    const out: FacultyAgg[] = [];
    for (const [fid, fac] of fmap.entries()) {
      const levels: LevelAgg[] = [];
      for (const [lvl, pmap] of fac.lmap.entries()) {
        const programs: ProgramAgg[] = [];
        for (const [pid, prog] of pmap.entries()) {
          programs.push({
            programId: pid,
            programName: prog.name,
            courses: prog.courses
              .slice()
              .sort((a, b) => a.courseCode.localeCompare(b.courseCode)),
          });
        }
        programs.sort((a, b) => a.programName.localeCompare(b.programName));
        levels.push({ level: lvl, programs });
      }
      levels.sort((a, b) => (LEVEL_ORDER[a.level] ?? 99) - (LEVEL_ORDER[b.level] ?? 99));
      out.push({ facultyId: fid, facultyName: fac.name, levels });
    }
    out.sort((a, b) => a.facultyName.localeCompare(b.facultyName));
    return out;
  }, [byProgram]);

  // Helpers to roll-up a set of rows to a single cell (weighted by n).
  const rollup = (rows: ProgramCourseRow[]): { overall: number | null; byYear: Record<string, number | null>; totalN: number } => {
    let sumW = 0;
    let sumN = 0;
    const byYearAcc = new Map<string, { sumW: number; sumN: number }>();
    for (const r of rows) {
      sumW += r.overall.ratingAvg * r.overall.respondentCount;
      sumN += r.overall.respondentCount;
      for (const [y, cell] of Object.entries(r.byYear)) {
        let yEntry = byYearAcc.get(y);
        if (!yEntry) {
          yEntry = { sumW: 0, sumN: 0 };
          byYearAcc.set(y, yEntry);
        }
        yEntry.sumW += cell.ratingAvg * cell.respondentCount;
        yEntry.sumN += cell.respondentCount;
      }
    }
    const byYear: Record<string, number | null> = {};
    for (const [y, yEntry] of byYearAcc.entries()) {
      byYear[y] = yEntry.sumN > 0 ? yEntry.sumW / yEntry.sumN : null;
    }
    return {
      overall: sumN > 0 ? sumW / sumN : null,
      byYear,
      totalN: sumN,
    };
  };

  // Expansion state. By default everything is collapsed; user clicks to
  // unfold the tree.
  const [openFaculties, setOpenFaculties] = React.useState<Set<string>>(() => new Set());
  const [openLevels, setOpenLevels] = React.useState<Set<string>>(() => new Set());
  const [openPrograms, setOpenPrograms] = React.useState<Set<string>>(() => new Set());

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void): void => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  // Selected course for the drill panel below the table. Click a course
  // row to open the panel; click again or click X to close. Mirrors the
  // /staff/teaching instructor-drill pattern.
  const [selectedCourse, setSelectedCourse] = React.useState<{
    programId: string;
    courseCode: string;
    courseName: string | null;
    facultyName: string | null;
    programName: string;
    programLevel: string;
  } | null>(null);
  const [courseDetail, setCourseDetail] = React.useState<CourseDetailResult | null>(null);
  const [courseDetailLoading, setCourseDetailLoading] = React.useState(false);

  // Sortable "By question, year over year" table in the course-detail
  // panel. Flat table (one row per question); year columns are dynamic
  // and stay plain headers.
  const byQuestionSort = useSortableTable(courseDetail?.byQuestion ?? [], {
    questionId: (q) => q.questionIdRegistrar,
    question: (q) => q.questionTextEnOverride ?? q.questionTextEn ?? q.questionTextTh,
    theme: (q) => (q.themeTag ? THEME_LABELS[q.themeTag] ?? q.themeTag : ''),
    overall: (q) => q.ratingAvg,
    n: (q) => q.respondentCount,
  });

  const openCourse = React.useCallback(
    async (
      row: ProgramCourseRow,
    ): Promise<void> => {
      setSelectedCourse({
        programId: row.programId,
        courseCode: row.courseCode,
        courseName: row.courseName,
        facultyName: row.facultyName,
        programName: row.programName,
        programLevel: row.programLevel,
      });
      setCourseDetail(null);
      setCourseDetailLoading(true);
      try {
        const qs = new URLSearchParams();
        facultyNameFilter.forEach((f) => qs.append('facultyName', f));
        selectedSemesters.forEach((s) => qs.append('semester', String(s)));
        qs.set('courseCode', row.courseCode);
        qs.set('programId', row.programId);
        const res = await fetch(`/api/proxy/education/satisfaction/course-detail?${qs}`);
        const payload = (await res.json()) as { data: CourseDetailResult | null };
        setCourseDetail(payload.data);
      } finally {
        setCourseDetailLoading(false);
      }
    },
    [facultyNameFilter, selectedSemesters],
  );

  // Sort state — applies to every level of the tree (faculty rows,
  // level rows within a faculty, program rows within a level, course
  // rows within a program). Click a header to toggle the column or
  // flip direction. `name` covers all four levels (faculty name, level
  // label, program name, course code).
  type SortKey = 'name' | 'overall' | 'n' | string; // string = year (e.g., "2568")
  type SortDir = 'asc' | 'desc';
  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({
    key: 'overall',
    dir: 'asc', // lowest-rated bubble to the top — the action-priority view
  });
  const toggleSort = (key: SortKey): void => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      // Default direction: numeric columns descending (highest first);
      // 'name' ascending (alphabetical) — except 'overall' opens in
      // ascending so a fresh click goes from current view to "worst first".
      return { key, dir: key === 'name' ? 'asc' : 'desc' };
    });
  };

  // Generic comparator. Takes the items to sort + a way to derive the
  // sort value per item. Used by faculty / level / program / course
  // sorting; the only thing that changes is how we derive the value.
  type SortValue = number | string;
  const cmp = (a: SortValue, b: SortValue): number => {
    if (typeof a === 'string' && typeof b === 'string') {
      return sort.dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
    }
    const na = a as number;
    const nb = b as number;
    return sort.dir === 'asc' ? na - nb : nb - na;
  };

  // Derive sort value for a "group" of rows + the group's name.
  // The rollup result gives us overall + byYear + totalN.
  const groupSortValue = (
    rows: ProgramCourseRow[],
    name: string,
  ): SortValue => {
    if (sort.key === 'name') return name.toLocaleLowerCase();
    const agg = rollup(rows);
    if (sort.key === 'overall') return agg.overall ?? -Infinity;
    if (sort.key === 'n') return agg.totalN;
    // Year column key
    return agg.byYear[sort.key] ?? -Infinity;
  };
  // Derive sort value for a leaf course row.
  const courseSortValue = (r: ProgramCourseRow): SortValue => {
    if (sort.key === 'name') return r.courseCode.toLocaleLowerCase();
    if (sort.key === 'overall') return r.overall.ratingAvg;
    if (sort.key === 'n') return r.overall.respondentCount;
    const cell = r.byYear[sort.key];
    return cell ? cell.ratingAvg : -Infinity;
  };

  // Reusable sort-indicator icon — visually marks the active sort column.
  const SortIcon = ({ k }: { k: SortKey }): React.ReactNode => {
    if (sort.key !== k) {
      return <ArrowUpDown size={10} className="inline-block opacity-30" />;
    }
    return sort.dir === 'asc' ? (
      <ArrowUp size={10} className="inline-block text-accent-default" />
    ) : (
      <ArrowDown size={10} className="inline-block text-accent-default" />
    );
  };
  // Wrap header cell in a sortable button. Numeric columns sit right-
  // aligned; name column sits left-aligned. The handler stops the table
  // row from receiving the click (it's the only ancestor that would).
  const SortHeader = ({
    k,
    label,
    align = 'right',
    title,
  }: {
    k: SortKey;
    label: React.ReactNode;
    align?: 'left' | 'right';
    title?: string;
  }): React.ReactNode => (
    <th
      className={
        'cursor-pointer select-none px-2 py-2 text-xs uppercase text-text-tertiary hover:bg-surface-2 ' +
        (align === 'right' ? 'text-right' : 'text-left')
      }
      onClick={() => toggleSort(k)}
      title={title}
    >
      {align === 'right' ? (
        <span className="inline-flex items-center gap-1">
          {label}
          <SortIcon k={k} />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <SortIcon k={k} />
          {label}
        </span>
      )}
    </th>
  );

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      {kpis}

      {/* Trend chart */}
      <Card className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-medium text-text-primary">Trend</h2>
            <p className="text-sm text-text-tertiary">
              Weighted mean rating per year × semester (all semesters shown).
            </p>
          </div>
          <span className="text-xs text-text-tertiary">
            {trend?.methodologyVersion ?? ''}
          </span>
        </div>
        <div className="h-[280px]">
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="oklch(var(--color-border-subtle) / 0.5)"
                />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  domain={[3.5, 5]}
                  ticks={[3.5, 4, 4.5, 5]}
                  tick={{ fontSize: 11 }}
                  width={36}
                />
                <Tooltip
                  formatter={(v: unknown, key: string) =>
                    typeof v === 'number'
                      ? key === 'rating'
                        ? v.toFixed(3)
                        : v.toLocaleString('en-US')
                      : String(v)
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="rating"
                  name="Mean rating"
                  stroke="oklch(0.65 0.20 145)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-text-tertiary">
              No trend data in window.
            </div>
          )}
        </div>
      </Card>

      {/* 4-level nested pivot */}
      <Card className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-medium text-text-primary">Courses by satisfaction</h2>
            <p className="text-sm text-text-tertiary">
              Drill in: faculty → degree level → program → course. Hover a course to see
              its question-by-question scores. The heat colour maps the [3.5, 5.0] range
              because real-world ratings are ceiling-biased — relative shade matters more
              than absolute value. Click any column header to sort.
            </p>
          </div>
          <span className="text-xs text-text-tertiary">
            {pl(byProgram?.rows.length ?? 0, 'program-course pairing')}
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-text-tertiary">Semesters:</span>
          {SEM_OPTIONS.map((s) => {
            const active = selectedSemesters.includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleSem(s.value)}
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
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-1">
              <tr className="border-b border-border-subtle text-left">
                <SortHeader
                  k="name"
                  align="left"
                  label="Faculty / Level / Program / Course"
                  title="Click to sort alphabetically"
                />
                <SortHeader
                  k="overall"
                  label="Overall"
                  title="Weighted by respondent count across all years in the window"
                />
                <SortHeader
                  k="n"
                  label="Respondents"
                  title="Σ student respondents across all cells"
                />
                {yearCols.map((y) => (
                  <SortHeader
                    key={y}
                    k={String(y)}
                    label={
                      <span className="leading-tight">
                        BE {y}
                        <span className="ml-1 text-[10px] text-text-tertiary/80">
                          ({beToCe(y)})
                        </span>
                      </span>
                    }
                    title={`Academic year ${y} BE (${beToCe(y)} CE) — Σ respondents weighted average`}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {facultyTree
                .slice()
                .sort((a, b) =>
                  cmp(
                    groupSortValue(
                      a.levels.flatMap((l) => l.programs.flatMap((p) => p.courses)),
                      a.facultyName,
                    ),
                    groupSortValue(
                      b.levels.flatMap((l) => l.programs.flatMap((p) => p.courses)),
                      b.facultyName,
                    ),
                  ),
                )
                .map((fac) => {
                const facKey = fac.facultyId;
                const facOpen = openFaculties.has(facKey);
                const facAllRows = fac.levels.flatMap((l) =>
                  l.programs.flatMap((p) => p.courses),
                );
                const facAgg = rollup(facAllRows);
                return (
                  <React.Fragment key={facKey}>
                    {/* Faculty row */}
                    <tr
                      className="cursor-pointer border-b border-border-subtle bg-surface-1 hover:bg-surface-2"
                      onClick={() => toggle(openFaculties, facKey, setOpenFaculties)}
                    >
                      <td className="px-2 py-2 font-medium text-text-primary">
                        <span className="mr-1 inline-flex w-3 align-middle text-text-tertiary">
                          {facOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                        {fac.facultyName}
                        <span className="ml-2 text-xs text-text-tertiary">
                          {pl(
                            fac.levels.reduce((s, l) => s + l.programs.length, 0),
                            'program',
                          )}{' '}
                          · {pl(facAllRows.length, 'course')}
                        </span>
                      </td>
                      <RatingCell
                        rating={facAgg.overall}
                        scope={{ facultyId: fac.facultyId }}
                        qs={tooltipQs}
                        scopeLabel={`${fac.facultyName} · overall`}
                        className="font-medium"
                      />
                      <td className="px-2 py-2 text-right text-xs text-text-tertiary">
                        {fmt(facAgg.totalN)}
                      </td>
                      {yearCols.map((y) => (
                        <RatingCell
                          key={y}
                          rating={facAgg.byYear[String(y)] ?? null}
                          scope={{ facultyId: fac.facultyId, acadYearBE: y }}
                          qs={tooltipQs}
                          scopeLabel={`${fac.facultyName} · BE ${y}`}
                        />
                      ))}
                    </tr>
                    {facOpen &&
                      fac.levels
                        .slice()
                        .sort((a, b) =>
                          // When sorting by name, preserve the academic
                          // hierarchy (Bachelor → Higher Grad Dip →
                          // Master → Doctoral) since "name" of a degree
                          // level is a logical order, not alphabetical.
                          sort.key === 'name'
                            ? (LEVEL_ORDER[a.level] ?? 99) -
                                (LEVEL_ORDER[b.level] ?? 99) || 0
                            : cmp(
                                groupSortValue(
                                  a.programs.flatMap((p) => p.courses),
                                  LEVEL_LABELS[a.level] ?? a.level,
                                ),
                                groupSortValue(
                                  b.programs.flatMap((p) => p.courses),
                                  LEVEL_LABELS[b.level] ?? b.level,
                                ),
                              ),
                        )
                        .map((lvl) => {
                        const lvlKey = `${facKey}|${lvl.level}`;
                        const lvlOpen = openLevels.has(lvlKey);
                        const lvlRows = lvl.programs.flatMap((p) => p.courses);
                        const lvlAgg = rollup(lvlRows);
                        return (
                          <React.Fragment key={lvlKey}>
                            {/* Level row */}
                            <tr
                              className="cursor-pointer border-b border-border-subtle bg-surface-2/40 hover:bg-surface-2"
                              onClick={() =>
                                toggle(openLevels, lvlKey, setOpenLevels)
                              }
                            >
                              <td className="py-1.5 pl-6 text-sm font-medium text-text-secondary">
                                <span className="mr-1 inline-flex w-3 align-middle text-text-tertiary">
                                  {lvlOpen ? (
                                    <ChevronDown size={12} />
                                  ) : (
                                    <ChevronRight size={12} />
                                  )}
                                </span>
                                {LEVEL_LABELS[lvl.level] ?? lvl.level}
                                <span className="ml-1 text-xs text-text-tertiary">
                                  · {LEVEL_LABELS_TH[lvl.level] ?? ''}
                                </span>
                                <span className="ml-2 text-xs text-text-tertiary">
                                  {pl(lvl.programs.length, 'program')} ·{' '}
                                  {pl(lvlRows.length, 'course')}
                                </span>
                              </td>
                              <RatingCell
                                rating={lvlAgg.overall}
                                scope={{
                                  facultyId: fac.facultyId,
                                  programLevel: lvl.level,
                                }}
                                qs={tooltipQs}
                                scopeLabel={`${fac.facultyName} · ${LEVEL_LABELS[lvl.level] ?? lvl.level}`}
                                paddingClass="px-2 py-1.5"
                                className="text-xs"
                              />
                              <td className="px-2 py-1.5 text-right text-xs text-text-tertiary">
                                {fmt(lvlAgg.totalN)}
                              </td>
                              {yearCols.map((y) => (
                                <RatingCell
                                  key={y}
                                  rating={lvlAgg.byYear[String(y)] ?? null}
                                  scope={{
                                    facultyId: fac.facultyId,
                                    programLevel: lvl.level,
                                    acadYearBE: y,
                                  }}
                                  qs={tooltipQs}
                                  scopeLabel={`${LEVEL_LABELS[lvl.level] ?? lvl.level} · BE ${y}`}
                                  paddingClass="px-2 py-1.5"
                                  className="text-xs"
                                />
                              ))}
                            </tr>
                            {lvlOpen &&
                              lvl.programs
                                .slice()
                                .sort((a, b) =>
                                  cmp(
                                    groupSortValue(a.courses, a.programName),
                                    groupSortValue(b.courses, b.programName),
                                  ),
                                )
                                .map((prog) => {
                                const pKey = `${lvlKey}|${prog.programId}`;
                                const pOpen = openPrograms.has(pKey);
                                const pAgg = rollup(prog.courses);
                                return (
                                  <React.Fragment key={pKey}>
                                    {/* Program row */}
                                    <tr
                                      className="cursor-pointer border-b border-border-subtle hover:bg-surface-2"
                                      onClick={() =>
                                        toggle(openPrograms, pKey, setOpenPrograms)
                                      }
                                    >
                                      <td className="py-1.5 pl-12 text-xs text-text-secondary">
                                        <span className="mr-1 inline-flex w-3 align-middle text-text-tertiary">
                                          {pOpen ? (
                                            <ChevronDown size={12} />
                                          ) : (
                                            <ChevronRight size={12} />
                                          )}
                                        </span>
                                        {prog.programName}
                                        <span className="ml-2 text-text-tertiary">
                                          · {pl(prog.courses.length, 'course')}
                                        </span>
                                      </td>
                                      <RatingCell
                                        rating={pAgg.overall}
                                        scope={{ programId: prog.programId }}
                                        qs={tooltipQs}
                                        scopeLabel={prog.programName}
                                        paddingClass="px-2 py-1.5"
                                        className="text-xs"
                                      />
                                      <td className="px-2 py-1.5 text-right text-xs text-text-tertiary">
                                        {fmt(pAgg.totalN)}
                                      </td>
                                      {yearCols.map((y) => (
                                        <RatingCell
                                          key={y}
                                          rating={pAgg.byYear[String(y)] ?? null}
                                          scope={{
                                            programId: prog.programId,
                                            acadYearBE: y,
                                          }}
                                          qs={tooltipQs}
                                          scopeLabel={`${prog.programName} · BE ${y}`}
                                          paddingClass="px-2 py-1.5"
                                          className="text-xs"
                                        />
                                      ))}
                                    </tr>
                                    {pOpen &&
                                      prog.courses
                                        .slice()
                                        .sort((a, b) =>
                                          cmp(courseSortValue(a), courseSortValue(b)),
                                        )
                                        .map((r) => {
                                          const isSelected =
                                            selectedCourse?.programId === prog.programId &&
                                            selectedCourse?.courseCode === r.courseCode;
                                          return (
                                            <tr
                                              key={`${prog.programId}-${r.courseCode}`}
                                              className={
                                                'border-b border-border-subtle hover:bg-surface-2 ' +
                                                (isSelected ? 'bg-accent-subtle/50' : '')
                                              }
                                            >
                                              <CourseNameCell
                                                courseCode={r.courseCode}
                                                courseName={r.courseName}
                                                isSelected={isSelected}
                                                onClick={() => void openCourse(r)}
                                              />
                                              <RatingCell
                                                rating={r.overall.ratingAvg}
                                                scope={{
                                                  programId: prog.programId,
                                                  courseCode: r.courseCode,
                                                }}
                                                qs={tooltipQs}
                                                scopeLabel={`${r.courseCode} ${r.courseName ?? ''}`}
                                                paddingClass="px-2 py-1.5"
                                                className="text-xs"
                                                onClick={() => void openCourse(r)}
                                              />
                                              <td className="px-2 py-1.5 text-right text-xs text-text-tertiary">
                                                {fmt(r.overall.respondentCount)}
                                              </td>
                                              {yearCols.map((y) => {
                                                const c = r.byYear[String(y)];
                                                return (
                                                  <RatingCell
                                                    key={y}
                                                    rating={c ? c.ratingAvg : null}
                                                    scope={{
                                                      programId: prog.programId,
                                                      courseCode: r.courseCode,
                                                      acadYearBE: y,
                                                    }}
                                                    qs={tooltipQs}
                                                    scopeLabel={`${r.courseCode} · BE ${y}`}
                                                    paddingClass="px-2 py-1.5"
                                                    className="text-xs"
                                                    onClick={() => void openCourse(r)}
                                                  />
                                                );
                                              })}
                                            </tr>
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
            </tbody>
          </table>
        </div>
      </Card>

      {/* Course detail panel — opens when the user clicks a course row.
          Same shape as the /staff/teaching instructor-drill panel:
          summary KPIs + trend + per-question heatmap. Course-aggregated,
          so no per-instructor names. */}
      {selectedCourse && (
        <Card className="p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-text-primary">
                <span className="font-mono text-base text-text-secondary">
                  {selectedCourse.courseCode}
                </span>
                {selectedCourse.courseName && (
                  <span className="ml-2">{selectedCourse.courseName}</span>
                )}
              </h2>
              <p className="text-sm text-text-tertiary">
                {selectedCourse.facultyName ?? '—'} ·{' '}
                {LEVEL_LABELS[selectedCourse.programLevel] ??
                  selectedCourse.programLevel}{' '}
                · {selectedCourse.programName}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedCourse(null);
                setCourseDetail(null);
              }}
              className="rounded p-1 text-text-tertiary hover:bg-surface-2"
              aria-label="Close course detail"
            >
              <X size={16} />
            </button>
          </div>
          {courseDetailLoading ? (
            <div className="py-8 text-center text-sm text-text-tertiary">Loading…</div>
          ) : !courseDetail ? (
            <div className="py-8 text-center text-sm text-text-tertiary">
              No detail available for this course in the current window.
            </div>
          ) : (
            <>
              {/* Summary KPIs */}
              <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
                <Card className="p-2">
                  <div className="text-[10px] uppercase text-text-tertiary">Rating</div>
                  <div className="text-lg font-medium">
                    {fmtRating(courseDetail.summary.ratingAvg)}
                  </div>
                </Card>
                <Card className="p-2">
                  <div className="text-[10px] uppercase text-text-tertiary">Respondents</div>
                  <div className="text-lg font-medium">
                    {fmt(courseDetail.summary.totalRespondents)}
                  </div>
                </Card>
                <Card className="p-2">
                  <div className="text-[10px] uppercase text-text-tertiary">Sections</div>
                  <div className="text-lg font-medium">
                    {fmt(courseDetail.summary.classCount)}
                  </div>
                </Card>
                <Card className="p-2">
                  <div className="text-[10px] uppercase text-text-tertiary">Teachers</div>
                  <div className="text-lg font-medium">
                    {fmt(courseDetail.summary.instructorCount)}
                  </div>
                </Card>
                <Card className="p-2">
                  <div className="text-[10px] uppercase text-text-tertiary">Questions</div>
                  <div className="text-lg font-medium">
                    {fmt(courseDetail.summary.questionCount)}
                  </div>
                </Card>
                <Card className="p-2">
                  <div className="text-[10px] uppercase text-text-tertiary">Semesters</div>
                  <div className="text-lg font-medium">
                    {fmt(courseDetail.summary.semestersObserved)}
                  </div>
                </Card>
              </div>

              {/* Trend */}
              {courseDetail.trend.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 text-sm font-medium text-text-primary">Trend</div>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={courseDetail.trend.map((p) => ({
                          label: p.label,
                          rating: p.ratingAvg,
                        }))}
                        margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="oklch(var(--color-border-subtle) / 0.5)"
                        />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis
                          domain={[3, 5]}
                          ticks={[3, 3.5, 4, 4.5, 5]}
                          tick={{ fontSize: 10 }}
                          width={28}
                        />
                        <Tooltip
                          formatter={(v: unknown) =>
                            typeof v === 'number' ? v.toFixed(3) : String(v)
                          }
                        />
                        <Line
                          type="monotone"
                          dataKey="rating"
                          stroke="oklch(0.65 0.20 145)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* By question — heatmap with year columns */}
              <div>
                <div className="mb-2 text-sm font-medium text-text-primary">
                  By question, year over year
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-surface-1">
                      <tr className="border-b border-border-subtle text-left text-xs uppercase text-text-tertiary">
                        <SortableTh sortKey="questionId" sort={byQuestionSort.sort} className="px-2 py-1.5">QID</SortableTh>
                        <SortableTh sortKey="question" sort={byQuestionSort.sort} className="px-2 py-1.5">Question</SortableTh>
                        <SortableTh sortKey="theme" sort={byQuestionSort.sort} className="px-2 py-1.5">Theme</SortableTh>
                        <SortableTh sortKey="overall" sort={byQuestionSort.sort} align="right" className="px-2 py-1.5 text-right">Overall</SortableTh>
                        <SortableTh sortKey="n" sort={byQuestionSort.sort} align="right" className="px-2 py-1.5 text-right">N</SortableTh>
                        {courseDetail.summary.yearsObserved.map((y) => (
                          <th key={y} className="px-2 py-1.5 text-right">
                            BE {y}{' '}
                            <span className="text-[10px] text-text-tertiary/80">
                              ({beToCe(y)})
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byQuestionSort.sorted
                        .map((q) => (
                          <tr
                            key={q.questionIdRegistrar}
                            className="border-b border-border-subtle"
                          >
                            <td className="px-2 py-1.5 font-mono text-xs">
                              {q.questionIdRegistrar}
                            </td>
                            <td className="px-2 py-1.5 text-xs">
                              {q.questionTextEnOverride ?? q.questionTextEn ?? (
                                <span className="text-text-tertiary">{q.questionTextTh}</span>
                              )}
                              <div className="text-[10px] text-text-tertiary">
                                {q.questionTextTh}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-xs text-text-tertiary">
                              {q.themeTag ? THEME_LABELS[q.themeTag] ?? q.themeTag : '—'}
                            </td>
                            <td
                              className="px-2 py-1.5 text-right text-xs"
                              style={{ backgroundColor: ratingHeat(q.ratingAvg) }}
                            >
                              {fmtRating(q.ratingAvg)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-xs text-text-tertiary">
                              {fmt(q.respondentCount)}
                            </td>
                            {courseDetail.summary.yearsObserved.map((y) => {
                              const c = q.byYear[String(y)];
                              return (
                                <td
                                  key={y}
                                  className="px-2 py-1.5 text-right text-xs"
                                  style={{
                                    backgroundColor: ratingHeat(c ? c.ratingAvg : null),
                                  }}
                                >
                                  {c ? fmtRating(c.ratingAvg) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
