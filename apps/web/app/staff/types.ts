// Shape-only types mirroring the Staff Dashboard API responses.

export interface FilterOptions {
  faculties: string[];
  staffTypes: Array<{ id: string; label: string }>;
  tracks: Array<{ id: 'ACADEMIC' | 'SUPPORT'; label: string }>;
  academicStandings: Array<{ id: string; label: string }>;
  positionLevels: Array<{ id: string; label: string }>;
  budgets: Array<{ id: string; label: string }>;
  nationalities: string[];
}

export interface RefreshStatus {
  sources: Array<{
    slug: string;
    name: string;
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    recordsLoaded: number | null;
    durationMs: number | null;
    errorMessage: string | null;
  }>;
}

export interface OverviewBlock {
  headcount: { total: number; academic: number; support: number; executives: number; unknownTrack: number };
  retirementCliff5y: { academic: number; support: number; total: number };
  flow12m: { hires: number; separations: number };
  facultyMosaic: Array<{ facultyName: string; academic: number; support: number; total: number }>;
  /** 10-year forward retirement projection (year-grain, academic/support
   *  split). Source: processed-HR vw_history.retireday — KKU mandatory
   *  retirement is 1 Oct of the staff member's 60th-birthday fiscal year. */
  retirementProjection: Array<{
    fiscalYear: number;
    academic: number;
    support: number;
    total: number;
  }>;
  /** Tenure distribution — years since hireDate for active workforce.
   *  Source: HCMEmployee.FIRSTHIREDATE (with vw_history.putday as
   *  fallback). Captures the "experience pyramid". */
  tenure: {
    withHireDate: number;
    meanYears: number;
    medianYears: number;
    buckets: Array<{ label: string; academic: number; support: number; total: number }>;
  };
  /** Turnover — pre-retirement separations from HCMEmployee.ENDWORKDATE
   *  (full table snapshot, no STATUS filter). Surfaces both
   *  academic-only and all-staff rates because the same data source
   *  cleanly covers both populations. */
  facultyTurnover: {
    /** Active academic faculty (FacultyMember.isActive=true). */
    activeFacultyCount: number;
    /** Total active staff (StaffMasterRecord scope). */
    activeAllCount: number;
    /** Academic faculty separations in last 12 months. */
    separations12mAcademic: number;
    /** All-staff separations in last 12 months. */
    separations12mAll: number;
    /** Academic 12m turnover rate (×100). */
    turnoverRate12mAcademicPct: number;
    /** All-staff 12m turnover rate (×100). */
    turnoverRate12mAllPct: number;
    /** Last 5 calendar years of separation counts — both scopes. */
    yearly: Array<{ year: number; separationsAcademic: number; separationsAll: number }>;
  };
}

export interface DemographicsBlock {
  academic: TrackBlock;
  support: TrackBlock;
  facultyRetirementRisk: Array<{ facultyName: string; total: number; retire5y: number; pct: number }>;
}
export interface TrackBlock {
  total: number;
  nearRetirement: number;
  agePyramid: Array<{ bucket: string; male: number; female: number; total: number }>;
  tenureBuckets: Record<string, number>;
}

export interface WorkforceResponse extends OverviewBlock {
  demographics: DemographicsBlock;
}

// Drill-down tree shape: Faculty → Program Level → Program
export interface FacultyByProgramResponse {
  thresholds: { responsibleMinimum: number };
  faculties: Array<{
    facultyName: string;
    teachType2: number;
    teachType3: number;
    distinctStaff: number;
    studentCount: number;
    studentsPerStaff: number | null;
    programCount: number;
    programsBelowMin: number;
    levels: Array<{
      programLevel: string;
      teachType2: number;
      teachType3: number;
      distinctStaff: number;
      studentCount: number;
      studentsPerStaff: number | null;
      programCount: number;
      programsBelowMin: number;
      programs: Array<{
        programId: string;
        programName: string;
        teachType2: number;
        teachType3: number;
        distinctStaff: number;
        studentCount: number;
        studentsPerStaff: number | null;
        meetsResponsibleMin: boolean;
      }>;
    }>;
  }>;
}

// Research view — consolidated 2026-05-07. Driven by FacultyMember +
// ResearchOutput directly from the kku-publications mirror, scoped to
// active employees. Replaces the older staff_master_records-based
// Research view AND the standalone Publications view (the prior two
// were redundant); now there's one canonical view at /staff/research.
export interface ResearchAuthor {
  fmId: string;
  nameTh: string | null;
  nameEn: string | null;
  rank: string;
  isActive: boolean;
  employeeSource: 'kku-hr' | 'kku-publications' | 'other';
  facultyName: string | null;
  departmentName: string | null;
  papers: number;
  citations: number;
  hIndex: number;
  mostRecentYear: number | null;
  bySource: Record<string, number>;
}

export interface ResearchFacultyRow {
  facultyName: string;
  staffCount: number;
  publishingStaff: number;
  papers: number;
  citations: number;
  bySource: Record<string, number>;
  byType: Record<string, number>;
}

export interface ResearchHeatmapRow {
  facultyName: string;
  years: Array<{ year: number; papers: number }>;
}

// Productivity-by-rank breakdown, scoped to kku-hr-sourced staff
// (kkupub_-backfilled rows carry rank=LECTURER as a placeholder and
// would skew the averages if included).
export interface ResearchByRankRow {
  rank: string;       // 'PROF' | 'ASSOC_PROF' | 'ASST_PROF' | 'LECTURER'
  rankLabel: string;  // human-readable label
  rankRank: number;   // ordering: PROF=4 → LECTURER=1
  staffCount: number;
  publishingStaff: number;
  papers: number;
  citations: number;
  avgPapersPerStaff: number;
  avgCitesPerStaff: number;
  maxHIndex: number;
}

export interface ResearchResponse {
  yearFrom: number;
  yearTo: number;
  totalStaff: number;
  publishingStaff: number;
  totalPapers: number;
  totalCitations: number;
  bySource: Record<string, number>;
  byType: Record<string, number>;
  byYear: Array<{ year: number; scopus: number; pubmed: number; total: number }>;
  byFaculty: ResearchFacultyRow[];
  heatmap: ResearchHeatmapRow[];
  topVenues: Array<{ venue: string; papers: number }>;
  topAuthors: ResearchAuthor[];
  perAuthor: ResearchAuthor[];
  byRank: ResearchByRankRow[];
  employeeSourceMix: { kkuHr: number; kkuPublications: number; other: number };
  activeFormerSplit: {
    active: number;
    former: number;
    activePublishing: number;
    formerPublishing: number;
  };
  caveats: string[];
}

export interface CompensationResponse {
  budgetByTrack: Array<{ source: string; academic: number; support: number; total: number }>;
  incomeByTrack: Array<{ bandId: string; bandLabel: string; academic: number; support: number }>;
  drillDown: Array<{
    facultyName: string;
    headcount: number;
    meanSalary: number;
    minSalary: number;
    maxSalary: number;
    children: Array<{
      track: 'ACADEMIC' | 'SUPPORT';
      headcount: number;
      meanSalary: number;
      minSalary: number;
      maxSalary: number;
      children: Array<{
        salType: string;
        headcount: number;
        meanSalary: number;
        minSalary: number;
        maxSalary: number;
      }>;
    }>;
  }>;
  sources: { masterRowCount: number; compensationCells: number; notice: string };
}
