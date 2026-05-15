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

/** Leaf row inside the by-teacher drill-down. */
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

/** Top-level (faculty) group in the by-teacher drill-down. */
export interface TeacherFacultyGroup {
  facultyId: string | null;
  facultyName: string;
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

export interface TeacherDeepDiveResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: TeacherFacultyGroup[];
  totals: {
    teachers: number;
    sections: number;
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
   * Per-teacher drill-down — Faculty → Teacher hierarchy. Aggregates
   * roll up to the faculty tier. UI matches the active-pivot
   * drill-down style. The teacher's KKU email is NOT surfaced (the
   * admin raw-data viewer still has it for analyst follow-up); the
   * display name falls back to the email's local-part for unresolved
   * teachers so the row is still readable.
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
    const rows = await prisma.$queryRaw<
      Array<{
        kku_email: string;
        faculty_member_id: string | null;
        name_th: string | null;
        name_en: string | null;
        rank: string | null;
        faculty_id: string | null;
        faculty_name_th: string | null;
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
        fm.faculty_id,
        f.name_th AS faculty_name_th,
        per_teacher.sections,
        per_teacher.distinct_courses,
        per_teacher.lecture_hrs,
        per_teacher.lab_hrs,
        per_teacher.contact_hrs,
        per_teacher.students_taught,
        per_teacher.team_sections
      FROM per_teacher
      LEFT JOIN faculty_members fm ON fm.id = per_teacher.faculty_member_id
      LEFT JOIN faculties f ON f.id = fm.faculty_id
      ORDER BY f.name_th NULLS LAST, per_teacher.contact_hrs DESC
    `;

    // Pivot SQL rows into Faculty → Teacher tree.
    const facMap = new Map<string, TeacherFacultyGroup>();
    const facKey = (id: string | null, nm: string | null): string =>
      id ?? `__unresolved__:${nm ?? ''}`;
    for (const r of rows) {
      const sections = Number(r.sections);
      const lectureHrs = Number(r.lecture_hrs);
      const labHrs = Number(r.lab_hrs);
      const contactHrs = Number(r.contact_hrs);
      const students = Number(r.students_taught);
      const team = Number(r.team_sections);
      const displayName =
        r.name_th?.trim() ||
        r.name_en?.trim() ||
        r.kku_email.split('@')[0] ||
        r.kku_email;
      const groupName = r.faculty_name_th ?? 'Unresolved (external / HCM gap)';
      const k = facKey(r.faculty_id, r.faculty_name_th);
      const fac = facMap.get(k) ?? {
        facultyId: r.faculty_id,
        facultyName: groupName,
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
      fac.children.push({
        facultyMemberId: r.faculty_member_id,
        displayName,
        rank: r.rank,
        sections,
        distinctCourses: Number(r.distinct_courses),
        lectureHrsPerWeek: lectureHrs,
        labHrsPerWeek: labHrs,
        totalContactHrsPerWeek: contactHrs,
        studentsTaught: students,
        teamTaughtSections: team,
      });
      fac.teachers += 1;
      fac.sections += sections;
      fac.lectureHrsPerWeek += lectureHrs;
      fac.labHrsPerWeek += labHrs;
      fac.totalContactHrsPerWeek += contactHrs;
      fac.studentsTaught += students;
      fac.teamTaughtSections += team;
      facMap.set(k, fac);
    }
    const out: TeacherFacultyGroup[] = [];
    let totTeachers = 0,
      totSections = 0,
      totHrs = 0,
      totStudents = 0,
      totTeam = 0;
    for (const fac of facMap.values()) {
      fac.avgContactHrsPerTeacher =
        fac.teachers > 0 ? fac.totalContactHrsPerWeek / fac.teachers : 0;
      out.push(fac);
      totTeachers += fac.teachers;
      totSections += fac.sections;
      totHrs += fac.totalContactHrsPerWeek;
      totStudents += fac.studentsTaught;
      totTeam += fac.teamTaughtSections;
    }
    // Default ordering: resolved faculties (by total contact hrs desc),
    // unresolved row last (typically a long tail of external lecturers).
    out.sort((a, b) => {
      if (a.facultyId === null && b.facultyId !== null) return 1;
      if (a.facultyId !== null && b.facultyId === null) return -1;
      return b.totalContactHrsPerWeek - a.totalContactHrsPerWeek;
    });
    return {
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      rows: out,
      totals: {
        teachers: totTeachers,
        sections: totSections,
        totalContactHrsPerWeek: totHrs,
        avgContactHrsPerTeacher: totTeachers > 0 ? totHrs / totTeachers : 0,
        studentsTaught: totStudents,
        teamTaughtSections: totTeam,
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
