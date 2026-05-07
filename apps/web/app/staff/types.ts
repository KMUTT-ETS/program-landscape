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
