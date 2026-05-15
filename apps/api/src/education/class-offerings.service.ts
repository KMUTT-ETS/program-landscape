// ────────────────────────────────────────────────────────────────────────────
// /education/class-offerings — subject information & seat fulfilment.
//
// Source: `class_offerings` cube refreshed by `pnpm programs:link-class-offerings`
// from POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER. Faculty attribution is direct
// (`facultyId` column resolved at insert time from the registrar's Thai
// faculty name). Scope clamping handled by the controller via
// `clampFacultyNameFilter` — service receives a pre-clamped list of
// Thai faculty names.
// ────────────────────────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@kku/db';
import type { OfferingScope } from '../common/scope-guards';

export interface ClassOfferingsFilter {
  /** Resolved user scope — drives the WHERE-clause OR of
   *  (registry_faculty_name IN faculties) and (course_code IN program-codes).
   *  Admin/UNI = 'all' (no clamp); pure FACULTY_USER has facultyNames only;
   *  pure PROGRAM_USER has programCourseCodes only; mixed = both. */
  scope: OfferingScope;
  acadYearBE?: number;
  semester?: number;
  levelName?: string[];
  geOnly?: boolean;
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
  totalSeatsOffered: number;
  totalSeatsFilled: number;
  fillRate: number;
  distinctCourses: number;
  distinctFaculties: number;
  distinctTeachers: number;
  totalCreditsDelivered: number;
  zeroEnrollmentSections: number;
  geSections: number;
}

export interface HeatmapResponse {
  rows: Array<{
    facultyName: string;
    cells: Array<{
      acadYearBE: number;
      semester: number;
      sections: number;
      seatsOffered: number;
      seatsFilled: number;
      fillRate: number;
    }>;
  }>;
  yearSemesters: Array<{ acadYearBE: number; semester: number; label: string }>;
}

export interface DistributionResponse {
  acadYearBE: number;
  semester: number;
  totalSections: number;
  buckets: Array<{
    bucket: string;
    rangeLowerPct: number;
    rangeUpperPct: number;
    sections: number;
    pctOfTotal: number;
  }>;
}

export interface GeBreakdownResponse {
  byProvider: Array<{
    registryFacultyName: string;
    isGeInstitute: boolean;
    sections: number;
    seatsOffered: number;
    seatsFilled: number;
    fillRate: number;
    distinctCourses: number;
  }>;
  trend: Array<{
    acadYearBE: number;
    semester: number;
    label: string;
    sections: number;
    seatsOffered: number;
    seatsFilled: number;
    fillRate: number;
  }>;
  totals: {
    sections: number;
    seatsOffered: number;
    seatsFilled: number;
    fillRate: number;
  };
}

/** One course-row inside a faculty × level group. Leaf of the drill-down. */
export interface DeepDiveCourseRow {
  courseCode: string;
  courseNameTh: string | null;
  courseNameEn: string | null;
  isGeneralEducation: boolean;
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
  creditTotal: number | null;
  programsCount: number;
}

/** Mid-level (program-level) group inside a faculty. */
export interface DeepDiveLevelGroup {
  levelName: string;
  children: DeepDiveCourseRow[];
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
  totalCreditsDelivered: number;
}

/** Top-level (faculty) group. Aggregates roll up over all levels. */
export interface DeepDiveFacultyGroup {
  facultyName: string;
  children: DeepDiveLevelGroup[];
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
  totalCreditsDelivered: number;
  distinctCourses: number;
}

export interface DeepDiveResponse {
  acadYearBE: number;
  semester: number;
  rows: DeepDiveFacultyGroup[];
  totals: {
    sections: number;
    seatsOffered: number;
    seatsFilled: number;
    fillRate: number;
    totalCreditsDelivered: number;
    distinctCourses: number;
  };
}

@Injectable()
export class ClassOfferingsService {
  /**
   * Prisma-style WHERE for `prisma.classOffering.*` calls. Scope clamp
   * is built as an OR of (registry_faculty_name IN faculties) and
   * (course_code IN program-codes) — admin = no clamp, scoped = OR of
   * the relevant sets, none = an unsatisfiable predicate so the query
   * returns no rows.
   */
  private buildWhere(filter: ClassOfferingsFilter): Prisma.ClassOfferingWhereInput {
    const where: Prisma.ClassOfferingWhereInput = {};
    const scope = filter.scope;
    if (scope.mode === 'none') {
      // Unsatisfiable — yields empty result set.
      where.id = '__none__';
    } else if (scope.mode === 'scoped') {
      const or: Prisma.ClassOfferingWhereInput[] = [];
      if (scope.facultyNames.length > 0) {
        or.push({ registryFacultyName: { in: scope.facultyNames } });
      }
      if (scope.programCourseCodes.length > 0) {
        or.push({ courseCode: { in: scope.programCourseCodes } });
      }
      if (or.length === 0) where.id = '__none__';
      else if (or.length === 1) Object.assign(where, or[0]);
      else where.OR = or;
    }
    if (filter.acadYearBE !== undefined) where.acadYearBE = filter.acadYearBE;
    if (filter.semester !== undefined) where.semester = filter.semester;
    if (filter.levelName && filter.levelName.length > 0) {
      where.levelName = { in: filter.levelName };
    }
    if (filter.geOnly) where.isGeneralEducation = true;
    return where;
  }

  /**
   * Find the latest "main" snapshot WITH ENROLLMENT — preferring sem 1
   * or 2 of the most recent year where students have actually enrolled.
   * The most recent semester is often a not-yet-started term where
   * enroll_seat is uniformly 0; the dashboard default should land on
   * the last "real" snapshot. Semesters 3 (summer) and 4 (special) are
   * deprioritised (heavy thesis / clinical-rotation rows). Explicit
   * (year, sem) filters still reach them. Returns null on empty scope.
   */
  async resolveLatestSnapshot(
    scope: OfferingScope,
  ): Promise<{ acadYearBE: number; semester: number } | null> {
    // Reuse the rawWhereSnippet logic by passing a scope-only filter.
    const scopeOnly = this.rawWhereSnippet({ scope });
    const rows = await prisma.$queryRaw<Array<{ y: number; s: number }>>`
      SELECT c.acad_year_be AS y, c.semester AS s
        FROM class_offerings c
       WHERE ${scopeOnly}
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
   * Filter options. Drives the dropdowns on the page. Returns the
   * FULL set of years/semesters/levels/faculties that the caller can
   * see — clamped by the user's effective scope.
   */
  async filterOptions(scope: OfferingScope): Promise<FilterOptionsResponse> {
    const where = this.buildWhere({ scope });
    const [years, semesters, levels, faculties] = await Promise.all([
      prisma.classOffering.findMany({
        where,
        distinct: ['acadYearBE'],
        select: { acadYearBE: true },
        orderBy: { acadYearBE: 'desc' },
      }),
      prisma.classOffering.findMany({
        where,
        distinct: ['semester'],
        select: { semester: true },
        orderBy: { semester: 'asc' },
      }),
      prisma.classOffering.findMany({
        where,
        distinct: ['levelName'],
        select: { levelName: true },
        orderBy: { levelName: 'asc' },
      }),
      prisma.classOffering.findMany({
        where,
        distinct: ['registryFacultyName'],
        select: { registryFacultyName: true },
        orderBy: { registryFacultyName: 'asc' },
      }),
    ]);
    return {
      years: years.map((r) => r.acadYearBE),
      semesters: semesters.map((r) => r.semester),
      levels: levels.map((r) => r.levelName),
      faculties: faculties.map((r) => r.registryFacultyName),
    };
  }

  /**
   * KPI summary card data for the dashboard header. All counts respect
   * the active filter and the user's faculty clamp.
   */
  async summary(filter: ClassOfferingsFilter): Promise<SummaryResponse> {
    const where = this.buildWhere(filter);
    const [
      agg,
      distinctCourses,
      distinctFaculties,
      zeroEnroll,
      geCount,
      distinctTeachersRow,
    ] = await Promise.all([
      prisma.classOffering.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalSeat: true, enrollSeat: true, creditTotal: true },
      }),
      prisma.classOffering.findMany({
        where,
        distinct: ['courseCode'],
        select: { courseCode: true },
      }),
      prisma.classOffering.findMany({
        where,
        distinct: ['registryFacultyName'],
        select: { registryFacultyName: true },
      }),
      prisma.classOffering.count({ where: { ...where, enrollSeat: 0 } }),
      prisma.classOffering.count({ where: { ...where, isGeneralEducation: true } }),
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(DISTINCT t.kku_email)::bigint AS n
          FROM class_offering_teachers t
          JOIN class_offerings c ON c.id = t.class_offering_id
         WHERE ${this.rawWhereSnippet(filter)}
      `,
    ]);
    const seatsOffered = Number(agg._sum.totalSeat ?? 0);
    const seatsFilled = Number(agg._sum.enrollSeat ?? 0);
    return {
      acadYearBE: filter.acadYearBE ?? null,
      semester: filter.semester ?? null,
      totalSections: agg._count._all,
      totalSeatsOffered: seatsOffered,
      totalSeatsFilled: seatsFilled,
      fillRate: seatsOffered > 0 ? seatsFilled / seatsOffered : 0,
      distinctCourses: distinctCourses.length,
      distinctFaculties: distinctFaculties.length,
      distinctTeachers: Number(distinctTeachersRow[0]?.n ?? 0),
      totalCreditsDelivered: Number(agg._sum.creditTotal ?? 0),
      zeroEnrollmentSections: zeroEnroll,
      geSections: geCount,
    };
  }

  /**
   * Raw SQL WHERE snippet matching `buildWhere`. Used by the
   * heatmap / GE / deep-dive queries that need GROUP BY at the SQL
   * level. Same OR-of-scope-clauses contract as buildWhere().
   */
  private rawWhereSnippet(filter: ClassOfferingsFilter): Prisma.Sql {
    const clauses: Prisma.Sql[] = [Prisma.sql`TRUE`];
    const scope = filter.scope;
    if (scope.mode === 'none') {
      clauses.push(Prisma.sql`FALSE`);
    } else if (scope.mode === 'scoped') {
      const or: Prisma.Sql[] = [];
      if (scope.facultyNames.length > 0) {
        or.push(Prisma.sql`c.registry_faculty_name IN (${Prisma.join(scope.facultyNames)})`);
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
    if (filter.geOnly) clauses.push(Prisma.sql`c.is_general_education = TRUE`);
    return Prisma.join(clauses, ' AND ');
  }

  /**
   * Heatmap: rows = faculty, columns = (acad_year × semester), cell =
   * fill rate. Last 5 years × all semesters by default (the cube only
   * has 5 years anyway). Faculties sorted by total sections desc.
   */
  async heatmap(filter: Omit<ClassOfferingsFilter, 'acadYearBE' | 'semester'>): Promise<HeatmapResponse> {
    // Group at SQL level for speed (the JS-side groupBy would walk 122k rows).
    // The (year, sem) tuple is filtered out GLOBALLY when total enrolment
    // is zero — that drops not-yet-enrolled future terms cleanly without
    // hiding legitimate completed semesters. Summer (sem 3) and Special
    // (sem 4) terms have low fill rates by their nature (1–6%) but they
    // *did* run; they belong in the heatmap.
    const rows = await prisma.$queryRaw<
      Array<{
        registry_faculty_name: string;
        acad_year_be: number;
        semester: number;
        n: bigint;
        seats: bigint;
        enrolled: bigint;
      }>
    >`
      WITH eligible AS (
        SELECT c.acad_year_be, c.semester
          FROM class_offerings c
         WHERE ${this.rawWhereSnippet(filter)}
         GROUP BY c.acad_year_be, c.semester
        HAVING SUM(c.enroll_seat) > 0
      )
      SELECT
        c.registry_faculty_name,
        c.acad_year_be,
        c.semester,
        COUNT(*)::bigint AS n,
        SUM(c.total_seat)::bigint AS seats,
        SUM(c.enroll_seat)::bigint AS enrolled
      FROM class_offerings c
      JOIN eligible e ON e.acad_year_be = c.acad_year_be AND e.semester = c.semester
      WHERE ${this.rawWhereSnippet(filter)}
      GROUP BY c.registry_faculty_name, c.acad_year_be, c.semester
      ORDER BY c.registry_faculty_name, c.acad_year_be, c.semester
    `;
    // Pivot into rows.
    const yearSemSet = new Set<string>();
    const byFaculty = new Map<string, HeatmapResponse['rows'][number]>();
    for (const r of rows) {
      const key = `${r.acad_year_be}-${r.semester}`;
      yearSemSet.add(key);
      const facRow =
        byFaculty.get(r.registry_faculty_name) ?? {
          facultyName: r.registry_faculty_name,
          cells: [],
        };
      const seats = Number(r.seats);
      const enrolled = Number(r.enrolled);
      facRow.cells.push({
        acadYearBE: r.acad_year_be,
        semester: r.semester,
        sections: Number(r.n),
        seatsOffered: seats,
        seatsFilled: enrolled,
        fillRate: seats > 0 ? enrolled / seats : 0,
      });
      byFaculty.set(r.registry_faculty_name, facRow);
    }
    const yearSemesters = [...yearSemSet]
      .map((k) => {
        const [y, s] = k.split('-').map(Number);
        return { acadYearBE: y!, semester: s!, label: `BE ${y} / S${s}` };
      })
      .sort((a, b) => a.acadYearBE - b.acadYearBE || a.semester - b.semester);
    return {
      rows: [...byFaculty.values()].sort((a, b) => {
        const aTot = a.cells.reduce((s, c) => s + c.sections, 0);
        const bTot = b.cells.reduce((s, c) => s + c.sections, 0);
        return bTot - aTot;
      }),
      yearSemesters,
    };
  }

  /**
   * Section utilisation distribution. Fill rate bucketed into 6 bands —
   * the zero-enrollment bucket is the headline finding (~50% of sections
   * had no enrollment, per the probe).
   */
  async distribution(filter: ClassOfferingsFilter): Promise<DistributionResponse> {
    const buckets = [
      { bucket: '0% (zero enrolment)', lo: 0, hi: 0 },
      { bucket: '1–25%', lo: 0.0001, hi: 0.25 },
      { bucket: '26–50%', lo: 0.2501, hi: 0.5 },
      { bucket: '51–75%', lo: 0.5001, hi: 0.75 },
      { bucket: '76–99%', lo: 0.7501, hi: 0.9999 },
      { bucket: '100%+ (full)', lo: 1.0, hi: 9999 },
    ];
    const where = this.buildWhere(filter);
    const all = await prisma.classOffering.findMany({
      where,
      select: { enrollSeat: true, totalSeat: true },
    });
    const out = buckets.map((b) => ({
      bucket: b.bucket,
      rangeLowerPct: b.lo * 100,
      rangeUpperPct: b.hi * 100,
      sections: 0,
      pctOfTotal: 0,
    }));
    for (const r of all) {
      if (r.totalSeat <= 0) continue; // skip null/0-capacity rows
      const rate = r.enrollSeat / r.totalSeat;
      let idx = 0;
      if (rate === 0) idx = 0;
      else if (rate <= 0.25) idx = 1;
      else if (rate <= 0.5) idx = 2;
      else if (rate <= 0.75) idx = 3;
      else if (rate < 1) idx = 4;
      else idx = 5;
      out[idx]!.sections++;
    }
    const total = out.reduce((s, b) => s + b.sections, 0);
    for (const b of out) b.pctOfTotal = total > 0 ? (b.sections / total) * 100 : 0;
    return {
      acadYearBE: filter.acadYearBE ?? 0,
      semester: filter.semester ?? 0,
      totalSections: total,
      buckets: out,
    };
  }

  /**
   * General-education breakdown. Aggregates GE-flagged offerings only,
   * split by owning registry faculty + trend across all years/semesters
   * the caller can see. Respects faculty clamp (which usually doesn't
   * narrow GE — every faculty's students take GE — but the consistent
   * application keeps the contract simple).
   */
  async geBreakdown(scope: OfferingScope): Promise<GeBreakdownResponse> {
    const filter: ClassOfferingsFilter = { scope, geOnly: true };
    const where = this.buildWhere(filter);
    const [byProviderRaw, trendRaw, totals] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          registry_faculty_name: string;
          n: bigint;
          seats: bigint;
          enrolled: bigint;
          courses: bigint;
        }>
      >`
        SELECT
          c.registry_faculty_name,
          COUNT(*)::bigint AS n,
          SUM(c.total_seat)::bigint AS seats,
          SUM(c.enroll_seat)::bigint AS enrolled,
          COUNT(DISTINCT c.course_code)::bigint AS courses
        FROM class_offerings c
        WHERE c.is_general_education = TRUE
          AND ${this.rawWhereSnippet({ ...filter })}
        GROUP BY c.registry_faculty_name
        ORDER BY COUNT(*) DESC
      `,
      prisma.$queryRaw<
        Array<{
          acad_year_be: number;
          semester: number;
          n: bigint;
          seats: bigint;
          enrolled: bigint;
        }>
      >`
        SELECT
          c.acad_year_be, c.semester,
          COUNT(*)::bigint AS n,
          SUM(c.total_seat)::bigint AS seats,
          SUM(c.enroll_seat)::bigint AS enrolled
        FROM class_offerings c
        WHERE c.is_general_education = TRUE
          AND ${this.rawWhereSnippet({ ...filter })}
        GROUP BY c.acad_year_be, c.semester
        ORDER BY c.acad_year_be, c.semester
      `,
      prisma.classOffering.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalSeat: true, enrollSeat: true },
      }),
    ]);
    const totalSeats = Number(totals._sum.totalSeat ?? 0);
    const totalEnrolled = Number(totals._sum.enrollSeat ?? 0);
    return {
      byProvider: byProviderRaw.map((r) => {
        const seats = Number(r.seats);
        const enrolled = Number(r.enrolled);
        return {
          registryFacultyName: r.registry_faculty_name,
          isGeInstitute:
            r.registry_faculty_name === 'สถาบันการสอนวิชาศึกษาทั่วไป' ||
            r.registry_faculty_name === 'สถาบันภาษา',
          sections: Number(r.n),
          seatsOffered: seats,
          seatsFilled: enrolled,
          fillRate: seats > 0 ? enrolled / seats : 0,
          distinctCourses: Number(r.courses),
        };
      }),
      trend: trendRaw.map((r) => {
        const seats = Number(r.seats);
        const enrolled = Number(r.enrolled);
        return {
          acadYearBE: r.acad_year_be,
          semester: r.semester,
          label: `BE ${r.acad_year_be} / S${r.semester}`,
          sections: Number(r.n),
          seatsOffered: seats,
          seatsFilled: enrolled,
          fillRate: seats > 0 ? enrolled / seats : 0,
        };
      }),
      totals: {
        sections: totals._count._all,
        seatsOffered: totalSeats,
        seatsFilled: totalEnrolled,
        fillRate: totalSeats > 0 ? totalEnrolled / totalSeats : 0,
      },
    };
  }

  /**
   * Course-level deep-dive — three-tier hierarchy
   * Faculty → Program Level → Course. Aggregates roll up at every tier.
   * Designed to plug straight into the DrillDownPivot-style table on
   * the web side (same UI idiom as /education/active-pivot).
   *
   * Mass courses (e.g., gen-ed) joined to program_courses to count how
   * many programs list each course.
   */
  async deepDiveDrillDown(filter: ClassOfferingsFilter): Promise<DeepDiveResponse> {
    const rows = await prisma.$queryRaw<
      Array<{
        course_code: string;
        course_name_th: string | null;
        course_name_en: string | null;
        registry_faculty_name: string;
        level_name: string;
        is_general_education: boolean;
        n: bigint;
        seats: bigint;
        enrolled: bigint;
        credit_total: number | null;
        programs_count: bigint;
      }>
    >`
      SELECT
        c.course_code,
        MAX(c.course_name_th)            AS course_name_th,
        MAX(c.course_name_en)            AS course_name_en,
        c.registry_faculty_name,
        c.level_name,
        bool_or(c.is_general_education)  AS is_general_education,
        COUNT(*)::bigint                 AS n,
        SUM(c.total_seat)::bigint        AS seats,
        SUM(c.enroll_seat)::bigint       AS enrolled,
        MAX(c.credit_total)              AS credit_total,
        (SELECT COUNT(*)::bigint
           FROM program_courses pc
          WHERE pc.course_code = c.course_code) AS programs_count
      FROM class_offerings c
      WHERE ${this.rawWhereSnippet(filter)}
      GROUP BY c.course_code, c.registry_faculty_name, c.level_name
      ORDER BY c.registry_faculty_name, c.level_name, SUM(c.total_seat) DESC NULLS LAST, c.course_code
    `;

    // Pivot SQL rows into Faculty → Level → Course tree.
    const facultyMap = new Map<string, DeepDiveFacultyGroup>();
    for (const r of rows) {
      const facName = r.registry_faculty_name;
      const lvlName = r.level_name;
      const seats = Number(r.seats);
      const enrolled = Number(r.enrolled);
      const sections = Number(r.n);
      const credits = Number(r.credit_total ?? 0) * sections;
      const fac = facultyMap.get(facName) ?? {
        facultyName: facName,
        children: [],
        sections: 0,
        seatsOffered: 0,
        seatsFilled: 0,
        fillRate: 0,
        totalCreditsDelivered: 0,
        distinctCourses: 0,
      };
      let level = fac.children.find((l) => l.levelName === lvlName);
      if (!level) {
        level = {
          levelName: lvlName,
          children: [],
          sections: 0,
          seatsOffered: 0,
          seatsFilled: 0,
          fillRate: 0,
          totalCreditsDelivered: 0,
        };
        fac.children.push(level);
      }
      level.children.push({
        courseCode: r.course_code,
        courseNameTh: r.course_name_th,
        courseNameEn: r.course_name_en,
        isGeneralEducation: r.is_general_education,
        sections,
        seatsOffered: seats,
        seatsFilled: enrolled,
        fillRate: seats > 0 ? enrolled / seats : 0,
        creditTotal: r.credit_total === null ? null : Number(r.credit_total),
        programsCount: Number(r.programs_count),
      });
      level.sections += sections;
      level.seatsOffered += seats;
      level.seatsFilled += enrolled;
      level.totalCreditsDelivered += credits;
      fac.sections += sections;
      fac.seatsOffered += seats;
      fac.seatsFilled += enrolled;
      fac.totalCreditsDelivered += credits;
      facultyMap.set(facName, fac);
    }
    // Finalise — fill rate (weighted) + distinct course count per faculty.
    const out: DeepDiveFacultyGroup[] = [...facultyMap.values()];
    let totSections = 0,
      totSeats = 0,
      totEnrolled = 0,
      totCredits = 0;
    const allCourses = new Set<string>();
    for (const fac of out) {
      const facCourses = new Set<string>();
      for (const lvl of fac.children) {
        lvl.fillRate = lvl.seatsOffered > 0 ? lvl.seatsFilled / lvl.seatsOffered : 0;
        for (const c of lvl.children) facCourses.add(c.courseCode);
      }
      fac.distinctCourses = facCourses.size;
      fac.fillRate = fac.seatsOffered > 0 ? fac.seatsFilled / fac.seatsOffered : 0;
      totSections += fac.sections;
      totSeats += fac.seatsOffered;
      totEnrolled += fac.seatsFilled;
      totCredits += fac.totalCreditsDelivered;
      for (const code of facCourses) allCourses.add(code);
    }
    // Stable, Thai-friendly faculty ordering: by section count desc.
    out.sort((a, b) => b.sections - a.sections);
    return {
      acadYearBE: filter.acadYearBE ?? 0,
      semester: filter.semester ?? 0,
      rows: out,
      totals: {
        sections: totSections,
        seatsOffered: totSeats,
        seatsFilled: totEnrolled,
        fillRate: totSeats > 0 ? totEnrolled / totSeats : 0,
        totalCreditsDelivered: totCredits,
        distinctCourses: allCourses.size,
      },
    };
  }
}
