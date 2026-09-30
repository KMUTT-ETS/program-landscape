'use client';

import * as React from 'react';
import { Card } from '@kku/ui';
import { ChevronRight } from 'lucide-react';
import type {
  ByFacultyResponse,
  HistogramResponse,
  StudentsByFacultyResponse,
  Summary,
  TeacherFacultyGroup,
  TeacherLevelGroup,
  TeacherProgramGroup,
  TeacherRow,
  TeachersResponse,
} from './types';

interface Props {
  summary: Summary | null;
  histogram: HistogramResponse | null;
  byFaculty: ByFacultyResponse | null;
  studentsByFaculty: StudentsByFacultyResponse | null;
  teachers: TeachersResponse | null;
  scopeFaculties: string[];
}

const SEMESTER_LABEL: Record<number, string> = {
  1: 'Semester 1 (main)',
  2: 'Semester 2 (main)',
  3: 'Semester 3 (summer)',
  4: 'Semester 4 (special)',
};

// KKU's nominal full-time teaching load for academic staff is roughly
// 9–15 contact hours/week. Anything above 16 is over-load territory.
const BAND_COLOUR = {
  UNDER: '#f0a232',
  NORMAL: '#069c6a',
  OVER: '#a6192e',
} as const;

// Full-form Thai rank titles — what KKU staff are addressed by. Used
// to prefix every teacher's display name in the deep-dive (e.g.,
// "ผู้ช่วยศาสตราจารย์ เด่นพงษ์ สุดภักดี") so we can drop the separate
// Position column. Mirrors packages/db/src/staff-profile/profile.ts but uses
// the full (un-abbreviated) form because the name + title reads as
// one phrase, the way it's spoken.
const RANK_TITLE_TH: Record<string, string> = {
  PROF: 'ศาสตราจารย์',
  ASSOC_PROF: 'รองศาสตราจารย์',
  ASST_PROF: 'ผู้ช่วยศาสตราจารย์',
  LECTURER: 'อาจารย์',
};

/** Returns "{rank-title} {displayName}" when rank resolves, else just
 *  the display name. Unresolved teachers (rank = null) skip the prefix. */
function nameWithRank(displayName: string, rank: string | null | undefined): string {
  const title = rank ? RANK_TITLE_TH[rank] : undefined;
  return title ? `${title} ${displayName}` : displayName;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US');
}

export function TeachingWorkloadClient({
  summary,
  histogram,
  byFaculty,
  studentsByFaculty,
  teachers,
  scopeFaculties,
}: Props) {
  const snapLabel =
    summary && summary.acadYearBE && summary.semester
      ? `BE ${summary.acadYearBE} · ${SEMESTER_LABEL[summary.semester] ?? `Sem ${summary.semester}`}`
      : '—';

  return (
    <div className="space-y-6">
      <p className="text-[11px] text-fg-3">
        Showing: <strong>{snapLabel}</strong>
        {scopeFaculties.length > 0 && (
          <>
            {' '}
            · scope: {scopeFaculties.length}{' '}
            facult{scopeFaculties.length === 1 ? 'y' : 'ies'} you can see
          </>
        )}
      </p>

      {/* ── KPI tiles ── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            label="Distinct teachers"
            value={fmt(summary.totalTeachers)}
            tooltip="Distinct KKU emails appearing in the registrar's KKUMAIL field across every section in scope."
          />
          <KpiTile
            label="Avg hrs / week"
            value={summary.avgContactHrsPerTeacher.toFixed(1)}
            hint="contact hours · per teacher · per week"
            tooltip="Σ (lecture + lab hours per week) ÷ teacher count. KKU's expected full-time load is roughly 9–15 hours/week."
          />
          <KpiTile
            label="Total contact hrs / wk"
            value={fmt(summary.totalContactHrsPerWeek)}
            hint="Σ lecture + lab hours, per week"
            tooltip="Sum of (lecture + lab hours per week) across every (teacher × section) pair. Every co-teacher on a team-taught course gets the full credit."
          />
          <KpiTile
            label="Team-taught sections"
            value={fmt(summary.teamTaughtSections)}
            hint={`of ${fmt(summary.totalSections)} sections`}
            tooltip="Sections with two or more teachers in KKUMAIL."
          />
          <KpiTile
            label="Students taught"
            value={fmt(summary.totalStudentsTaught)}
            tooltip="Σ ENROLLSEAT across every (teacher × section) pair — counts a student once per teacher they encounter."
          />
          <KpiTile
            label="Resolved teachers"
            value={fmt(summary.resolvedTeachers)}
            hint="matched to a staff record"
            tooltip="Teachers whose KKU email matches a FacultyMember row from HCM."
          />
          <KpiTile
            label="Unresolved teachers"
            value={fmt(summary.unresolvedTeachers)}
            hint="external lecturers / HCM gaps"
            tone={summary.unresolvedTeachers > 0 ? 'warning' : undefined}
            tooltip="KKU emails on KKUMAIL with no matching staff record — usually external lecturers, retired staff, or HCM-not-yet-ingested."
          />
          <KpiTile label="Sections" value={fmt(summary.totalSections)} tooltip="Distinct class sections opened in this snapshot." />
        </div>
      )}

      {/* ── Viz 1 — workload distribution histogram ── */}
      {histogram && histogram.totalTeachers > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">
            Workload distribution — contact hours per teacher, per week
          </h2>
          <p className="text-xs text-fg-3 mb-3">
            Each bar is a teacher count, bucketed by total weekly contact
            hours. KKU's expected full-time load is 9–15 hrs/week
            (green band). Bars in the red band are heavy delivery loads —
            worth checking whether team-teaching is mis-attributed.
          </p>
          <div className="space-y-2">
            {histogram.buckets.map((b) => (
              <div
                key={b.bucket}
                className="grid grid-cols-[140px_1fr_160px] gap-2 items-center text-xs"
                title={`${fmt(b.teachers)} teachers in the ${b.bucket} band — ${b.pctOfTotal.toFixed(1)}% of ${fmt(histogram.totalTeachers)} total`}
              >
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
            <LegendSwatch colour={BAND_COLOUR.UNDER} label="Under-load (≤ 8 hrs/wk)" />
            <LegendSwatch colour={BAND_COLOUR.NORMAL} label="Normal (9–15 hrs/wk)" />
            <LegendSwatch colour={BAND_COLOUR.OVER} label="Over-load (≥ 16 hrs/wk)" />
          </div>
        </Card>
      )}

      {/* ── Viz 2 — faculty workload pulse (clarified unit) ── */}
      {byFaculty && byFaculty.rows.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">
            Faculty workload pulse — avg <em>hrs / week</em> per teacher
          </h2>
          <p className="text-xs text-fg-3 mb-3">
            Each bar is a faculty's mean contact hours per teacher per
            week. Attribution is by the teacher's home faculty — a Math
            teacher running a service course to Engineering still counts
            as Math's load.
          </p>
          <FacultyPulseBars byFaculty={byFaculty} />
        </Card>
      )}

      {/* ── Viz 3 — students taught by faculty ── */}
      {studentsByFaculty && studentsByFaculty.rows.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">
            Students taught — by faculty
          </h2>
          <p className="text-xs text-fg-3 mb-3">
            Σ enrolment across every section a faculty's teachers
            deliver. Complements the contact-hours pulse — a faculty can
            be heavy on hours but light on students (small specialised
            classes) or vice versa.
          </p>
          <StudentsTaughtBars data={studentsByFaculty} />
        </Card>
      )}

      {/* ── Deep-dive: Faculty → Program → Teacher drill-down ── */}
      {teachers && teachers.rows.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-1">Per-teacher deep dive</h2>
          <p className="text-xs text-fg-3 mb-3">
            Faculty → Program Level → Program → Teacher. The program tier
            is the teacher↔curriculum link extracted by the program-digest
            pipeline; the level tier groups those programs by degree
            (Bachelor&rsquo;s / Master&rsquo;s / Doctoral / Higher Grad.
            Dip.). A teacher who belongs to several programs appears under
            each, every node showing their <em>full</em> actual workload —
            figures are not split or weighted per program. Level, Faculty
            and Total rows therefore count each teacher once. Teachers with
            teaching activity but no curriculum membership sit in a{' '}
            <em>Not attached to a curriculum</em> bucket; unresolved
            teachers (external lecturers / HCM gaps) are pooled last. Sort
            by any column to find the heaviest carriers.
          </p>
          <TeacherDrillDown data={teachers} />
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Faculty pulse — bar chart, average contact hours/week per teacher.
// ────────────────────────────────────────────────────────────────────

function FacultyPulseBars({ byFaculty }: { byFaculty: ByFacultyResponse }) {
  const rows = byFaculty.rows;
  const max = Math.max(
    1,
    ...rows.map((r) => r.avgContactHrsPerTeacher),
    byFaculty.unresolvedRow.avgContactHrsPerTeacher,
  );
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const colour =
          r.avgContactHrsPerTeacher >= 16
            ? BAND_COLOUR.OVER
            : r.avgContactHrsPerTeacher >= 9
            ? BAND_COLOUR.NORMAL
            : BAND_COLOUR.UNDER;
        return (
          <div
            key={r.facultyName}
            className="grid grid-cols-[220px_1fr_200px] gap-2 items-center text-xs"
            title={`${r.facultyName}\n${fmt(r.teachers)} teachers · ${fmt(r.sections)} sections\n${r.avgContactHrsPerTeacher.toFixed(1)} hrs/week avg per teacher\n${fmt(r.studentsTaught)} students taught`}
          >
            <div className="text-fg-2 truncate">{r.facultyName}</div>
            <div className="relative bg-surface-2 rounded-sm h-4 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{
                  width: `${(r.avgContactHrsPerTeacher / max) * 100}%`,
                  backgroundColor: colour,
                }}
              />
            </div>
            <div className="text-right tabular-nums text-fg-3">
              {r.avgContactHrsPerTeacher.toFixed(1)} hrs/wk · {fmt(r.teachers)} teachers
            </div>
          </div>
        );
      })}
      {byFaculty.unresolvedRow.teachers > 0 && (
        <div
          className="grid grid-cols-[220px_1fr_200px] gap-2 items-center text-xs border-t border-line mt-2 pt-2"
          title={`Unresolved teachers (external lecturers / HCM gaps)\n${fmt(byFaculty.unresolvedRow.teachers)} teachers · ${fmt(byFaculty.unresolvedRow.sections)} sections`}
        >
          <div className="text-fg-3 italic">Unresolved (external / HCM)</div>
          <div className="relative bg-surface-2 rounded-sm h-4 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-sm bg-gray-400"
              style={{
                width: `${(byFaculty.unresolvedRow.avgContactHrsPerTeacher / max) * 100}%`,
              }}
            />
          </div>
          <div className="text-right tabular-nums text-fg-3">
            {byFaculty.unresolvedRow.avgContactHrsPerTeacher.toFixed(1)} hrs/wk ·{' '}
            {fmt(byFaculty.unresolvedRow.teachers)} teachers
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Students taught bars.
// ────────────────────────────────────────────────────────────────────

function StudentsTaughtBars({ data }: { data: StudentsByFacultyResponse }) {
  const max = Math.max(1, ...data.rows.map((r) => r.studentsTaught));
  return (
    <div className="space-y-2">
      {data.rows.map((r) => (
        <div
          key={r.facultyName}
          className="grid grid-cols-[220px_1fr_200px] gap-2 items-center text-xs"
          title={`${r.facultyName}\n${fmt(r.studentsTaught)} students taught · ${fmt(r.teachers)} teachers · ${fmt(r.sections)} sections\n${r.studentsPerTeacher.toFixed(1)} students per teacher (on average)`}
        >
          <div className="text-fg-2 truncate">{r.facultyName}</div>
          <div className="relative bg-surface-2 rounded-sm h-4 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{
                width: `${(r.studentsTaught / max) * 100}%`,
                backgroundColor: '#2b4ba4',
              }}
            />
          </div>
          <div className="text-right tabular-nums text-fg-3">
            {fmt(r.studentsTaught)} students · {r.studentsPerTeacher.toFixed(0)}/teacher
          </div>
        </div>
      ))}
      <p className="text-[10px] text-fg-3 mt-2">
        Total students taught: {fmt(data.totals.studentsTaught)} ·
        {' '}sections: {fmt(data.totals.sections)} ·
        {' '}teachers: {fmt(data.totals.teachers)}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// By-teacher drill-down — Faculty → Program Level → Program → Teacher,
// sortable headers. The program tier comes from the program-digest
// pipeline's teacher↔curriculum links (ProgramFaculty); the level tier
// groups those programs by degree. A teacher in several programs shows
// under each, every node carrying their full actual workload (no split);
// level / faculty / total rows count each teacher once.
// ────────────────────────────────────────────────────────────────────

type TeacherColKey =
  | 'sections'
  | 'distinctCourses'
  | 'lectureHrs'
  | 'labHrs'
  | 'contactHrs'
  | 'students'
  | 'team';

interface SortState {
  key: TeacherColKey;
  dir: 'asc' | 'desc';
}

const LEVEL_LABEL: Record<string, string> = {
  BACHELOR: "Bachelor's",
  MASTER: "Master's",
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Grad. Dip.',
};

const ROLE_LABEL: Record<string, string> = {
  COORDINATOR: 'Coordinator',
  CORE: 'Core',
  SUPPORT: 'Support',
};

const FALLBACK_LABEL = 'Not attached to a curriculum';

const facKeyOf = (f: TeacherFacultyGroup): string =>
  f.facultyId ?? `__un__:${f.facultyName}`;
const levelKeyOf = (l: TeacherLevelGroup): string => l.level ?? '__nolevel__';
const progKeyOf = (p: TeacherProgramGroup): string =>
  p.programId ?? '__noprog__';

function RoleChip({ role }: { role: string }) {
  return (
    <span
      className="ml-1.5 px-1 py-px rounded-sm text-[9px] uppercase tracking-wide bg-surface-3 text-fg-2 align-middle"
      title={`Curriculum role: ${ROLE_LABEL[role] ?? role}`}
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function TeacherDrillDown({ data }: { data: TeachersResponse }) {
  const [openFac, setOpenFac] = React.useState<Set<string>>(() => new Set());
  const [openLevel, setOpenLevel] = React.useState<Set<string>>(() => new Set());
  const [openProg, setOpenProg] = React.useState<Set<string>>(() => new Set());
  const [sort, setSort] = React.useState<SortState | null>(null);

  const cycleSort = (k: TeacherColKey) => {
    setSort((s) => {
      if (!s || s.key !== k) return { key: k, dir: 'desc' };
      if (s.dir === 'desc') return { key: k, dir: 'asc' };
      return null;
    });
  };

  const toggle =
    (set: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (k: string) =>
      set((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
  const toggleFac = toggle(setOpenFac);
  const toggleLevel = toggle(setOpenLevel);
  const toggleProg = toggle(setOpenProg);

  const sortedRows = React.useMemo<TeacherFacultyGroup[]>(() => {
    if (!sort) return data.rows;
    const teacherV = (t: TeacherRow, k: TeacherColKey): number => {
      if (k === 'sections') return t.sections;
      if (k === 'distinctCourses') return t.distinctCourses;
      if (k === 'lectureHrs') return t.lectureHrsPerWeek;
      if (k === 'labHrs') return t.labHrsPerWeek;
      if (k === 'contactHrs') return t.totalContactHrsPerWeek;
      if (k === 'students') return t.studentsTaught;
      if (k === 'team') return t.teamTaughtSections;
      return 0;
    };
    // Faculty / level / program rows render lecture/lab as an average per
    // teacher, so sort by that — the visible order matches the cell
    // value. The Courses column is teacher-only, so the upper tiers keep
    // their order under that key.
    const groupV = (
      g: {
        sections: number;
        teachers: number;
        lectureHrsPerWeek: number;
        labHrsPerWeek: number;
        totalContactHrsPerWeek: number;
        studentsTaught: number;
        teamTaughtSections: number;
      },
      k: TeacherColKey,
    ): number => {
      if (k === 'sections') return g.sections;
      if (k === 'distinctCourses') return 0;
      if (k === 'lectureHrs') return g.teachers > 0 ? g.lectureHrsPerWeek / g.teachers : 0;
      if (k === 'labHrs') return g.teachers > 0 ? g.labHrsPerWeek / g.teachers : 0;
      if (k === 'contactHrs') return g.totalContactHrsPerWeek;
      if (k === 'students') return g.studentsTaught;
      if (k === 'team') return g.teamTaughtSections;
      return 0;
    };
    const cmp = (a: number, b: number) => (sort.dir === 'asc' ? a - b : b - a);
    return data.rows
      .map((f) => ({
        ...f,
        levels: [...f.levels]
          .map((l) => ({
            ...l,
            programs: [...l.programs]
              .map((p) => ({
                ...p,
                children: [...p.children].sort((a, b) =>
                  cmp(teacherV(a, sort.key), teacherV(b, sort.key)),
                ),
              }))
              .sort((a, b) => {
                // "Not attached to a curriculum" node always last.
                if (a.programId === null && b.programId !== null) return 1;
                if (a.programId !== null && b.programId === null) return -1;
                return cmp(groupV(a, sort.key), groupV(b, sort.key));
              }),
          }))
          .sort((a, b) => {
            // The no-level fallback bucket always last.
            if (a.level === null && b.level !== null) return 1;
            if (a.level !== null && b.level === null) return -1;
            return cmp(groupV(a, sort.key), groupV(b, sort.key));
          }),
      }))
      .sort((a, b) => {
        // Always keep the unresolved faculty last.
        if (a.facultyId === null && b.facultyId !== null) return 1;
        if (a.facultyId !== null && b.facultyId === null) return -1;
        return cmp(groupV(a, sort.key), groupV(b, sort.key));
      });
  }, [data.rows, sort]);

  const SortHeader = ({
    label,
    keyName,
    tooltip,
  }: {
    label: string;
    keyName: TeacherColKey;
    tooltip?: string;
  }) => {
    const active = sort?.key === keyName;
    return (
      <th
        className="px-2 py-1.5 text-right cursor-pointer select-none whitespace-nowrap hover:bg-surface-3"
        onClick={() => cycleSort(keyName)}
        title={tooltip ?? `Sort by ${label}`}
      >
        {label}
        <span className="inline-block w-3 ml-0.5">
          {active ? (sort?.dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </th>
    );
  };

  const avgTotLec =
    data.totals.teachers > 0
      ? data.totals.lectureHrsPerWeek / data.totals.teachers
      : 0;
  const avgTotLab =
    data.totals.teachers > 0
      ? data.totals.labHrsPerWeek / data.totals.teachers
      : 0;

  // One numeric-cell renderer reused by the faculty / level / program
  // group rows — they all show lecture/lab as an average per teacher and
  // total as an avg pill. Keeps the three group tiers visually identical.
  const GroupCells = ({
    g,
  }: {
    g: {
      sections: number;
      teachers: number;
      lectureHrsPerWeek: number;
      labHrsPerWeek: number;
      avgContactHrsPerTeacher: number;
      studentsTaught: number;
      teamTaughtSections: number;
    };
  }) => {
    const lecAvg = g.teachers > 0 ? g.lectureHrsPerWeek / g.teachers : 0;
    const labAvg = g.teachers > 0 ? g.labHrsPerWeek / g.teachers : 0;
    return (
      <>
        <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(g.sections)} (teacher × section) instances`}>
          {fmt(g.sections)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-fg-3">—</td>
        <td
          className="px-2 py-1.5 text-right tabular-nums"
          title={`${fmt(g.lectureHrsPerWeek)} hrs lecture/wk Σ · avg ${lecAvg.toFixed(1)} per teacher`}
        >
          {lecAvg.toFixed(1)}
          <span className="ml-0.5 text-[9px] text-fg-3">avg</span>
        </td>
        <td
          className="px-2 py-1.5 text-right tabular-nums"
          title={`${fmt(g.labHrsPerWeek)} hrs lab/wk Σ · avg ${labAvg.toFixed(1)} per teacher`}
        >
          {labAvg.toFixed(1)}
          <span className="ml-0.5 text-[9px] text-fg-3">avg</span>
        </td>
        <td
          className="px-2 py-1.5 text-right tabular-nums"
          title={`avg ${g.avgContactHrsPerTeacher.toFixed(1)} contact hrs/wk per teacher (each teacher counted once)`}
        >
          <HrsPill hrs={g.avgContactHrsPerTeacher} suffix=" avg" />
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(g.studentsTaught)} student-seats`}>
          {fmt(g.studentsTaught)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(g.teamTaughtSections)} team-taught (teacher × section) instances`}>
          {fmt(g.teamTaughtSections)}
        </td>
      </>
    );
  };

  // Teacher (leaf) row — its own actual totals, not an average.
  const TeacherRowEl = ({ t, indent }: { t: TeacherRow; indent: string }) => (
    <tr className="border-b border-line/30 hover:bg-surface-2">
      <td
        className={`px-2 py-1.5 ${indent} whitespace-nowrap sticky left-0 bg-surface-1`}
        title={t.rank ? `Rank: ${t.rank}` : 'Rank: unresolved (external / HCM gap)'}
      >
        {nameWithRank(t.displayName, t.rank)}
        {t.programRole && <RoleChip role={t.programRole} />}
        {t.programCount > 1 && (
          <span
            className="ml-1.5 text-[9px] text-fg-3"
            title={`Curriculum member of ${t.programCount} programs — the same workload row appears under each.`}
          >
            in {t.programCount} programs
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(t.sections)} sections`}>
        {fmt(t.sections)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(t.distinctCourses)} distinct courses`}>
        {fmt(t.distinctCourses)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(t.lectureHrsPerWeek)} hrs of lecture per week (Σ across all this teacher's sections)`}>
        {fmt(t.lectureHrsPerWeek)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(t.labHrsPerWeek)} hrs of lab per week (Σ across all this teacher's sections)`}>
        {fmt(t.labHrsPerWeek)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(t.totalContactHrsPerWeek)} hrs/wk total · ${t.sections > 0 ? (t.totalContactHrsPerWeek / t.sections).toFixed(1) : '0'} avg per section`}>
        <HrsPill hrs={t.totalContactHrsPerWeek} />
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(t.studentsTaught)} student-seats taught`}>
        {fmt(t.studentsTaught)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums" title={`${fmt(t.teamTaughtSections)} sections shared with at least one co-teacher`}>
        {fmt(t.teamTaughtSections)}
      </td>
    </tr>
  );

  return (
    <div className="overflow-x-auto max-h-[640px] overflow-y-auto border border-line rounded-md">
      <table className="w-full text-[11px] border-collapse">
        <thead className="sticky top-0 bg-surface-2 z-10 border-b border-line text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-2 py-1.5 text-left sticky left-0 bg-surface-2">
              Faculty / level / program / teacher
            </th>
            <SortHeader label="Sections" keyName="sections" tooltip="Number of class-sections the teacher appears on." />
            <SortHeader label="Courses" keyName="distinctCourses" tooltip="Distinct course codes — same course counted once even across many sections. Shown on teacher rows only." />
            <SortHeader
              label="Lecture hrs / wk"
              keyName="lectureHrs"
              tooltip="Lecture hours per week ('B' in COURSEUNIT 'A (B-C-D)'). Group rows = average per teacher. Teacher row = the teacher's own Σ across all sections."
            />
            <SortHeader
              label="Lab hrs / wk"
              keyName="labHrs"
              tooltip="Laboratory hours per week ('C' in COURSEUNIT 'A (B-C-D)'). Group rows = average per teacher. Teacher row = the teacher's own Σ across all sections."
            />
            <SortHeader label="Total hrs / wk" keyName="contactHrs" tooltip="Σ lecture + lab hours per week across all the teacher's sections." />
            <SortHeader label="Students taught" keyName="students" tooltip="Σ ENROLLSEAT across the teacher's sections — a head-count of the seats they teach into." />
            <SortHeader label="Team-taught" keyName="team" tooltip="Sections where the teacher is one of 2+ teachers in KKUMAIL." />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((f) => {
            const fk = facKeyOf(f);
            const facOpen = openFac.has(fk);
            const isUnresolvedFac = f.facultyId === null;
            const realPrograms = f.levels.reduce(
              (n, l) =>
                n + l.programs.filter((p) => p.programId !== null).length,
              0,
            );
            return (
              <React.Fragment key={fk}>
                {/* ── Faculty row ── */}
                <tr
                  className={`border-b border-line cursor-pointer bg-surface-1 hover:bg-surface-2 ${
                    isUnresolvedFac ? 'italic text-fg-3' : ''
                  }`}
                  onClick={() => toggleFac(fk)}
                >
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap sticky left-0 bg-surface-1">
                    <ChevronRight
                      size={12}
                      className={`inline-block transition-transform mr-1 ${
                        facOpen ? 'rotate-90' : ''
                      }`}
                    />
                    {f.facultyName}
                    <span className="ml-2 text-fg-3 font-normal">
                      · {fmt(realPrograms)} program{realPrograms === 1 ? '' : 's'} ·{' '}
                      {fmt(f.teachers)} teacher{f.teachers === 1 ? '' : 's'}
                    </span>
                  </td>
                  <GroupCells g={f} />
                </tr>

                {/* ── Program-level rows ── */}
                {facOpen &&
                  f.levels.map((l) => {
                    const lk = `${fk}::${levelKeyOf(l)}`;
                    const levelOpen = openLevel.has(lk);
                    const isFallbackLevel = l.level === null;
                    const levelRealPrograms = l.programs.filter(
                      (p) => p.programId !== null,
                    ).length;
                    // The fallback level's single program child is the
                    // redundant "Not attached to a curriculum" node — skip
                    // it and surface its teachers directly under the level.
                    const fallbackTeachers = isFallbackLevel
                      ? l.programs[0]?.children ?? []
                      : [];
                    return (
                      <React.Fragment key={lk}>
                        <tr
                          className={`border-b border-line/70 cursor-pointer bg-surface-1 hover:bg-surface-2 ${
                            isFallbackLevel ? 'italic text-fg-3' : 'font-medium'
                          }`}
                          onClick={() => toggleLevel(lk)}
                        >
                          <td className="px-2 py-1.5 pl-7 whitespace-nowrap sticky left-0 bg-surface-1">
                            <ChevronRight
                              size={12}
                              className={`inline-block transition-transform mr-1 ${
                                levelOpen ? 'rotate-90' : ''
                              }`}
                            />
                            {isFallbackLevel
                              ? FALLBACK_LABEL
                              : l.level
                                ? LEVEL_LABEL[l.level] ?? l.level
                                : FALLBACK_LABEL}
                            <span className="ml-2 text-fg-3 font-normal">
                              {!isFallbackLevel && (
                                <>
                                  · {fmt(levelRealPrograms)} program
                                  {levelRealPrograms === 1 ? '' : 's'}{' '}
                                </>
                              )}
                              · {fmt(l.teachers)} teacher
                              {l.teachers === 1 ? '' : 's'}
                            </span>
                          </td>
                          <GroupCells g={l} />
                        </tr>

                        {/* Fallback level → teachers directly. */}
                        {levelOpen &&
                          isFallbackLevel &&
                          fallbackTeachers.map((t) => (
                            <TeacherRowEl
                              key={`${lk}::${t.facultyMemberId ?? t.displayName}`}
                              t={t}
                              indent="pl-12"
                            />
                          ))}

                        {/* ── Program rows ── */}
                        {levelOpen &&
                          !isFallbackLevel &&
                          l.programs.map((p) => {
                            const pk = `${lk}::${progKeyOf(p)}`;
                            const progOpen = openProg.has(pk);
                            return (
                              <React.Fragment key={pk}>
                                <tr
                                  className="border-b border-line/50 cursor-pointer bg-surface-1 hover:bg-surface-2"
                                  onClick={() => toggleProg(pk)}
                                  title={`${p.programName}${p.programCode ? ` (${p.programCode})` : ''}`}
                                >
                                  <td className="px-2 py-1.5 pl-12 whitespace-nowrap sticky left-0 bg-surface-1">
                                    <ChevronRight
                                      size={11}
                                      className={`inline-block transition-transform mr-1 ${
                                        progOpen ? 'rotate-90' : ''
                                      }`}
                                    />
                                    <span className="font-medium">{p.programName}</span>
                                    {p.programCode && (
                                      <span className="ml-1.5 text-fg-3 font-normal">
                                        {p.programCode}
                                      </span>
                                    )}
                                    <span className="ml-2 text-fg-3 font-normal">
                                      · {fmt(p.teachers)} teacher
                                      {p.teachers === 1 ? '' : 's'}
                                    </span>
                                  </td>
                                  <GroupCells g={p} />
                                </tr>
                                {progOpen &&
                                  p.children.map((t) => (
                                    <TeacherRowEl
                                      key={`${pk}::${t.facultyMemberId ?? t.displayName}`}
                                      t={t}
                                      indent="pl-16"
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
          {/* Footer totals — lecture + lab shown as average per teacher,
              consistent with the group rows. Teachers / hours count each
              teacher once even when they span several programs. */}
          <tr className="border-t-2 border-line font-semibold bg-surface-2">
            <td className="px-2 py-1.5 sticky left-0 bg-surface-2">
              Total
              <span className="ml-2 text-fg-3 font-normal">
                · {fmt(data.totals.teachers)} teachers ·{' '}
                {fmt(data.totals.programs)} programs
              </span>
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(data.totals.sections)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-fg-3">—</td>
            <td
              className="px-2 py-1.5 text-right tabular-nums"
              title={`Σ ${fmt(data.totals.lectureHrsPerWeek)} hrs/wk of lecture across ${fmt(data.totals.teachers)} teachers · avg ${avgTotLec.toFixed(1)} per teacher`}
            >
              {avgTotLec.toFixed(1)}
              <span className="ml-0.5 text-[9px] text-fg-3">avg</span>
            </td>
            <td
              className="px-2 py-1.5 text-right tabular-nums"
              title={`Σ ${fmt(data.totals.labHrsPerWeek)} hrs/wk of lab across ${fmt(data.totals.teachers)} teachers · avg ${avgTotLab.toFixed(1)} per teacher`}
            >
              {avgTotLab.toFixed(1)}
              <span className="ml-0.5 text-[9px] text-fg-3">avg</span>
            </td>
            <td
              className="px-2 py-1.5 text-right tabular-nums"
              title={`${fmt(data.totals.totalContactHrsPerWeek)} hrs/wk Σ · ${data.totals.avgContactHrsPerTeacher.toFixed(1)} avg per teacher`}
            >
              <HrsPill hrs={data.totals.avgContactHrsPerTeacher} suffix=" avg" />
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(data.totals.studentsTaught)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(data.totals.teamTaughtSections)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function HrsPill({ hrs, suffix = '' }: { hrs: number; suffix?: string }) {
  const colour =
    hrs >= 16 ? BAND_COLOUR.OVER : hrs >= 9 ? BAND_COLOUR.NORMAL : BAND_COLOUR.UNDER;
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded-sm text-white"
      style={{ backgroundColor: colour }}
    >
      {hrs.toFixed(1)}
      {suffix}
    </span>
  );
}

function KpiTile({
  label,
  value,
  hint,
  tone,
  tooltip,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warning';
  tooltip?: string;
}) {
  return (
    <Card className="p-3" title={tooltip}>
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

function LegendSwatch({ colour, label }: { colour: string; label: string }) {
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
