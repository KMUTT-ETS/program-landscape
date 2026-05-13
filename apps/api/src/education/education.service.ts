import { Injectable } from '@nestjs/common';
import {
  Prisma,
  prisma,
  STUDENT_STATUS_GROUP_RANGES,
  studentStatusGroupOf,
  type StudentStatusGroup,
} from '@kku/db';
import {
  THAILAND_REGION_LABELS,
  THAILAND_REGION_ORDER,
  type ThailandRegion,
} from '@kku/shared';
import {
  compareLevel,
  compareThai,
  sortByLevel,
  sortByThai,
} from './sorting';

// Read-side service for the Education dashboard. Queries the
// pre-aggregated cubes (populated by EducationRefreshService) and
// derives the projections each dashboard needs.
//
// Status code defaults to the "Current students" group (codes 10–39
// inclusive) when the caller doesn't supply a status filter. The
// student-info dashboard exposes the three status groups + the raw
// underlying codes via the StatusGroup multi-select.

// Status taxonomy moved to @kku/db (`student-status.ts`) so the home +
// cockpit "Currently enrolled" KPI tile and this dashboard share the
// same definition. Local aliases keep the existing call sites
// untouched.
export type StatusGroup = StudentStatusGroup;
export const STATUS_GROUP_RANGES = STUDENT_STATUS_GROUP_RANGES;
const statusGroupOf = studentStatusGroupOf;

const DEFAULT_STATUS_GROUP: StatusGroup = 'CURRENT';
// Legacy default (used by the active-pivot, location, and international
// dashboards which scope to "currently enrolled, normal status" only —
// status code 10 specifically, not the whole CURRENT group).
const DEFAULT_ACTIVE_STATUS_CODES = [10];

export interface FacetCount {
  key: string;
  label: string;
  count: number;
}

// Filter shapes are arrays so every dashboard supports multi-select.
// Empty array = no filter on that dimension.
export interface StudentInfoFilters {
  facultyName?: string[];
  programLevel?: string[];
  programName?: string[];
  /** Explicit status codes — when present, override the group filter. */
  statusCode?: number[];
  /** High-level status grouping. Defaults to ['CURRENT'] when neither
   *  this nor `statusCode` is supplied. */
  statusGroup?: StatusGroup[];
}

export interface StatusOption {
  code: number;
  name: string;
  count: number;
}

export interface StatusGroupBucket {
  group: StatusGroup;
  label: string;
  count: number;
}

export interface StudentInfoResponse {
  totalActive: number;
  byProgramLevel: FacetCount[];
  byEntryType: FacetCount[];
  byGender: FacetCount[];
  byNationality: FacetCount[];
  thaiVsNonThai: { thai: number; nonThai: number };
  /** Average student age across the matched filter, restricted to ages
   *  16-80. `null` when no rows have valid ages on file. */
  averageAge: number | null;
  /** Number of students whose age contributed to the average. */
  ageSampleCount: number;
  byStatusGroup: StatusGroupBucket[];
  filters: {
    faculties: string[];
    programLevels: string[];
    programs: { facultyName: string; programLevel: string; programName: string }[];
    statuses: StatusOption[];
    statusGroups: { group: StatusGroup; label: string; count: number }[];
  };
  appliedStatusCodes: number[];
  appliedStatusGroups: StatusGroup[];
}

export interface LocationFilters {
  cohortYearBe?: number[];
  region?: ThailandRegion[];
  facultyName?: string[];
  programLevel?: string[];
  programName?: string[];
}

export interface LocationResponse {
  totalActive: number;
  byRegion: { region: ThailandRegion; label: string; count: number }[];
  unknownRegionCount: number;
  byProvince: FacetCount[]; // top 30
  bySchool: FacetCount[]; // top 30
  cohortYears: number[]; // available filter values
  filters: {
    faculties: string[];
    programLevels: string[];
    programs: { facultyName: string; programLevel: string; programName: string }[];
  };
}

export interface ActivePivotResponse {
  /** Distinct cohort entry years observed in the cube (sorted asc). */
  entryYears: number[];
  /** Drill-down rows nested faculty → program level → program. */
  rows: Array<{
    facultyName: string;
    children: Array<{
      programLevel: string;
      children: Array<{
        programName: string;
        cells: Record<number, number>;
        total: number;
      }>;
      cells: Record<number, number>;
      total: number;
    }>;
    cells: Record<number, number>;
    total: number;
  }>;
  totals: { cells: Record<number, number>; total: number };
}

export interface InternationalResponse {
  totalNonThai: number;
  byCountry: Array<{ country: string; count: number }>;
  programLevels: string[];
  rows: Array<{
    facultyName: string;
    children: Array<{
      programName: string;
      cells: Record<string, number>;
      total: number;
    }>;
    cells: Record<string, number>;
    total: number;
  }>;
  totals: { cells: Record<string, number>; total: number };
}

export interface TuitionFilters {
  semester?: string[];
  facultyName?: string[];
}

export interface TuitionResponse {
  totalRevenueThb: number;
  byAcademicYear: Array<{ academicYearBe: number; revenueThb: number }>;
  byFaculty: Array<{ facultyName: string; revenueThb: number }>;
  semesters: string[];
  rows: Array<{
    facultyName: string;
    children: Array<{
      programLevel: string;
      children: Array<{
        programName: string;
        cells: Record<number, number>;
        total: number;
      }>;
      cells: Record<number, number>;
      total: number;
    }>;
    cells: Record<number, number>;
    total: number;
  }>;
  academicYears: number[];
  totals: { cells: Record<number, number>; total: number };
}

// ── Performance dashboard interfaces ─────────────────────────────────

export interface PerformanceFilters {
  facultyName?: string[];
  programLevel?: string[];
  programName?: string[];
  region?: ThailandRegion[];
}

export interface PerformanceOverall {
  totalStudents: number;
  averageEntryGpa: number | null;
  averageGpa: number | null;
  averageEnglishGpa: number | null;
  facultyCount: number;
  programCount: number;
  schoolCount: number;
  filters: {
    faculties: string[];
    programLevels: string[];
    programs: { facultyName: string; programLevel: string; programName: string }[];
  };
}

export interface PerformanceByProgramRow {
  facultyName: string;
  children: Array<{
    programName: string;
    studentCount: number;
    averageEntryGpa: number | null;
    averageGpa: number | null;
  }>;
  studentCount: number;
  averageEntryGpa: number | null;
  averageGpa: number | null;
}

export interface PerformanceByProgramResponse {
  rows: PerformanceByProgramRow[];
  totals: {
    studentCount: number;
    averageEntryGpa: number | null;
    averageGpa: number | null;
  };
}

export interface PerformanceByLocationLeaf {
  programName: string;
  studentCount: number;
  averageEntryGpa: number | null;
  averageGpa: number | null;
}

export interface PerformanceByLocationFaculty {
  facultyName: string;
  children: PerformanceByLocationLeaf[];
  studentCount: number;
  averageEntryGpa: number | null;
  averageGpa: number | null;
}

export interface PerformanceByLocationSchool {
  schoolName: string;
  children: PerformanceByLocationFaculty[];
  studentCount: number;
  averageEntryGpa: number | null;
  averageGpa: number | null;
}

export interface PerformanceByLocationProvince {
  provinceName: string;
  children: PerformanceByLocationSchool[];
  studentCount: number;
  averageEntryGpa: number | null;
  averageGpa: number | null;
}

export interface PerformanceByLocationRegion {
  region: ThailandRegion | 'UNKNOWN';
  label: string;
  children: PerformanceByLocationProvince[];
  studentCount: number;
  averageEntryGpa: number | null;
  averageGpa: number | null;
}

export interface PerformanceByLocationResponse {
  rows: PerformanceByLocationRegion[];
  totals: {
    studentCount: number;
    averageEntryGpa: number | null;
    averageGpa: number | null;
  };
}

export interface EntryScoreSubject {
  subjectCode: string;
  subjectName: string | null;
}

export interface EntryScoreRow {
  facultyName: string;
  children: Array<{
    programName: string;
    /** Cells keyed by subjectCode → average score. */
    cells: Record<string, number>;
    studentCount: number;
  }>;
  cells: Record<string, number>;
  studentCount: number;
}

export interface EntryScoreResponse {
  subjects: EntryScoreSubject[];
  rows: EntryScoreRow[];
  totals: { cells: Record<string, number>; studentCount: number };
}

@Injectable()
export class EducationService {
  // ── Dashboard 1 — Student info ───────────────────────────────────

  async studentInfo(filters: StudentInfoFilters): Promise<StudentInfoResponse> {
    // Resolve effective status filter:
    //   1. Explicit `statusCode` overrides everything.
    //   2. Otherwise expand `statusGroup` ranges (default: CURRENT).
    let appliedStatusCodes: number[];
    let appliedStatusGroups: StatusGroup[];
    if (filters.statusCode && filters.statusCode.length > 0) {
      appliedStatusCodes = filters.statusCode;
      // Derive groups from the codes for response transparency.
      const groupSet = new Set<StatusGroup>();
      for (const c of appliedStatusCodes) groupSet.add(statusGroupOf(c));
      appliedStatusGroups = Array.from(groupSet);
    } else {
      appliedStatusGroups =
        filters.statusGroup && filters.statusGroup.length > 0
          ? filters.statusGroup
          : [DEFAULT_STATUS_GROUP];
      appliedStatusCodes = []; // not used; statusGroup ranges drive the where clause
    }

    const groupRanges = appliedStatusGroups.map((g) => STATUS_GROUP_RANGES[g]);
    const statusFilterClause: Prisma.EducationStudentCubeWhereInput =
      filters.statusCode && filters.statusCode.length > 0
        ? { statusCode: { in: filters.statusCode } }
        : {
            OR: groupRanges.map((r) => ({
              statusCode: { gte: r.min, lte: r.max },
            })),
          };

    const where: Prisma.EducationStudentCubeWhereInput = {
      ...statusFilterClause,
    };
    if (filters.facultyName && filters.facultyName.length > 0)
      where.facultyName = { in: filters.facultyName };
    if (filters.programLevel && filters.programLevel.length > 0)
      where.programLevel = { in: filters.programLevel };
    if (filters.programName && filters.programName.length > 0)
      where.programName = { in: filters.programName };

    const rows = await prisma.educationStudentCube.findMany({
      where,
      select: {
        programLevel: true,
        gender: true,
        nationality: true,
        isThai: true,
        entryType: true,
        statusCode: true,
        studentCount: true,
        ageSum: true,
        ageCount: true,
      },
    });

    const totalActive = rows.reduce((s, r) => s + r.studentCount, 0);
    let totalAgeSum = 0;
    let totalAgeCount = 0;
    for (const r of rows) {
      totalAgeSum += r.ageSum ?? 0;
      totalAgeCount += r.ageCount ?? 0;
    }
    const averageAge = totalAgeCount > 0 ? totalAgeSum / totalAgeCount : null;

    // Humanise gender — the registrar emits Thai short codes ("ช" /
    // "ญ"), full Thai words ("ชาย" / "หญิง"), or English single letters
    // ("M" / "F"). Map all to user-friendly labels at response time.
    const humanizeGender = (raw: string): string => {
      const s = raw.trim().toLowerCase();
      if (['ช', 'ชาย', 'm', 'male'].includes(s)) return 'Male';
      if (['ญ', 'หญิง', 'f', 'female'].includes(s)) return 'Female';
      if (
        ['unspecified', '', 'n/a', '-', 'other', 'อื่นๆ', 'อื่น ๆ'].includes(s)
      )
        return 'Other / unspecified';
      return raw;
    };
    const byProgramLevel = sortByLevel(
      bucket(rows, (r) => r.programLevel),
      (b) => b.label,
    );
    const byEntryType = bucket(rows, (r) => r.entryType ?? 'Unspecified');
    const byGender = bucket(rows, (r) => humanizeGender(r.gender ?? '')).map(
      (b) => ({ ...b, label: b.key }),
    );
    const byNationality = bucket(
      rows,
      (r) => r.nationality ?? 'Unspecified',
      25,
    );
    let thai = 0;
    let nonThai = 0;
    for (const r of rows) {
      if (r.isThai) thai += r.studentCount;
      else nonThai += r.studentCount;
    }

    // Group counts (respect OTHER filters but not status, same logic as
    // the per-code list below).
    const noStatusWhere: Prisma.EducationStudentCubeWhereInput = {};
    if (filters.facultyName && filters.facultyName.length > 0)
      noStatusWhere.facultyName = { in: filters.facultyName };
    if (filters.programLevel && filters.programLevel.length > 0)
      noStatusWhere.programLevel = { in: filters.programLevel };
    if (filters.programName && filters.programName.length > 0)
      noStatusWhere.programName = { in: filters.programName };
    const statusGroupRows = await prisma.educationStudentCube.groupBy({
      by: ['statusCode', 'statusName'],
      where: noStatusWhere,
      _sum: { studentCount: true },
      orderBy: { statusCode: 'asc' },
    });

    const groupTotals: Record<StatusGroup, number> = {
      INCOMING: 0,
      CURRENT: 0,
      FORMER: 0,
    };
    for (const r of statusGroupRows) {
      groupTotals[statusGroupOf(r.statusCode)] +=
        r._sum.studentCount ?? 0;
    }
    const byStatusGroup: StatusGroupBucket[] = (
      ['INCOMING', 'CURRENT', 'FORMER'] as const
    ).map((g) => ({
      group: g,
      label: STATUS_GROUP_RANGES[g].label,
      count: groupTotals[g],
    }));

    const [faculties, programLevels, programs] = await Promise.all([
      prisma.educationStudentCube
        .findMany({
          distinct: ['facultyName'],
          select: { facultyName: true },
        })
        .then((xs) => sortByThai(xs.map((x) => x.facultyName), (s) => s)),
      prisma.educationStudentCube
        .findMany({
          distinct: ['programLevel'],
          select: { programLevel: true },
        })
        .then((xs) => sortByLevel(xs.map((x) => x.programLevel), (s) => s)),
      prisma.educationStudentCube
        .findMany({
          distinct: ['facultyName', 'programLevel', 'programName'],
          select: {
            facultyName: true,
            programLevel: true,
            programName: true,
          },
        })
        .then((xs) =>
          [...xs].sort((a, b) => {
            const f = compareThai(a.facultyName, b.facultyName);
            if (f !== 0) return f;
            const l = compareLevel(a.programLevel, b.programLevel);
            if (l !== 0) return l;
            return compareThai(a.programName, b.programName);
          }),
        ),
    ]);

    const statuses: StatusOption[] = statusGroupRows.map((g) => ({
      code: g.statusCode,
      name: g.statusName ?? '',
      count: g._sum.studentCount ?? 0,
    }));

    return {
      totalActive,
      byProgramLevel,
      byEntryType,
      byGender,
      byNationality,
      thaiVsNonThai: { thai, nonThai },
      averageAge,
      ageSampleCount: totalAgeCount,
      byStatusGroup,
      filters: {
        faculties,
        programLevels,
        programs,
        statuses,
        statusGroups: byStatusGroup.map((b) => ({
          group: b.group,
          label: b.label,
          count: b.count,
        })),
      },
      appliedStatusCodes,
      appliedStatusGroups,
    };
  }

  // ── Dashboard 2 — Location ───────────────────────────────────────

  async byLocation(filters: LocationFilters): Promise<LocationResponse> {
    const where: Prisma.EducationStudentLocationCubeWhereInput = {
      statusCode: { in: DEFAULT_ACTIVE_STATUS_CODES },
    };
    if (filters.cohortYearBe && filters.cohortYearBe.length > 0)
      where.cohortYearBe = { in: filters.cohortYearBe };
    if (filters.region && filters.region.length > 0)
      where.thaiRegion = { in: filters.region as string[] };
    if (filters.facultyName && filters.facultyName.length > 0)
      where.facultyName = { in: filters.facultyName };
    if (filters.programLevel && filters.programLevel.length > 0)
      where.programLevel = { in: filters.programLevel };
    if (filters.programName && filters.programName.length > 0)
      where.programName = { in: filters.programName };

    const rows = await prisma.educationStudentLocationCube.findMany({
      where,
      select: {
        thaiRegion: true,
        schoolProvinceName: true,
        schoolName: true,
        studentCount: true,
      },
    });

    const totalActive = rows.reduce((s, r) => s + r.studentCount, 0);

    const regionTotals = new Map<ThailandRegion, number>();
    let unknownRegionCount = 0;
    for (const r of rows) {
      if (r.thaiRegion) {
        const region = r.thaiRegion as ThailandRegion;
        regionTotals.set(
          region,
          (regionTotals.get(region) ?? 0) + r.studentCount,
        );
      } else {
        unknownRegionCount += r.studentCount;
      }
    }
    const byRegion = THAILAND_REGION_ORDER.map((region) => ({
      region,
      label: THAILAND_REGION_LABELS[region].en,
      count: regionTotals.get(region) ?? 0,
    }));

    const byProvince = bucket(
      rows,
      (r) => r.schoolProvinceName ?? 'Unspecified',
      30,
    );
    const bySchool = bucket(
      rows.filter((r) => r.schoolName),
      (r) => r.schoolName ?? 'Unspecified',
      30,
    );

    const [cohortYears, faculties, programLevels, programs] = await Promise.all([
      prisma.educationStudentLocationCube
        .findMany({
          distinct: ['cohortYearBe'],
          select: { cohortYearBe: true },
          orderBy: { cohortYearBe: 'desc' },
        })
        .then((xs) => xs.map((x) => x.cohortYearBe)),
      prisma.educationStudentLocationCube
        .findMany({
          distinct: ['facultyName'],
          select: { facultyName: true },
        })
        .then((xs) => sortByThai(xs.map((x) => x.facultyName), (s) => s)),
      prisma.educationStudentLocationCube
        .findMany({
          distinct: ['programLevel'],
          select: { programLevel: true },
        })
        .then((xs) => sortByLevel(xs.map((x) => x.programLevel), (s) => s)),
      prisma.educationStudentLocationCube
        .findMany({
          distinct: ['facultyName', 'programLevel', 'programName'],
          select: {
            facultyName: true,
            programLevel: true,
            programName: true,
          },
        })
        .then((xs) =>
          [...xs].sort((a, b) => {
            const f = compareThai(a.facultyName, b.facultyName);
            if (f !== 0) return f;
            const l = compareLevel(a.programLevel, b.programLevel);
            if (l !== 0) return l;
            return compareThai(a.programName, b.programName);
          }),
        ),
    ]);

    return {
      totalActive,
      byRegion,
      unknownRegionCount,
      byProvince,
      bySchool,
      cohortYears,
      filters: { faculties, programLevels, programs },
    };
  }

  // ── Dashboard 3 — Active pivot (Faculty → Level → Program × Year) ─

  async activePivot(filter: { facultyName?: string } = {}): Promise<ActivePivotResponse> {
    const rows = await prisma.educationStudentCube.findMany({
      where: {
        statusCode: { in: DEFAULT_ACTIVE_STATUS_CODES },
        ...(filter.facultyName ? { facultyName: filter.facultyName } : {}),
      },
      select: {
        facultyName: true,
        programLevel: true,
        programName: true,
        cohortYearBe: true,
        studentCount: true,
      },
    });
    return buildPivot(
      rows,
      (r) => r.cohortYearBe,
      (r) => r.studentCount,
      'numeric',
    );
  }

  // ── Dashboard 4 — International by country, level pivot ──────────

  async international(filter: { facultyName?: string } = {}): Promise<InternationalResponse> {
    const rows = await prisma.educationStudentCube.findMany({
      where: {
        statusCode: { in: DEFAULT_ACTIVE_STATUS_CODES },
        isThai: false,
        ...(filter.facultyName ? { facultyName: filter.facultyName } : {}),
      },
      select: {
        facultyName: true,
        programLevel: true,
        programName: true,
        nationality: true,
        studentCount: true,
      },
    });
    const totalNonThai = rows.reduce((s, r) => s + r.studentCount, 0);
    const byCountry = bucket(
      rows,
      (r) => r.nationality ?? 'Unspecified',
      40,
    );

    // facultyName → programName → programLevel → count.
    // International dashboard pivots: row drill-down Faculty → Program,
    // column dimension is program level (so a single program at multiple
    // levels stays a single row with cells per level).
    const programLevelsSet = new Set<string>();
    const data = new Map<string, Map<string, Record<string, number>>>();
    for (const r of rows) {
      programLevelsSet.add(r.programLevel);
      let byProgram = data.get(r.facultyName);
      if (!byProgram) {
        byProgram = new Map();
        data.set(r.facultyName, byProgram);
      }
      const cells = byProgram.get(r.programName) ?? {};
      cells[r.programLevel] = (cells[r.programLevel] ?? 0) + r.studentCount;
      byProgram.set(r.programName, cells);
    }

    const programLevels = sortByLevel(
      Array.from(programLevelsSet),
      (s) => s,
    );
    const rowsOut: InternationalResponse['rows'] = [];
    const overall: Record<string, number> = {};

    for (const [facultyName, byProgram] of [...data.entries()].sort(
      ([a], [b]) => compareThai(a, b),
    )) {
      const programChildren: InternationalResponse['rows'][number]['children'] = [];
      const facultyCells: Record<string, number> = {};
      for (const [programName, cells] of [...byProgram.entries()].sort(
        ([a], [b]) => compareThai(a, b),
      )) {
        const total = Object.values(cells).reduce((s, v) => s + v, 0);
        for (const [level, n] of Object.entries(cells)) {
          facultyCells[level] = (facultyCells[level] ?? 0) + n;
          overall[level] = (overall[level] ?? 0) + n;
        }
        programChildren.push({ programName, cells, total });
      }
      const facultyTotal = Object.values(facultyCells).reduce(
        (s, v) => s + v,
        0,
      );
      rowsOut.push({
        facultyName,
        children: programChildren,
        cells: facultyCells,
        total: facultyTotal,
      });
    }

    return {
      totalNonThai,
      byCountry: byCountry.map((b) => ({ country: b.label, count: b.count })),
      programLevels,
      rows: rowsOut,
      totals: {
        cells: overall,
        total: Object.values(overall).reduce((s, v) => s + v, 0),
      },
    };
  }

  // ── Dashboard 5 — Tuition incomes ────────────────────────────────

  async tuition(filters: TuitionFilters): Promise<TuitionResponse> {
    const where: Prisma.EducationTuitionCubeWhereInput = {};
    if (filters.semester && filters.semester.length > 0)
      where.semester = { in: filters.semester };
    if (filters.facultyName && filters.facultyName.length > 0)
      where.facultyName = { in: filters.facultyName };

    const rows = await prisma.educationTuitionCube.findMany({
      where,
      select: {
        facultyName: true,
        programLevel: true,
        programName: true,
        academicYearBe: true,
        revenueThb: true,
      },
    });

    const totalRevenueThb = rows.reduce(
      (s, r) => s + Number(r.revenueThb),
      0,
    );

    const yearMap = new Map<number, number>();
    const facultyMap = new Map<string, number>();
    for (const r of rows) {
      const v = Number(r.revenueThb);
      yearMap.set(r.academicYearBe, (yearMap.get(r.academicYearBe) ?? 0) + v);
      facultyMap.set(r.facultyName, (facultyMap.get(r.facultyName) ?? 0) + v);
    }

    const byAcademicYear = [...yearMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([academicYearBe, revenueThb]) => ({ academicYearBe, revenueThb }));

    const byFaculty = [...facultyMap.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([facultyName, revenueThb]) => ({ facultyName, revenueThb }));

    const semesters = await prisma.educationTuitionCube
      .findMany({
        distinct: ['semester'],
        select: { semester: true },
        orderBy: { semester: 'asc' },
      })
      .then((xs) => xs.map((x) => x.semester));

    const pivot = buildPivot(
      rows.map((r) => ({
        facultyName: r.facultyName,
        programLevel: r.programLevel,
        programName: r.programName,
        academicYearBe: r.academicYearBe,
        revenueThb: Number(r.revenueThb),
      })),
      (r) => r.academicYearBe,
      (r) => r.revenueThb,
      'currency',
    );

    return {
      totalRevenueThb,
      byAcademicYear,
      byFaculty,
      semesters,
      rows: pivot.rows,
      academicYears: pivot.entryYears,
      totals: pivot.totals,
    };
  }

  // ── Performance dashboard ────────────────────────────────────────

  async performanceOverall(
    filters: PerformanceFilters,
  ): Promise<PerformanceOverall> {
    const where = this.buildPerfWhere(filters);
    const rows = await prisma.educationPerformanceCube.findMany({
      where,
      select: {
        facultyName: true,
        programName: true,
        schoolNameNorm: true,
        studentCount: true,
        entryGpaSum: true,
        entryGpaCount: true,
        gpaSum: true,
        gpaCount: true,
        englishGpaSum: true,
        englishGpaCount: true,
      },
    });
    let totalStudents = 0;
    let entryGpaSum = 0;
    let entryGpaCount = 0;
    let gpaSum = 0;
    let gpaCount = 0;
    let englishGpaSum = 0;
    let englishGpaCount = 0;
    const faculties = new Set<string>();
    const programs = new Set<string>();
    const schools = new Set<string>();
    for (const r of rows) {
      totalStudents += r.studentCount;
      entryGpaSum += r.entryGpaSum;
      entryGpaCount += r.entryGpaCount;
      gpaSum += r.gpaSum;
      gpaCount += r.gpaCount;
      englishGpaSum += r.englishGpaSum;
      englishGpaCount += r.englishGpaCount;
      faculties.add(r.facultyName);
      programs.add(`${r.facultyName}|${r.programName}`);
      if (r.schoolNameNorm) schools.add(r.schoolNameNorm);
    }
    const filtersOpts = await this.performanceFilterOptions();
    return {
      totalStudents,
      averageEntryGpa: entryGpaCount > 0 ? entryGpaSum / entryGpaCount : null,
      averageGpa: gpaCount > 0 ? gpaSum / gpaCount : null,
      averageEnglishGpa:
        englishGpaCount > 0 ? englishGpaSum / englishGpaCount : null,
      facultyCount: faculties.size,
      programCount: programs.size,
      schoolCount: schools.size,
      filters: filtersOpts,
    };
  }

  async performanceByProgram(
    filters: PerformanceFilters,
  ): Promise<PerformanceByProgramResponse> {
    const where = this.buildPerfWhere(filters);
    const rows = await prisma.educationPerformanceCube.findMany({
      where,
      select: {
        facultyName: true,
        programLevel: true,
        programName: true,
        studentCount: true,
        entryGpaSum: true,
        entryGpaCount: true,
        gpaSum: true,
        gpaCount: true,
      },
    });
    interface Acc {
      studentCount: number;
      entryGpaSum: number;
      entryGpaCount: number;
      gpaSum: number;
      gpaCount: number;
    }
    const facultyMap = new Map<
      string,
      { agg: Acc; programs: Map<string, Acc> }
    >();
    const overall: Acc = {
      studentCount: 0,
      entryGpaSum: 0,
      entryGpaCount: 0,
      gpaSum: 0,
      gpaCount: 0,
    };
    for (const r of rows) {
      let f = facultyMap.get(r.facultyName);
      if (!f) {
        f = { agg: blankAcc(), programs: new Map() };
        facultyMap.set(r.facultyName, f);
      }
      addInto(f.agg, r);
      let p = f.programs.get(r.programName);
      if (!p) {
        p = blankAcc();
        f.programs.set(r.programName, p);
      }
      addInto(p, r);
      addInto(overall, r);
    }
    const out: PerformanceByProgramRow[] = [];
    for (const [facultyName, f] of [...facultyMap.entries()].sort(
      ([a], [b]) => compareThai(a, b),
    )) {
      const children: PerformanceByProgramRow['children'] = [];
      for (const [programName, p] of [...f.programs.entries()].sort(
        ([a], [b]) => compareThai(a, b),
      )) {
        children.push({
          programName,
          studentCount: p.studentCount,
          averageEntryGpa:
            p.entryGpaCount > 0 ? p.entryGpaSum / p.entryGpaCount : null,
          averageGpa: p.gpaCount > 0 ? p.gpaSum / p.gpaCount : null,
        });
      }
      out.push({
        facultyName,
        children,
        studentCount: f.agg.studentCount,
        averageEntryGpa:
          f.agg.entryGpaCount > 0
            ? f.agg.entryGpaSum / f.agg.entryGpaCount
            : null,
        averageGpa: f.agg.gpaCount > 0 ? f.agg.gpaSum / f.agg.gpaCount : null,
      });
    }
    return {
      rows: out,
      totals: {
        studentCount: overall.studentCount,
        averageEntryGpa:
          overall.entryGpaCount > 0
            ? overall.entryGpaSum / overall.entryGpaCount
            : null,
        averageGpa:
          overall.gpaCount > 0 ? overall.gpaSum / overall.gpaCount : null,
      },
    };
  }

  async performanceByLocation(
    filters: PerformanceFilters,
  ): Promise<PerformanceByLocationResponse> {
    const where = this.buildPerfWhere(filters);
    const rows = await prisma.educationPerformanceCube.findMany({
      where,
      select: {
        facultyName: true,
        programName: true,
        schoolName: true,
        schoolProvinceName: true,
        thaiRegion: true,
        studentCount: true,
        entryGpaSum: true,
        entryGpaCount: true,
        gpaSum: true,
        gpaCount: true,
      },
    });
    // Tree: region → province → school → faculty → program.
    interface Acc {
      studentCount: number;
      entryGpaSum: number;
      entryGpaCount: number;
      gpaSum: number;
      gpaCount: number;
    }
    type FacultyNode = {
      agg: Acc;
      programs: Map<string, Acc>;
    };
    type SchoolNode = {
      agg: Acc;
      faculties: Map<string, FacultyNode>;
    };
    type ProvinceNode = {
      agg: Acc;
      schools: Map<string, SchoolNode>;
    };
    type RegionNode = {
      agg: Acc;
      provinces: Map<string, ProvinceNode>;
    };
    const tree = new Map<string, RegionNode>();
    const overall: Acc = blankAcc();
    for (const r of rows) {
      const region = r.thaiRegion ?? 'UNKNOWN';
      const province = r.schoolProvinceName ?? 'Unknown / foreign';
      const school = r.schoolName ?? 'Unknown school';
      let regionNode = tree.get(region);
      if (!regionNode) {
        regionNode = { agg: blankAcc(), provinces: new Map() };
        tree.set(region, regionNode);
      }
      addInto(regionNode.agg, r);
      let provinceNode = regionNode.provinces.get(province);
      if (!provinceNode) {
        provinceNode = { agg: blankAcc(), schools: new Map() };
        regionNode.provinces.set(province, provinceNode);
      }
      addInto(provinceNode.agg, r);
      let schoolNode = provinceNode.schools.get(school);
      if (!schoolNode) {
        schoolNode = { agg: blankAcc(), faculties: new Map() };
        provinceNode.schools.set(school, schoolNode);
      }
      addInto(schoolNode.agg, r);
      let facultyNode = schoolNode.faculties.get(r.facultyName);
      if (!facultyNode) {
        facultyNode = { agg: blankAcc(), programs: new Map() };
        schoolNode.faculties.set(r.facultyName, facultyNode);
      }
      addInto(facultyNode.agg, r);
      let programAcc = facultyNode.programs.get(r.programName);
      if (!programAcc) {
        programAcc = blankAcc();
        facultyNode.programs.set(r.programName, programAcc);
      }
      addInto(programAcc, r);
      addInto(overall, r);
    }

    const finalize = (a: Acc) => ({
      studentCount: a.studentCount,
      averageEntryGpa:
        a.entryGpaCount > 0 ? a.entryGpaSum / a.entryGpaCount : null,
      averageGpa: a.gpaCount > 0 ? a.gpaSum / a.gpaCount : null,
    });

    const out: PerformanceByLocationRegion[] = [];
    for (const region of THAILAND_REGION_ORDER) {
      const regionNode = tree.get(region);
      if (!regionNode) continue;
      out.push(
        buildRegionRow(
          region,
          THAILAND_REGION_LABELS[region].en,
          regionNode,
          finalize,
        ),
      );
    }
    if (tree.has('UNKNOWN')) {
      out.push(
        buildRegionRow(
          'UNKNOWN',
          'Unknown / foreign',
          tree.get('UNKNOWN')!,
          finalize,
        ),
      );
    }

    return {
      rows: out,
      totals: finalize(overall),
    };
  }

  async entryScores(
    filters: PerformanceFilters,
  ): Promise<EntryScoreResponse> {
    const where: Prisma.EducationEntryScoreCubeWhereInput = {};
    if (filters.facultyName && filters.facultyName.length > 0)
      where.facultyName = { in: filters.facultyName };
    if (filters.programLevel && filters.programLevel.length > 0)
      where.programLevel = { in: filters.programLevel };
    if (filters.programName && filters.programName.length > 0)
      where.programName = { in: filters.programName };
    const rows = await prisma.educationEntryScoreCube.findMany({
      where,
      select: {
        facultyName: true,
        programName: true,
        subjectCode: true,
        subjectName: true,
        scoreSum: true,
        scoreCount: true,
        studentCount: true,
      },
    });

    // Collect distinct subjects (in code-asc order).
    const subjectMap = new Map<string, EntryScoreSubject>();
    for (const r of rows) {
      if (!subjectMap.has(r.subjectCode)) {
        subjectMap.set(r.subjectCode, {
          subjectCode: r.subjectCode,
          subjectName: r.subjectName,
        });
      }
    }
    const subjects = [...subjectMap.values()].sort((a, b) =>
      a.subjectCode.localeCompare(b.subjectCode),
    );

    interface FacAcc {
      studentCount: number;
      // subject → { sum, count }
      cells: Map<string, { sum: number; count: number }>;
    }
    type ProgAcc = FacAcc;
    type Faculty = { agg: FacAcc; programs: Map<string, ProgAcc> };
    const facMap = new Map<string, Faculty>();
    const overall: FacAcc = { studentCount: 0, cells: new Map() };

    const addCell = (m: Map<string, { sum: number; count: number }>, sub: string, sum: number, count: number) => {
      const existing = m.get(sub) ?? { sum: 0, count: 0 };
      existing.sum += sum;
      existing.count += count;
      m.set(sub, existing);
    };

    for (const r of rows) {
      let f = facMap.get(r.facultyName);
      if (!f) {
        f = { agg: { studentCount: 0, cells: new Map() }, programs: new Map() };
        facMap.set(r.facultyName, f);
      }
      f.agg.studentCount += r.studentCount;
      addCell(f.agg.cells, r.subjectCode, r.scoreSum, r.scoreCount);

      let p = f.programs.get(r.programName);
      if (!p) {
        p = { studentCount: 0, cells: new Map() };
        f.programs.set(r.programName, p);
      }
      p.studentCount += r.studentCount;
      addCell(p.cells, r.subjectCode, r.scoreSum, r.scoreCount);

      overall.studentCount += r.studentCount;
      addCell(overall.cells, r.subjectCode, r.scoreSum, r.scoreCount);
    }

    const cellsToRecord = (
      m: Map<string, { sum: number; count: number }>,
    ): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [k, v] of m.entries()) {
        if (v.count > 0) out[k] = v.sum / v.count;
      }
      return out;
    };

    const rowsOut: EntryScoreRow[] = [];
    for (const [facultyName, f] of [...facMap.entries()].sort(([a], [b]) =>
      compareThai(a, b),
    )) {
      const children = [...f.programs.entries()]
        .sort(([a], [b]) => compareThai(a, b))
        .map(([programName, p]) => ({
          programName,
          cells: cellsToRecord(p.cells),
          studentCount: p.studentCount,
        }));
      rowsOut.push({
        facultyName,
        children,
        cells: cellsToRecord(f.agg.cells),
        studentCount: f.agg.studentCount,
      });
    }

    return {
      subjects,
      rows: rowsOut,
      totals: {
        cells: cellsToRecord(overall.cells),
        studentCount: overall.studentCount,
      },
    };
  }

  // Shared filter-where builder for the performance cube.
  private buildPerfWhere(
    filters: PerformanceFilters,
  ): Prisma.EducationPerformanceCubeWhereInput {
    const where: Prisma.EducationPerformanceCubeWhereInput = {};
    if (filters.facultyName && filters.facultyName.length > 0)
      where.facultyName = { in: filters.facultyName };
    if (filters.programLevel && filters.programLevel.length > 0)
      where.programLevel = { in: filters.programLevel };
    if (filters.programName && filters.programName.length > 0)
      where.programName = { in: filters.programName };
    if (filters.region && filters.region.length > 0)
      where.thaiRegion = { in: filters.region as string[] };
    return where;
  }

  private async performanceFilterOptions() {
    const [faculties, programLevels, programs] = await Promise.all([
      prisma.educationPerformanceCube
        .findMany({
          distinct: ['facultyName'],
          select: { facultyName: true },
        })
        .then((xs) => sortByThai(xs.map((x) => x.facultyName), (s) => s)),
      prisma.educationPerformanceCube
        .findMany({
          distinct: ['programLevel'],
          select: { programLevel: true },
        })
        .then((xs) => sortByLevel(xs.map((x) => x.programLevel), (s) => s)),
      prisma.educationPerformanceCube
        .findMany({
          distinct: ['facultyName', 'programLevel', 'programName'],
          select: {
            facultyName: true,
            programLevel: true,
            programName: true,
          },
        })
        .then((xs) =>
          [...xs].sort((a, b) => {
            const f = compareThai(a.facultyName, b.facultyName);
            if (f !== 0) return f;
            return compareThai(a.programName, b.programName);
          }),
        ),
    ]);
    return { faculties, programLevels, programs };
  }
}

// Performance read-side helpers — kept module-private since they
// only support the byLocation method's tree assembly.
function blankAcc() {
  return {
    studentCount: 0,
    entryGpaSum: 0,
    entryGpaCount: 0,
    gpaSum: 0,
    gpaCount: 0,
  };
}
function addInto(
  a: ReturnType<typeof blankAcc>,
  r: {
    studentCount: number;
    entryGpaSum: number;
    entryGpaCount: number;
    gpaSum: number;
    gpaCount: number;
  },
) {
  a.studentCount += r.studentCount;
  a.entryGpaSum += r.entryGpaSum;
  a.entryGpaCount += r.entryGpaCount;
  a.gpaSum += r.gpaSum;
  a.gpaCount += r.gpaCount;
}
function buildRegionRow(
  region: ThailandRegion | 'UNKNOWN',
  label: string,
  regionNode: {
    agg: ReturnType<typeof blankAcc>;
    provinces: Map<
      string,
      {
        agg: ReturnType<typeof blankAcc>;
        schools: Map<
          string,
          {
            agg: ReturnType<typeof blankAcc>;
            faculties: Map<
              string,
              {
                agg: ReturnType<typeof blankAcc>;
                programs: Map<string, ReturnType<typeof blankAcc>>;
              }
            >;
          }
        >;
      }
    >;
  },
  finalize: (a: ReturnType<typeof blankAcc>) => {
    studentCount: number;
    averageEntryGpa: number | null;
    averageGpa: number | null;
  },
): PerformanceByLocationRegion {
  const provinces: PerformanceByLocationProvince[] = [];
  for (const [provinceName, province] of [...regionNode.provinces.entries()].sort(
    ([a], [b]) => compareThai(a, b),
  )) {
    const schools: PerformanceByLocationSchool[] = [];
    for (const [schoolName, school] of [...province.schools.entries()].sort(
      ([a], [b]) => compareThai(a, b),
    )) {
      const faculties: PerformanceByLocationFaculty[] = [];
      for (const [facultyName, faculty] of [...school.faculties.entries()].sort(
        ([a], [b]) => compareThai(a, b),
      )) {
        const programs: PerformanceByLocationLeaf[] = [];
        for (const [programName, prog] of [...faculty.programs.entries()].sort(
          ([a], [b]) => compareThai(a, b),
        )) {
          programs.push({
            programName,
            ...finalize(prog),
          });
        }
        faculties.push({
          facultyName,
          children: programs,
          ...finalize(faculty.agg),
        });
      }
      schools.push({
        schoolName,
        children: faculties,
        ...finalize(school.agg),
      });
    }
    provinces.push({
      provinceName,
      children: schools,
      ...finalize(province.agg),
    });
  }
  return {
    region,
    label,
    children: provinces,
    ...finalize(regionNode.agg),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function bucket<T>(
  rows: Array<T & { studentCount: number }>,
  keyFn: (r: T) => string,
  limit?: number,
): FacetCount[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r as T);
    m.set(k, (m.get(k) ?? 0) + r.studentCount);
  }
  let out = Array.from(m.entries()).map(([key, count]) => ({
    key,
    label: key,
    count,
  }));
  out.sort((a, b) => b.count - a.count);
  if (limit) out = out.slice(0, limit);
  return out;
}

interface PivotRow {
  facultyName: string;
  programLevel: string;
  programName: string;
}

function buildPivot<R extends PivotRow, K extends number>(
  rows: R[],
  keyFn: (r: R) => K,
  valueFn: (r: R) => number,
  _format: 'numeric' | 'currency',
): {
  entryYears: number[];
  rows: Array<{
    facultyName: string;
    children: Array<{
      programLevel: string;
      children: Array<{
        programName: string;
        cells: Record<number, number>;
        total: number;
      }>;
      cells: Record<number, number>;
      total: number;
    }>;
    cells: Record<number, number>;
    total: number;
  }>;
  totals: { cells: Record<number, number>; total: number };
} {
  const yearsSet = new Set<number>();
  // facultyName → programLevel → programName → year → value
  const data = new Map<
    string,
    Map<string, Map<string, Map<number, number>>>
  >();
  for (const r of rows) {
    const y = Number(keyFn(r));
    yearsSet.add(y);
    const v = valueFn(r);
    let byFaculty = data.get(r.facultyName);
    if (!byFaculty) {
      byFaculty = new Map();
      data.set(r.facultyName, byFaculty);
    }
    let byLevel = byFaculty.get(r.programLevel);
    if (!byLevel) {
      byLevel = new Map();
      byFaculty.set(r.programLevel, byLevel);
    }
    let byProgram = byLevel.get(r.programName);
    if (!byProgram) {
      byProgram = new Map();
      byLevel.set(r.programName, byProgram);
    }
    byProgram.set(y, (byProgram.get(y) ?? 0) + v);
  }

  const entryYears = Array.from(yearsSet).sort((a, b) => a - b);
  const overall: Record<number, number> = {};
  const out: ReturnType<typeof buildPivot>['rows'] = [];

  for (const [facultyName, byFaculty] of [...data.entries()].sort(
    ([a], [b]) => compareThai(a, b),
  )) {
    const facultyCells: Record<number, number> = {};
    const levelChildren: ReturnType<typeof buildPivot>['rows'][number]['children'] = [];
    for (const [programLevel, byLevel] of [...byFaculty.entries()].sort(
      ([a], [b]) => compareLevel(a, b),
    )) {
      const levelCells: Record<number, number> = {};
      const programChildren: ReturnType<
        typeof buildPivot
      >['rows'][number]['children'][number]['children'] = [];
      for (const [programName, byYear] of [...byLevel.entries()].sort(
        ([a], [b]) => compareThai(a, b),
      )) {
        const cells: Record<number, number> = {};
        let programTotal = 0;
        for (const [year, val] of byYear.entries()) {
          cells[year] = round2(val);
          programTotal += val;
          levelCells[year] = round2((levelCells[year] ?? 0) + val);
          facultyCells[year] = round2((facultyCells[year] ?? 0) + val);
          overall[year] = round2((overall[year] ?? 0) + val);
        }
        programChildren.push({
          programName,
          cells,
          total: round2(programTotal),
        });
      }
      const levelTotal = Object.values(levelCells).reduce(
        (s, v) => s + v,
        0,
      );
      levelChildren.push({
        programLevel,
        children: programChildren,
        cells: levelCells,
        total: round2(levelTotal),
      });
    }
    const facultyTotal = Object.values(facultyCells).reduce(
      (s, v) => s + v,
      0,
    );
    out.push({
      facultyName,
      children: levelChildren,
      cells: facultyCells,
      total: round2(facultyTotal),
    });
  }

  return {
    entryYears,
    rows: out,
    totals: {
      cells: overall,
      total: round2(Object.values(overall).reduce((s, v) => s + v, 0)),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
