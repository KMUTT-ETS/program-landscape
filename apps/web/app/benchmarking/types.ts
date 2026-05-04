// Shared DTOs for the Benchmarking UI. Mirror the API response shapes.
// New (real-data) types are at the bottom; legacy v1 types kept for
// backwards compat with /benchmarking/programs/[id] sub-route.

export type ContentModernity = 'OLD_SCHOOL' | 'IN_BETWEEN' | 'FRONTIER';

export interface BenchmarkingHero {
  programsBenchmarked: number;
  programsReviewed: number;
  totalActivePrograms: number;
  modernityCounts: { OLD_SCHOOL: number; IN_BETWEEN: number; FRONTIER: number; UNKNOWN: number };
}

export interface CitedPeerRow {
  rankedUniversityId: string;
  name: string;
  country: string;
  qsWorldRank: number | null;
  theWorldRank: number | null;
  selectionCount: number;
  byTier: { WORLD: number; ASIA: number; SOUTHEAST_ASIA: number; THAILAND_PEER: number };
}

export interface RecentReviewRow {
  programId: string;
  programCode: string;
  programNameEn: string;
  programNameTh: string;
  facultyCode: string;
  contentModernity: ContentModernity | null;
  modernityNarrative: string | null;
  topStrength: string | null;
  topWeakness: string | null;
  topContentGap: { topic: string; severity: 'major' | 'moderate' | 'minor' } | null;
  topPeer: { name: string; country: string; tier: string } | null;
  generatedAt: string;
}

export interface ProgramBenchmarkRow {
  programId: string;
  programCode: string;
  programNameEn: string;
  programNameTh: string;
  facultyCode: string;
  contentModernity: ContentModernity | null;
  peerCount: number;
  topPeerName: string | null;
  topPeerCountry: string | null;
  topGapTopic: string | null;
  hasReview: boolean;
}

export interface BenchmarkingOverviewDto {
  methodologyVersion: string;
  generatedAt: string;
  hero: BenchmarkingHero;
  citedPeers: CitedPeerRow[];
  recentReviews: RecentReviewRow[];
  programs: ProgramBenchmarkRow[];
}

// ─── Legacy v1 types (kept for sub-routes) ──────────────────────────────────


export interface PeerSetDto {
  id: string;
  name: string;
  descriptionTh: string | null;
  descriptionEn: string | null;
  isSystem: boolean;
  subjectArea: string | null;
  region: string;
  memberCount: number;
  createdAt: string;
}

export interface PortfolioComparisonResponse {
  peerSetId: string;
  peerSetName: string;
  kku: {
    programCount: number;
    subjectDistribution: Record<string, number>;
    levelDistribution: Record<string, number>;
  };
  peers: Array<{
    institution: string;
    country: string;
    programCount: number;
    subjectDistribution: Record<string, number>;
    levelDistribution: Record<string, number>;
  }>;
  whatTheyHave: Array<{ subjectArea: string; peerCount: number }>;
  whatWeHave: Array<{ subjectArea: string; kkuProgramCount: number }>;
  methodologyVersion: string;
  asOf: string;
  lowConfidenceReason: string | null;
}

export interface SubjectLeadershipResponse {
  subjectArea: string;
  kkuPercentileLatest: number | null;
  trendsBySource: Record<
    string,
    Array<{
      institution: string;
      source: string;
      years: Array<{ year: number; rank: number; percentile: number | null }>;
      trend: 'rising' | 'falling' | 'stable';
    }>
  >;
  researchOutputGap: { kku: number; peerMedian: number; gapPct: number } | null;
  methodologyVersion: string;
  asOf: string;
  lowConfidenceReason: string | null;
}

export interface ProgramPeersResponse {
  programId: string;
  peers: Array<{
    id: string;
    institution: string;
    country: string;
    programName: string;
    programLevel: string;
    subjectArea: string | null;
    ranking: number | null;
    similarityScore: number;
    skillOverlapCount: number;
    lastScraped: string;
  }>;
  distinctiveness: {
    programId: string;
    score: number;
    overlapRatio: number;
    distinctiveSkills: Array<{ id: string; nameEn: string; nameTh: string }>;
    sharedWithNPeers: Array<{ skillId: string; nameEn: string; count: number }>;
  };
  methodologyVersion: string;
  asOf: string;
  scorerUsed: 'embedding-cosine' | 'skill-overlap' | 'subject-and-country-fallback';
}

export interface WhiteSpaceResponse {
  rows: Array<{
    skillId: string;
    skillCode: string;
    nameEn: string;
    nameTh: string;
    peerCount: number;
    peerInstitutions: string[];
    estimatedCohortSize: number;
    fitNote: string;
  }>;
  peerThreshold: number;
  methodologyVersion: string;
  asOf: string;
  lowConfidenceReason: string | null;
}
