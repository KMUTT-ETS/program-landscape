// ────────────────────────────────────────────────────────────────────────────
// /staff-dashboard/teaching-workload — subject teaching workload.
//
// Source: `class_offerings` × `class_offering_teachers` × `faculty_members`.
//
// Contact-hours/week per teacher = SUM(lecture_hrs_per_week + lab_hrs_per_week)
// across every section where their KKUMAIL appears. Every co-teacher on a
// team-taught course gets the FULL workload — that matches both the
// registrar's representation and KKU's teaching-credit policy.
//
// Faculty attribution is via FacultyMember.facultyId (the teacher's home
// faculty). Unresolved teachers (kkuEmail with no matching FacultyMember)
// are bucketed as "Unresolved (external / HCM gap)" and not faculty-clamped
// — they have no facultyId to clamp on.
// ────────────────────────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@kku/db';
import { CacheService } from '../common/cache.service';
import type { OfferingScope } from '../common/scope-guards';

export interface TeachingWorkloadFilter {
  /** Resolved scope. The WHERE clause emits an OR of:
   *    (fm.faculty_id IN facultyIds)            — clamps to the
   *      TEACHER's home faculty (so a Math teacher running a service
   *      course to Engineering still counts as Math's workload), AND
   *    (c.course_code IN programCourseCodes)    — clamps to courses
   *      the granted programs use (PROGRAM_USER scope).
   *  Admin / UNIVERSITY = no clamp; mixed scope = OR of both. */
  scope: OfferingScope;
  acadYearBE?: number;
  semester?: number;
  levelName?: string[];
}

export interface FilterOptionsResponse {
  years: number[];
  semesters: number[];
  levels: string[];
  faculties: string[];
}

export interface SummaryResponse {
  acadYearBE: number | null;
  semester: number | null;
  totalSections: number;
  totalTeachers: number;
  resolvedTeachers: number;
  unresolvedTeachers: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
  /** Teams of ≥2 teachers on the same section. */
  teamTaughtSections: number;
  totalStudentsTaught: number;
}

export interface HistogramResponse {
  acadYearBE: number | null;
  semester: number | null;
  totalTeachers: number;
  buckets: Array<{
    bucket: string;
    rangeLo: number;
    rangeHi: number;
    teachers: number;
    pctOfTotal: number;
    band: 'UNDER' | 'NORMAL' | 'OVER';
  }>;
}

export interface ByFacultyResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: Array<{
    facultyId: string | null;
    facultyName: string;
    teachers: number;
    sections: number;
    totalContactHrsPerWeek: number;
    avgContactHrsPerTeacher: number;
    studentsTaught: number;
  }>;
  unresolvedRow: {
    teachers: number;
    sections: number;
    totalContactHrsPerWeek: number;
    avgContactHrsPerTeacher: number;
    studentsTaught: number;
  };
}

/** Leaf row inside the by-teacher drill-down
 *  (Faculty → Program Level → Program → Teacher).
 *  The workload figures are the teacher's ACTUAL totals across every
 *  section they teach — they are NOT split or weighted per program. A
 *  teacher who is a curriculum member of three programs appears under all
 *  three program nodes, each showing the same full workload. */
export interface TeacherRow {
  facultyMemberId: string | null;
  /** Thai name if present, otherwise English, else the email local-part.
   *  KKUMAIL is intentionally not surfaced to the UI (cleaner reading;
   *  the admin raw-data viewer still has it). */
  displayName: string;
  /** Rank code (PROF / ASSOC_PROF / ASST_PROF / LECTURER) — the UI
   *  resolves to a human-readable label. Null for unresolved teachers
   *  (external lecturers / HCM gaps). */
  rank: string | null;
  /** ProgramFaculty role in THIS program context (COORDINATOR / CORE /
   *  SUPPORT). Null in the "not attached to a curriculum" fallback node. */
  programRole: string | null;
  /** Number of programs this teacher is a curriculum member of (PDG
   *  ProgramFaculty). >1 means this same workload row is repeated under
   *  each of those program nodes — repeated, not additive. 0 for the
   *  fallback node. */
  programCount: number;
  sections: number;
  distinctCourses: number;
  /** Σ lecture hours per week. From COURSEUNIT "B" of "A (B-C-D)". */
  lectureHrsPerWeek: number;
  /** Σ lab hours per week. From COURSEUNIT "C" of "A (B-C-D)". */
  labHrsPerWeek: number;
  /** Σ lecture + lab — what the histogram + summary use. */
  totalContactHrsPerWeek: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

/** Middle (program) tier. `programId` is null for the synthetic
 *  "not attached to a curriculum" node — teachers with teaching activity
 *  but no ProgramFaculty membership. Within one program a teacher appears
 *  exactly once, so the program aggregate is a straight sum of children. */
export interface TeacherProgramGroup {
  programId: string | null;
  programCode: string | null;
  programName: string;
  programLevel: string | null;
  children: TeacherRow[];
  teachers: number;
  sections: number;
  lectureHrsPerWeek: number;
  labHrsPerWeek: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

/** Program-level tier (Faculty → Program Level → Program → Teacher).
 *  `level` is the ProgramLevel enum value (BACHELOR / MASTER / DOCTORAL /
 *  HIGHER_GRAD_DIPLOMA), or null for the "not attached to a curriculum"
 *  bucket — whose single program child carries the fallback teachers. */
export interface TeacherLevelGroup {
  level: string | null;
  programs: TeacherProgramGroup[];
  /** Distinct teachers in this level — a teacher in two programs of the
   *  same level is counted once. */
  teachers: number;
  sections: number;
  lectureHrsPerWeek: number;
  labHrsPerWeek: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

/** Top (faculty) tier. For program nodes the faculty is the curriculum's
 *  OWNING faculty (Program.facultyId); for the fallback node it is the
 *  teacher's home faculty. The faculty aggregate counts each teacher once
 *  even when they teach across several of the faculty's programs. */
export interface TeacherFacultyGroup {
  facultyId: string | null;
  facultyName: string;
  levels: TeacherLevelGroup[];
  /** Distinct teachers — a teacher in several of the faculty's programs
   *  is counted once here (and once in the grand total). */
  teachers: number;
  sections: number;
  lectureHrsPerWeek: number;
  labHrsPerWeek: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

export interface TeacherDeepDiveResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: TeacherFacultyGroup[];
  totals: {
    /** Distinct teachers, counted once across the whole tree. */
    teachers: number;
    /** Distinct real program nodes (excludes the fallback node). */
    programs: number;
    sections: number;
    lectureHrsPerWeek: number;
    labHrsPerWeek: number;
    totalContactHrsPerWeek: number;
    avgContactHrsPerTeacher: number;
    studentsTaught: number;
    teamTaughtSections: number;
  };
}

/** "Students taught" by faculty — feeds the second staff viz. */
export interface StudentsByFacultyResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: Array<{
    facultyId: string | null;
    facultyName: string;
    teachers: number;
    sections: number;
    studentsTaught: number;
    studentsPerTeacher: number;
  }>;
  totals: {
    teachers: number;
    sections: number;
    studentsTaught: number;
  };
}

@Injectable()
export class TeachingWorkloadService {
  /** Cache TTL for the per-snapshot rollups. The cube is full-replaced
   *  by `pnpm programs:link-class-offerings` (admin-triggered), so a
   *  10-minute TTL is comfortable — operators see the new data on the
   *  next refresh and the page renders ~instantly between refreshes. */
  private static readonly CACHE_TTL_SECONDS = 600;

  constructor(private readonly cache: CacheService) {}

  private cacheKey(
    namespace: string,
    filter: TeachingWorkloadFilter,
  ): string {
    const s = filter.scope;
    return CacheService.keyOf(`teaching-workload:${namespace}`, {
      scopeMode: s.mode,
      facultyIds: [...s.facultyIds].sort().join(','),
      programCourseCodes: [...s.programCourseCodes].sort().join(','),
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      levelName: (filter.levelName ?? []).slice().sort().join(','),
    });
  }

  /**
   * Find the latest "main" snapshot WITH teaching activity for the
   * caller's scope. Prefers sem 1 / 2 of the most recent year that has
   * actual enrollment (excludes "not-yet-started" terms with 0 students).
   * Sem 3 / 4 (summer / special) deprioritised. Explicit (year, sem)
   * filters still reach them.
   */
  async resolveLatestSnapshot(
    scope: OfferingScope,
  ): Promise<{ acadYearBE: number; semester: number } | null> {
    const scopeClause = this.buildWhere({ scope });
    const rows = await prisma.$queryRaw<Array<{ y: number; s: number }>>`
      SELECT c.acad_year_be AS y, c.semester AS s
        FROM class_offerings c
        JOIN class_offering_teachers t ON t.class_offering_id = c.id
        LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
       WHERE ${scopeClause}
       GROUP BY c.acad_year_be, c.semester
      HAVING SUM(c.enroll_seat)::numeric / NULLIF(SUM(c.total_seat),0)::numeric >= 0.1
       ORDER BY c.acad_year_be DESC,
                CASE WHEN c.semester IN (1, 2) THEN 0 ELSE 1 END,
                c.semester DESC
       LIMIT 1
    `;
    return rows[0] ? { acadYearBE: rows[0].y, semester: rows[0].s } : null;
  }

  /**
   * Filter options — pulls year/semester/level distinct values from
   * the scoped slice of teaching activity. Faculty dropdown shows the
   * granted-faculty set; for pure PROGRAM_USER the dropdown is empty.
   */
  async filterOptions(scope: OfferingScope): Promise<FilterOptionsResponse> {
    const scopeClause = this.buildWhere({ scope });
    const [years, semesters, levels, facultyRows] = await Promise.all([
      prisma.$queryRaw<Array<{ y: number }>>`
        SELECT DISTINCT c.acad_year_be AS y
          FROM class_offerings c
          JOIN class_offering_teachers t ON t.class_offering_id = c.id
          LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
         WHERE ${scopeClause}
         ORDER BY c.acad_year_be DESC
      `,
      prisma.$queryRaw<Array<{ s: number }>>`
        SELECT DISTINCT c.semester AS s
          FROM class_offerings c
          JOIN class_offering_teachers t ON t.class_offering_id = c.id
          LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
         WHERE ${scopeClause}
         ORDER BY c.semester
      `,
      prisma.$queryRaw<Array<{ l: string }>>`
        SELECT DISTINCT c.level_name AS l
          FROM class_offerings c
          JOIN class_offering_teachers t ON t.class_offering_id = c.id
          LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
         WHERE ${scopeClause}
         ORDER BY c.level_name
      `,
      scope.mode === 'all'
        ? prisma.faculty.findMany({ select: { nameTh: true }, orderBy: { nameTh: 'asc' } })
        : scope.facultyIds.length > 0
        ? prisma.faculty.findMany({
            where: { id: { in: scope.facultyIds } },
            select: { nameTh: true },
            orderBy: { nameTh: 'asc' },
          })
        : Promise.resolve([] as Array<{ nameTh: string }>),
    ]);
    return {
      years: years.map((r) => r.y),
      semesters: semesters.map((r) => r.s),
      levels: levels.map((r) => r.l),
      faculties: facultyRows.map((r) => r.nameTh),
    };
  }

  /**
   * Build the raw-SQL WHERE clause for the
   * `class_offering_teachers t JOIN class_offerings c LEFT JOIN faculty_members fm`
   * shape used by every query in this service.
   *
   * Scope clamp emits an OR of:
   *   `fm.faculty_id IN (facultyIds)` — TEACHER's home faculty
   *     (so a Math teacher running a GE service course is still
   *     attributed to Math's load), AND
   *   `c.course_code IN (programCourseCodes)` — courses used by the
   *     granted programs (PROGRAM_USER scope, includes GE).
   *
   * Admin / UNIVERSITY = no clamp; mixed scope = OR; no-grants =
   * unsatisfiable predicate so the query yields empty.
   */
  private buildWhere(filter: TeachingWorkloadFilter): Prisma.Sql {
    const clauses: Prisma.Sql[] = [Prisma.sql`TRUE`];
    const scope = filter.scope;
    if (scope.mode === 'none') {
      clauses.push(Prisma.sql`FALSE`);
    } else if (scope.mode === 'scoped') {
      const or: Prisma.Sql[] = [];
      if (scope.facultyIds.length > 0) {
        or.push(Prisma.sql`fm.faculty_id IN (${Prisma.join(scope.facultyIds)})`);
      }
      if (scope.programCourseCodes.length > 0) {
        or.push(Prisma.sql`c.course_code IN (${Prisma.join(scope.programCourseCodes)})`);
      }
      if (or.length === 0) clauses.push(Prisma.sql`FALSE`);
      else if (or.length === 1) clauses.push(or[0]!);
      else clauses.push(Prisma.sql`(${Prisma.join(or, ' OR ')})`);
    }
    if (filter.acadYearBE !== undefined) {
      clauses.push(Prisma.sql`c.acad_year_be = ${filter.acadYearBE}`);
    }
    if (filter.semester !== undefined) {
      clauses.push(Prisma.sql`c.semester = ${filter.semester}`);
    }
    if (filter.levelName && filter.levelName.length > 0) {
      clauses.push(Prisma.sql`c.level_name IN (${Prisma.join(filter.levelName)})`);
    }
    return Prisma.join(clauses, ' AND ');
  }

  /** Per-teacher contact-hour CTE shared by histogram + by-faculty +
   *  deep-dive. One row per kku_email × snapshot.
   *
   *  Performance notes:
   *  - "Team-taught" was previously a correlated subquery (`SELECT COUNT
   *    FROM class_offering_teachers WHERE class_offering_id = c.id`) —
   *    that ran per-row × per-teacher = O(N²), exhausting Postgres's
   *    small `/dev/shm` budget under parallel workers (64 MB by default
   *    in the dev container). Now factored as a derived table joined
   *    once: ~10× faster + fits in a single backend without spilling.
   *  - Lecture / lab hours are summed separately so the per-teacher
   *    deep-dive can show them as distinct columns (the registrar's
   *    COURSEUNIT carries `A (B-C-D)` = credits + lecture + lab + study).
   *
   *  The LEFT JOIN to `faculty_members fm` is what enables the
   *  faculty-clamp (`fm.faculty_id IN (...)`) — see buildWhere().
   */
  private teacherCteSql(filter: TeachingWorkloadFilter): Prisma.Sql {
    return Prisma.sql`
      SELECT
        t.kku_email,
        t.faculty_member_id,
        COUNT(DISTINCT c.id)::bigint                                    AS sections,
        COUNT(DISTINCT c.course_code)::bigint                           AS distinct_courses,
        COALESCE(SUM(c.lecture_hrs_per_week), 0)::bigint                AS lecture_hrs,
        COALESCE(SUM(c.lab_hrs_per_week),     0)::bigint                AS lab_hrs,
        COALESCE(SUM(COALESCE(c.lecture_hrs_per_week,0) + COALESCE(c.lab_hrs_per_week,0)),0)::bigint AS contact_hrs,
        COALESCE(SUM(c.enroll_seat),0)::bigint                          AS students_taught,
        SUM(CASE WHEN ts.class_offering_id IS NOT NULL THEN 1 ELSE 0 END)::bigint AS team_sections
      FROM class_offering_teachers t
      JOIN class_offerings c ON c.id = t.class_offering_id
      LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
      LEFT JOIN (
        SELECT class_offering_id
          FROM class_offering_teachers
         GROUP BY class_offering_id
        HAVING COUNT(*) >= 2
      ) ts ON ts.class_offering_id = c.id
      WHERE ${this.buildWhere(filter)}
      GROUP BY t.kku_email, t.faculty_member_id
    `;
  }

  async summary(filter: TeachingWorkloadFilter): Promise<SummaryResponse> {
    const ck = this.cacheKey('summary', filter);
    const cached = await this.cache.get<SummaryResponse>(ck);
    if (cached) return cached;
    const res = await this.summaryFresh(filter);
    await this.cache.set(ck, res, TeachingWorkloadService.CACHE_TTL_SECONDS);
    return res;
  }

  private async summaryFresh(filter: TeachingWorkloadFilter): Promise<SummaryResponse> {
    const sectionsRow = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT c.id)::bigint AS n
        FROM class_offerings c
        JOIN class_offering_teachers t ON t.class_offering_id = c.id
        LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
       WHERE ${this.buildWhere(filter)}
    `;
    const teamRow = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM (
        SELECT c.id
          FROM class_offerings c
          JOIN class_offering_teachers t ON t.class_offering_id = c.id
          LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
         WHERE ${this.buildWhere(filter)}
         GROUP BY c.id
        HAVING COUNT(DISTINCT t.kku_email) >= 2
      ) AS t
    `;
    const perTeacher = await prisma.$queryRaw<
      Array<{
        kku_email: string;
        faculty_member_id: string | null;
        contact_hrs: bigint;
        students_taught: bigint;
      }>
    >`
      WITH per_teacher AS (${this.teacherCteSql(filter)})
      SELECT kku_email, faculty_member_id, contact_hrs, students_taught FROM per_teacher
    `;
    let totalContactHrs = 0;
    let totalStudents = 0;
    let resolved = 0;
    let unresolved = 0;
    for (const r of perTeacher) {
      totalContactHrs += Number(r.contact_hrs);
      totalStudents += Number(r.students_taught);
      if (r.faculty_member_id) resolved++;
      else unresolved++;
    }
    return {
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      totalSections: Number(sectionsRow[0]?.n ?? 0),
      totalTeachers: perTeacher.length,
      resolvedTeachers: resolved,
      unresolvedTeachers: unresolved,
      totalContactHrsPerWeek: totalContactHrs,
      avgContactHrsPerTeacher: perTeacher.length > 0 ? totalContactHrs / perTeacher.length : 0,
      teamTaughtSections: Number(teamRow[0]?.n ?? 0),
      totalStudentsTaught: totalStudents,
    };
  }

  /**
   * Workload-bucket histogram. KKU's nominal full-time teaching load
   * for academic staff is ~9–12 contact hrs/week; we colour-band:
   *   UNDER:  0–8
   *   NORMAL: 9–15
   *   OVER:   16+
   * The unresolved (external) bucket is excluded from the histogram —
   * by-faculty + summary cards already surface the unresolved count.
   */
  async histogram(filter: TeachingWorkloadFilter): Promise<HistogramResponse> {
    const ck = this.cacheKey('histogram', filter);
    const cached = await this.cache.get<HistogramResponse>(ck);
    if (cached) return cached;
    const res = await this.histogramFresh(filter);
    await this.cache.set(ck, res, TeachingWorkloadService.CACHE_TTL_SECONDS);
    return res;
  }

  private async histogramFresh(filter: TeachingWorkloadFilter): Promise<HistogramResponse> {
    const buckets: Array<{
      bucket: string;
      lo: number;
      hi: number;
      band: 'UNDER' | 'NORMAL' | 'OVER';
    }> = [
      { bucket: '0–4 hrs',  lo: 0,  hi: 4,    band: 'UNDER' },
      { bucket: '5–8 hrs',  lo: 5,  hi: 8,    band: 'UNDER' },
      { bucket: '9–12 hrs', lo: 9,  hi: 12,   band: 'NORMAL' },
      { bucket: '13–15 hrs', lo: 13, hi: 15,  band: 'NORMAL' },
      { bucket: '16–20 hrs', lo: 16, hi: 20,  band: 'OVER' },
      { bucket: '21+ hrs',  lo: 21, hi: 9999, band: 'OVER' },
    ];
    const rows = await prisma.$queryRaw<Array<{ kku_email: string; contact_hrs: bigint }>>`
      WITH per_teacher AS (${this.teacherCteSql(filter)})
      SELECT kku_email, contact_hrs FROM per_teacher
    `;
    const out = buckets.map((b) => ({
      bucket: b.bucket,
      rangeLo: b.lo,
      rangeHi: b.hi,
      band: b.band,
      teachers: 0,
      pctOfTotal: 0,
    }));
    for (const r of rows) {
      const h = Number(r.contact_hrs);
      let idx = 0;
      if (h <= 4) idx = 0;
      else if (h <= 8) idx = 1;
      else if (h <= 12) idx = 2;
      else if (h <= 15) idx = 3;
      else if (h <= 20) idx = 4;
      else idx = 5;
      out[idx]!.teachers++;
    }
    for (const b of out) b.pctOfTotal = rows.length > 0 ? (b.teachers / rows.length) * 100 : 0;
    return {
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      totalTeachers: rows.length,
      buckets: out,
    };
  }

  /**
   * Faculty rollup — average contact-hrs/teacher, total sections, total
   * students. Resolved teachers grouped by FacultyMember.facultyId →
   * Faculty.nameTh. Unresolved teachers pooled into a single row.
   */
  async byFaculty(filter: TeachingWorkloadFilter): Promise<ByFacultyResponse> {
    const ck = this.cacheKey('byFaculty', filter);
    const cached = await this.cache.get<ByFacultyResponse>(ck);
    if (cached) return cached;
    const res = await this.byFacultyFresh(filter);
    await this.cache.set(ck, res, TeachingWorkloadService.CACHE_TTL_SECONDS);
    return res;
  }

  private async byFacultyFresh(filter: TeachingWorkloadFilter): Promise<ByFacultyResponse> {
    const rows = await prisma.$queryRaw<
      Array<{
        faculty_id: string | null;
        faculty_name_th: string | null;
        teachers: bigint;
        sections: bigint;
        contact_hrs: bigint;
        students_taught: bigint;
      }>
    >`
      WITH per_teacher AS (${this.teacherCteSql(filter)})
      SELECT
        fm.faculty_id,
        f.name_th AS faculty_name_th,
        COUNT(*)::bigint AS teachers,
        SUM(per_teacher.sections)::bigint AS sections,
        SUM(per_teacher.contact_hrs)::bigint AS contact_hrs,
        SUM(per_teacher.students_taught)::bigint AS students_taught
      FROM per_teacher
      LEFT JOIN faculty_members fm ON fm.id = per_teacher.faculty_member_id
      LEFT JOIN faculties f ON f.id = fm.faculty_id
      GROUP BY fm.faculty_id, f.name_th
      ORDER BY SUM(per_teacher.contact_hrs) DESC NULLS LAST
    `;
    const resolved: ByFacultyResponse['rows'] = [];
    const unresolved = {
      teachers: 0,
      sections: 0,
      totalContactHrsPerWeek: 0,
      studentsTaught: 0,
    };
    for (const r of rows) {
      const teachers = Number(r.teachers);
      const sections = Number(r.sections);
      const contactHrs = Number(r.contact_hrs);
      const students = Number(r.students_taught);
      if (!r.faculty_id) {
        unresolved.teachers += teachers;
        unresolved.sections += sections;
        unresolved.totalContactHrsPerWeek += contactHrs;
        unresolved.studentsTaught += students;
        continue;
      }
      resolved.push({
        facultyId: r.faculty_id,
        facultyName: r.faculty_name_th ?? '(unknown)',
        teachers,
        sections,
        totalContactHrsPerWeek: contactHrs,
        avgContactHrsPerTeacher: teachers > 0 ? contactHrs / teachers : 0,
        studentsTaught: students,
      });
    }
    return {
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      rows: resolved,
      unresolvedRow: {
        ...unresolved,
        avgContactHrsPerTeacher:
          unresolved.teachers > 0
            ? unresolved.totalContactHrsPerWeek / unresolved.teachers
            : 0,
      },
    };
  }

  /**
   * Per-teacher drill-down — Faculty → Program Level → Program → Teacher.
   *
   * The program tier comes from `program_faculties` — the
   * teacher↔curriculum links extracted by the program-digest pipeline;
   * the Program Level tier groups those programs by Program.level
   * (Bachelor's / Master's / Doctoral / Higher Grad. Dip.).
   * A teacher is a curriculum member of 0..N programs; they appear under
   * EVERY program they belong to, each node showing their FULL actual
   * teaching workload (no split, no weighting — a deliberate choice so
   * each program reads as "this is the load the people on our curriculum
   * carry"). Faculty + grand-total rows count each teacher once, so they
   * stay consistent with the summary cards and the by-faculty pulse.
   *
   * Teachers with teaching activity but no (in-scope) curriculum
   * membership land in a "Not attached to a curriculum" node under their
   * home faculty (or the Unresolved bucket). The teacher's KKU email is
   * NOT surfaced (the admin raw-data viewer still has it); the display
   * name falls back to the email local-part for unresolved teachers.
   *
   * Cached by full filter signature for ~10 min.
   */
  async teachersDrillDown(
    filter: TeachingWorkloadFilter,
  ): Promise<TeacherDeepDiveResponse> {
    const ck = this.cacheKey('teachersDrillDown', filter);
    const cached = await this.cache.get<TeacherDeepDiveResponse>(ck);
    if (cached) return cached;
    const res = await this.teachersDrillDownFresh(filter);
    await this.cache.set(ck, res, TeachingWorkloadService.CACHE_TTL_SECONDS);
    return res;
  }

  private async teachersDrillDownFresh(
    filter: TeachingWorkloadFilter,
  ): Promise<TeacherDeepDiveResponse> {
    // Program-membership join is clamped for scoped users so the deep-dive
    // never surfaces curricula outside the caller's grant. A teacher whose
    // memberships are all out-of-scope falls into the "not attached to a
    // curriculum" node — same as a teacher with genuinely no membership.
    const scope = filter.scope;
    let programScope: Prisma.Sql = Prisma.sql`TRUE`;
    if (scope.mode === 'scoped') {
      const or: Prisma.Sql[] = [];
      if (scope.facultyIds.length > 0) {
        or.push(Prisma.sql`p.faculty_id IN (${Prisma.join(scope.facultyIds)})`);
      }
      if (scope.programIds.length > 0) {
        or.push(Prisma.sql`p.id IN (${Prisma.join(scope.programIds)})`);
      }
      programScope =
        or.length === 0
          ? Prisma.sql`FALSE`
          : or.length === 1
          ? or[0]!
          : Prisma.sql`(${Prisma.join(or, ' OR ')})`;
    }

    // The per_teacher CTE emits one row per teacher; the LEFT JOIN to
    // program_faculties fans that out to one row per (teacher × program
    // membership). Teachers with no in-scope membership keep their single
    // row with program_id = NULL.
    const rows = await prisma.$queryRaw<
      Array<{
        kku_email: string;
        faculty_member_id: string | null;
        name_th: string | null;
        name_en: string | null;
        rank: string | null;
        home_faculty_id: string | null;
        home_faculty_name_th: string | null;
        program_role: string | null;
        program_id: string | null;
        program_code: string | null;
        program_name_th: string | null;
        program_level: string | null;
        program_faculty_id: string | null;
        program_faculty_name_th: string | null;
        sections: bigint;
        distinct_courses: bigint;
        lecture_hrs: bigint;
        lab_hrs: bigint;
        contact_hrs: bigint;
        students_taught: bigint;
        team_sections: bigint;
      }>
    >`
      WITH per_teacher AS (${this.teacherCteSql(filter)})
      SELECT
        per_teacher.kku_email,
        per_teacher.faculty_member_id,
        fm.name_th, fm.name_en, fm.rank::text AS rank,
        fm.faculty_id AS home_faculty_id,
        hf.name_th    AS home_faculty_name_th,
        pf.role::text AS program_role,
        p.id          AS program_id,
        p.code        AS program_code,
        p.name_th     AS program_name_th,
        p.level::text AS program_level,
        p.faculty_id  AS program_faculty_id,
        pgf.name_th   AS program_faculty_name_th,
        per_teacher.sections,
        per_teacher.distinct_courses,
        per_teacher.lecture_hrs,
        per_teacher.lab_hrs,
        per_teacher.contact_hrs,
        per_teacher.students_taught,
        per_teacher.team_sections
      FROM per_teacher
      LEFT JOIN faculty_members fm   ON fm.id = per_teacher.faculty_member_id
      LEFT JOIN faculties hf         ON hf.id = fm.faculty_id
      LEFT JOIN program_faculties pf ON pf.faculty_member_id = per_teacher.faculty_member_id
      LEFT JOIN programs p           ON p.id = pf.program_id AND ${programScope}
      LEFT JOIN faculties pgf        ON pgf.id = p.faculty_id
    `;

    // ── Pass 1: collapse the program-membership fan-out to one record
    //    per teacher, carrying the list of in-scope memberships. ──
    interface TeacherMeta {
      kkuEmail: string;
      facultyMemberId: string | null;
      displayName: string;
      rank: string | null;
      homeFacultyId: string | null;
      homeFacultyName: string | null;
      sections: number;
      distinctCourses: number;
      lectureHrs: number;
      labHrs: number;
      contactHrs: number;
      students: number;
      team: number;
      memberships: Array<{
        programId: string;
        programCode: string | null;
        programName: string;
        programLevel: string | null;
        facultyId: string | null;
        facultyName: string | null;
        role: string | null;
      }>;
    }
    const byTeacher = new Map<string, TeacherMeta>();
    for (const r of rows) {
      let t = byTeacher.get(r.kku_email);
      if (!t) {
        t = {
          kkuEmail: r.kku_email,
          facultyMemberId: r.faculty_member_id,
          displayName:
            r.name_th?.trim() ||
            r.name_en?.trim() ||
            r.kku_email.split('@')[0] ||
            r.kku_email,
          rank: r.rank,
          homeFacultyId: r.home_faculty_id,
          homeFacultyName: r.home_faculty_name_th,
          sections: Number(r.sections),
          distinctCourses: Number(r.distinct_courses),
          lectureHrs: Number(r.lecture_hrs),
          labHrs: Number(r.lab_hrs),
          contactHrs: Number(r.contact_hrs),
          students: Number(r.students_taught),
          team: Number(r.team_sections),
          memberships: [],
        };
        byTeacher.set(r.kku_email, t);
      }
      if (
        r.program_id &&
        !t.memberships.some((m) => m.programId === r.program_id)
      ) {
        t.memberships.push({
          programId: r.program_id,
          programCode: r.program_code,
          programName: r.program_name_th ?? '(unnamed program)',
          programLevel: r.program_level,
          facultyId: r.program_faculty_id,
          facultyName: r.program_faculty_name_th,
          role: r.program_role,
        });
      }
    }

    // ── Pass 2: build the Faculty → Program Level → Program → Teacher
    //    tree. The fallback (teachers with no in-scope curriculum) sits in
    //    a level node with `level = null`, whose single program child
    //    carries them. ──
    const FALLBACK_PROGRAM = '__no_program__';
    const FALLBACK_LEVEL = '__no_level__';
    const UNRESOLVED_FACULTY = '__unresolved__';
    interface LevelAccum {
      level: string | null;
      programs: Map<string, TeacherProgramGroup>;
      /** Deduped — a teacher in two programs of the same level is counted
       *  once for the level rollup. */
      distinct: Map<string, TeacherRow>;
    }
    interface FacAccum {
      facultyId: string | null;
      facultyName: string;
      levels: Map<string, LevelAccum>;
      /** Deduped — a teacher across several of the faculty's programs is
       *  counted once for the faculty rollup. */
      distinct: Map<string, TeacherRow>;
    }
    const facMap = new Map<string, FacAccum>();
    const grandDistinct = new Map<string, TeacherRow>();

    const getFac = (
      key: string,
      facultyId: string | null,
      facultyName: string,
    ): FacAccum => {
      let f = facMap.get(key);
      if (!f) {
        f = { facultyId, facultyName, levels: new Map(), distinct: new Map() };
        facMap.set(key, f);
      }
      return f;
    };
    const getLevel = (
      fac: FacAccum,
      levelKey: string,
      level: string | null,
    ): LevelAccum => {
      let l = fac.levels.get(levelKey);
      if (!l) {
        l = { level, programs: new Map(), distinct: new Map() };
        fac.levels.set(levelKey, l);
      }
      return l;
    };
    const getProg = (
      lvl: LevelAccum,
      progKey: string,
      seed: Pick<
        TeacherProgramGroup,
        'programId' | 'programCode' | 'programName' | 'programLevel'
      >,
    ): TeacherProgramGroup => {
      let p = lvl.programs.get(progKey);
      if (!p) {
        p = {
          ...seed,
          children: [],
          teachers: 0,
          sections: 0,
          lectureHrsPerWeek: 0,
          labHrsPerWeek: 0,
          totalContactHrsPerWeek: 0,
          avgContactHrsPerTeacher: 0,
          studentsTaught: 0,
          teamTaughtSections: 0,
        };
        lvl.programs.set(progKey, p);
      }
      return p;
    };

    for (const t of byTeacher.values()) {
      const teacherRow = (programRole: string | null): TeacherRow => ({
        facultyMemberId: t.facultyMemberId,
        displayName: t.displayName,
        rank: t.rank,
        programRole,
        programCount: t.memberships.length,
        sections: t.sections,
        distinctCourses: t.distinctCourses,
        lectureHrsPerWeek: t.lectureHrs,
        labHrsPerWeek: t.labHrs,
        totalContactHrsPerWeek: t.contactHrs,
        studentsTaught: t.students,
        teamTaughtSections: t.team,
      });

      const placements: Array<{
        facKey: string;
        facultyId: string | null;
        facultyName: string;
        levelKey: string;
        level: string | null;
        progKey: string;
        progSeed: Pick<
          TeacherProgramGroup,
          'programId' | 'programCode' | 'programName' | 'programLevel'
        >;
        role: string | null;
      }> = [];

      if (t.memberships.length > 0) {
        for (const m of t.memberships) {
          placements.push({
            facKey: m.facultyId ?? UNRESOLVED_FACULTY,
            facultyId: m.facultyId,
            facultyName: m.facultyName ?? 'Unresolved (external / HCM gap)',
            levelKey: m.programLevel ?? FALLBACK_LEVEL,
            level: m.programLevel,
            progKey: m.programId,
            progSeed: {
              programId: m.programId,
              programCode: m.programCode,
              programName: m.programName,
              programLevel: m.programLevel,
            },
            role: m.role,
          });
        }
      } else {
        // Teaching activity but no in-scope curriculum membership —
        // grouped under the teacher's home faculty (or the Unresolved
        // bucket when the teacher itself is unresolved), inside a level
        // node with no level.
        const resolvedHome = Boolean(t.facultyMemberId && t.homeFacultyId);
        placements.push({
          facKey: resolvedHome ? t.homeFacultyId! : UNRESOLVED_FACULTY,
          facultyId: resolvedHome ? t.homeFacultyId : null,
          facultyName: resolvedHome
            ? t.homeFacultyName ?? '(unknown faculty)'
            : 'Unresolved (external / HCM gap)',
          levelKey: FALLBACK_LEVEL,
          level: null,
          progKey: FALLBACK_PROGRAM,
          progSeed: {
            programId: null,
            programCode: null,
            programName: 'Not attached to a curriculum',
            programLevel: null,
          },
          role: null,
        });
      }

      for (const pl of placements) {
        const fac = getFac(pl.facKey, pl.facultyId, pl.facultyName);
        const lvl = getLevel(fac, pl.levelKey, pl.level);
        const prog = getProg(lvl, pl.progKey, pl.progSeed);
        const row = teacherRow(pl.role);
        prog.children.push(row);
        prog.teachers += 1;
        prog.sections += t.sections;
        prog.lectureHrsPerWeek += t.lectureHrs;
        prog.labHrsPerWeek += t.labHrs;
        prog.totalContactHrsPerWeek += t.contactHrs;
        prog.studentsTaught += t.students;
        prog.teamTaughtSections += t.team;
        // Level + faculty + grand-total rollups count each teacher once.
        lvl.distinct.set(t.kkuEmail, row);
        fac.distinct.set(t.kkuEmail, row);
        grandDistinct.set(t.kkuEmail, row);
      }
    }

    // ── Pass 3: finalise aggregates + ordering. ──
    const sumRows = (m: Map<string, TeacherRow>) => {
      let sections = 0,
        lec = 0,
        lab = 0,
        hrs = 0,
        students = 0,
        team = 0;
      for (const r of m.values()) {
        sections += r.sections;
        lec += r.lectureHrsPerWeek;
        lab += r.labHrsPerWeek;
        hrs += r.totalContactHrsPerWeek;
        students += r.studentsTaught;
        team += r.teamTaughtSections;
      }
      return {
        teachers: m.size,
        sections,
        lectureHrsPerWeek: lec,
        labHrsPerWeek: lab,
        totalContactHrsPerWeek: hrs,
        studentsTaught: students,
        teamTaughtSections: team,
      };
    };
    // Bachelor → Master → Doctoral → Higher Grad. Dip.; fallback last.
    const levelRank = (level: string | null): number => {
      switch (level) {
        case 'BACHELOR':
          return 0;
        case 'MASTER':
          return 1;
        case 'DOCTORAL':
          return 2;
        case 'HIGHER_GRAD_DIPLOMA':
          return 3;
        default:
          return 99;
      }
    };

    const out: TeacherFacultyGroup[] = [];
    let programCount = 0;
    for (const fac of facMap.values()) {
      const levels: TeacherLevelGroup[] = [];
      for (const lvl of fac.levels.values()) {
        const programs: TeacherProgramGroup[] = [];
        for (const prog of lvl.programs.values()) {
          prog.avgContactHrsPerTeacher =
            prog.teachers > 0 ? prog.totalContactHrsPerWeek / prog.teachers : 0;
          prog.children.sort(
            (a, b) => b.totalContactHrsPerWeek - a.totalContactHrsPerWeek,
          );
          if (prog.programId !== null) programCount += 1;
          programs.push(prog);
        }
        // Real programs by total contact hrs desc; fallback node last.
        programs.sort((a, b) => {
          if (a.programId === null && b.programId !== null) return 1;
          if (a.programId !== null && b.programId === null) return -1;
          return b.totalContactHrsPerWeek - a.totalContactHrsPerWeek;
        });
        const lAgg = sumRows(lvl.distinct);
        levels.push({
          level: lvl.level,
          programs,
          teachers: lAgg.teachers,
          sections: lAgg.sections,
          lectureHrsPerWeek: lAgg.lectureHrsPerWeek,
          labHrsPerWeek: lAgg.labHrsPerWeek,
          totalContactHrsPerWeek: lAgg.totalContactHrsPerWeek,
          avgContactHrsPerTeacher:
            lAgg.teachers > 0
              ? lAgg.totalContactHrsPerWeek / lAgg.teachers
              : 0,
          studentsTaught: lAgg.studentsTaught,
          teamTaughtSections: lAgg.teamTaughtSections,
        });
      }
      // Levels in degree order; the no-level fallback last.
      levels.sort((a, b) => levelRank(a.level) - levelRank(b.level));
      const agg = sumRows(fac.distinct);
      out.push({
        facultyId: fac.facultyId,
        facultyName: fac.facultyName,
        levels,
        teachers: agg.teachers,
        sections: agg.sections,
        lectureHrsPerWeek: agg.lectureHrsPerWeek,
        labHrsPerWeek: agg.labHrsPerWeek,
        totalContactHrsPerWeek: agg.totalContactHrsPerWeek,
        avgContactHrsPerTeacher:
          agg.teachers > 0 ? agg.totalContactHrsPerWeek / agg.teachers : 0,
        studentsTaught: agg.studentsTaught,
        teamTaughtSections: agg.teamTaughtSections,
      });
    }
    // Resolved faculties by total contact hrs desc; Unresolved last.
    out.sort((a, b) => {
      if (a.facultyId === null && b.facultyId !== null) return 1;
      if (a.facultyId !== null && b.facultyId === null) return -1;
      return b.totalContactHrsPerWeek - a.totalContactHrsPerWeek;
    });

    const grand = sumRows(grandDistinct);
    return {
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      rows: out,
      totals: {
        teachers: grand.teachers,
        programs: programCount,
        sections: grand.sections,
        lectureHrsPerWeek: grand.lectureHrsPerWeek,
        labHrsPerWeek: grand.labHrsPerWeek,
        totalContactHrsPerWeek: grand.totalContactHrsPerWeek,
        avgContactHrsPerTeacher:
          grand.teachers > 0
            ? grand.totalContactHrsPerWeek / grand.teachers
            : 0,
        studentsTaught: grand.studentsTaught,
        teamTaughtSections: grand.teamTaughtSections,
      },
    };
  }

  /**
   * "Students taught" by faculty — feeds the second viz on the staff
   * dashboard. Counts students-per-teacher seat-enrolment Σ across
   * every section the faculty's teachers teach. Useful complement to
   * the contact-hours pulse — a faculty can be over-loaded on hours
   * but under-reaching on student headcount (or vice versa).
   *
   * Cached by full filter signature.
   */
  async studentsByFaculty(
    filter: TeachingWorkloadFilter,
  ): Promise<StudentsByFacultyResponse> {
    const ck = this.cacheKey('studentsByFaculty', filter);
    const cached = await this.cache.get<StudentsByFacultyResponse>(ck);
    if (cached) return cached;
    const rows = await prisma.$queryRaw<
      Array<{
        faculty_id: string | null;
        faculty_name_th: string | null;
        teachers: bigint;
        sections: bigint;
        students_taught: bigint;
      }>
    >`
      WITH per_teacher AS (${this.teacherCteSql(filter)})
      SELECT
        fm.faculty_id,
        f.name_th AS faculty_name_th,
        COUNT(*)::bigint                 AS teachers,
        SUM(per_teacher.sections)::bigint AS sections,
        SUM(per_teacher.students_taught)::bigint AS students_taught
      FROM per_teacher
      LEFT JOIN faculty_members fm ON fm.id = per_teacher.faculty_member_id
      LEFT JOIN faculties f ON f.id = fm.faculty_id
      GROUP BY fm.faculty_id, f.name_th
      ORDER BY SUM(per_teacher.students_taught) DESC NULLS LAST
    `;
    let totT = 0,
      totS = 0,
      totST = 0;
    const out = rows.map((r) => {
      const teachers = Number(r.teachers);
      const sections = Number(r.sections);
      const students = Number(r.students_taught);
      totT += teachers;
      totS += sections;
      totST += students;
      return {
        facultyId: r.faculty_id,
        facultyName: r.faculty_name_th ?? 'Unresolved (external / HCM gap)',
        teachers,
        sections,
        studentsTaught: students,
        studentsPerTeacher: teachers > 0 ? students / teachers : 0,
      };
    });
    const res: StudentsByFacultyResponse = {
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      rows: out,
      totals: {
        teachers: totT,
        sections: totS,
        studentsTaught: totST,
      },
    };
    await this.cache.set(ck, res, TeachingWorkloadService.CACHE_TTL_SECONDS);
    return res;
  }
}
