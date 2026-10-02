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
  /** Per-faculty 5-year retirement risk with academic/support split.
   *  Succession-planning levers differ by track — academic needs long-
   *  lead hiring + dissertation pipelines; support has shorter
   *  recruitment windows. Sorted by overall pct. */
  facultyRetirementRisk: Array<{
    facultyName: string;
    /** Combined totals (back-compat). */
    total: number;
    retire5y: number;
    pct: number;
    /** Academic split. */
    academicTotal: number;
    academicRetire5y: number;
    academicPct: number;
    /** Support split. */
    supportTotal: number;
    supportRetire5y: number;
    supportPct: number;
  }>;
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
  facultyNameTh: string | null;
  departmentName: string | null;
  papers: number;
  citations: number;
  hIndex: number;
  /** This author's Q1 / Q2 papers + the Top-10% subset. */
  q1Papers: number;
  q2Papers: number;
  top10Papers: number;
  mostRecentYear: number | null;
  bySource: Record<string, number>;
}

export interface ResearchFacultyRow {
  facultyName: string;
  staffCount: number;
  publishingStaff: number;
  papers: number;
  citations: number;
  /** Distinct papers per Scopus quartile + Top-10% subset + rated total. */
  q1Papers: number;
  q2Papers: number;
  q3Papers: number;
  q4Papers: number;
  top10Papers: number;
  ratedPapers: number;
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
  /** When set, the window collapses to a single year. yearFrom is set to
   *  this value too so the existing chart axis logic keeps working. */
  yearExact: number | null;
  /** Stable bounds for the year-range slider — the ingestion floor and
   *  the current year, independent of the active filter window. */
  yearMin: number;
  yearMax: number;
  totalStaff: number;
  /** Faculty members with isActive=true in the filter set. Denominator
   *  for the "papers per active faculty" KPI — same active-count the
   *  /staff/workforce dashboard reports. */
  activeStaff: number;
  publishingStaff: number;
  totalPapers: number;
  totalCitations: number;
  bySource: Record<string, number>;
  byType: Record<string, number>;
  /** Scopus journal-quartile distribution (distinct papers). `unrated`
   *  = PubMed + journals with no CiteScore record; `q1Share` is against
   *  `rated` only. */
  byQuartile: {
    q1: number;
    q2: number;
    q3: number;
    q4: number;
    /** Top-10% (Tier 1) papers — a SUBSET of q1, not an extra band. */
    top10: number;
    unrated: number;
    rated: number;
    q1Share: number | null;
    top10Share: number | null;
  };
  /** Quartile mix per year (rated Scopus papers only) + Top-10% subset
   *  + rated total — powers the by-year tier distribution chart. */
  quartileByYear: Array<{
    year: number;
    q1: number;
    q2: number;
    q3: number;
    q4: number;
    top10: number;
    rated: number;
  }>;
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

// ── Research and academic service grants (/staff-dashboard/grants) ──
// Shape-only copies of the @kku/db research-services types, kept here like
// every other response in this file so client components never touch the
// @kku/db barrel at runtime.

export type GrantType = 'RESEARCH' | 'ACADEMIC_SERVICE' | 'CONSULTING' | 'OTHER';

export interface GrantsTableRow {
  id: string;
  titleTh: string;
  titleEn: string | null;
  type: GrantType;
  fiscalYearBe: number;
  leadName: string | null;
  leadFacultyName: string;
  funderName: string | null;
  budgetThb: number | null;
  teamSize: number;
  workflowStatus: string;
}

export interface GrantsDashboard {
  kpis: { projects: number; budgetThb: number; staffInvolved: number; membersTotal: number; membersMatched: number };
  /** CONSULTING is folded into OTHER here. */
  trend: Array<{ fiscalYearBe: number; RESEARCH: number; ACADEMIC_SERVICE: number; OTHER: number; budgetThb: number }>;
  byFaculty: Array<{ facultyName: string; led: number; coOnly: number; total: number }>;
  topFunders: Array<{ funderName: string | null; projects: number; budgetThb: number }>;
  table: { total: number; page: number; pageSize: number; rows: GrantsTableRow[] };
}

export type GrantsResponse = GrantsDashboard & {
  options: { yearMin: number | null; yearMax: number | null; funders: string[] };
};

export interface GrantProjectDetail {
  id: string;
  titleTh: string;
  titleEn: string | null;
  type: GrantType;
  typeRaw: string;
  fiscalYearBe: number;
  startDate: string | null;
  endDate: string | null;
  budgetThb: number | null;
  funderName: string | null;
  keywords: string | null;
  workflowStatus: string;
  leadFacultyName: string;
  team: Array<{ role: 'LEAD' | 'CO_INVESTIGATOR'; displayName: string | null; facultyName: string | null; matched: boolean }>;
}
