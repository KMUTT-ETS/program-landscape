/**
 * Queries over the Student DQ cubes (`dq_student_cube`, `dq_module_cube`).
 *
 * Every mean is computed as SUM(score_sum) / SUM(taken_count) at the
 * level being displayed — never an average of child means. A faculty
 * mean built from its programs' means would weight a 12-student program
 * the same as a 900-student one; the cubes store sums and counts
 * precisely so that never happens. See `dqModuleMean` in @kku/shared.
 *
 * Modules with no takers return null, never 0: on this dashboard an
 * empty module is a rollout gap, not a competency failure. Module 13
 * (Generative AI) is only ~57% taken because it arrived after most
 * students sat the test — averaging its zeros would read as an AI
 * competency crisis at ~40 instead of its true ~68.
 *
 * PDPA: the cubes carry no student rows at all (names and ids are
 * resolved in memory during ingestion and never persisted). What is left
 * to protect is the small-cell case — see DQ_MIN_CELL_STUDENTS.
 */

import { Prisma } from '@prisma/client';
import { DQ_MODULES, dqModuleMean, type DqModuleKind } from '@kku/shared';
import { prisma } from './index';

export const STUDENT_DQ_METHODOLOGY_VERSION = 'student-dq.v1';

/** Connector slug that writes both cubes — the provenance anchor for
 *  `refreshedAt` and the coverage panel. */
const DQ_SOURCE_SLUG = 'kku-dq';

/**
 * Small-cell suppression floor.
 *
 * A `(faculty × program)` cell can hold very few students — a niche
 * program in a small faculty routinely lands in single digits. On a
 * one-student row, `studentsAllPassed` publishes that individual's DQ
 * verdict to anyone who knows who is enrolled, and `overallMean` is that
 * person's score. This repo's established posture for exactly that shape
 * is a ≥5 gate (`kku-hr` compensation buckets, `kku-registry` status
 * counts, `EvaluationResponseSummary.respondentCount`), applied at the
 * source. The DQ cubes are dimensioned finer than the gate the connector
 * can apply, so the gate lives here instead — at the single layer every
 * consumer (API, page, radar, any future export) reads through.
 *
 * Headcounts stay visible: "this program tested 3 students" is a
 * coverage fact, not a disclosure. It is the *verdict* and the *score*
 * that are withheld.
 */
export const DQ_MIN_CELL_STUDENTS = 5;

/**
 * Highest module number the headline `overallMean` averages over.
 *
 * Module 13 (Generative AI) is a partial rollout: measured uptake runs
 * 48.7%–96.7% across the 21 faculties with more than 200 scored
 * students. Including it moves the headline by 0.12–0.94 points purely
 * according to how far the rollout has reached locally, which makes the
 * one column whose entire purpose is cross-faculty comparison not
 * comparable. It keeps its own column and its own radar axis, so
 * nothing is hidden — it is only kept out of the single number faculties
 * are ranked by. Revisit when uptake is uniform.
 */
export const OVERALL_MEAN_MAX_MODULE_NO = 12;

export interface DqFilter {
  /** Thai faculty names as they appear in the cube. */
  facultyName?: string[];
  cohortYearBE?: number[];
}

export interface DqModuleCell {
  moduleKey: string;
  moduleNo: number;
  moduleKind: string;
  mean: number | null;
  takenCount: number;
  studentsInScope: number;
  /** Share of in-scope students who actually took it, 0-100. */
  coveragePct: number | null;
}

export interface DqDrillRow {
  facultyName: string;
  facultyId: string | null;
  programId: string | null;
  programName: string | null;
  studentsTested: number;
  studentsWithScores: number;
  /** Null when the row is suppressed — see DQ_MIN_CELL_STUDENTS. */
  studentsAllPassed: number | null;
  /** Weighted mean across theory modules 1–12; module 13 is excluded
   *  because its rollout is incomplete and its uptake varies by faculty
   *  — see OVERALL_MEAN_MAX_MODULE_NO. Workshops are excluded too: they
   *  are a separate 4-axis view, not part of the headline. */
  overallMean: number | null;
  /** True when this row has fewer than DQ_MIN_CELL_STUDENTS scored
   *  students, so scores and the pass verdict are withheld. The UI shows
   *  the reason rather than leaving a reader to guess at the dashes. */
  suppressed: boolean;
  modules: DqModuleCell[];
}

export interface DqOverview {
  methodologyVersion: string;
  studentsTested: number;
  studentsWithScores: number;
  /** Null when the selection is suppressed — see DQ_MIN_CELL_STUDENTS.
   *  The filter is caller-controlled, so a narrow enough selection is a
   *  small cell like any other. */
  studentsAllPassed: number | null;
  /** True when this selection has fewer than DQ_MIN_CELL_STUDENTS scored
   *  students: `studentsAllPassed` and every `modules[].mean` are then
   *  withheld. Counts stay visible. */
  suppressed: boolean;
  facultyCount: number;
  programsResolved: number;
  studentsUnplaced: number;
  modules: DqModuleCell[];
  refreshedAt: Date | null;
  /** From the connector run's metadata — see the coverage panel. */
  coverage: {
    fetched: number;
    /** Students the source flags `hasResult`. Wider than `withScores` —
     *  a result can carry no module payload. Null when the refresh that
     *  wrote the cubes predates the counter, so a consumer can say "not
     *  reported" rather than print a zero that means "unknown". */
    withResult: number | null;
    withScores: number;
    matchRatePct: number;
    unmatchedFacultyNames: string[];
    allPassedInconsistent: number;
  } | null;
}

export interface DqRadarScope {
  facultyName?: string;
  programId?: string;
  cohortYearBE?: number[];
  kind: DqModuleKind;
}

export interface DqRadarResult {
  methodologyVersion: string;
  scopeLabel: string;
  /** Ordered by moduleNo — the framework's order, not the cube's. */
  scope: DqModuleCell[];
  /** Same modules, same order, computed over every faculty. Never
   *  suppressed: it is unfiltered by construction, so it is an
   *  institution-wide mean over thousands of students and attributable
   *  to nobody. */
  university: DqModuleCell[];
  /** Scored students behind the `scope` series. Visible even when
   *  suppressed — a headcount is not a disclosure. */
  studentsWithScores: number;
  /** True when the scope has fewer than DQ_MIN_CELL_STUDENTS scored
   *  students: every `scope[].mean` and `scope[].coveragePct` is then
   *  withheld. `university` is unaffected. */
  suppressed: boolean;
}

/**
 * Distinct filter values actually present in the cube.
 *
 * The filter rail was otherwise generating a cohort list from a static
 * BE range and offering years with no data behind them. One grouped
 * scan over the student cube instead, so the rail can only offer cuts
 * that return something.
 */
export interface DqFilterOptions {
  methodologyVersion: string;
  facultyNames: string[];
  /** Ascending. Rows whose student id yielded no plausible cohort are
   *  stored with a NULL `cohort_year_be` and are simply absent here —
   *  they are reachable only by not filtering on cohort at all. */
  cohortYearsBE: number[];
}

/** Fresh per call site. Never hoist into a shared const: this repo has a
 *  production incident on reusing one Prisma.Sql across $queryRaw calls
 *  (intermittent `syntax error at or near "$1"` from parameter-index
 *  drift in Prisma's SQL builder) — see the comment at
 *  packages/db/src/dashboard-overview.ts:184-189, and the same note on
 *  `facultyClauseFor` in teaching-talent.ts. */
function dqWhere(f: DqFilter | undefined, alias: string): Prisma.Sql {
  const col = Prisma.raw(alias); // trusted literal, never user input
  const parts: Prisma.Sql[] = [];
  if (f?.facultyName && f.facultyName.length > 0) {
    parts.push(Prisma.sql`${col}.faculty_name = ANY(${f.facultyName}::text[])`);
  }
  if (f?.cohortYearBE && f.cohortYearBE.length > 0) {
    parts.push(Prisma.sql`${col}.cohort_year_be = ANY(${f.cohortYearBE}::int[])`);
  }
  return parts.length === 0 ? Prisma.empty : Prisma.sql`AND ${Prisma.join(parts, ' AND ')}`;
}

interface ModuleAggregateRow {
  module_key: string;
  module_no: number;
  module_kind: string;
  taken: bigint;
  score_sum: number;
  in_scope: bigint;
}

/** One aggregate row → one display cell. The single place the mean and
 *  the coverage percentage are derived, so they can never disagree. */
function toCell(r: {
  module_key: string;
  module_no: number;
  module_kind: string;
  taken: bigint;
  score_sum: number;
  in_scope: bigint;
}): DqModuleCell {
  const taken = Number(r.taken);
  const inScope = Number(r.in_scope);
  return {
    moduleKey: r.module_key,
    moduleNo: r.module_no,
    moduleKind: r.module_kind,
    // Weighted mean at THIS level — never an average of child means.
    mean: dqModuleMean(r.score_sum, taken),
    takenCount: taken,
    studentsInScope: inScope,
    coveragePct: inScope > 0 ? (100 * taken) / inScope : null,
  };
}

/** Blank the score-bearing fields of a cell, keeping its counts. Used on
 *  suppressed rows so the module columns read `—` while the "N of M took
 *  it" headcounts survive. `coveragePct` goes too: over fewer than five
 *  students it is a per-individual statistic like the mean is. */
function suppressCell(cell: DqModuleCell): DqModuleCell {
  return { ...cell, mean: null, coveragePct: null };
}

/**
 * The headline mean: one weighted mean over theory modules 1–12,
 * rebuilt from sums so it agrees with the per-module figures printed
 * beside it, and never an average of the module means.
 *
 * `mean * takenCount` recovers each module's `SUM(score_sum)` — the
 * cells came from that division a moment ago, so this is the same
 * arithmetic, not an approximation of it.
 */
function overallTheoryMean(mods: DqModuleCell[]): number | null {
  const counted = mods.filter(
    (m) => m.moduleKind === 'THEORY' && m.moduleNo <= OVERALL_MEAN_MAX_MODULE_NO,
  );
  const takenTotal = counted.reduce((a, m) => a + m.takenCount, 0);
  const sumTotal = counted.reduce((a, m) => a + (m.mean ?? 0) * m.takenCount, 0);
  return dqModuleMean(sumTotal, takenTotal);
}

/**
 * Scored students behind an arbitrary selection — the suppression test
 * for the two aggregate helpers.
 *
 * `dqOverview` and `dqRadar` group the student dimensions away, so
 * neither of them can see how many people its numbers describe. Without
 * this count they published per-module means for selections as small as
 * one student: a program's radar under a FACULTY_USER's own clamp, or
 * `facultyName=X&cohortYearBE=Y` on either route. Reading the count from
 * `dq_student_cube` under the SAME filter is what makes the gate follow
 * whatever the caller narrowed to.
 */
async function scopedScoredCount(
  filter: DqFilter | undefined,
  programId?: string,
): Promise<number> {
  const programClause = programId ? Prisma.sql`AND s.program_id = ${programId}` : Prisma.empty;
  const [row] = await prisma.$queryRaw<Array<{ scored: bigint }>>`
    SELECT COALESCE(SUM(s.students_with_scores), 0)::bigint AS scored
    FROM dq_student_cube s
    WHERE true ${programClause} ${dqWhere(filter, 's')}
  `;
  return Number(row?.scored ?? 0);
}

export async function dqDrill(
  filter?: DqFilter,
): Promise<{ methodologyVersion: string; rows: DqDrillRow[] }> {
  // Two grouped scans — students and modules — folded together in TS.
  // Grouping collapses the cohort dimension, which is a filter here, not
  // a display level.
  const students = await prisma.$queryRaw<
    Array<{
      faculty_name: string;
      faculty_id: string | null;
      program_id: string | null;
      program_name: string | null;
      tested: bigint;
      scored: bigint;
      passed: bigint;
    }>
  >`
    SELECT s.faculty_name, MAX(s.faculty_id) AS faculty_id, s.program_id,
           MAX(s.program_name) AS program_name,
           SUM(s.students_tested)::bigint      AS tested,
           SUM(s.students_with_scores)::bigint AS scored,
           SUM(s.students_all_passed)::bigint  AS passed
    FROM dq_student_cube s
    WHERE true ${dqWhere(filter, 's')}
    GROUP BY s.faculty_name, s.program_id
    ORDER BY s.faculty_name
  `;

  const modules = await prisma.$queryRaw<
    Array<ModuleAggregateRow & { faculty_name: string; program_id: string | null }>
  >`
    SELECT m.faculty_name, m.program_id, m.module_key, m.module_no, m.module_kind,
           SUM(m.taken_count)::bigint       AS taken,
           SUM(m.score_sum)::float          AS score_sum,
           SUM(m.students_in_scope)::bigint AS in_scope
    FROM dq_module_cube m
    WHERE true ${dqWhere(filter, 'm')}
    GROUP BY m.faculty_name, m.program_id, m.module_key, m.module_no, m.module_kind
  `;

  const key = (facultyName: string, programId: string | null): string =>
    `${facultyName}|${programId ?? ''}`;

  const cells = new Map<string, DqModuleCell[]>();
  for (const r of modules) {
    const k = key(r.faculty_name, r.program_id);
    const list = cells.get(k) ?? [];
    list.push(toCell(r));
    cells.set(k, list);
  }

  const rows: DqDrillRow[] = students.map((s) => {
    const mods = (cells.get(key(s.faculty_name, s.program_id)) ?? []).sort(
      (a, b) => a.moduleNo - b.moduleNo,
    );
    const scored = Number(s.scored);
    const suppressed = scored < DQ_MIN_CELL_STUDENTS;
    return {
      facultyName: s.faculty_name,
      facultyId: s.faculty_id,
      programId: s.program_id,
      programName: s.program_name,
      // Headcounts are never suppressed — see DQ_MIN_CELL_STUDENTS.
      studentsTested: Number(s.tested),
      studentsWithScores: scored,
      studentsAllPassed: suppressed ? null : Number(s.passed),
      overallMean: suppressed ? null : overallTheoryMean(mods),
      suppressed,
      modules: suppressed ? mods.map(suppressCell) : mods,
    };
  });

  return { methodologyVersion: STUDENT_DQ_METHODOLOGY_VERSION, rows };
}

/**
 * Faculty-level rows — the same shape as `dqDrill`, grouped one level up.
 *
 * These are deliberately NOT derived by re-aggregating `dqDrill`'s leaf
 * rows. Suppression nulls `overallMean`, `studentsAllPassed` and every
 * module mean on any `(faculty × program)` cell with fewer than
 * DQ_MIN_CELL_STUDENTS scored students, so a faculty total assembled
 * from its children would quietly omit exactly those students' scores —
 * the mean-of-means trap wearing a different hat. Grouping by
 * `faculty_name` in SQL keeps every scored student in both the numerator
 * and the denominator, and applies the ≥5 gate where it actually belongs
 * (a faculty with <5 scored students is itself a small cell; a faculty
 * with 400 is not, however many of its programs are suppressed).
 */
export async function dqFacultyRows(
  filter?: DqFilter,
): Promise<{ methodologyVersion: string; rows: DqDrillRow[] }> {
  const students = await prisma.$queryRaw<
    Array<{
      faculty_name: string;
      faculty_id: string | null;
      tested: bigint;
      scored: bigint;
      passed: bigint;
    }>
  >`
    SELECT s.faculty_name, MAX(s.faculty_id) AS faculty_id,
           SUM(s.students_tested)::bigint      AS tested,
           SUM(s.students_with_scores)::bigint AS scored,
           SUM(s.students_all_passed)::bigint  AS passed
    FROM dq_student_cube s
    WHERE true ${dqWhere(filter, 's')}
    GROUP BY s.faculty_name
    ORDER BY s.faculty_name
  `;

  const modules = await prisma.$queryRaw<Array<ModuleAggregateRow & { faculty_name: string }>>`
    SELECT m.faculty_name, m.module_key, m.module_no, m.module_kind,
           SUM(m.taken_count)::bigint       AS taken,
           SUM(m.score_sum)::float          AS score_sum,
           SUM(m.students_in_scope)::bigint AS in_scope
    FROM dq_module_cube m
    WHERE true ${dqWhere(filter, 'm')}
    GROUP BY m.faculty_name, m.module_key, m.module_no, m.module_kind
  `;

  const cells = new Map<string, DqModuleCell[]>();
  for (const r of modules) {
    const list = cells.get(r.faculty_name) ?? [];
    list.push(toCell(r));
    cells.set(r.faculty_name, list);
  }

  const rows: DqDrillRow[] = students.map((s) => {
    const mods = (cells.get(s.faculty_name) ?? []).sort((a, b) => a.moduleNo - b.moduleNo);
    const scored = Number(s.scored);
    const suppressed = scored < DQ_MIN_CELL_STUDENTS;
    return {
      facultyName: s.faculty_name,
      facultyId: s.faculty_id,
      // A faculty row is not a program; the page keys the tree off these
      // being null rather than off which array a row arrived in.
      programId: null,
      programName: null,
      studentsTested: Number(s.tested),
      studentsWithScores: scored,
      studentsAllPassed: suppressed ? null : Number(s.passed),
      overallMean: suppressed ? null : overallTheoryMean(mods),
      suppressed,
      modules: suppressed ? mods.map(suppressCell) : mods,
    };
  });

  return { methodologyVersion: STUDENT_DQ_METHODOLOGY_VERSION, rows };
}

/**
 * Portfolio-level KPI figures plus the module profile of the selection.
 *
 * The same two scans as `dqDrill` without the GROUP BY dimensions — the
 * mean is therefore SUM/SUM across every row in the selection, not a
 * mean of the faculty means it sits above.
 *
 * Suppression applies here too. "An aggregate is not a small cell" is
 * only true when the aggregate is over a population the caller did not
 * choose; this filter is caller-controlled, and
 * `?facultyName=X&cohortYearBE=Y` was measured returning one student's
 * per-module scores and pass verdict through this route.
 */
export async function dqOverview(filter?: DqFilter): Promise<DqOverview> {
  const [totals] = await prisma.$queryRaw<
    Array<{
      tested: bigint;
      scored: bigint;
      passed: bigint;
      faculties: bigint;
      programs: bigint;
      unplaced: bigint;
    }>
  >`
    SELECT COALESCE(SUM(s.students_tested), 0)::bigint      AS tested,
           COALESCE(SUM(s.students_with_scores), 0)::bigint AS scored,
           COALESCE(SUM(s.students_all_passed), 0)::bigint  AS passed,
           COUNT(DISTINCT s.faculty_name)::bigint           AS faculties,
           COUNT(DISTINCT s.program_id)::bigint             AS programs,
           COALESCE(SUM(s.students_tested)
             FILTER (WHERE s.program_id IS NULL), 0)::bigint AS unplaced
    FROM dq_student_cube s
    WHERE true ${dqWhere(filter, 's')}
  `;

  const moduleRows = await prisma.$queryRaw<ModuleAggregateRow[]>`
    SELECT m.module_key, m.module_no, m.module_kind,
           SUM(m.taken_count)::bigint       AS taken,
           SUM(m.score_sum)::float          AS score_sum,
           SUM(m.students_in_scope)::bigint AS in_scope
    FROM dq_module_cube m
    WHERE true ${dqWhere(filter, 'm')}
    GROUP BY m.module_key, m.module_no, m.module_kind
    ORDER BY m.module_no
  `;

  const run = await latestDqRun();

  // Read straight off the totals scan — the same number the suppression
  // gate would fetch, so no extra query.
  const scored = Number(totals?.scored ?? 0);
  const suppressed = scored < DQ_MIN_CELL_STUDENTS;
  const cells = moduleRows.map(toCell);

  return {
    methodologyVersion: STUDENT_DQ_METHODOLOGY_VERSION,
    studentsTested: Number(totals?.tested ?? 0),
    studentsWithScores: scored,
    studentsAllPassed: suppressed ? null : Number(totals?.passed ?? 0),
    suppressed,
    facultyCount: Number(totals?.faculties ?? 0),
    // COUNT(DISTINCT program_id) ignores NULLs, so this is the number of
    // real programs — the "Program not identified" bucket is the
    // `studentsUnplaced` headcount beside it, not a program.
    programsResolved: Number(totals?.programs ?? 0),
    studentsUnplaced: Number(totals?.unplaced ?? 0),
    modules: suppressed ? cells.map(suppressCell) : cells,
    refreshedAt: run?.refreshedAt ?? null,
    coverage: run?.coverage ?? null,
  };
}

/**
 * One scope's module profile beside the university's, aligned by index.
 *
 * Both series are reindexed against `DQ_MODULES` of the requested kind:
 * `RadarChartSmall`'s `comparisons` matches series by position, so a
 * module missing from the cube has to appear as a null axis in BOTH
 * arrays rather than being dropped from one and not the other — which
 * would silently rotate one series against the other.
 *
 * The `scope` series carries the same ≥5 gate the drill applies. It is
 * the narrowest route into the cubes — `programId` and `cohortYearBE`
 * both ride through it — and a FACULTY_USER's clamp permits every
 * program in their own faculty, so without the gate a single-student
 * program's per-module scores were readable here while the drill row
 * beside it correctly showed dashes.
 */
export async function dqRadar(scope: DqRadarScope): Promise<DqRadarResult> {
  const scoped = await radarModuleScan(scope);
  // Unfiltered on faculty/program/cohort: the university comparison is
  // the whole population regardless of what the scope narrows to. That
  // is also why it needs no suppression — see the field comment.
  const university = await radarModuleScan({ kind: scope.kind });

  // Counted from the student cube under the scope's OWN filter: the
  // module scan has grouped the student dimensions away and cannot
  // answer "how many people is this".
  const scoredStudents = await scopedScoredCount(
    {
      facultyName: scope.facultyName ? [scope.facultyName] : undefined,
      cohortYearBE: scope.cohortYearBE,
    },
    scope.programId,
  );
  const suppressed = scoredStudents < DQ_MIN_CELL_STUDENTS;

  const axes = DQ_MODULES.filter((m) => m.kind === scope.kind).sort((a, b) => a.no - b.no);
  const align = (rows: ModuleAggregateRow[]): DqModuleCell[] => {
    const byKey = new Map(rows.map((r) => [r.module_key, toCell(r)]));
    return axes.map(
      (m) =>
        byKey.get(m.key) ?? {
          moduleKey: m.key,
          moduleNo: m.no,
          moduleKind: m.kind,
          mean: null,
          takenCount: 0,
          studentsInScope: 0,
          coveragePct: null,
        },
    );
  };

  const scopeCells = align(scoped);

  return {
    methodologyVersion: STUDENT_DQ_METHODOLOGY_VERSION,
    scopeLabel: await resolveScopeLabel(scope),
    scope: suppressed ? scopeCells.map(suppressCell) : scopeCells,
    university: align(university),
    studentsWithScores: scoredStudents,
    suppressed,
  };
}

/**
 * Distinct faculty names and cohort years present in the cube.
 *
 * One grouped scan, filter-aware: passing a clamped filter returns only
 * the values that user can actually reach, so the rail cannot offer a
 * faculty or a cohort whose selection comes back empty.
 */
export async function dqFilterOptions(filter?: DqFilter): Promise<DqFilterOptions> {
  const rows = await prisma.$queryRaw<
    Array<{ faculty_name: string; cohort_year_be: number | null }>
  >`
    SELECT s.faculty_name, s.cohort_year_be
    FROM dq_student_cube s
    WHERE true ${dqWhere(filter, 's')}
    GROUP BY s.faculty_name, s.cohort_year_be
    ORDER BY s.faculty_name
  `;

  const faculties = new Set<string>();
  const cohorts = new Set<number>();
  for (const r of rows) {
    faculties.add(r.faculty_name);
    if (r.cohort_year_be !== null) cohorts.add(r.cohort_year_be);
  }

  return {
    methodologyVersion: STUDENT_DQ_METHODOLOGY_VERSION,
    // localeCompare so Thai names sort as a Thai reader expects rather
    // than by code point.
    facultyNames: [...faculties].sort((a, b) => a.localeCompare(b, 'th')),
    cohortYearsBE: [...cohorts].sort((a, b) => a - b),
  };
}

/** The module scan behind both radar series. `programId` is a radar-only
 *  dimension (the drill-down filter has no program facet), so it is
 *  applied here rather than through `dqWhere`. */
async function radarModuleScan(scope: DqRadarScope): Promise<ModuleAggregateRow[]> {
  const filter: DqFilter = {
    facultyName: scope.facultyName ? [scope.facultyName] : undefined,
    cohortYearBE: scope.cohortYearBE,
  };
  const programClause = scope.programId
    ? Prisma.sql`AND m.program_id = ${scope.programId}`
    : Prisma.empty;

  return prisma.$queryRaw<ModuleAggregateRow[]>`
    SELECT m.module_key, m.module_no, m.module_kind,
           SUM(m.taken_count)::bigint       AS taken,
           SUM(m.score_sum)::float          AS score_sum,
           SUM(m.students_in_scope)::bigint AS in_scope
    FROM dq_module_cube m
    WHERE m.module_kind = ${scope.kind}
      ${programClause}
      ${dqWhere(filter, 'm')}
    GROUP BY m.module_key, m.module_no, m.module_kind
    ORDER BY m.module_no
  `;
}

/** Human label for the radar's scope series. Program name comes from the
 *  cube itself so a program whose row predates a rename still labels as
 *  the DQ refresh saw it. */
async function resolveScopeLabel(scope: DqRadarScope): Promise<string> {
  if (scope.programId) {
    const row = await prisma.dqModuleCube.findFirst({
      where: { programId: scope.programId },
      select: { programName: true, facultyName: true },
    });
    return row?.programName ?? row?.facultyName ?? 'Selected program';
  }
  if (scope.facultyName) return scope.facultyName;
  return 'University';
}

/**
 * Freshness + coverage from the run that wrote the current cubes.
 *
 * The latest SUCCEEDED run is the right anchor rather than the latest
 * run of any status: a failed refresh leaves the previous cube contents
 * in place (see the design doc's error handling), so pairing them with a
 * failed run's timestamp would misdate the data on screen.
 */
async function latestDqRun(): Promise<{
  refreshedAt: Date | null;
  coverage: DqOverview['coverage'];
} | null> {
  const source = await prisma.dataSource.findUnique({
    where: { slug: DQ_SOURCE_SLUG },
    select: { id: true },
  });
  if (!source) return null;

  const run = await prisma.ingestionRun.findFirst({
    where: { dataSourceId: source.id, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
    select: { completedAt: true, createdAt: true, metadata: true },
  });
  if (!run) return null;

  const meta =
    run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata)
      ? (run.metadata as Record<string, unknown>)
      : undefined;

  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  // Distinct from `num`: absent means "this refresh did not count it",
  // which is not the same claim as "it counted zero".
  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const names = Array.isArray(meta?.unmatchedFacultyNames)
    ? meta.unmatchedFacultyNames.filter((n): n is string => typeof n === 'string')
    : [];

  return {
    refreshedAt: run.completedAt ?? run.createdAt,
    coverage: meta
      ? {
          fetched: num(meta.studentsFetched),
          withResult: numOrNull(meta.studentsWithResult),
          withScores: num(meta.studentsWithScores),
          matchRatePct: num(meta.programMatchRatePct),
          unmatchedFacultyNames: names,
          allPassedInconsistent: num(meta.allPassedInconsistent),
        }
      : null,
  };
}
