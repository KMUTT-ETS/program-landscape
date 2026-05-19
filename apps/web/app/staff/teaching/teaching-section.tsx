'use client';

// /staff/teaching — Per-instructor student-evaluation dashboard.
//
// Visibility tiers (enforced by the API):
//   - PROGRAM_USER  → own row only (single-row drill, no roster)
//   - FACULTY_USER  → roster of their faculty's instructors, drill into any
//   - UNIVERSITY_USER+ → all instructors, drill into any
//
// Structure mirrors /education/satisfaction:
//   - KPI strip
//   - 4-level expandable tree: Faculty → Program Level → Program → Teacher
//   - Hover any rating cell → per-question tooltip scoped to that cell
//   - Click a teacher row → drill panel below the table (summary +
//     trend + per-question heatmap + per-course breakdown)
//
// Each instructor's cells are attributed to the program(s) that teach
// the courses they taught (same posture as /education/satisfaction's
// courseByProgram rollup). A teacher who taught a general-ed course
// appears under every program that teaches it.

import * as React from 'react';
import { Card } from '@kku/ui';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ── Types ───────────────────────────────────────────────────────────────

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
  scope?: 'own';
}

interface InstructorCell {
  ratingAvg: number;
  respondentCount: number;
  cellCount: number;
  instructorCount: number;
}

interface ProgramInstructorRow {
  facultyId: string;
  facultyName: string;
  programLevel: string;
  programId: string;
  programName: string;
  facultyMemberId: string;
  instructorNameTh: string;
  instructorNameEn: string;
  instructorRank: string;
  overall: InstructorCell;
  byYear: Record<string, InstructorCell>;
  yearsObserved: number[];
}

interface ByProgramResult {
  methodologyVersion: string;
  rows: ProgramInstructorRow[];
  yearsObserved: number[];
}

interface InstructorCourseCell {
  ratingAvg: number;
  respondentCount: number;
  cellCount: number;
}

interface InstructorCourseRow {
  courseCode: string;
  courseName: string | null;
  courseNameEn: string | null;
  overall: InstructorCourseCell;
  byYear: Record<string, InstructorCourseCell>;
  yearsObserved: number[];
}

interface QuestionDetail {
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

interface TrendPoint {
  acadYearBE: number;
  semester: number;
  label: string;
  ratingAvg: number | null;
  respondentCount: number;
  cellCount: number;
  courseCount: number;
}

interface PersonalResult {
  methodologyVersion: string;
  summary: {
    ratingAvg: number;
    totalRespondents: number;
    cellCount: number;
    courseCount: number;
    questionCount: number;
    semestersObserved: number;
  };
  trend: TrendPoint[];
  byQuestion: Array<
    QuestionDetail & {
      byYear: Record<string, { ratingAvg: number; respondentCount: number }>;
    }
  >;
  byCourse: Array<{
    courseCode: string;
    courseNameTh: string | null;
    courseNameEn: string | null;
    ratingAvg: number;
    cellCount: number;
    respondentCount: number;
    latestYearBE: number;
    latestSemester: number;
  }>;
}

interface Props {
  overall: OverallResult | null;
  byProgramInitial: ByProgramResult | null;
  facultyNameFilter: string[];
  /** When set, the page is own-only (PROGRAM_USER) — pre-load their data. */
  ownPersonal?: PersonalResult | null;
  ownFacultyMemberId?: string | null;
}

// ── Formatters ──────────────────────────────────────────────────────────

const fmt = (n: number): string => n.toLocaleString('en-US');
const fmtRating = (n: number | null): string => (n === null ? '—' : n.toFixed(2));
const pl = (n: number, word: string): string => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

// Buddhist Era → Common Era — same convention as /education/satisfaction.
const beToCe = (be: number): number => be - 543;

// Heat palette: narrow [3.0, 5.0] mapped across hue arc (matches
// /education/satisfaction).
function ratingHeat(rating: number | null): string {
  if (rating === null) return 'transparent';
  const clamp = Math.max(3.0, Math.min(5, rating));
  let hue: number;
  if (clamp <= 3.75) hue = 25 + ((60 - 25) * (clamp - 3.0)) / 0.75;
  else if (clamp <= 4.5) hue = 60 + ((130 - 60) * (clamp - 3.75)) / 0.75;
  else hue = 130 + ((145 - 130) * (clamp - 4.5)) / 0.5;
  return `oklch(0.86 0.10 ${hue.toFixed(0)})`;
}

// Thai academic-title abbreviations. Combined into the display name as
// `ผศ.เด่นพงษ์ สุดภักดี` — no space between abbrev and first name.
const RANK_ABBREV_TH: Record<string, string> = {
  PROF: 'ศ.',
  ASSOC_PROF: 'รศ.',
  ASST_PROF: 'ผศ.',
  LECTURER: 'อ.',
};
function formatTeacherName(nameTh: string, rank: string): string {
  // Strip any rank prefix that's already in nameTh (registrar/HR data
  // sometimes carries one). Keep middle titles like "ดร." / "นพ." since
  // those are professional qualifications, not academic rank.
  const stripped = nameTh.replace(/^(ศ\.|รศ\.|ผศ\.|อ\.)\s*/, '').trim();
  const prefix = RANK_ABBREV_TH[rank] ?? '';
  return prefix ? `${prefix}${stripped}` : stripped;
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

const THEME_LABELS: Record<string, string> = {
  'active-learning': 'Active learning',
  ethics: 'Ethics',
  assessment: 'Assessment',
  feedback: 'Feedback / Q&A',
  'content-design': 'Content & design',
  'english-skills': 'English skills',
};

const SEM_OPTIONS = [
  { value: 1, label: 'Sem 1' },
  { value: 2, label: 'Sem 2' },
  { value: 3, label: 'Summer (3)' },
  { value: 4, label: 'Intersession (4)' },
] as const;

// ── Lazy hover-tooltip ─────────────────────────────────────────────────

interface CellScope {
  facultyId?: string;
  programLevel?: string;
  programId?: string;
  courseCode?: string;
  facultyMemberId?: string;
  acadYearBE?: number;
}

interface CellQuestionsResult {
  methodologyVersion: string;
  scope: CellScope;
  questions: QuestionDetail[];
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
    scope.facultyMemberId ?? '',
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
  if (scope.facultyMemberId) out.set('facultyMemberId', scope.facultyMemberId);
  if (scope.acadYearBE !== undefined) out.set('acadYearBE', String(scope.acadYearBE));
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
    const url = `/api/proxy/staff/teaching/question-detail?${qs}${scopeQs ? `&${scopeQs}` : ''}`;
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

function RatingCell({
  rating,
  scope,
  qs,
  scopeLabel,
  className,
  paddingClass = 'px-2 py-2',
  onClick,
}: {
  rating: number | null;
  scope: CellScope;
  qs: string;
  scopeLabel: string;
  className?: string;
  paddingClass?: string;
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
      className={'relative text-right ' + paddingClass + ' ' + (className ?? '')}
      style={{ backgroundColor: ratingHeat(rating) }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={onClick}
    >
      {fmtRating(rating)}
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

// ── Sort UI ────────────────────────────────────────────────────────────

type SortKey = 'name' | 'overall' | 'n' | string;
type SortDir = 'asc' | 'desc';

// ── Main section ───────────────────────────────────────────────────────

export function TeachingSection({
  overall,
  byProgramInitial,
  facultyNameFilter,
  ownPersonal,
  ownFacultyMemberId,
}: Props) {
  const isOwnOnly = overall?.scope === 'own';

  const [selectedSemesters, setSelectedSemesters] = React.useState<number[]>([1, 2]);
  const [byProgram, setByProgram] = React.useState<ByProgramResult | null>(byProgramInitial);
  const [tableLoading, setTableLoading] = React.useState(false);

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
        const res = await fetch(`/api/proxy/staff/teaching/by-program?${qs}`);
        const payload = (await res.json()) as { data: ByProgramResult | null };
        if (payload.data) setByProgram(payload.data);
        questionsCache.clear();
        // The 5th-level course cache is filter-window-dependent too —
        // wipe it so subsequent opens refetch with the new window.
        setInstructorCourses({});
        setOpenInstructors(new Set());
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

  // Expansion state.
  const [openFaculties, setOpenFaculties] = React.useState<Set<string>>(() => new Set());
  const [openLevels, setOpenLevels] = React.useState<Set<string>>(() => new Set());
  const [openPrograms, setOpenPrograms] = React.useState<Set<string>>(() => new Set());
  // Teacher → course (5th-level) expansion. Keyed by `programId|facultyMemberId`.
  const [openInstructors, setOpenInstructors] = React.useState<Set<string>>(
    () => new Set(),
  );
  // Course rows per (programId|facultyMemberId), fetched lazily.
  const [instructorCourses, setInstructorCourses] = React.useState<
    Record<
      string,
      {
        loading: boolean;
        rows: InstructorCourseRow[];
        yearsObserved: number[];
      }
    >
  >({});

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void): void => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  // Toggle teacher → course expansion. First open triggers a lazy fetch.
  const toggleInstructor = React.useCallback(
    async (programId: string, facultyMemberId: string): Promise<void> => {
      const key = `${programId}|${facultyMemberId}`;
      setOpenInstructors((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      // If we've never fetched it, fetch now (regardless of toggle
      // direction — the data will be there the next time the user
      // opens the row).
      if (!instructorCourses[key]) {
        setInstructorCourses((prev) => ({
          ...prev,
          [key]: { loading: true, rows: [], yearsObserved: [] },
        }));
        try {
          const qs = new URLSearchParams();
          facultyNameFilter.forEach((f) => qs.append('facultyName', f));
          selectedSemesters.forEach((s) => qs.append('semester', String(s)));
          qs.set('programId', programId);
          qs.set('facultyMemberId', facultyMemberId);
          const res = await fetch(
            `/api/proxy/staff/teaching/instructor-courses?${qs}`,
          );
          const payload = (await res.json()) as {
            data: { rows: InstructorCourseRow[]; yearsObserved: number[] } | null;
          };
          setInstructorCourses((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              rows: payload.data?.rows ?? [],
              yearsObserved: payload.data?.yearsObserved ?? [],
            },
          }));
        } catch {
          setInstructorCourses((prev) => ({
            ...prev,
            [key]: { loading: false, rows: [], yearsObserved: [] },
          }));
        }
      }
    },
    [facultyNameFilter, selectedSemesters, instructorCourses],
  );

  // Selected instructor for the drill panel. Tracks BOTH the instructor
  // id and the program of context — clicking a teacher under "Program A"
  // shows only their Program A courses, even though the same teacher
  // might appear under "Program B" elsewhere in the tree.
  const [selectedInstructor, setSelectedInstructor] = React.useState<{
    id: string;
    programId: string | null;
  } | null>(
    isOwnOnly && ownFacultyMemberId
      ? { id: ownFacultyMemberId, programId: null }
      : null,
  );
  const selectedInstructorId = selectedInstructor?.id ?? null;
  const [personal, setPersonal] = React.useState<PersonalResult | null>(ownPersonal ?? null);
  const [drillLoading, setDrillLoading] = React.useState(false);

  const openInstructor = React.useCallback(
    async (id: string, programId?: string): Promise<void> => {
      setSelectedInstructor({ id, programId: programId ?? null });
      setDrillLoading(true);
      try {
        const qs = new URLSearchParams();
        facultyNameFilter.forEach((f) => qs.append('facultyName', f));
        selectedSemesters.forEach((s) => qs.append('semester', String(s)));
        if (programId) qs.set('programId', programId);
        const res = await fetch(
          `/api/proxy/staff/teaching/instructor/${encodeURIComponent(id)}?${qs}`,
        );
        const payload = (await res.json()) as { data: PersonalResult | null };
        setPersonal(payload.data);
      } finally {
        setDrillLoading(false);
      }
    },
    [facultyNameFilter, selectedSemesters],
  );

  // Sort state.
  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({
    key: 'overall',
    dir: 'asc', // worst-rated first — action-priority view
  });
  const toggleSort = (key: SortKey): void => {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: key === 'name' ? 'asc' : 'desc' };
    });
  };
  type SortValue = number | string;
  const cmp = (a: SortValue, b: SortValue): number => {
    if (typeof a === 'string' && typeof b === 'string') {
      return sort.dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
    }
    const na = a as number;
    const nb = b as number;
    return sort.dir === 'asc' ? na - nb : nb - na;
  };

  // Build tree from byProgram.rows: faculty → level → program → instructor[]
  type ProgramAgg = { programId: string; programName: string; instructors: ProgramInstructorRow[] };
  type LevelAgg = { level: string; programs: ProgramAgg[] };
  type FacultyAgg = { facultyId: string; facultyName: string; levels: LevelAgg[] };

  const facultyTree = React.useMemo<FacultyAgg[]>(() => {
    if (!byProgram) return [];
    const fmap = new Map<
      string,
      { name: string; lmap: Map<string, Map<string, { name: string; instructors: ProgramInstructorRow[] }>> }
    >();
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
        prog = { name: r.programName, instructors: [] };
        lmap.set(r.programId, prog);
      }
      prog.instructors.push(r);
    }
    const out: FacultyAgg[] = [];
    for (const [fid, fac] of fmap.entries()) {
      const levels: LevelAgg[] = [];
      for (const [lvl, pmap] of fac.lmap.entries()) {
        const programs: ProgramAgg[] = [];
        for (const [pid, prog] of pmap.entries()) {
          programs.push({
            programId: pid,
            programName: prog.name,
            instructors: prog.instructors
              .slice()
              .sort((a, b) => a.instructorNameTh.localeCompare(b.instructorNameTh)),
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

  // Rollup a set of instructor rows into one weighted aggregate.
  const rollup = (
    rows: ProgramInstructorRow[],
  ): { overall: number | null; byYear: Record<string, number | null>; totalN: number } => {
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
    return { overall: sumN > 0 ? sumW / sumN : null, byYear, totalN: sumN };
  };

  const groupSortValue = (rows: ProgramInstructorRow[], name: string): SortValue => {
    if (sort.key === 'name') return name.toLocaleLowerCase();
    const agg = rollup(rows);
    if (sort.key === 'overall') return agg.overall ?? -Infinity;
    if (sort.key === 'n') return agg.totalN;
    return agg.byYear[sort.key] ?? -Infinity;
  };
  const instructorSortValue = (r: ProgramInstructorRow): SortValue => {
    if (sort.key === 'name')
      return formatTeacherName(r.instructorNameTh, r.instructorRank).toLocaleLowerCase();
    if (sort.key === 'overall') return r.overall.ratingAvg;
    if (sort.key === 'n') return r.overall.respondentCount;
    const cell = r.byYear[sort.key];
    return cell ? cell.ratingAvg : -Infinity;
  };

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

  const yearCols = byProgram?.yearsObserved ?? [];

  // ── KPI strip ─────────────────────────────────────────────────────────
  const kpis = overall ? (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">
          {isOwnOnly ? 'Your average rating' : 'Average rating'}
        </div>
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
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Anonymous cells</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">{fmt(overall.cellCount)}</div>
        <div className="text-xs text-text-tertiary">≥ 5 respondents each</div>
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Courses taught</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">{fmt(overall.courseCount)}</div>
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Teachers in roster</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">
          {fmt(overall.instructorCount)}
        </div>
      </Card>
      <Card className="p-3">
        <div className="text-xs uppercase tracking-wide text-text-tertiary">Questions asked</div>
        <div className="mt-1 text-2xl font-medium text-text-primary">
          {fmt(overall.questionCount)}
        </div>
        <div className="text-xs text-text-tertiary">over {pl(overall.bucketCount, 'semester')}</div>
      </Card>
    </div>
  ) : null;

  // ── Drill panel ───────────────────────────────────────────────────────
  const selectedInstructorRow = React.useMemo(() => {
    if (!selectedInstructor || !byProgram) return null;
    // Prefer the (instructor, program) match — same teacher may appear
    // under multiple programs in the tree and we want the right header.
    if (selectedInstructor.programId) {
      const exact = byProgram.rows.find(
        (r) =>
          r.facultyMemberId === selectedInstructor.id &&
          r.programId === selectedInstructor.programId,
      );
      if (exact) return exact;
    }
    return (
      byProgram.rows.find((r) => r.facultyMemberId === selectedInstructor.id) ?? null
    );
  }, [selectedInstructor, byProgram]);

  const drillPanel = selectedInstructorId && personal ? (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-text-primary">
            {selectedInstructorRow
              ? formatTeacherName(
                  selectedInstructorRow.instructorNameTh,
                  selectedInstructorRow.instructorRank,
                )
              : isOwnOnly
                ? 'Your teaching evaluations'
                : 'Instructor detail'}
          </h2>
          {selectedInstructorRow && (
            <p className="text-sm text-text-tertiary">
              {selectedInstructorRow.facultyName} ·{' '}
              {LEVEL_LABELS[selectedInstructorRow.programLevel] ??
                selectedInstructorRow.programLevel}{' '}
              · {selectedInstructorRow.programName} ·{' '}
              {selectedInstructorRow.instructorNameEn}
              {selectedInstructor?.programId && (
                <span className="ml-2 text-[11px] italic">
                  showing courses in this program only
                </span>
              )}
            </p>
          )}
        </div>
        {!isOwnOnly && (
          <button
            type="button"
            onClick={() => {
              setSelectedInstructor(null);
              setPersonal(null);
            }}
            className="rounded p-1 text-text-tertiary hover:bg-surface-2"
            aria-label="Close drill"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {drillLoading ? (
        <div className="py-8 text-center text-sm text-text-tertiary">Loading…</div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            <Card className="p-2">
              <div className="text-[10px] uppercase text-text-tertiary">Rating</div>
              <div className="text-lg font-medium">{fmtRating(personal.summary.ratingAvg)}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] uppercase text-text-tertiary">Respondents</div>
              <div className="text-lg font-medium">{fmt(personal.summary.totalRespondents)}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] uppercase text-text-tertiary">Cells</div>
              <div className="text-lg font-medium">{fmt(personal.summary.cellCount)}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] uppercase text-text-tertiary">Courses</div>
              <div className="text-lg font-medium">{fmt(personal.summary.courseCount)}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] uppercase text-text-tertiary">Questions</div>
              <div className="text-lg font-medium">{fmt(personal.summary.questionCount)}</div>
            </Card>
            <Card className="p-2">
              <div className="text-[10px] uppercase text-text-tertiary">Semesters</div>
              <div className="text-lg font-medium">{fmt(personal.summary.semestersObserved)}</div>
            </Card>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-sm font-medium text-text-primary">Trend</div>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={personal.trend.map((p) => ({ label: p.label, rating: p.ratingAvg }))}
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

          <div className="mb-4">
            <div className="mb-2 text-sm font-medium text-text-primary">By question</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-1">
                  <tr className="border-b border-border-subtle text-left text-xs uppercase text-text-tertiary">
                    <th className="px-2 py-1.5">QID</th>
                    <th className="px-2 py-1.5">Question</th>
                    <th className="px-2 py-1.5">Theme</th>
                    <th className="px-2 py-1.5 text-right">Rating</th>
                    <th className="px-2 py-1.5 text-right">N</th>
                  </tr>
                </thead>
                <tbody>
                  {personal.byQuestion.map((q) => (
                    <tr key={q.questionIdRegistrar} className="border-b border-border-subtle">
                      <td className="px-2 py-1.5 font-mono text-xs">{q.questionIdRegistrar}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {q.questionTextEn ? (
                          <>
                            {q.questionTextEn}
                            <div className="text-text-tertiary">{q.questionTextTh}</div>
                          </>
                        ) : (
                          q.questionTextTh
                        )}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-text-primary">By course</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-1">
                  <tr className="border-b border-border-subtle text-left text-xs uppercase text-text-tertiary">
                    <th className="px-2 py-1.5">Code</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5 text-right">Rating</th>
                    <th className="px-2 py-1.5 text-right">N</th>
                    <th className="px-2 py-1.5 text-right">Latest</th>
                  </tr>
                </thead>
                <tbody>
                  {personal.byCourse.map((c) => (
                    <tr key={c.courseCode} className="border-b border-border-subtle">
                      <td className="px-2 py-1.5 font-mono text-xs">{c.courseCode}</td>
                      <td className="px-2 py-1.5 text-xs">{c.courseNameTh ?? '(no name)'}</td>
                      <td
                        className="px-2 py-1.5 text-right text-xs"
                        style={{ backgroundColor: ratingHeat(c.ratingAvg) }}
                      >
                        {fmtRating(c.ratingAvg)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs text-text-tertiary">
                        {fmt(c.respondentCount)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs text-text-tertiary">
                        BE {c.latestYearBE}/S{c.latestSemester}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Card>
  ) : null;

  return (
    <div className="space-y-6">
      {kpis}

      {/* 4-level nested pivot — only shown when not own-only */}
      {!isOwnOnly && (
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-medium text-text-primary">Teachers by satisfaction</h2>
              <p className="text-sm text-text-tertiary">
                Drill in: faculty → degree level → program → teacher. Hover any rating cell
                to see the question-by-question breakdown. Click a teacher to open the full
                detail panel below. Click any column header to sort.
              </p>
            </div>
            <span className="text-xs text-text-tertiary">
              {pl(byProgram?.rows.length ?? 0, 'program-teacher pairing')}
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
                    label="Faculty / Level / Program / Teacher"
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
                      title={`Academic year ${y} BE (${beToCe(y)} CE)`}
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
                        a.levels.flatMap((l) => l.programs.flatMap((p) => p.instructors)),
                        a.facultyName,
                      ),
                      groupSortValue(
                        b.levels.flatMap((l) => l.programs.flatMap((p) => p.instructors)),
                        b.facultyName,
                      ),
                    ),
                  )
                  .map((fac) => {
                    const facKey = fac.facultyId;
                    const facOpen = openFaculties.has(facKey);
                    const facAllRows = fac.levels.flatMap((l) =>
                      l.programs.flatMap((p) => p.instructors),
                    );
                    const facAgg = rollup(facAllRows);
                    const facInstructorCount = new Set(
                      facAllRows.map((r) => r.facultyMemberId),
                    ).size;
                    return (
                      <React.Fragment key={facKey}>
                        <tr
                          className="cursor-pointer border-b border-border-subtle bg-surface-1 hover:bg-surface-2"
                          onClick={() => toggle(openFaculties, facKey, setOpenFaculties)}
                        >
                          <td className="px-2 py-2 font-medium text-text-primary">
                            <span className="mr-1 inline-flex w-3 align-middle text-text-tertiary">
                              {facOpen ? (
                                <ChevronDown size={12} />
                              ) : (
                                <ChevronRight size={12} />
                              )}
                            </span>
                            {fac.facultyName}
                            <span className="ml-2 text-xs text-text-tertiary">
                              {pl(
                                fac.levels.reduce((s, l) => s + l.programs.length, 0),
                                'program',
                              )}{' '}
                              · {pl(facInstructorCount, 'teacher')}
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
                              sort.key === 'name'
                                ? (LEVEL_ORDER[a.level] ?? 99) -
                                    (LEVEL_ORDER[b.level] ?? 99) || 0
                                : cmp(
                                    groupSortValue(
                                      a.programs.flatMap((p) => p.instructors),
                                      LEVEL_LABELS[a.level] ?? a.level,
                                    ),
                                    groupSortValue(
                                      b.programs.flatMap((p) => p.instructors),
                                      LEVEL_LABELS[b.level] ?? b.level,
                                    ),
                                  ),
                            )
                            .map((lvl) => {
                              const lvlKey = `${facKey}|${lvl.level}`;
                              const lvlOpen = openLevels.has(lvlKey);
                              const lvlRows = lvl.programs.flatMap((p) => p.instructors);
                              const lvlAgg = rollup(lvlRows);
                              const lvlInstructorCount = new Set(
                                lvlRows.map((r) => r.facultyMemberId),
                              ).size;
                              return (
                                <React.Fragment key={lvlKey}>
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
                                        {pl(lvlInstructorCount, 'teacher')}
                                      </span>
                                    </td>
                                    <RatingCell
                                      rating={lvlAgg.overall}
                                      scope={{
                                        facultyId: fac.facultyId,
                                        programLevel: lvl.level,
                                      }}
                                      qs={tooltipQs}
                                      scopeLabel={`${fac.facultyName} · ${
                                        LEVEL_LABELS[lvl.level] ?? lvl.level
                                      }`}
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
                                          groupSortValue(a.instructors, a.programName),
                                          groupSortValue(b.instructors, b.programName),
                                        ),
                                      )
                                      .map((prog) => {
                                        const pKey = `${lvlKey}|${prog.programId}`;
                                        const pOpen = openPrograms.has(pKey);
                                        const pAgg = rollup(prog.instructors);
                                        return (
                                          <React.Fragment key={pKey}>
                                            <tr
                                              className="cursor-pointer border-b border-border-subtle hover:bg-surface-2"
                                              onClick={() =>
                                                toggle(
                                                  openPrograms,
                                                  pKey,
                                                  setOpenPrograms,
                                                )
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
                                                  · {pl(prog.instructors.length, 'teacher')}
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
                                              prog.instructors
                                                .slice()
                                                .sort((a, b) =>
                                                  cmp(
                                                    instructorSortValue(a),
                                                    instructorSortValue(b),
                                                  ),
                                                )
                                                .map((r) => {
                                                  // Highlight only the row that was actually
                                                  // clicked — a teacher who appears under
                                                  // multiple programs shouldn't light up
                                                  // every instance when one is selected.
                                                  const isSelected =
                                                    selectedInstructor?.id ===
                                                      r.facultyMemberId &&
                                                    selectedInstructor?.programId ===
                                                      prog.programId;
                                                  const displayName = formatTeacherName(
                                                    r.instructorNameTh,
                                                    r.instructorRank,
                                                  );
                                                  const insKey = `${prog.programId}|${r.facultyMemberId}`;
                                                  const insOpen = openInstructors.has(insKey);
                                                  const insCourses =
                                                    instructorCourses[insKey];
                                                  return (
                                                    <React.Fragment
                                                      key={`${prog.programId}-${r.facultyMemberId}`}
                                                    >
                                                      <tr
                                                        className={
                                                          'border-b border-border-subtle hover:bg-surface-2 ' +
                                                          (isSelected
                                                            ? 'bg-accent-subtle/50'
                                                            : '')
                                                        }
                                                      >
                                                        <td
                                                          className="cursor-pointer py-1.5 pl-20 text-xs"
                                                          onClick={() => {
                                                            void openInstructor(r.facultyMemberId, prog.programId);
                                                            void toggleInstructor(
                                                              prog.programId,
                                                              r.facultyMemberId,
                                                            );
                                                          }}
                                                        >
                                                          <span
                                                            className="mr-1 inline-flex w-3 align-middle text-text-tertiary"
                                                            onClick={(e) => {
                                                              // Chevron-only toggle: open the
                                                              // 5th-level inline expansion
                                                              // without also opening the drill
                                                              // panel.
                                                              e.stopPropagation();
                                                              void toggleInstructor(
                                                                prog.programId,
                                                                r.facultyMemberId,
                                                              );
                                                            }}
                                                            role="button"
                                                            aria-label={
                                                              insOpen
                                                                ? 'Collapse courses'
                                                                : 'Expand courses'
                                                            }
                                                          >
                                                            {insOpen ? (
                                                              <ChevronDown size={12} />
                                                            ) : (
                                                              <ChevronRight size={12} />
                                                            )}
                                                          </span>
                                                          <span className="text-text-primary">
                                                            {displayName}
                                                          </span>
                                                        </td>
                                                        <RatingCell
                                                          rating={r.overall.ratingAvg}
                                                          scope={{
                                                            programId: prog.programId,
                                                            facultyMemberId: r.facultyMemberId,
                                                          }}
                                                          qs={tooltipQs}
                                                          scopeLabel={displayName}
                                                          paddingClass="px-2 py-1.5"
                                                          className="text-xs"
                                                          onClick={() =>
                                                            void openInstructor(r.facultyMemberId, prog.programId)
                                                          }
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
                                                                facultyMemberId:
                                                                  r.facultyMemberId,
                                                                acadYearBE: y,
                                                              }}
                                                              qs={tooltipQs}
                                                              scopeLabel={`${displayName} · BE ${y}`}
                                                              paddingClass="px-2 py-1.5"
                                                              className="text-xs"
                                                              onClick={() =>
                                                                void openInstructor(
                                                                  r.facultyMemberId,
                                                                  prog.programId,
                                                                )
                                                              }
                                                            />
                                                          );
                                                        })}
                                                      </tr>
                                                      {insOpen && (
                                                        <>
                                                          {!insCourses || insCourses.loading ? (
                                                            <tr className="border-b border-border-subtle">
                                                              <td
                                                                colSpan={3 + yearCols.length}
                                                                className="py-1.5 pl-36 text-[11px] italic text-text-tertiary"
                                                              >
                                                                Loading courses…
                                                              </td>
                                                            </tr>
                                                          ) : insCourses.rows.length === 0 ? (
                                                            <tr className="border-b border-border-subtle">
                                                              <td
                                                                colSpan={3 + yearCols.length}
                                                                className="py-1.5 pl-36 text-[11px] italic text-text-tertiary"
                                                              >
                                                                No courses for this teacher in this
                                                                program (in the current window).
                                                              </td>
                                                            </tr>
                                                          ) : (
                                                            insCourses.rows
                                                              .slice()
                                                              .sort(
                                                                (a, b) =>
                                                                  a.overall.ratingAvg -
                                                                  b.overall.ratingAvg,
                                                              )
                                                              .map((c) => (
                                                                <tr
                                                                  key={`${prog.programId}-${r.facultyMemberId}-${c.courseCode}`}
                                                                  className="border-b border-border-subtle bg-surface-2/30"
                                                                >
                                                                  <td className="py-1.5 pl-36 text-xs">
                                                                    <span className="font-mono text-[11px] text-text-secondary">
                                                                      {c.courseCode}
                                                                    </span>
                                                                    {c.courseName && (
                                                                      <span className="ml-1 text-text-primary">
                                                                        {c.courseName}
                                                                      </span>
                                                                    )}
                                                                  </td>
                                                                  <RatingCell
                                                                    rating={c.overall.ratingAvg}
                                                                    scope={{
                                                                      programId: prog.programId,
                                                                      facultyMemberId:
                                                                        r.facultyMemberId,
                                                                      courseCode: c.courseCode,
                                                                    }}
                                                                    qs={tooltipQs}
                                                                    scopeLabel={`${displayName} · ${c.courseCode}`}
                                                                    paddingClass="px-2 py-1.5"
                                                                    className="text-xs"
                                                                  />
                                                                  <td className="px-2 py-1.5 text-right text-xs text-text-tertiary">
                                                                    {fmt(
                                                                      c.overall.respondentCount,
                                                                    )}
                                                                  </td>
                                                                  {yearCols.map((y) => {
                                                                    const yc = c.byYear[String(y)];
                                                                    return (
                                                                      <RatingCell
                                                                        key={y}
                                                                        rating={
                                                                          yc ? yc.ratingAvg : null
                                                                        }
                                                                        scope={{
                                                                          programId:
                                                                            prog.programId,
                                                                          facultyMemberId:
                                                                            r.facultyMemberId,
                                                                          courseCode:
                                                                            c.courseCode,
                                                                          acadYearBE: y,
                                                                        }}
                                                                        qs={tooltipQs}
                                                                        scopeLabel={`${displayName} · ${c.courseCode} · BE ${y}`}
                                                                        paddingClass="px-2 py-1.5"
                                                                        className="text-xs"
                                                                      />
                                                                    );
                                                                  })}
                                                                </tr>
                                                              ))
                                                          )}
                                                        </>
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
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {drillPanel}
    </div>
  );
}
