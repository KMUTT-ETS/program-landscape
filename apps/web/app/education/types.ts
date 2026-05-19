// Shape-only types mirroring the Education API responses. Kept in sync
// with apps/api/src/education/education.service.ts.

export interface FacetCount {
  key: string;
  label: string;
  count: number;
}

export interface StatusOption {
  code: number;
  name: string;
  count: number;
}

export type StatusGroup = 'INCOMING' | 'CURRENT' | 'FORMER';

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
  averageAge: number | null;
  ageSampleCount: number;
  byStatusGroup: StatusGroupBucket[];
  filters: {
    faculties: string[];
    programLevels: string[];
    programs: { facultyName: string; programLevel: string; programName: string }[];
    statuses: StatusOption[];
    statusGroups: StatusGroupBucket[];
  };
  appliedStatusCodes: number[];
  appliedStatusGroups: StatusGroup[];
}

export type ThailandRegion =
  | 'NORTH'
  | 'NORTHEAST'
  | 'CENTRAL'
  | 'EAST'
  | 'WEST'
  | 'SOUTH';

export interface LocationResponse {
  totalActive: number;
  byRegion: { region: ThailandRegion; label: string; count: number }[];
  unknownRegionCount: number;
  byProvince: FacetCount[];
  bySchool: FacetCount[];
  cohortYears: number[];
  filters: {
    faculties: string[];
    programLevels: string[];
    programs: { facultyName: string; programLevel: string; programName: string }[];
  };
}

export interface ActivePivotResponse {
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

// ── Performance dashboard ───────────────────────────────────────────

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

export interface PerformanceByProgramResponse {
  rows: Array<{
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
  }>;
  totals: {
    studentCount: number;
    averageEntryGpa: number | null;
    averageGpa: number | null;
  };
}

export interface PerformanceByLocationResponse {
  rows: Array<{
    region: ThailandRegion | 'UNKNOWN';
    label: string;
    children: Array<{
      provinceName: string;
      children: Array<{
        schoolName: string;
        children: Array<{
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
        }>;
        studentCount: number;
        averageEntryGpa: number | null;
        averageGpa: number | null;
      }>;
      studentCount: number;
      averageEntryGpa: number | null;
      averageGpa: number | null;
    }>;
    studentCount: number;
    averageEntryGpa: number | null;
    averageGpa: number | null;
  }>;
  totals: {
    studentCount: number;
    averageEntryGpa: number | null;
    averageGpa: number | null;
  };
}

export interface EntryScoreResponse {
  subjects: Array<{ subjectCode: string; subjectName: string | null }>;
  rows: Array<{
    facultyName: string;
    children: Array<{
      programName: string;
      cells: Record<string, number>;
      studentCount: number;
    }>;
    cells: Record<string, number>;
    studentCount: number;
  }>;
  totals: { cells: Record<string, number>; studentCount: number };
}

// ── Class GPA (new in v1.2.9) ───────────────────────────────────────────
// Server shapes mirror apps/api/src/education/education.service.ts.

export interface ClassGpaOverall {
  totalClasses: number;
  classesWithGrades: number;
  totalGradedCount: number;
  averageClassGpa: number | null;
  passRate: number | null;
  withdrawalRate: number | null;
  gradeDistribution: Record<
    'A' | 'BPLUS' | 'B' | 'CPLUS' | 'C' | 'DPLUS' | 'D' | 'F',
    number
  >;
  windowYearsBE: { start: number | null; end: number | null };
}

export interface ClassGpaTrendCell {
  classCount: number;
  gradedCount: number;
  averageClassGpa: number | null;
}

export interface ClassGpaTrendRow {
  acadYearBE: number;
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
  byYear: Record<string, ClassGpaTrendCell>;
}

export interface ClassGpaByProgramResponse {
  rows: ClassGpaByProgramRow[];
  totals: ClassGpaTrendCell;
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

export interface RefreshStatus {
  isRunning: boolean;
  cubes: Array<{
    cubeName: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    recordsLoaded: number | null;
    durationMs: number | null;
    errorMessage: string | null;
  }>;
}
