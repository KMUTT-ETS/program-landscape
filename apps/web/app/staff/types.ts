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

export interface ResearchAuthor {
  citizenIdHash: string;
  nameTh: string | null;
  rank: string;
  rankRank: number;
  facultyName: string | null;
  publications: number;
  citations: number;
  hIndex: number;
}

export interface ResearchResponse {
  windowYears: number;
  facultyTotal: number;
  authorsWithPubs: number;
  totalPubs: number;
  totalCitations: number;
  orcidCoverage: { withOrcid: number; total: number };
  byFaculty: Array<{
    facultyName: string;
    staffCount: number;
    staffWithPubs: number;
    pubsLast5y: number;
    citations: number;
    intensity: number;
  }>;
  byRank: Array<{
    rank: string;
    rankRank: number;
    staffCount: number;
    pubsLast5y: number;
    citations: number;
    avgPubsPerStaff: number;
    avgCitesPerStaff: number;
    maxHIndex: number;
  }>;
  perAuthor: ResearchAuthor[];
}

// Publications view — driven by FacultyMember + ResearchOutput directly
// (not staff_master_records). Surfaces the kku-publications mirror corpus
// including kkupub_-backfilled FacultyMember rows. Distinct from the
// /research view which is bound to currently-employed kku-hr staff.
export interface PublicationsAuthor {
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

export interface PublicationsFacultyRow {
  facultyName: string;
  staffCount: number;
  publishingStaff: number;
  papers: number;
  citations: number;
  bySource: Record<string, number>;
  byType: Record<string, number>;
}

export interface PublicationsHeatmapRow {
  facultyName: string;
  years: Array<{ year: number; papers: number }>;
}

export interface PublicationsResponse {
  yearFrom: number;
  yearTo: number;
  totalStaff: number;
  publishingStaff: number;
  totalPapers: number;
  totalCitations: number;
  bySource: Record<string, number>;
  byType: Record<string, number>;
  byYear: Array<{ year: number; papers: number }>;
  byFaculty: PublicationsFacultyRow[];
  heatmap: PublicationsHeatmapRow[];
  topVenues: Array<{ venue: string; papers: number }>;
  topAuthors: PublicationsAuthor[];
  perAuthor: PublicationsAuthor[];
  employeeSourceMix: { kkuHr: number; kkuPublications: number; other: number };
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
