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
  /** Substring match (case-insensitive) on schoolName. When set, the
   *  Prisma query filters at the DB layer so the bucket()-imposed
   *  top-30 cap doesn't hide low-rank matches. */
  schoolFilter?: string;
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

// ── Class-GPA shapes (new in v1.2.9) ─────────────────────────────────────
// Source: ClassOffering grade-distribution columns. Distinct from student
// cumulative GPA (which lives in EducationPerformanceCube) — see
// docs/methodologies/class-gpa.md.
//
// All aggregations are credit-weighted: a section's contribution to a
// rollup is `classGpa × gradedCount × COALESCE(creditTotal, 1)`. The
// `gradedCount` denominator and `creditTotal` weight are summed
// separately at every level (faculty, program, course, semester) so the
// numerator/denominator pair stays exact under further aggregation.

export interface ClassGpaFilters {
  facultyName?: string[];
  /** LEVELNAME from the registrar — 'ปริญญาตรี' / 'ปริญญาโท' / etc. */
  levelName?: string[];
  /** ACADYEAR Buddhist Era — e.g. [2566, 2567, 2568]. Empty = all years. */
  acadYearBE?: number[];
  /** Semester codes 1-4. Empty = all. */
  semester?: number[];
  /** When true, only classes flagged isGeneralEducation=true. */
  geOnly?: boolean;
}

export interface ClassGpaOverall {
  /** Number of class offerings in the filtered window. */
  totalClasses: number;
  /** Subset whose gradedCount > 0 (had at least one letter grade reported). */
  classesWithGrades: number;
  /** Total students who received a graded letter (A..F). */
  totalGradedCount: number;
  /** Credit-weighted mean class GPA. NULL when no graded classes match. */
  averageClassGpa: number | null;
  /** Pass rate = 1 - (F count / gradedCount). NULL when gradedCount = 0. */
  passRate: number | null;
  /** Withdraw rate = W / (gradedCount + I + W). NULL on zero. */
  withdrawalRate: number | null;
  /** Letter distribution (counts of each graded letter across all matched
   *  sections). UI renders this as a stacked bar / pie. */
  gradeDistribution: Record<
    'A' | 'BPLUS' | 'B' | 'CPLUS' | 'C' | 'DPLUS' | 'D' | 'F',
    number
  >;
  /** Inclusive year range observed in the matched rows. */
  windowYearsBE: { start: number | null; end: number | null };
}

export interface ClassGpaTrendCell {
  classCount: number;
  gradedCount: number;
  averageClassGpa: number | null;
}

export interface ClassGpaTrendRow {
  acadYearBE: number;
  /** Per-semester cells. Missing semesters → undefined; UI renders as a
   *  gap rather than zero. Keys are stringified for JSON portability. */
  bySemester: Record<'1' | '2' | '3' | '4', ClassGpaTrendCell | undefined>;
  overall: ClassGpaTrendCell;
}

export interface ClassGpaByProgramRow {
  programId: string;
  programName: string;
  programLevel: string;
  facultyName: string;
  classCount: number;
  gradedCount: number;
  averageClassGpa: number | null;
  /** Keys = ACADYEAR_BE; the UI renders these as columns. Cells where
   *  the program had no graded data in that year are omitted; the UI
   *  shows a blank "—" rather than 0. */
  byYear: Record<string, ClassGpaTrendCell>;
}

export interface ClassGpaByProgramResponse {
  rows: ClassGpaByProgramRow[];
  totals: ClassGpaTrendCell;
  /** Sorted ascending. The UI uses this to pin the column order. */
  yearsObserved: number[];
}

export interface ClassGpaCourseRow {
  courseCode: string;
  courseNameTh: string | null;
  courseNameEn: string | null;
  classCount: number;
  gradedCount: number;
  averageClassGpa: number | null;
  byYear: Record<string, ClassGpaTrendCell>;
}

export interface ClassGpaCoursesResponse {
  programId: string;
  rows: ClassGpaCourseRow[];
  yearsObserved: number[];
}

/** Per-section drill — what the UI shows when an analyst clicks a program
 *  in the class-GPA breakdown. Limited to a single (program × year × sem)
 *  cell so the payload stays small (a program rarely has > 50 sections
 *  per semester). */
export interface ClassGpaSectionRow {
  classOfferingId: string;
  acadYearBE: number;
  semester: number;
  courseCode: string;
  courseNameTh: string | null;
  courseNameEn: string | null;
  section: number;
  enrollSeat: number;
  gradedCount: number;
  classGpa: number | null;
  creditTotal: number | null;
  // Grade letter counts for the section so the drill-down shows the
  // distribution behind each row.
  grades: {
    A: number;
    BPLUS: number;
    B: number;
    CPLUS: number;
    C: number;
    DPLUS: number;
    D: number;
    F: number;
    I: number;
    W: number;
  };
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
    if (filters.schoolFilter)
      where.schoolName = { contains: filters.schoolFilter, mode: 'insensitive' };

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

  // ── Class GPA (new in v1.2.9) ──────────────────────────────────────
  // Driven from the ClassOffering grade-distribution columns. All
  // aggregations credit-weighted: contribution = classGpa × gradedCount ×
  // COALESCE(creditTotal, 1). gradedCount + creditTotal sums are tracked
  // per cell so any further rollup remains exact.

  /** Shared SQL fragment building the `class_offerings` WHERE clause from
   *  a ClassGpaFilters bag. Used by every class-GPA query so the filter
   *  semantics stay consistent. */
  private classGpaWhere(filters: ClassGpaFilters) {
    const where: Prisma.ClassOfferingWhereInput = {};
    if (filters.facultyName && filters.facultyName.length > 0)
      where.faculty = { OR: [{ nameTh: { in: filters.facultyName } }, { nameEn: { in: filters.facultyName } }] };
    if (filters.levelName && filters.levelName.length > 0)
      where.levelName = { in: filters.levelName };
    if (filters.acadYearBE && filters.acadYearBE.length > 0)
      where.acadYearBE = { in: filters.acadYearBE };
    if (filters.semester && filters.semester.length > 0)
      where.semester = { in: filters.semester };
    if (filters.geOnly) where.isGeneralEducation = true;
    return where;
  }

  /** Overall KPIs across the filtered window. */
  async classGpaOverall(filters: ClassGpaFilters): Promise<ClassGpaOverall> {
    const where = this.classGpaWhere(filters);
    const rows = await prisma.classOffering.findMany({
      where,
      select: {
        acadYearBE: true,
        gradedCount: true,
        classGpa: true,
        creditTotal: true,
        gradeA: true,
        gradeBPlus: true,
        gradeB: true,
        gradeCPlus: true,
        gradeC: true,
        gradeDPlus: true,
        gradeD: true,
        gradeF: true,
        gradeI: true,
        gradeW: true,
      },
    });
    let totalClasses = 0;
    let classesWithGrades = 0;
    let weightedGpaNumer = 0;
    let weightedDenom = 0;
    let totalGradedCount = 0;
    let totalI = 0;
    let totalW = 0;
    const dist = {
      A: 0,
      BPLUS: 0,
      B: 0,
      CPLUS: 0,
      C: 0,
      DPLUS: 0,
      D: 0,
      F: 0,
    };
    let minYear: number | null = null;
    let maxYear: number | null = null;
    for (const r of rows) {
      totalClasses++;
      if (minYear === null || r.acadYearBE < minYear) minYear = r.acadYearBE;
      if (maxYear === null || r.acadYearBE > maxYear) maxYear = r.acadYearBE;
      if (r.gradedCount > 0 && r.classGpa !== null) {
        classesWithGrades++;
        const credits = r.creditTotal ?? 1;
        const w = r.gradedCount * credits;
        weightedGpaNumer += r.classGpa * w;
        weightedDenom += w;
      }
      totalGradedCount += r.gradedCount;
      totalI += r.gradeI;
      totalW += r.gradeW;
      dist.A += r.gradeA;
      dist.BPLUS += r.gradeBPlus;
      dist.B += r.gradeB;
      dist.CPLUS += r.gradeCPlus;
      dist.C += r.gradeC;
      dist.DPLUS += r.gradeDPlus;
      dist.D += r.gradeD;
      dist.F += r.gradeF;
    }
    const averageClassGpa = weightedDenom > 0 ? weightedGpaNumer / weightedDenom : null;
    const passRate = totalGradedCount > 0 ? 1 - dist.F / totalGradedCount : null;
    const withdrawalDenom = totalGradedCount + totalI + totalW;
    const withdrawalRate = withdrawalDenom > 0 ? totalW / withdrawalDenom : null;
    return {
      totalClasses,
      classesWithGrades,
      totalGradedCount,
      averageClassGpa,
      passRate,
      withdrawalRate,
      gradeDistribution: dist,
      windowYearsBE: { start: minYear, end: maxYear },
    };
  }

  /** Trend grid: one row per acadYearBE, four cells per semester (1, 2, 3, 4)
   *  plus the year's overall. UI plots one line per semester. */
  async classGpaTrend(filters: ClassGpaFilters): Promise<ClassGpaTrendRow[]> {
    const where = this.classGpaWhere(filters);
    const rows = await prisma.classOffering.findMany({
      where: { ...where, gradedCount: { gt: 0 } },
      select: {
        acadYearBE: true,
        semester: true,
        gradedCount: true,
        classGpa: true,
        creditTotal: true,
      },
    });
    interface Agg {
      classCount: number;
      gradedCount: number;
      numer: number;
      denom: number;
    }
    const yearMap = new Map<number, { sem: Map<number, Agg>; overall: Agg }>();
    const blank = (): Agg => ({ classCount: 0, gradedCount: 0, numer: 0, denom: 0 });
    for (const r of rows) {
      if (r.classGpa === null) continue;
      const credits = r.creditTotal ?? 1;
      const w = r.gradedCount * credits;
      const entry = yearMap.get(r.acadYearBE) ?? { sem: new Map(), overall: blank() };
      const semCell = entry.sem.get(r.semester) ?? blank();
      semCell.classCount++;
      semCell.gradedCount += r.gradedCount;
      semCell.numer += r.classGpa * w;
      semCell.denom += w;
      entry.sem.set(r.semester, semCell);
      entry.overall.classCount++;
      entry.overall.gradedCount += r.gradedCount;
      entry.overall.numer += r.classGpa * w;
      entry.overall.denom += w;
      yearMap.set(r.acadYearBE, entry);
    }
    const out: ClassGpaTrendRow[] = [];
    for (const [year, entry] of [...yearMap.entries()].sort((a, b) => a[0] - b[0])) {
      const cell = (a: Agg): ClassGpaTrendCell => ({
        classCount: a.classCount,
        gradedCount: a.gradedCount,
        averageClassGpa: a.denom > 0 ? a.numer / a.denom : null,
      });
      const bySemester: ClassGpaTrendRow['bySemester'] = {
        '1': entry.sem.has(1) ? cell(entry.sem.get(1)!) : undefined,
        '2': entry.sem.has(2) ? cell(entry.sem.get(2)!) : undefined,
        '3': entry.sem.has(3) ? cell(entry.sem.get(3)!) : undefined,
        '4': entry.sem.has(4) ? cell(entry.sem.get(4)!) : undefined,
      };
      out.push({ acadYearBE: year, bySemester, overall: cell(entry.overall) });
    }
    return out;
  }

  /** Per-program rollup. Class GPAs aggregated from ClassOffering rows
   *  whose courseCode matches a row in `program_courses` for that
   *  program. A class taught by a course shared across N programs
   *  contributes to all N — accurate for a "what's the average GPA my
   *  curriculum's classes produce" reading. Sort defaults to averageClassGpa
   *  desc with NULLs sinking to the bottom. */
  async classGpaByProgram(filters: ClassGpaFilters): Promise<ClassGpaByProgramResponse> {
    // Raw query — joining ClassOffering ↔ ProgramCourse on courseCode +
    // ProgramCourse ↔ Program is the natural shape. The Prisma ORM
    // would need a nested aggregation which it doesn't model neatly;
    // the SQL stays small + indexable.
    const sqlConditions: Prisma.Sql[] = [];
    if (filters.facultyName && filters.facultyName.length > 0)
      sqlConditions.push(Prisma.sql`f."name_th" IN (${Prisma.join(filters.facultyName)})`);
    if (filters.levelName && filters.levelName.length > 0)
      sqlConditions.push(Prisma.sql`co."level_name" IN (${Prisma.join(filters.levelName)})`);
    if (filters.acadYearBE && filters.acadYearBE.length > 0)
      sqlConditions.push(Prisma.sql`co."acad_year_be" IN (${Prisma.join(filters.acadYearBE)})`);
    if (filters.semester && filters.semester.length > 0)
      sqlConditions.push(Prisma.sql`co."semester" IN (${Prisma.join(filters.semester)})`);
    if (filters.geOnly) sqlConditions.push(Prisma.sql`co."is_general_education" = TRUE`);
    const where =
      sqlConditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(sqlConditions, ' AND ')} AND co."graded_count" > 0`
        : Prisma.sql`WHERE co."graded_count" > 0`;

    // Group by (program, year) so the UI can render year-columns. The
    // overall program rollup is summed client-side from the year cells.
    const rows = await prisma.$queryRaw<
      Array<{
        program_id: string;
        program_name: string;
        program_level: string;
        faculty_name: string;
        acad_year_be: number;
        class_count: bigint;
        graded_count: bigint;
        weighted_numer: number | null;
        weighted_denom: number | null;
      }>
    >(Prisma.sql`
      SELECT
        p."id"                                   AS program_id,
        p."name_th"                              AS program_name,
        p."level"::text                          AS program_level,
        f."name_th"                              AS faculty_name,
        co."acad_year_be"                        AS acad_year_be,
        COUNT(co."id")::bigint                   AS class_count,
        COALESCE(SUM(co."graded_count"), 0)::bigint AS graded_count,
        SUM(co."class_gpa" * co."graded_count" * COALESCE(co."credit_total", 1)) AS weighted_numer,
        SUM(co."graded_count" * COALESCE(co."credit_total", 1))::float AS weighted_denom
      FROM "class_offerings" co
      JOIN "program_courses" pc ON pc."course_code" = co."course_code"
      JOIN "programs" p ON p."id" = pc."program_id"
      JOIN "faculties" f ON f."id" = p."faculty_id"
      ${where}
      GROUP BY p."id", p."name_th", p."level", f."name_th", co."acad_year_be"
    `);

    // Fold (program × year) tuples into one row per program with a
    // byYear map. Track yearsObserved globally for the column header set.
    interface Agg {
      programId: string;
      programName: string;
      programLevel: string;
      facultyName: string;
      classCount: number;
      gradedCount: number;
      weightedNumer: number;
      weightedDenom: number;
      byYear: Record<string, ClassGpaTrendCell>;
    }
    const programMap = new Map<string, Agg>();
    const yearSet = new Set<number>();
    for (const r of rows) {
      yearSet.add(r.acad_year_be);
      const numer = r.weighted_numer ?? 0;
      const denom = r.weighted_denom ?? 0;
      const classCount = Number(r.class_count);
      const gradedCount = Number(r.graded_count);
      const cell: ClassGpaTrendCell = {
        classCount,
        gradedCount,
        averageClassGpa: denom > 0 ? numer / denom : null,
      };
      const entry =
        programMap.get(r.program_id) ?? {
          programId: r.program_id,
          programName: r.program_name,
          programLevel: r.program_level,
          facultyName: r.faculty_name,
          classCount: 0,
          gradedCount: 0,
          weightedNumer: 0,
          weightedDenom: 0,
          byYear: {},
        };
      entry.classCount += classCount;
      entry.gradedCount += gradedCount;
      entry.weightedNumer += numer;
      entry.weightedDenom += denom;
      entry.byYear[String(r.acad_year_be)] = cell;
      programMap.set(r.program_id, entry);
    }

    let totalCount = 0;
    let totalGraded = 0;
    let totalNumer = 0;
    let totalDenom = 0;
    const out: ClassGpaByProgramRow[] = [...programMap.values()]
      .map((a) => {
        totalCount += a.classCount;
        totalGraded += a.gradedCount;
        totalNumer += a.weightedNumer;
        totalDenom += a.weightedDenom;
        return {
          programId: a.programId,
          programName: a.programName,
          programLevel: a.programLevel,
          facultyName: a.facultyName,
          classCount: a.classCount,
          gradedCount: a.gradedCount,
          averageClassGpa: a.weightedDenom > 0 ? a.weightedNumer / a.weightedDenom : null,
          byYear: a.byYear,
        };
      })
      .sort((x, y) => {
        const xv = x.averageClassGpa ?? -Infinity;
        const yv = y.averageClassGpa ?? -Infinity;
        return yv - xv;
      });
    return {
      rows: out,
      totals: {
        classCount: totalCount,
        gradedCount: totalGraded,
        averageClassGpa: totalDenom > 0 ? totalNumer / totalDenom : null,
      },
      yearsObserved: [...yearSet].sort((a, b) => a - b),
    };
  }

  /** Per-course (lowest level in Faculty→Program→Course drill) — one row
   *  per courseCode in the program's curriculum, with year-columns
   *  weighted across all sections of that course. Sections are
   *  rolled up by (courseCode × year). */
  async classGpaByCourse(
    programId: string,
    filters: Omit<ClassGpaFilters, 'facultyName' | 'levelName' | 'geOnly'>,
  ): Promise<ClassGpaCoursesResponse> {
    const sqlConditions: Prisma.Sql[] = [Prisma.sql`pc."program_id" = ${programId}`];
    if (filters.acadYearBE && filters.acadYearBE.length > 0)
      sqlConditions.push(Prisma.sql`co."acad_year_be" IN (${Prisma.join(filters.acadYearBE)})`);
    if (filters.semester && filters.semester.length > 0)
      sqlConditions.push(Prisma.sql`co."semester" IN (${Prisma.join(filters.semester)})`);
    sqlConditions.push(Prisma.sql`co."graded_count" > 0`);
    const where = Prisma.sql`WHERE ${Prisma.join(sqlConditions, ' AND ')}`;

    const rows = await prisma.$queryRaw<
      Array<{
        course_code: string;
        course_name_th: string | null;
        course_name_en: string | null;
        acad_year_be: number;
        class_count: bigint;
        graded_count: bigint;
        weighted_numer: number | null;
        weighted_denom: number | null;
      }>
    >(Prisma.sql`
      SELECT
        co."course_code"                          AS course_code,
        MAX(co."course_name_th")                  AS course_name_th,
        MAX(co."course_name_en")                  AS course_name_en,
        co."acad_year_be"                         AS acad_year_be,
        COUNT(co."id")::bigint                    AS class_count,
        COALESCE(SUM(co."graded_count"), 0)::bigint AS graded_count,
        SUM(co."class_gpa" * co."graded_count" * COALESCE(co."credit_total", 1)) AS weighted_numer,
        SUM(co."graded_count" * COALESCE(co."credit_total", 1))::float AS weighted_denom
      FROM "class_offerings" co
      JOIN "program_courses" pc ON pc."course_code" = co."course_code"
      ${where}
      GROUP BY co."course_code", co."acad_year_be"
    `);

    interface Agg {
      courseCode: string;
      courseNameTh: string | null;
      courseNameEn: string | null;
      classCount: number;
      gradedCount: number;
      weightedNumer: number;
      weightedDenom: number;
      byYear: Record<string, ClassGpaTrendCell>;
    }
    const courseMap = new Map<string, Agg>();
    const yearSet = new Set<number>();
    for (const r of rows) {
      yearSet.add(r.acad_year_be);
      const numer = r.weighted_numer ?? 0;
      const denom = r.weighted_denom ?? 0;
      const classCount = Number(r.class_count);
      const gradedCount = Number(r.graded_count);
      const cell: ClassGpaTrendCell = {
        classCount,
        gradedCount,
        averageClassGpa: denom > 0 ? numer / denom : null,
      };
      const entry =
        courseMap.get(r.course_code) ?? {
          courseCode: r.course_code,
          courseNameTh: r.course_name_th,
          courseNameEn: r.course_name_en,
          classCount: 0,
          gradedCount: 0,
          weightedNumer: 0,
          weightedDenom: 0,
          byYear: {},
        };
      entry.classCount += classCount;
      entry.gradedCount += gradedCount;
      entry.weightedNumer += numer;
      entry.weightedDenom += denom;
      entry.byYear[String(r.acad_year_be)] = cell;
      courseMap.set(r.course_code, entry);
    }
    const out: ClassGpaCourseRow[] = [...courseMap.values()]
      .map((a) => ({
        courseCode: a.courseCode,
        courseNameTh: a.courseNameTh,
        courseNameEn: a.courseNameEn,
        classCount: a.classCount,
        gradedCount: a.gradedCount,
        averageClassGpa: a.weightedDenom > 0 ? a.weightedNumer / a.weightedDenom : null,
        byYear: a.byYear,
      }))
      .sort((x, y) => x.courseCode.localeCompare(y.courseCode));
    return {
      programId,
      rows: out,
      yearsObserved: [...yearSet].sort((a, b) => a - b),
    };
  }

  /** Resolve "latest (year × semester) with graded data" for a given
   *  program. Defends the drill UI against picking a term that's still
   *  in progress (e.g., BE 2569 sem 1 with no submitted grades yet). */
  async classGpaLatestCellForProgram(
    programId: string,
  ): Promise<{ acadYearBE: number; semester: number } | null> {
    const row = await prisma.$queryRaw<Array<{ acad_year_be: number; semester: number }>>(Prisma.sql`
      SELECT co."acad_year_be", co."semester"
        FROM "class_offerings" co
        JOIN "program_courses" pc ON pc."course_code" = co."course_code"
       WHERE pc."program_id" = ${programId}
         AND co."graded_count" > 0
       ORDER BY co."acad_year_be" DESC, co."semester" DESC
       LIMIT 1
    `);
    if (row.length === 0) return null;
    return { acadYearBE: row[0]!.acad_year_be, semester: row[0]!.semester };
  }

  /** Per-section drill — the sections a program's curriculum produced in
   *  a specific (year × sem). Returns all sections; UI clips/sorts as
   *  needed. Empty when the program has no `program_courses` rows
   *  materialised yet. */
  async classGpaSectionDrill(
    programId: string,
    acadYearBE: number,
    semester: number,
  ): Promise<ClassGpaSectionRow[]> {
    const sections = await prisma.$queryRaw<
      Array<{
        id: string;
        acad_year_be: number;
        semester: number;
        course_code: string;
        course_name_th: string | null;
        course_name_en: string | null;
        section: number;
        enroll_seat: number;
        graded_count: number;
        class_gpa: number | null;
        credit_total: number | null;
        grade_a: number;
        grade_b_plus: number;
        grade_b: number;
        grade_c_plus: number;
        grade_c: number;
        grade_d_plus: number;
        grade_d: number;
        grade_f: number;
        grade_i: number;
        grade_w: number;
      }>
    >(Prisma.sql`
      SELECT
        co."id", co."acad_year_be", co."semester", co."course_code",
        co."course_name_th", co."course_name_en", co."section",
        co."enroll_seat", co."graded_count", co."class_gpa",
        co."credit_total",
        co."grade_a", co."grade_b_plus", co."grade_b", co."grade_c_plus",
        co."grade_c", co."grade_d_plus", co."grade_d", co."grade_f",
        co."grade_i", co."grade_w"
      FROM "class_offerings" co
      JOIN "program_courses" pc ON pc."course_code" = co."course_code"
      WHERE pc."program_id" = ${programId}
        AND co."acad_year_be" = ${acadYearBE}
        AND co."semester" = ${semester}
      ORDER BY co."course_code", co."section"
    `);
    return sections.map((s) => ({
      classOfferingId: s.id,
      acadYearBE: s.acad_year_be,
      semester: s.semester,
      courseCode: s.course_code,
      courseNameTh: s.course_name_th,
      courseNameEn: s.course_name_en,
      section: s.section,
      enrollSeat: s.enroll_seat,
      gradedCount: s.graded_count,
      classGpa: s.class_gpa,
      creditTotal: s.credit_total,
      grades: {
        A: s.grade_a,
        BPLUS: s.grade_b_plus,
        B: s.grade_b,
        CPLUS: s.grade_c_plus,
        C: s.grade_c,
        DPLUS: s.grade_d_plus,
        D: s.grade_d,
        F: s.grade_f,
        I: s.grade_i,
        W: s.grade_w,
      },
    }));
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
