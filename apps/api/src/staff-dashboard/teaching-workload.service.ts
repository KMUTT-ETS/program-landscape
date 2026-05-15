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

export interface TeachingWorkloadFilter {
  /** Granted faculty IDs (Faculty.id) — clamps on the TEACHER's home
   *  faculty (fm.faculty_id), NOT the course-owning faculty. A Math
   *  teacher teaching a service course to Engineering still counts as
   *  Math's workload. `null` = no clamp (admin / UNIVERSITY_USER). */
  facultyIds: string[] | null;
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

export interface TeacherDeepDiveRow {
  kkuEmail: string;
  facultyMemberId: string | null;
  nameTh: string | null;
  nameEn: string | null;
  rank: string | null;
  facultyId: string | null;
  facultyName: string | null;
  sections: number;
  distinctCourses: number;
  totalContactHrsPerWeek: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

export interface TeacherDeepDiveResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: TeacherDeepDiveRow[];
  truncated: boolean;
}

@Injectable()
export class TeachingWorkloadService {
  /**
   * Find the latest "main" snapshot WITH teaching activity for the
   * caller's scope. Prefers sem 1 / 2 of the most recent year that has
   * actual enrollment (excludes "not-yet-started" terms with 0 students).
   * Sem 3 / 4 (summer / special) deprioritised. Explicit (year, sem)
   * filters still reach them.
   */
  async resolveLatestSnapshot(
    facultyIds: string[] | null,
  ): Promise<{ acadYearBE: number; semester: number } | null> {
    const facClause =
      facultyIds === null
        ? Prisma.sql`TRUE`
        : facultyIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`fm.faculty_id IN (${Prisma.join(facultyIds)})`;
    const rows = await prisma.$queryRaw<Array<{ y: number; s: number }>>`
      SELECT c.acad_year_be AS y, c.semester AS s
        FROM class_offerings c
        JOIN class_offering_teachers t ON t.class_offering_id = c.id
        LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
       WHERE ${facClause}
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
   * the scoped slice of teaching activity. Faculties list is sourced
   * from the granted Faculty rows directly.
   */
  async filterOptions(facultyIds: string[] | null): Promise<FilterOptionsResponse> {
    const facClause =
      facultyIds === null
        ? Prisma.sql`TRUE`
        : facultyIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`fm.faculty_id IN (${Prisma.join(facultyIds)})`;
    const [years, semesters, levels, faculties] = await Promise.all([
      prisma.$queryRaw<Array<{ y: number }>>`
        SELECT DISTINCT c.acad_year_be AS y
          FROM class_offerings c
          JOIN class_offering_teachers t ON t.class_offering_id = c.id
          LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
         WHERE ${facClause}
         ORDER BY c.acad_year_be DESC
      `,
      prisma.$queryRaw<Array<{ s: number }>>`
        SELECT DISTINCT c.semester AS s
          FROM class_offerings c
          JOIN class_offering_teachers t ON t.class_offering_id = c.id
          LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
         WHERE ${facClause}
         ORDER BY c.semester
      `,
      prisma.$queryRaw<Array<{ l: string }>>`
        SELECT DISTINCT c.level_name AS l
          FROM class_offerings c
          JOIN class_offering_teachers t ON t.class_offering_id = c.id
          LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
         WHERE ${facClause}
         ORDER BY c.level_name
      `,
      facultyIds === null
        ? prisma.faculty.findMany({ select: { nameTh: true }, orderBy: { nameTh: 'asc' } })
        : prisma.faculty.findMany({
            where: { id: { in: facultyIds } },
            select: { nameTh: true },
            orderBy: { nameTh: 'asc' },
          }),
    ]);
    return {
      years: years.map((r) => r.y),
      semesters: semesters.map((r) => r.s),
      levels: levels.map((r) => r.l),
      faculties: faculties.map((r) => r.nameTh),
    };
  }

  /**
   * Build the raw-SQL WHERE clause for the
   * `class_offering_teachers t JOIN class_offerings c LEFT JOIN faculty_members fm`
   * shape used by every query in this service.
   *
   * Faculty clamp filters by `fm.faculty_id` — the TEACHER's home
   * faculty — NOT the course-owning registry faculty. A Math teacher
   * teaching a GE service course is still attributed to Math's load.
   * For UNIVERSITY / admin scope, `facultyIds === null` skips the
   * clamp entirely.
   */
  private buildWhere(filter: TeachingWorkloadFilter): Prisma.Sql {
    const clauses: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filter.facultyIds !== null) {
      if (filter.facultyIds.length === 0) {
        clauses.push(Prisma.sql`FALSE`);
      } else {
        clauses.push(Prisma.sql`fm.faculty_id IN (${Prisma.join(filter.facultyIds)})`);
      }
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
   *  deep-dive. One row per kku_email × snapshot. The LEFT JOIN to
   *  `faculty_members fm` is what makes the faculty-clamp possible. */
  private teacherCteSql(filter: TeachingWorkloadFilter): Prisma.Sql {
    return Prisma.sql`
      SELECT
        t.kku_email,
        t.faculty_member_id,
        COUNT(DISTINCT c.id)::bigint                                    AS sections,
        COUNT(DISTINCT c.course_code)::bigint                           AS distinct_courses,
        COALESCE(SUM(COALESCE(c.lecture_hrs_per_week,0) + COALESCE(c.lab_hrs_per_week,0)),0)::bigint AS contact_hrs,
        COALESCE(SUM(c.enroll_seat),0)::bigint                          AS students_taught,
        SUM(CASE WHEN (SELECT COUNT(*) FROM class_offering_teachers tt WHERE tt.class_offering_id = c.id) >= 2 THEN 1 ELSE 0 END)::bigint AS team_sections
      FROM class_offering_teachers t
      JOIN class_offerings c ON c.id = t.class_offering_id
      LEFT JOIN faculty_members fm ON fm.id = t.faculty_member_id
      WHERE ${this.buildWhere(filter)}
      GROUP BY t.kku_email, t.faculty_member_id
    `;
  }

  async summary(filter: TeachingWorkloadFilter): Promise<SummaryResponse> {
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

  async teachers(
    filter: TeachingWorkloadFilter & { limit?: number; onlyUnresolved?: boolean },
  ): Promise<TeacherDeepDiveResponse> {
    const limit = Math.min(filter.limit ?? 500, 2000);
    const onlyUnresolved = filter.onlyUnresolved ?? false;
    const unresolvedClause = onlyUnresolved
      ? Prisma.sql`AND per_teacher.faculty_member_id IS NULL`
      : Prisma.sql`AND TRUE`;
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
        per_teacher.contact_hrs,
        per_teacher.students_taught,
        per_teacher.team_sections
      FROM per_teacher
      LEFT JOIN faculty_members fm ON fm.id = per_teacher.faculty_member_id
      LEFT JOIN faculties f ON f.id = fm.faculty_id
      WHERE TRUE ${unresolvedClause}
      ORDER BY per_teacher.contact_hrs DESC, per_teacher.kku_email
      LIMIT ${limit + 1}
    `;
    const truncated = rows.length > limit;
    return {
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      rows: rows.slice(0, limit).map((r) => ({
        kkuEmail: r.kku_email,
        facultyMemberId: r.faculty_member_id,
        nameTh: r.name_th,
        nameEn: r.name_en,
        rank: r.rank,
        facultyId: r.faculty_id,
        facultyName: r.faculty_name_th,
        sections: Number(r.sections),
        distinctCourses: Number(r.distinct_courses),
        totalContactHrsPerWeek: Number(r.contact_hrs),
        studentsTaught: Number(r.students_taught),
        teamTaughtSections: Number(r.team_sections),
      })),
      truncated,
    };
  }
}
