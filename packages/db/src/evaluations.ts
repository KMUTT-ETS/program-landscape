// ────────────────────────────────────────────────────────────────────────
// Student-evaluation helpers for /education/satisfaction (course-aggregated)
// and /staff/teaching (instructor-individual).
//
// All helpers apply `realDataWhere()` to exclude mocked rows so dashboards
// never show synthetic ratings to Council viewers.
//
// PDPA: cells with `respondentCount < 5` are absent at ingestion time
// (server-side gate). No further suppression is required at the query
// layer beyond that — the rows already represent ≥5-respondent cells.
//
// Methodology version: `kku-evaluations.v1` (the connector's stamp).
// ────────────────────────────────────────────────────────────────────────

import { Prisma } from '@prisma/client';
import { prisma } from './index';

export const EVALUATIONS_METHODOLOGY_VERSION = 'kku-evaluations.v1';

// ── filter shape — shared across all helpers ────────────────────────────

export interface EvaluationFilter {
  /** Buddhist-Era academic years to include. Default: last 5. */
  acadYearBE?: number[];
  /** Semesters (1,2,3,4). Default: [1, 2] (main terms). */
  semester?: number[];
  /** Thai-language faculty names to filter by — clamped by the caller
   *  via `clampFacultyNameFilter`. */
  facultyName?: string[];
}

interface ResolvedFilter {
  acadYearBE: number[] | undefined;
  semester: number[];
  facultyNameTh: string[] | undefined;
}

function resolveFilter(f: EvaluationFilter | undefined): ResolvedFilter {
  return {
    acadYearBE: f?.acadYearBE && f.acadYearBE.length > 0 ? f.acadYearBE : undefined,
    semester: f?.semester && f.semester.length > 0 ? f.semester : [1, 2],
    facultyNameTh: f?.facultyName && f.facultyName.length > 0 ? f.facultyName : undefined,
  };
}

// ── KPI: overall satisfaction over the filter window ────────────────────

export interface OverallSatisfactionResult {
  methodologyVersion: string;
  /** Weighted mean rating (weighted by respondentCount). NULL when no cells. */
  ratingAvg: number | null;
  /** Sum of respondent counts. */
  totalRespondents: number;
  /** Distinct (class × question × instructor) cells included. */
  cellCount: number;
  /** Distinct courses (by courseCode). */
  courseCount: number;
  /** Distinct instructors (FacultyMember rows). */
  instructorCount: number;
  /** Distinct questions. */
  questionCount: number;
  /** Distinct (year, sem) buckets observed. */
  bucketCount: number;
  /** Min rating in window (sanity check). */
  ratingMin: number | null;
  /** Max rating in window. */
  ratingMax: number | null;
  /** Most recent LAST_UPDATE captured from the source. */
  freshness: Date | null;
}

export async function overallSatisfaction(
  filter: EvaluationFilter | undefined,
): Promise<OverallSatisfactionResult> {
  const f = resolveFilter(filter);
  const rows = await prisma.$queryRaw<
    Array<{
      rating_avg: number | null;
      total_respondents: bigint;
      cell_count: bigint;
      course_count: bigint;
      instructor_count: bigint;
      question_count: bigint;
      bucket_count: bigint;
      rating_min: number | null;
      rating_max: number | null;
      freshness: Date | null;
    }>
  >`
    SELECT
      SUM(e.rating_avg::numeric * e.respondent_count)::float / NULLIF(SUM(e.respondent_count), 0)
                                                          AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint        AS total_respondents,
      COUNT(*)::bigint                                    AS cell_count,
      COUNT(DISTINCT e.course_code)::bigint               AS course_count,
      COUNT(DISTINCT e.faculty_member_id)::bigint         AS instructor_count,
      COUNT(DISTINCT e.question_id_registrar)::bigint     AS question_count,
      COUNT(DISTINCT (e.acad_year_be * 10 + e.semester))::bigint AS bucket_count,
      MIN(e.rating_avg)::float                            AS rating_min,
      MAX(e.rating_avg)::float                            AS rating_max,
      MAX(e.last_update_at)                               AS freshness
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    LEFT JOIN faculties f ON f.id = e.faculty_id
    WHERE ds.mocked = false
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
      ${f.facultyNameTh ? Prisma.sql`AND f.name_th = ANY(${f.facultyNameTh}::text[])` : Prisma.empty}
  `;
  const r = rows[0]!;
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    ratingAvg: r.rating_avg !== null ? Number(r.rating_avg) : null,
    totalRespondents: Number(r.total_respondents),
    cellCount: Number(r.cell_count),
    courseCount: Number(r.course_count),
    instructorCount: Number(r.instructor_count),
    questionCount: Number(r.question_count),
    bucketCount: Number(r.bucket_count),
    ratingMin: r.rating_min !== null ? Number(r.rating_min) : null,
    ratingMax: r.rating_max !== null ? Number(r.rating_max) : null,
    freshness: r.freshness,
  };
}

// ── Course-aggregated pivot (Faculty → Program Level → Course) ──────────
//
// One row per (faculty × course × acadYear × semester), aggregated across
// instructors + questions inside the same class. Two grouping shapes are
// offered for the UI:
//
//   1. coursesByYear() — table with year columns, semester filter applied
//      to the aggregate. Drives the main pivot view.
//   2. coursesTrend()  — time series per (faculty, course, year, sem) for
//      the trend chart.
//
// Drilling into a specific course's per-instructor cells is done via
// `instructorScoresForCourse()` (gated by visibility tier).
//
// `coursesByProgram()` is the v2 shape — joins through `program_courses`
// → `programs` to give Faculty → Program Level → Program → Course
// nesting. Replaces `coursesByYear()` for the dashboard; the older
// helper is kept for backwards compatibility (no current callers).

export interface CourseSatisfactionCell {
  ratingAvg: number;
  respondentCount: number;
  cellCount: number;
  /** Number of distinct instructors who contributed (team-teaching). */
  instructorCount: number;
}

export interface CourseSatisfactionRow {
  facultyId: string | null;
  facultyName: string | null;
  /** Crude proxy for level — derived from courseCode prefix length / digits.
   *  KKU convention: numeric 6-digit codes (e.g., 318305) are grad-level;
   *  3-digit/code prefixes (EN24 etc) are undergrad. The UI maps these to
   *  "Undergraduate / Graduate" labels. */
  level: 'undergraduate' | 'graduate' | 'unknown';
  courseCode: string;
  courseNameTh: string | null;
  courseNameEn: string | null;
  /** Aggregate over the window. */
  overall: CourseSatisfactionCell;
  /** Per-year breakdown keyed by `acadYearBE`. */
  byYear: Record<string, CourseSatisfactionCell>;
  yearsObserved: number[];
}

function levelFromCourseCode(code: string): 'undergraduate' | 'graduate' | 'unknown' {
  // KKU convention: 6-digit numeric codes → grad-level subject (medicine,
  // dental, public health, etc.). Alphabetic prefixes (EN241100 etc) →
  // undergrad. Edge case: 5-digit codes treated as unknown.
  if (/^\d{6}$/.test(code)) return 'graduate';
  if (/^[A-Z]/.test(code)) return 'undergraduate';
  return 'unknown';
}

export async function coursesByYear(
  filter: EvaluationFilter | undefined,
): Promise<{
  methodologyVersion: string;
  rows: CourseSatisfactionRow[];
  yearsObserved: number[];
}> {
  const f = resolveFilter(filter);
  const cells = await prisma.$queryRaw<
    Array<{
      faculty_id: string | null;
      faculty_name: string | null;
      course_code: string;
      course_name_th: string | null;
      course_name_en: string | null;
      acad_year_be: number;
      rating_avg: number | null;
      respondent_count: bigint;
      cell_count: bigint;
      instructor_count: bigint;
    }>
  >`
    SELECT
      e.faculty_id                                                    AS faculty_id,
      f.name_th                                                       AS faculty_name,
      e.course_code                                                   AS course_code,
      MAX(e.course_name_th)                                           AS course_name_th,
      MAX(e.course_name_en)                                           AS course_name_en,
      e.acad_year_be                                                  AS acad_year_be,
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint                    AS respondent_count,
      COUNT(*)::bigint                                                AS cell_count,
      COUNT(DISTINCT e.faculty_member_id)::bigint                     AS instructor_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    LEFT JOIN faculties f ON f.id = e.faculty_id
    WHERE ds.mocked = false
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
      ${f.facultyNameTh ? Prisma.sql`AND f.name_th = ANY(${f.facultyNameTh}::text[])` : Prisma.empty}
    GROUP BY e.faculty_id, f.name_th, e.course_code, e.acad_year_be
    ORDER BY f.name_th, e.course_code, e.acad_year_be DESC
  `;
  // Pivot to per-course rows with byYear cells.
  const byCourse = new Map<string, CourseSatisfactionRow>();
  const yearsObservedSet = new Set<number>();
  for (const c of cells) {
    yearsObservedSet.add(c.acad_year_be);
    const key = `${c.faculty_id ?? ''}|${c.course_code}`;
    let row = byCourse.get(key);
    if (!row) {
      row = {
        facultyId: c.faculty_id,
        facultyName: c.faculty_name,
        level: levelFromCourseCode(c.course_code),
        courseCode: c.course_code,
        courseNameTh: c.course_name_th,
        courseNameEn: c.course_name_en,
        overall: { ratingAvg: 0, respondentCount: 0, cellCount: 0, instructorCount: 0 },
        byYear: {},
        yearsObserved: [],
      };
      byCourse.set(key, row);
    }
    const cell: CourseSatisfactionCell = {
      ratingAvg: c.rating_avg !== null ? Number(c.rating_avg) : 0,
      respondentCount: Number(c.respondent_count),
      cellCount: Number(c.cell_count),
      instructorCount: Number(c.instructor_count),
    };
    row.byYear[String(c.acad_year_be)] = cell;
    row.yearsObserved.push(c.acad_year_be);
    // Roll into overall.
    row.overall.respondentCount += cell.respondentCount;
    row.overall.cellCount += cell.cellCount;
    row.overall.instructorCount = Math.max(row.overall.instructorCount, cell.instructorCount);
  }
  // Compute weighted overall.ratingAvg per row across years.
  for (const row of byCourse.values()) {
    let num = 0;
    let den = 0;
    for (const cell of Object.values(row.byYear)) {
      num += cell.ratingAvg * cell.respondentCount;
      den += cell.respondentCount;
    }
    row.overall.ratingAvg = den > 0 ? num / den : 0;
    row.yearsObserved.sort((a, b) => b - a);
  }
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    rows: [...byCourse.values()],
    yearsObserved: [...yearsObservedSet].sort((a, b) => b - a),
  };
}

// ── Faculty → Program Level → Program → Course pivot (v2) ──────────────
//
// Joins evaluation cells through `program_courses` → `programs` so each
// course is attributed to its parent program(s). A course shared by N
// programs contributes to all N — same posture as the class-GPA
// dashboard's by-program rollup. The UI renders a 4-level expandable
// tree.

export interface ProgramCourseSatisfactionRow {
  facultyId: string;
  facultyName: string;
  programLevel: string;
  programId: string;
  programName: string;
  courseCode: string;
  courseName: string | null;
  overall: CourseSatisfactionCell;
  byYear: Record<string, CourseSatisfactionCell>;
  yearsObserved: number[];
}

export async function coursesByProgram(
  filter: EvaluationFilter | undefined,
): Promise<{
  methodologyVersion: string;
  rows: ProgramCourseSatisfactionRow[];
  yearsObserved: number[];
}> {
  const f = resolveFilter(filter);
  // The join chain:
  //   EvaluationResponseSummary e
  //     ↳ program_courses pc  ON pc.course_code = e.course_code
  //     ↳ programs p          ON p.id = pc.program_id
  //     ↳ faculties fp        ON fp.id = p.faculty_id
  // We use p.faculty_id (the program's owning faculty) for both grouping
  // and filtering — this ensures a course that's shared across faculties
  // (general-ed) gets attributed to the right faculty per program. We
  // also require e.faculty_id IS NOT NULL so courses on classes whose
  // ClassOffering didn't resolve to a Faculty (older years) are dropped
  // — matches the user's "hide unknown faculty" tweak.
  const cells = await prisma.$queryRaw<
    Array<{
      faculty_id: string;
      faculty_name: string;
      program_level: string;
      program_id: string;
      program_name: string;
      course_code: string;
      course_name: string | null;
      acad_year_be: number;
      rating_avg: number | null;
      respondent_count: bigint;
      cell_count: bigint;
      instructor_count: bigint;
    }>
  >`
    SELECT
      fp.id                                                            AS faculty_id,
      fp.name_th                                                       AS faculty_name,
      p.level::text                                                    AS program_level,
      p.id                                                             AS program_id,
      p.name_th                                                        AS program_name,
      e.course_code                                                    AS course_code,
      MAX(e.course_name_th)                                            AS course_name,
      e.acad_year_be                                                   AS acad_year_be,
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint                     AS respondent_count,
      COUNT(*)::bigint                                                 AS cell_count,
      COUNT(DISTINCT e.faculty_member_id)::bigint                      AS instructor_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN program_courses pc ON pc.course_code = e.course_code
    JOIN programs p ON p.id = pc.program_id
    JOIN faculties fp ON fp.id = p.faculty_id
    WHERE ds.mocked = false
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
      ${f.facultyNameTh ? Prisma.sql`AND fp.name_th = ANY(${f.facultyNameTh}::text[])` : Prisma.empty}
    GROUP BY fp.id, fp.name_th, p.level, p.id, p.name_th, e.course_code, e.acad_year_be
    ORDER BY fp.name_th, p.level, p.name_th, e.course_code, e.acad_year_be DESC
  `;
  const byCourse = new Map<string, ProgramCourseSatisfactionRow>();
  const yearsObservedSet = new Set<number>();
  for (const c of cells) {
    yearsObservedSet.add(c.acad_year_be);
    const key = `${c.program_id}|${c.course_code}`;
    let row = byCourse.get(key);
    if (!row) {
      row = {
        facultyId: c.faculty_id,
        facultyName: c.faculty_name,
        programLevel: c.program_level,
        programId: c.program_id,
        programName: c.program_name,
        courseCode: c.course_code,
        courseName: c.course_name,
        overall: { ratingAvg: 0, respondentCount: 0, cellCount: 0, instructorCount: 0 },
        byYear: {},
        yearsObserved: [],
      };
      byCourse.set(key, row);
    }
    const cell: CourseSatisfactionCell = {
      ratingAvg: c.rating_avg !== null ? Number(c.rating_avg) : 0,
      respondentCount: Number(c.respondent_count),
      cellCount: Number(c.cell_count),
      instructorCount: Number(c.instructor_count),
    };
    row.byYear[String(c.acad_year_be)] = cell;
    row.yearsObserved.push(c.acad_year_be);
    row.overall.respondentCount += cell.respondentCount;
    row.overall.cellCount += cell.cellCount;
    row.overall.instructorCount = Math.max(row.overall.instructorCount, cell.instructorCount);
  }
  for (const row of byCourse.values()) {
    let num = 0;
    let den = 0;
    for (const cell of Object.values(row.byYear)) {
      num += cell.ratingAvg * cell.respondentCount;
      den += cell.respondentCount;
    }
    row.overall.ratingAvg = den > 0 ? num / den : 0;
    row.yearsObserved.sort((a, b) => b - a);
  }
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    rows: [...byCourse.values()],
    yearsObserved: [...yearsObservedSet].sort((a, b) => b - a),
  };
}

// ── Per-question detail at arbitrary scope (hover tooltip) ──────────────
//
// Returns the per-question score breakdown for a slice of cells defined
// by any combination of (facultyId, programLevel, programId, courseCode,
// acadYearBE). The page-level facultyName / semester filter from
// `EvaluationFilter` always applies. Used by the cell-hover tooltip on
// /education/satisfaction — every rating cell in the pivot opens a
// tooltip scoped to that cell's faculty / level / program / course /
// year.

export interface CourseQuestionDetail {
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

export interface QuestionDetailScope {
  facultyId?: string;
  programLevel?: string;
  programId?: string;
  courseCode?: string;
  facultyMemberId?: string;
  acadYearBE?: number;
}

export async function courseQuestionDetail(args: {
  facultyId?: string;
  programLevel?: string;
  programId?: string;
  courseCode?: string;
  facultyMemberId?: string;
  acadYearBE?: number;
  filter?: EvaluationFilter;
}): Promise<{
  methodologyVersion: string;
  scope: QuestionDetailScope;
  questions: CourseQuestionDetail[];
  overall: { ratingAvg: number; respondentCount: number; cellCount: number };
}> {
  const f = resolveFilter(args.filter);
  // The join through program_courses → programs is required whenever the
  // scope crosses a program boundary (faculty/level/program filters or
  // when a specific programId is supplied). It's also helpful for the
  // courseCode-only case if we want to disambiguate, but for that path
  // we keep it off so we don't double-count cells when a course belongs
  // to multiple programs.
  const usingProgramScope = !!(
    args.facultyId ||
    args.programLevel ||
    args.programId
  );
  const programJoin = usingProgramScope
    ? Prisma.sql`
        JOIN program_courses pc ON pc.course_code = e.course_code
        JOIN programs p ON p.id = pc.program_id`
    : Prisma.empty;

  const conds: Prisma.Sql[] = [Prisma.sql`ds.mocked = false`];
  if (args.facultyId) conds.push(Prisma.sql`p.faculty_id = ${args.facultyId}`);
  if (args.programLevel)
    conds.push(Prisma.sql`p.level::text = ${args.programLevel}`);
  if (args.programId) conds.push(Prisma.sql`pc.program_id = ${args.programId}`);
  if (args.courseCode) conds.push(Prisma.sql`e.course_code = ${args.courseCode}`);
  if (args.facultyMemberId)
    conds.push(Prisma.sql`e.faculty_member_id = ${args.facultyMemberId}`);
  if (args.acadYearBE !== undefined)
    conds.push(Prisma.sql`e.acad_year_be = ${args.acadYearBE}`);
  else if (f.acadYearBE)
    conds.push(Prisma.sql`e.acad_year_be = ANY(${f.acadYearBE}::int[])`);
  conds.push(Prisma.sql`e.semester = ANY(${f.semester}::int[])`);
  // Faculty-name clamp from the page filter — only valid when we've
  // joined programs/faculties (otherwise e.faculty_id is the proxy).
  if (f.facultyNameTh) {
    if (usingProgramScope) {
      // Use the program's faculty, which matches the table's grouping.
      conds.push(
        Prisma.sql`p.faculty_id IN (SELECT id FROM faculties WHERE name_th = ANY(${f.facultyNameTh}::text[]))`,
      );
    } else {
      // Fall back to the cell's own facultyId.
      conds.push(
        Prisma.sql`e.faculty_id IN (SELECT id FROM faculties WHERE name_th = ANY(${f.facultyNameTh}::text[]))`,
      );
    }
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;

  const rows = await prisma.$queryRaw<
    Array<{
      question_id: string | null;
      question_id_registrar: string;
      rating_avg: number | null;
      respondent_count: bigint;
      cell_count: bigint;
    }>
  >(Prisma.sql`
    SELECT
      e.question_id,
      e.question_id_registrar,
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint AS respondent_count,
      COUNT(*)::bigint AS cell_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    ${programJoin}
    ${where}
    GROUP BY e.question_id, e.question_id_registrar
    ORDER BY e.question_id_registrar ASC
  `);
  // Pull question metadata (TH/EN text + theme).
  const questionRows = await prisma.evaluationQuestion.findMany({
    where: { questionIdRegistrar: { in: rows.map((r) => r.question_id_registrar) } },
    select: {
      id: true,
      questionIdRegistrar: true,
      questionTextTh: true,
      questionTextEn: true,
      questionTextEnOverride: true,
      themeTag: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  const byQid = new Map<string, (typeof questionRows)[number]>();
  for (const q of questionRows) {
    if (!byQid.has(q.questionIdRegistrar)) byQid.set(q.questionIdRegistrar, q);
  }
  const questions: CourseQuestionDetail[] = rows.map((r) => {
    const meta = byQid.get(r.question_id_registrar);
    return {
      questionId: meta?.id ?? '',
      questionIdRegistrar: r.question_id_registrar,
      questionTextTh: meta?.questionTextTh ?? '(unknown question)',
      questionTextEn: meta?.questionTextEn ?? null,
      questionTextEnOverride: meta?.questionTextEnOverride ?? null,
      themeTag: meta?.themeTag ?? null,
      ratingAvg: r.rating_avg !== null ? Number(r.rating_avg) : 0,
      respondentCount: Number(r.respondent_count),
      cellCount: Number(r.cell_count),
    };
  });
  // Overall weighted rating for the scope.
  let num = 0;
  let den = 0;
  let cells = 0;
  for (const q of questions) {
    num += q.ratingAvg * q.respondentCount;
    den += q.respondentCount;
    cells += q.cellCount;
  }
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    scope: {
      facultyId: args.facultyId,
      programLevel: args.programLevel,
      programId: args.programId,
      courseCode: args.courseCode,
      facultyMemberId: args.facultyMemberId,
      acadYearBE: args.acadYearBE,
    },
    questions,
    overall: {
      ratingAvg: den > 0 ? num / den : 0,
      respondentCount: den,
      cellCount: cells,
    },
  };
}

// ── Course detail (click-to-drill panel) ────────────────────────────────
//
// Richer payload for the click-into-course panel below the pivot table.
// Returns summary + (year × sem) trend + per-question breakdown + a
// per-year breakdown per question (heatmap rows).
//
// Course-aggregated only — no per-instructor names exposed.

export interface CourseDetailResult {
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
  trend: SatisfactionTrendPoint[];
  byQuestion: Array<
    CourseQuestionDetail & {
      byYear: Record<string, { ratingAvg: number; respondentCount: number }>;
    }
  >;
}

export async function courseDetail(args: {
  programId: string;
  courseCode: string;
  filter?: EvaluationFilter;
}): Promise<CourseDetailResult> {
  const f = resolveFilter(args.filter);
  // Pull every cell for this (program, course) in window — small fan-out
  // (hundreds of rows max for the most-taught courses).
  const cells = await prisma.$queryRaw<
    Array<{
      acad_year_be: number;
      semester: number;
      class_id_registrar: bigint;
      faculty_member_id: string | null;
      question_id: string | null;
      question_id_registrar: string;
      rating_avg: number;
      respondent_count: number;
    }>
  >`
    SELECT
      e.acad_year_be, e.semester,
      e.class_id_registrar,
      e.faculty_member_id,
      e.question_id, e.question_id_registrar,
      e.rating_avg::float AS rating_avg,
      e.respondent_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN program_courses pc ON pc.course_code = e.course_code
      AND pc.program_id = ${args.programId}
    WHERE ds.mocked = false
      AND e.course_code = ${args.courseCode}
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
  `;
  // Summary aggregates.
  let sumW = 0;
  let sumD = 0;
  const classes = new Set<string>();
  const instructors = new Set<string>();
  const questions = new Set<string>();
  const buckets = new Set<string>();
  const years = new Set<number>();
  for (const c of cells) {
    sumW += c.rating_avg * c.respondent_count;
    sumD += c.respondent_count;
    classes.add(c.class_id_registrar.toString());
    if (c.faculty_member_id) instructors.add(c.faculty_member_id);
    questions.add(c.question_id_registrar);
    buckets.add(`${c.acad_year_be}-${c.semester}`);
    years.add(c.acad_year_be);
  }
  // Per-(year × sem) trend.
  type Bucket = { sumW: number; sumD: number; cellCount: number; classes: Set<string>; courses: Set<string>; year: number; sem: number };
  const trendMap = new Map<string, Bucket>();
  for (const c of cells) {
    const k = `${c.acad_year_be}-${c.semester}`;
    let t = trendMap.get(k);
    if (!t) {
      t = { sumW: 0, sumD: 0, cellCount: 0, classes: new Set(), courses: new Set([args.courseCode]), year: c.acad_year_be, sem: c.semester };
      trendMap.set(k, t);
    }
    t.sumW += c.rating_avg * c.respondent_count;
    t.sumD += c.respondent_count;
    t.cellCount++;
    t.classes.add(c.class_id_registrar.toString());
  }
  const trend: SatisfactionTrendPoint[] = [...trendMap.values()]
    .sort((a, b) => a.year * 10 + a.sem - (b.year * 10 + b.sem))
    .map((t) => ({
      acadYearBE: t.year,
      semester: t.sem,
      label: `BE ${t.year} / S${t.sem}`,
      ratingAvg: t.sumD > 0 ? t.sumW / t.sumD : null,
      respondentCount: t.sumD,
      cellCount: t.cellCount,
      courseCount: 1,
    }));
  // Per-question heatmap (with byYear breakdown).
  type QStat = {
    ratingSumW: number;
    ratingSumD: number;
    cellCount: number;
    byYear: Map<number, { sumW: number; sumD: number }>;
  };
  const byQid = new Map<string, QStat>();
  for (const c of cells) {
    let q = byQid.get(c.question_id_registrar);
    if (!q) {
      q = { ratingSumW: 0, ratingSumD: 0, cellCount: 0, byYear: new Map() };
      byQid.set(c.question_id_registrar, q);
    }
    q.ratingSumW += c.rating_avg * c.respondent_count;
    q.ratingSumD += c.respondent_count;
    q.cellCount++;
    let y = q.byYear.get(c.acad_year_be);
    if (!y) {
      y = { sumW: 0, sumD: 0 };
      q.byYear.set(c.acad_year_be, y);
    }
    y.sumW += c.rating_avg * c.respondent_count;
    y.sumD += c.respondent_count;
  }
  const questionRows = await prisma.evaluationQuestion.findMany({
    where: { questionIdRegistrar: { in: [...byQid.keys()] } },
    select: {
      id: true,
      questionIdRegistrar: true,
      questionTextTh: true,
      questionTextEn: true,
      questionTextEnOverride: true,
      themeTag: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  const questionByQid = new Map<string, (typeof questionRows)[number]>();
  for (const q of questionRows) {
    if (!questionByQid.has(q.questionIdRegistrar))
      questionByQid.set(q.questionIdRegistrar, q);
  }
  const byQuestion = [...byQid.entries()]
    .map(([qid, stat]) => {
      const meta = questionByQid.get(qid);
      const byYear: Record<string, { ratingAvg: number; respondentCount: number }> = {};
      for (const [year, y] of stat.byYear.entries()) {
        byYear[String(year)] = {
          ratingAvg: y.sumD > 0 ? y.sumW / y.sumD : 0,
          respondentCount: y.sumD,
        };
      }
      return {
        questionId: meta?.id ?? '',
        questionIdRegistrar: qid,
        questionTextTh: meta?.questionTextTh ?? '(unknown)',
        questionTextEn: meta?.questionTextEn ?? null,
        questionTextEnOverride: meta?.questionTextEnOverride ?? null,
        themeTag: meta?.themeTag ?? null,
        ratingAvg: stat.ratingSumD > 0 ? stat.ratingSumW / stat.ratingSumD : 0,
        cellCount: stat.cellCount,
        respondentCount: stat.ratingSumD,
        byYear,
      };
    })
    .sort((a, b) => a.questionIdRegistrar.localeCompare(b.questionIdRegistrar));

  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    programId: args.programId,
    courseCode: args.courseCode,
    summary: {
      ratingAvg: sumD > 0 ? sumW / sumD : 0,
      totalRespondents: sumD,
      cellCount: cells.length,
      courseSectionCount: classes.size,
      classCount: classes.size,
      instructorCount: instructors.size,
      questionCount: questions.size,
      semestersObserved: buckets.size,
      yearsObserved: [...years].sort((a, b) => b - a),
    },
    trend,
    byQuestion,
  };
}

// ── Trend over time ─────────────────────────────────────────────────────

export interface SatisfactionTrendPoint {
  acadYearBE: number;
  semester: number;
  /** "BE 2568 / S1" label for the chart. */
  label: string;
  ratingAvg: number | null;
  respondentCount: number;
  cellCount: number;
  courseCount: number;
}

export async function trend(
  filter: EvaluationFilter | undefined,
): Promise<{
  methodologyVersion: string;
  points: SatisfactionTrendPoint[];
}> {
  const f = resolveFilter(filter);
  const rows = await prisma.$queryRaw<
    Array<{
      acad_year_be: number;
      semester: number;
      rating_avg: number | null;
      respondent_count: bigint;
      cell_count: bigint;
      course_count: bigint;
    }>
  >`
    SELECT
      e.acad_year_be,
      e.semester,
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint AS respondent_count,
      COUNT(*)::bigint AS cell_count,
      COUNT(DISTINCT e.course_code)::bigint AS course_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    LEFT JOIN faculties f ON f.id = e.faculty_id
    WHERE ds.mocked = false
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
      ${f.facultyNameTh ? Prisma.sql`AND f.name_th = ANY(${f.facultyNameTh}::text[])` : Prisma.empty}
    GROUP BY e.acad_year_be, e.semester
    ORDER BY e.acad_year_be ASC, e.semester ASC
  `;
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    points: rows.map((r) => ({
      acadYearBE: r.acad_year_be,
      semester: r.semester,
      label: `BE ${r.acad_year_be} / S${r.semester}`,
      ratingAvg: r.rating_avg !== null ? Number(r.rating_avg) : null,
      respondentCount: Number(r.respondent_count),
      cellCount: Number(r.cell_count),
      courseCount: Number(r.course_count),
    })),
  };
}

// ── Question gaps (bottom-decile per faculty × question × semester) ─────
//
// Definition: for each (faculty, question, year × semester) peer set,
// compute the within-faculty 10th-percentile rating. Cells below that are
// "gaps". Return the questions with the most gap-cells in the window,
// sorted by gap count desc + lowest-mean asc as tiebreaker.

export interface QuestionGap {
  questionId: string;
  questionIdRegistrar: string;
  questionTextTh: string;
  questionTextEn: string | null;
  questionTextEnOverride: string | null;
  themeTag: string | null;
  /** Weighted average rating across all cells touching this question. */
  ratingAvg: number;
  /** Count of cells that came in below the 10th-percentile band within
   *  their faculty/question/semester peer set. */
  gapCellCount: number;
  /** Cells touching this question in the window. */
  totalCellCount: number;
  /** Sample courses with the lowest ratings on this question. */
  sampleCourses: Array<{
    courseCode: string;
    courseNameTh: string | null;
    ratingAvg: number;
    respondentCount: number;
    acadYearBE: number;
    semester: number;
    facultyName: string | null;
  }>;
}

export async function questionGaps(
  filter: EvaluationFilter | undefined,
): Promise<{ methodologyVersion: string; gaps: QuestionGap[] }> {
  const f = resolveFilter(filter);
  // Step 1: pull every cell in window + window aggregates per question.
  const cells = await prisma.$queryRaw<
    Array<{
      question_id: string | null;
      question_id_registrar: string;
      faculty_id: string | null;
      faculty_name: string | null;
      acad_year_be: number;
      semester: number;
      course_code: string;
      course_name_th: string | null;
      rating_avg: number;
      respondent_count: number;
    }>
  >`
    SELECT
      e.question_id,
      e.question_id_registrar,
      e.faculty_id,
      f.name_th AS faculty_name,
      e.acad_year_be,
      e.semester,
      e.course_code,
      e.course_name_th,
      e.rating_avg::float AS rating_avg,
      e.respondent_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    LEFT JOIN faculties f ON f.id = e.faculty_id
    WHERE ds.mocked = false
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
      ${f.facultyNameTh ? Prisma.sql`AND f.name_th = ANY(${f.facultyNameTh}::text[])` : Prisma.empty}
  `;
  // Step 2: compute 10th-percentile thresholds per (faculty, question, semester).
  type Bucket = { values: number[]; cells: typeof cells };
  const buckets = new Map<string, Bucket>();
  for (const c of cells) {
    const k = `${c.faculty_id ?? ''}|${c.question_id_registrar}|${c.semester}`;
    let b = buckets.get(k);
    if (!b) {
      b = { values: [], cells: [] };
      buckets.set(k, b);
    }
    b.values.push(c.rating_avg);
    b.cells.push(c);
  }
  const thresholdByKey = new Map<string, number>();
  for (const [k, b] of buckets.entries()) {
    if (b.values.length === 0) continue;
    const sorted = [...b.values].sort((a, b) => a - b);
    // 10th percentile, linear interpolation.
    const idx = Math.max(0, Math.floor(sorted.length * 0.1) - 1);
    thresholdByKey.set(k, sorted[idx] ?? 0);
  }
  // Step 3: tally gap-cells per question.
  const byQid = new Map<
    string,
    {
      questionIdRegistrar: string;
      gapCellCount: number;
      totalCellCount: number;
      ratingSumW: number;
      ratingSumD: number;
      sample: Array<{
        rating: number;
        course_code: string;
        course_name_th: string | null;
        respondent_count: number;
        acad_year_be: number;
        semester: number;
        faculty_name: string | null;
      }>;
    }
  >();
  for (const c of cells) {
    let entry = byQid.get(c.question_id_registrar);
    if (!entry) {
      entry = {
        questionIdRegistrar: c.question_id_registrar,
        gapCellCount: 0,
        totalCellCount: 0,
        ratingSumW: 0,
        ratingSumD: 0,
        sample: [],
      };
      byQid.set(c.question_id_registrar, entry);
    }
    entry.totalCellCount++;
    entry.ratingSumW += c.rating_avg * c.respondent_count;
    entry.ratingSumD += c.respondent_count;
    const k = `${c.faculty_id ?? ''}|${c.question_id_registrar}|${c.semester}`;
    const threshold = thresholdByKey.get(k);
    if (threshold !== undefined && c.rating_avg <= threshold) {
      entry.gapCellCount++;
      entry.sample.push({
        rating: c.rating_avg,
        course_code: c.course_code,
        course_name_th: c.course_name_th,
        respondent_count: c.respondent_count,
        acad_year_be: c.acad_year_be,
        semester: c.semester,
        faculty_name: c.faculty_name,
      });
    }
  }
  // Step 4: enrich with question text + sample courses (top 5 lowest).
  const questionRows = await prisma.evaluationQuestion.findMany({
    where: { questionIdRegistrar: { in: [...byQid.keys()] } },
    select: {
      id: true,
      questionIdRegistrar: true,
      questionTextTh: true,
      questionTextEn: true,
      questionTextEnOverride: true,
      themeTag: true,
      lastSeenYearBE: true,
    },
    orderBy: [{ lastSeenYearBE: 'desc' }, { updatedAt: 'desc' }],
  });
  const questionByQid = new Map<string, (typeof questionRows)[number]>();
  for (const q of questionRows) {
    if (!questionByQid.has(q.questionIdRegistrar)) {
      questionByQid.set(q.questionIdRegistrar, q);
    }
  }
  const gaps: QuestionGap[] = [];
  for (const e of byQid.values()) {
    const q = questionByQid.get(e.questionIdRegistrar);
    e.sample.sort((a, b) => a.rating - b.rating);
    gaps.push({
      questionId: q?.id ?? '',
      questionIdRegistrar: e.questionIdRegistrar,
      questionTextTh: q?.questionTextTh ?? '(unknown question)',
      questionTextEn: q?.questionTextEn ?? null,
      questionTextEnOverride: q?.questionTextEnOverride ?? null,
      themeTag: q?.themeTag ?? null,
      ratingAvg: e.ratingSumD > 0 ? e.ratingSumW / e.ratingSumD : 0,
      gapCellCount: e.gapCellCount,
      totalCellCount: e.totalCellCount,
      sampleCourses: e.sample.slice(0, 5).map((s) => ({
        courseCode: s.course_code,
        courseNameTh: s.course_name_th,
        ratingAvg: s.rating,
        respondentCount: s.respondent_count,
        acadYearBE: s.acad_year_be,
        semester: s.semester,
        facultyName: s.faculty_name,
      })),
    });
  }
  gaps.sort((a, b) => {
    if (b.gapCellCount !== a.gapCellCount) return b.gapCellCount - a.gapCellCount;
    return a.ratingAvg - b.ratingAvg;
  });
  return { methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION, gaps };
}

// ── Question catalog ────────────────────────────────────────────────────

export async function questionCatalog(): Promise<
  Array<{
    id: string;
    questionIdRegistrar: string;
    questionTextTh: string;
    questionTextEn: string | null;
    questionTextEnOverride: string | null;
    themeTag: string | null;
    isCore: boolean;
    firstSeenYearBE: number;
    lastSeenYearBE: number;
    semestersUsed: number;
  }>
> {
  // Each QID may have multiple text-version rows; surface the latest one
  // per QID. The UI groups by `questionIdRegistrar`.
  const rows = await prisma.evaluationQuestion.findMany({
    select: {
      id: true,
      questionIdRegistrar: true,
      questionTextTh: true,
      questionTextEn: true,
      questionTextEnOverride: true,
      themeTag: true,
      isCore: true,
      firstSeenYearBE: true,
      lastSeenYearBE: true,
      semestersUsed: true,
      updatedAt: true,
    },
    orderBy: [{ questionIdRegistrar: 'asc' }, { updatedAt: 'desc' }],
  });
  const byQid = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!byQid.has(r.questionIdRegistrar)) byQid.set(r.questionIdRegistrar, r);
  }
  return [...byQid.values()].map((r) => ({
    id: r.id,
    questionIdRegistrar: r.questionIdRegistrar,
    questionTextTh: r.questionTextTh,
    questionTextEn: r.questionTextEn,
    questionTextEnOverride: r.questionTextEnOverride,
    themeTag: r.themeTag,
    isCore: r.isCore,
    firstSeenYearBE: r.firstSeenYearBE,
    lastSeenYearBE: r.lastSeenYearBE,
    semestersUsed: r.semestersUsed,
  }));
}

// ── /staff/teaching helpers ─────────────────────────────────────────────

export interface InstructorFilter extends EvaluationFilter {
  /** Restrict to a single instructor (own-view OR drill-down). */
  facultyMemberId?: string;
}

/** Resolve filter for instructor queries — extends `resolveFilter` with
 *  an optional facultyMemberId constraint. */
function resolveInstructorFilter(f: InstructorFilter | undefined): ResolvedFilter & {
  facultyMemberId: string | undefined;
} {
  return {
    ...resolveFilter(f),
    facultyMemberId: f?.facultyMemberId,
  };
}

export interface InstructorSatisfactionRow {
  facultyMemberId: string;
  nameTh: string;
  nameEn: string;
  facultyId: string | null;
  facultyName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  rank: string;
  isActive: boolean;
  /** Weighted mean rating in window. */
  ratingAvg: number;
  /** Sum of respondents across all this instructor's cells in window. */
  totalRespondents: number;
  /** Distinct (class × question) cells. */
  cellCount: number;
  /** Distinct courses they taught in window. */
  courseCount: number;
  /** Most-recent semester they have evaluations in. */
  latestYearBE: number;
  latestSemester: number;
}

export async function instructorRoster(
  filter: EvaluationFilter | undefined,
): Promise<{ methodologyVersion: string; rows: InstructorSatisfactionRow[] }> {
  const f = resolveFilter(filter);
  const rows = await prisma.$queryRaw<
    Array<{
      faculty_member_id: string;
      name_th: string;
      name_en: string;
      faculty_id: string | null;
      faculty_name: string | null;
      department_id: string | null;
      department_name: string | null;
      rank: string;
      is_active: boolean;
      rating_avg: number | null;
      total_respondents: bigint;
      cell_count: bigint;
      course_count: bigint;
      latest_year: number;
      latest_sem: number;
    }>
  >`
    SELECT
      fm.id                                                 AS faculty_member_id,
      fm.name_th                                            AS name_th,
      fm.name_en                                            AS name_en,
      fm.faculty_id                                         AS faculty_id,
      f.name_th                                             AS faculty_name,
      fm.department_id                                      AS department_id,
      d.name_th                                             AS department_name,
      fm.rank::text                                         AS rank,
      fm.is_active                                          AS is_active,
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint           AS total_respondents,
      COUNT(*)::bigint                                       AS cell_count,
      COUNT(DISTINCT e.course_code)::bigint                  AS course_count,
      MAX(e.acad_year_be)                                    AS latest_year,
      MAX(e.semester)                                        AS latest_sem
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN faculty_members fm ON fm.id = e.faculty_member_id
    JOIN faculties f ON f.id = fm.faculty_id
    LEFT JOIN departments d ON d.id = fm.department_id
    WHERE ds.mocked = false
      AND e.faculty_member_id IS NOT NULL
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
      ${f.facultyNameTh ? Prisma.sql`AND f.name_th = ANY(${f.facultyNameTh}::text[])` : Prisma.empty}
    GROUP BY fm.id, fm.name_th, fm.name_en, fm.faculty_id, f.name_th, fm.department_id, d.name_th, fm.rank, fm.is_active
    ORDER BY f.name_th, d.name_th NULLS FIRST, fm.name_th
  `;
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    rows: rows.map((r) => ({
      facultyMemberId: r.faculty_member_id,
      nameTh: r.name_th,
      nameEn: r.name_en,
      facultyId: r.faculty_id,
      facultyName: r.faculty_name,
      departmentId: r.department_id,
      departmentName: r.department_name,
      rank: r.rank,
      isActive: r.is_active,
      ratingAvg: r.rating_avg !== null ? Number(r.rating_avg) : 0,
      totalRespondents: Number(r.total_respondents),
      cellCount: Number(r.cell_count),
      courseCount: Number(r.course_count),
      latestYearBE: r.latest_year,
      latestSemester: r.latest_sem,
    })),
  };
}

// ── Faculty → Program Level → Program → Instructor pivot ────────────────
//
// Per-(program × instructor × year) rollup for /staff/teaching. Each
// instructor cell is attributed to the program(s) that teach the course
// the cell is for — a teacher who taught a course shared across N
// programs shows up under all N. The home-faculty of the instructor is
// irrelevant for the table hierarchy; the program's faculty drives the
// top-level grouping (matches /education/satisfaction).

export interface ProgramInstructorRow {
  facultyId: string;
  facultyName: string;
  programLevel: string;
  programId: string;
  programName: string;
  facultyMemberId: string;
  instructorNameTh: string;
  instructorNameEn: string;
  instructorRank: string;
  overall: CourseSatisfactionCell;
  byYear: Record<string, CourseSatisfactionCell>;
  yearsObserved: number[];
}

export async function instructorsByProgram(
  filter: EvaluationFilter | undefined,
): Promise<{
  methodologyVersion: string;
  rows: ProgramInstructorRow[];
  yearsObserved: number[];
}> {
  const f = resolveFilter(filter);
  const cells = await prisma.$queryRaw<
    Array<{
      faculty_id: string;
      faculty_name: string;
      program_level: string;
      program_id: string;
      program_name: string;
      faculty_member_id: string;
      instructor_name_th: string;
      instructor_name_en: string;
      instructor_rank: string;
      acad_year_be: number;
      rating_avg: number | null;
      respondent_count: bigint;
      cell_count: bigint;
      course_count: bigint;
    }>
  >`
    SELECT
      fp.id                                                            AS faculty_id,
      fp.name_th                                                       AS faculty_name,
      p.level::text                                                    AS program_level,
      p.id                                                             AS program_id,
      p.name_th                                                        AS program_name,
      fm.id                                                            AS faculty_member_id,
      fm.name_th                                                       AS instructor_name_th,
      fm.name_en                                                       AS instructor_name_en,
      fm.rank::text                                                    AS instructor_rank,
      e.acad_year_be                                                   AS acad_year_be,
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint                     AS respondent_count,
      COUNT(*)::bigint                                                 AS cell_count,
      COUNT(DISTINCT e.course_code)::bigint                            AS course_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN program_courses pc ON pc.course_code = e.course_code
    JOIN programs p ON p.id = pc.program_id
    JOIN faculties fp ON fp.id = p.faculty_id
    JOIN faculty_members fm ON fm.id = e.faculty_member_id
    WHERE ds.mocked = false
      AND e.faculty_member_id IS NOT NULL
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
      ${f.facultyNameTh ? Prisma.sql`AND fp.name_th = ANY(${f.facultyNameTh}::text[])` : Prisma.empty}
    GROUP BY fp.id, fp.name_th, p.level, p.id, p.name_th,
             fm.id, fm.name_th, fm.name_en, fm.rank,
             e.acad_year_be
    ORDER BY fp.name_th, p.level, p.name_th, fm.name_th, e.acad_year_be DESC
  `;
  // Fold into one row per (program, instructor) with byYear cells.
  const byKey = new Map<string, ProgramInstructorRow>();
  const yearsObservedSet = new Set<number>();
  for (const c of cells) {
    yearsObservedSet.add(c.acad_year_be);
    const key = `${c.program_id}|${c.faculty_member_id}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        facultyId: c.faculty_id,
        facultyName: c.faculty_name,
        programLevel: c.program_level,
        programId: c.program_id,
        programName: c.program_name,
        facultyMemberId: c.faculty_member_id,
        instructorNameTh: c.instructor_name_th,
        instructorNameEn: c.instructor_name_en,
        instructorRank: c.instructor_rank,
        overall: { ratingAvg: 0, respondentCount: 0, cellCount: 0, instructorCount: 1 },
        byYear: {},
        yearsObserved: [],
      };
      byKey.set(key, row);
    }
    const cell: CourseSatisfactionCell = {
      ratingAvg: c.rating_avg !== null ? Number(c.rating_avg) : 0,
      respondentCount: Number(c.respondent_count),
      cellCount: Number(c.cell_count),
      // `instructorCount` doesn't apply per cell here — it's always 1
      // (this row IS one instructor). Reusing the type for parity with
      // ProgramCourseSatisfactionRow.
      instructorCount: 1,
    };
    row.byYear[String(c.acad_year_be)] = cell;
    row.yearsObserved.push(c.acad_year_be);
    row.overall.respondentCount += cell.respondentCount;
    row.overall.cellCount += cell.cellCount;
  }
  for (const row of byKey.values()) {
    let num = 0;
    let den = 0;
    for (const cell of Object.values(row.byYear)) {
      num += cell.ratingAvg * cell.respondentCount;
      den += cell.respondentCount;
    }
    row.overall.ratingAvg = den > 0 ? num / den : 0;
    row.yearsObserved.sort((a, b) => b - a);
  }
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    rows: [...byKey.values()],
    yearsObserved: [...yearsObservedSet].sort((a, b) => b - a),
  };
}

// ── Courses taught by an instructor within one program (5th-level drill) ──
//
// Used by the 5th-level inline expansion under each teacher row on the
// /staff/teaching pivot. Returns only courses that BOTH the program
// teaches AND this instructor was credited for in the window — so
// general-ed courses the instructor taught for other programs are
// excluded.

export interface InstructorCourseRow {
  courseCode: string;
  courseName: string | null;
  courseNameEn: string | null;
  overall: CourseSatisfactionCell;
  byYear: Record<string, CourseSatisfactionCell>;
  yearsObserved: number[];
}

export async function coursesByInstructor(args: {
  programId: string;
  facultyMemberId: string;
  filter?: EvaluationFilter;
}): Promise<{
  methodologyVersion: string;
  rows: InstructorCourseRow[];
  yearsObserved: number[];
}> {
  const f = resolveFilter(args.filter);
  const cells = await prisma.$queryRaw<
    Array<{
      course_code: string;
      course_name_th: string | null;
      course_name_en: string | null;
      acad_year_be: number;
      rating_avg: number | null;
      respondent_count: bigint;
      cell_count: bigint;
    }>
  >`
    SELECT
      e.course_code                                                AS course_code,
      MAX(e.course_name_th)                                        AS course_name_th,
      MAX(e.course_name_en)                                        AS course_name_en,
      e.acad_year_be                                               AS acad_year_be,
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint                 AS respondent_count,
      COUNT(*)::bigint                                             AS cell_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN program_courses pc
      ON pc.course_code = e.course_code
     AND pc.program_id = ${args.programId}
    WHERE ds.mocked = false
      AND e.faculty_member_id = ${args.facultyMemberId}
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
    GROUP BY e.course_code, e.acad_year_be
    ORDER BY e.course_code, e.acad_year_be DESC
  `;
  const byCourse = new Map<string, InstructorCourseRow>();
  const yearsObservedSet = new Set<number>();
  for (const c of cells) {
    yearsObservedSet.add(c.acad_year_be);
    let row = byCourse.get(c.course_code);
    if (!row) {
      row = {
        courseCode: c.course_code,
        courseName: c.course_name_th,
        courseNameEn: c.course_name_en,
        overall: { ratingAvg: 0, respondentCount: 0, cellCount: 0, instructorCount: 1 },
        byYear: {},
        yearsObserved: [],
      };
      byCourse.set(c.course_code, row);
    }
    const cell: CourseSatisfactionCell = {
      ratingAvg: c.rating_avg !== null ? Number(c.rating_avg) : 0,
      respondentCount: Number(c.respondent_count),
      cellCount: Number(c.cell_count),
      instructorCount: 1,
    };
    row.byYear[String(c.acad_year_be)] = cell;
    row.yearsObserved.push(c.acad_year_be);
    row.overall.respondentCount += cell.respondentCount;
    row.overall.cellCount += cell.cellCount;
  }
  for (const row of byCourse.values()) {
    let num = 0;
    let den = 0;
    for (const cell of Object.values(row.byYear)) {
      num += cell.ratingAvg * cell.respondentCount;
      den += cell.respondentCount;
    }
    row.overall.ratingAvg = den > 0 ? num / den : 0;
    row.yearsObserved.sort((a, b) => b - a);
  }
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    rows: [...byCourse.values()],
    yearsObserved: [...yearsObservedSet].sort((a, b) => b - a),
  };
}

// ── Per-instructor personal view ────────────────────────────────────────
//
// For the personal view (own scores) AND the roster-drill (DEAN looking at
// one of their faculty members). Returns:
//   - aggregate summary
//   - per-(year, sem) trend
//   - per-question heatmap (40 questions × years observed)
//   - per-course breakdown
//
// Callers must enforce visibility BEFORE calling this — the helper does
// not check permissions.

export interface InstructorPersonalResult {
  methodologyVersion: string;
  summary: {
    ratingAvg: number;
    totalRespondents: number;
    cellCount: number;
    courseCount: number;
    questionCount: number;
    semestersObserved: number;
  };
  trend: SatisfactionTrendPoint[];
  byQuestion: Array<{
    questionId: string;
    questionIdRegistrar: string;
    questionTextTh: string;
    questionTextEn: string | null;
    themeTag: string | null;
    ratingAvg: number;
    cellCount: number;
    respondentCount: number;
    byYear: Record<string, { ratingAvg: number; respondentCount: number }>;
  }>;
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

export async function instructorPersonal(
  args:
    | string
    | {
        facultyMemberId: string;
        /** When set, narrows the result to ONLY the cells for courses
         *  this instructor taught within THIS program. Used by the
         *  /staff/teaching drill panel so the "by course" section
         *  reflects only the program-of-context, not every program the
         *  instructor ever taught for. */
        programId?: string;
        filter?: EvaluationFilter;
      },
  // Legacy positional `filter` param — kept so existing callers still
  // compile. Prefer the args-object form going forward.
  legacyFilter?: EvaluationFilter | undefined,
): Promise<InstructorPersonalResult> {
  const facultyMemberId = typeof args === 'string' ? args : args.facultyMemberId;
  const programId = typeof args === 'string' ? undefined : args.programId;
  const filter = typeof args === 'string' ? legacyFilter : args.filter;
  const f = resolveFilter(filter);
  // Pull all cells for this instructor in window. When `programId` is
  // set, JOIN through program_courses so only cells for courses taught
  // by that program survive.
  const cells = await prisma.$queryRaw<
    Array<{
      acad_year_be: number;
      semester: number;
      course_code: string;
      course_name_th: string | null;
      course_name_en: string | null;
      question_id: string | null;
      question_id_registrar: string;
      rating_avg: number;
      respondent_count: number;
    }>
  >`
    SELECT
      e.acad_year_be, e.semester,
      e.course_code, e.course_name_th, e.course_name_en,
      e.question_id, e.question_id_registrar,
      e.rating_avg::float AS rating_avg,
      e.respondent_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    ${
      programId
        ? Prisma.sql`JOIN program_courses pc ON pc.course_code = e.course_code AND pc.program_id = ${programId}`
        : Prisma.empty
    }
    WHERE ds.mocked = false
      AND e.faculty_member_id = ${facultyMemberId}
      AND e.semester = ANY(${f.semester}::int[])
      ${f.acadYearBE ? Prisma.sql`AND e.acad_year_be = ANY(${f.acadYearBE}::int[])` : Prisma.empty}
  `;
  if (cells.length === 0) {
    return {
      methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
      summary: { ratingAvg: 0, totalRespondents: 0, cellCount: 0, courseCount: 0, questionCount: 0, semestersObserved: 0 },
      trend: [],
      byQuestion: [],
      byCourse: [],
    };
  }
  let sumW = 0;
  let sumD = 0;
  const courses = new Set<string>();
  const questions = new Set<string>();
  const buckets = new Set<string>();
  for (const c of cells) {
    sumW += c.rating_avg * c.respondent_count;
    sumD += c.respondent_count;
    courses.add(c.course_code);
    questions.add(c.question_id_registrar);
    buckets.add(`${c.acad_year_be}-${c.semester}`);
  }
  // Trend per (year, sem).
  const trendMap = new Map<string, { ratingAvg: number; respondentCount: number; cellCount: number; courseSet: Set<string>; year: number; sem: number }>();
  for (const c of cells) {
    const k = `${c.acad_year_be}-${c.semester}`;
    let t = trendMap.get(k);
    if (!t) {
      t = { ratingAvg: 0, respondentCount: 0, cellCount: 0, courseSet: new Set(), year: c.acad_year_be, sem: c.semester };
      trendMap.set(k, t);
    }
    t.ratingAvg += c.rating_avg * c.respondent_count;
    t.respondentCount += c.respondent_count;
    t.cellCount++;
    t.courseSet.add(c.course_code);
  }
  const trend: SatisfactionTrendPoint[] = [...trendMap.values()]
    .sort((a, b) => a.year * 10 + a.sem - (b.year * 10 + b.sem))
    .map((t) => ({
      acadYearBE: t.year,
      semester: t.sem,
      label: `BE ${t.year} / S${t.sem}`,
      ratingAvg: t.respondentCount > 0 ? t.ratingAvg / t.respondentCount : null,
      respondentCount: t.respondentCount,
      cellCount: t.cellCount,
      courseCount: t.courseSet.size,
    }));
  // Per question.
  type QStat = {
    ratingSumW: number;
    ratingSumD: number;
    cellCount: number;
    byYear: Map<number, { sumW: number; sumD: number }>;
  };
  const byQid = new Map<string, QStat>();
  for (const c of cells) {
    let q = byQid.get(c.question_id_registrar);
    if (!q) {
      q = { ratingSumW: 0, ratingSumD: 0, cellCount: 0, byYear: new Map() };
      byQid.set(c.question_id_registrar, q);
    }
    q.ratingSumW += c.rating_avg * c.respondent_count;
    q.ratingSumD += c.respondent_count;
    q.cellCount++;
    let y = q.byYear.get(c.acad_year_be);
    if (!y) {
      y = { sumW: 0, sumD: 0 };
      q.byYear.set(c.acad_year_be, y);
    }
    y.sumW += c.rating_avg * c.respondent_count;
    y.sumD += c.respondent_count;
  }
  const questionRows = await prisma.evaluationQuestion.findMany({
    where: { questionIdRegistrar: { in: [...byQid.keys()] } },
    select: {
      id: true,
      questionIdRegistrar: true,
      questionTextTh: true,
      questionTextEn: true,
      questionTextEnOverride: true,
      themeTag: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  const questionByQid = new Map<string, (typeof questionRows)[number]>();
  for (const q of questionRows) {
    if (!questionByQid.has(q.questionIdRegistrar)) questionByQid.set(q.questionIdRegistrar, q);
  }
  const byQuestion = [...byQid.entries()]
    .map(([qid, stat]) => {
      const meta = questionByQid.get(qid);
      const byYear: Record<string, { ratingAvg: number; respondentCount: number }> = {};
      for (const [year, y] of stat.byYear.entries()) {
        byYear[String(year)] = { ratingAvg: y.sumD > 0 ? y.sumW / y.sumD : 0, respondentCount: y.sumD };
      }
      return {
        questionId: meta?.id ?? '',
        questionIdRegistrar: qid,
        questionTextTh: meta?.questionTextTh ?? '(unknown)',
        questionTextEn: meta?.questionTextEnOverride ?? meta?.questionTextEn ?? null,
        themeTag: meta?.themeTag ?? null,
        ratingAvg: stat.ratingSumD > 0 ? stat.ratingSumW / stat.ratingSumD : 0,
        cellCount: stat.cellCount,
        respondentCount: stat.ratingSumD,
        byYear,
      };
    })
    .sort((a, b) => a.questionIdRegistrar.localeCompare(b.questionIdRegistrar));
  // Per course.
  const byCourseMap = new Map<string, { sumW: number; sumD: number; cellCount: number; nameTh: string | null; nameEn: string | null; latestY: number; latestS: number }>();
  for (const c of cells) {
    let cc = byCourseMap.get(c.course_code);
    if (!cc) {
      cc = { sumW: 0, sumD: 0, cellCount: 0, nameTh: c.course_name_th, nameEn: c.course_name_en, latestY: c.acad_year_be, latestS: c.semester };
      byCourseMap.set(c.course_code, cc);
    }
    cc.sumW += c.rating_avg * c.respondent_count;
    cc.sumD += c.respondent_count;
    cc.cellCount++;
    if (c.acad_year_be > cc.latestY || (c.acad_year_be === cc.latestY && c.semester > cc.latestS)) {
      cc.latestY = c.acad_year_be;
      cc.latestS = c.semester;
    }
  }
  const byCourse = [...byCourseMap.entries()]
    .map(([code, c]) => ({
      courseCode: code,
      courseNameTh: c.nameTh,
      courseNameEn: c.nameEn,
      ratingAvg: c.sumD > 0 ? c.sumW / c.sumD : 0,
      cellCount: c.cellCount,
      respondentCount: c.sumD,
      latestYearBE: c.latestY,
      latestSemester: c.latestS,
    }))
    .sort((a, b) => a.ratingAvg - b.ratingAvg);
  return {
    methodologyVersion: EVALUATIONS_METHODOLOGY_VERSION,
    summary: {
      ratingAvg: sumD > 0 ? sumW / sumD : 0,
      totalRespondents: sumD,
      cellCount: cells.length,
      courseCount: courses.size,
      questionCount: questions.size,
      semestersObserved: buckets.size,
    },
    trend,
    byQuestion,
    byCourse,
  };
}
