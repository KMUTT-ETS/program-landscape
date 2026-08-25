// Shared types for the Gap Analyzer UI. Mirror the API response shapes
// from @kku/db gap-analysis helpers — intentionally not importing from
// db here because this is a client-reachable module.

export interface SkillGapRowDto {
  skillId: string;
  skillCode: string;
  nameTh: string;
  nameEn: string;
  category: string | null;
  demand: number;
  supply: number;
  gap: number;
  gapPct: number | null;
  topDemandingEmployers: string[];
  topSupplyingProgramIds: string[];
  methodologyVersion: string;
}

export interface SkillGapResponse {
  filter: Record<string, unknown>;
  rows: SkillGapRowDto[];
  totalSkillsConsidered: number;
  asOf: string;
  lowConfidenceReason: string | null;
}

// ── Multi-lens Gap Analyzer (gap-lenses.v1) ────────────────────────────────
export type GapLensKey = 'skill' | 'content' | 'aiReadiness' | 'recruitment' | 'staff' | 'demographic';

export interface ProgramGapProfileDto {
  programId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  facultyId: string;
  facultyNameEn: string;
  content: { major: number; moderate: number; minor: number; total: number; reviewed: boolean };
  ai: { curriculumIntegration: number | null; displaceableShare: number | null; aiNative: number; aiAugmented: number; aiDisplaceable: number; neutral: number };
  recruitment: { entryYearBE: number; planPerYear: number; regReported: number; applicants: number; fillRateVsPlan: number; competitionRatio: number; registrationYield: number | null } | null;
  staff: { active: number; seniorShare: number; successionRiskPct: number; avgAgeYears: number | null; pubsLast3y: number; pubsPerHead: number } | null;
  demographic: { competitionNow: number; superCriticalYear: number | null; contraction15yPct: number } | null;
  skill: { relevant: number; covered: number; gaps: number; coveragePct: number } | null;
  subScores: Record<GapLensKey, number | null>;
  composite: number | null;
}

export interface GapAnalysisResponse {
  methodologyVersion: string;
  scope: string;
  scopeId: string | null;
  generatedAt: string;
  programCount: number;
  composite: {
    weights: Record<GapLensKey, number>;
    rows: ProgramGapProfileDto[];
    facultyHeatmap: Array<{ facultyId: string; facultyNameEn: string; programCount: number; avgComposite: number | null; subScores: Record<GapLensKey, number | null> }>;
  };
  content: {
    reviewedPrograms: number;
    severity: { major: number; moderate: number; minor: number };
    topTopics: Array<{ topic: string; total: number; major: number; moderate: number; minor: number }>;
    worstPrograms: Array<GapProgRefDto & { major: number; total: number }>;
  };
  aiReadiness: {
    scoredPrograms: number;
    avgResilience: number | null;
    avgIntegration: number | null;
    skillMix: { aiNative: number; aiAugmented: number; aiDisplaceable: number; neutral: number };
    worstPrograms: Array<GapProgRefDto & { skillResilience: number; curriculumIntegration: number; aiNative: number; aiDisplaceable: number }>;
  };
  recruitment: {
    coveredPrograms: number;
    underFilling: Array<GapProgRefDto & { entryYearBE: number; fillRateVsPlan: number; competitionRatio: number; registrationYield: number | null }>;
  };
  staff: {
    coveredPrograms: number;
    atRisk: Array<GapProgRefDto & { active: number; successionRiskPct: number; avgAgeYears: number | null; seniorShare: number; pubsPerHead: number }>;
  };
  demographic: {
    coveredPrograms: number;
    contraction15yPct: number;
    superCritical: Array<GapProgRefDto & { competitionNow: number; superCriticalYear: number | null }>;
  };
  whiteSpace: {
    marketGaps: Array<{ skillId: string; nameEn: string; nameTh: string; demand: number; topCareers: string[] }>;
    systemicTopics: Array<{ topic: string; programCount: number; majorCount: number; sampleFaculties: string[] }>;
    minPrograms: number;
    staffExpertiseNote: string;
  };
  skill: SkillGapResponse;
}

export interface GapProgRefDto {
  programId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  facultyNameEn: string;
}

export interface SectorGapRowDto {
  sectorId: string;
  sectorCode: string;
  family: 'BCG' | 'SCURVE' | 'CUSTOM';
  nameTh: string;
  nameEn: string;
  demandIndex: number;
  supplyIndex: number;
  gap: number;
  trend: 'growing' | 'shrinking' | 'flat';
  contributingProgramIds: string[];
  methodologyVersion: string;
}

export interface SectorGapResponse {
  filter: Record<string, unknown>;
  rows: SectorGapRowDto[];
  asOf: string;
}

export interface OccupationGapRowDto {
  occupationCode: string;
  region: string;
  demandCurrent: number;
  demandForecast: number | null;
  supplyCurrent: number;
  supplyForecast: number | null;
  gap: number;
  thailandAverageShare: number;
  kkuProductionShare: number;
  methodologyVersion: string;
}

export interface OccupationGapResponse {
  filter: Record<string, unknown>;
  rows: OccupationGapRowDto[];
  asOf: string;
  lowConfidenceReason: string | null;
}

export interface RegionalGapCellDto {
  province: string;
  demandTotal: number;
  supplyTotal: number;
  gap: number;
  intensity: 'demand-heavy' | 'supply-heavy' | 'balanced' | 'no-data';
}

export interface RegionalGapResponse {
  filter: Record<string, unknown>;
  cells: RegionalGapCellDto[];
  asOf: string;
  lowConfidenceReason: string | null;
}

export interface OpportunityRowDto {
  skillId: string;
  nameTh: string;
  nameEn: string;
  recentDemand: number;
  demandGrowthPct: number;
  existingProgramCount: number;
  peerProgramCount: number;
  estimatedCohortSize: number;
  fitNote: string;
}

export interface OpportunityResponse {
  filter: Record<string, unknown>;
  rows: OpportunityRowDto[];
  asOf: string;
}

export interface ProgramDemandGapRowDto {
  programId: string;
  programCode: string;
  programNameEn: string;
  programNameTh: string;
  facultyCode: string;
  relevantSkillCount: number;
  coveredCount: number;
  gapCount: number;
  coverageRatio: number;
  topGaps: Array<{ skillId: string; skillNameEn: string; skillNameTh: string; relatedness: number }>;
  methodologyVersion: string;
}

export interface ProgramDemandGapResponse {
  filter: Record<string, unknown>;
  rows: ProgramDemandGapRowDto[];
  uncoveredProgramCount: number;
  asOf: string;
}

export interface RiskRowDto {
  programId: string;
  programCode: string;
  nameTh: string;
  nameEn: string;
  curriculumYearBE: number | null;
  currentGraduates: number;
  projectedSupply5yr: number;
  projectedSupplyAfterDemographic: number;
  estimatedRegionalDemand: number;
  oversupplyPct: number;
  recommendationHint: 'reduce-intake' | 'rebalance' | 'repurpose' | 'watch';
}

// ── Digital-competency attainment lens (dq-skill-lens.v1) ─────────────────
// A separate axis beside the gap output, never a modifier on it: nothing
// above this comment reads any of the fields below.

export type DqSkillConfidenceDto = 'exact' | 'near' | 'none';

export interface DqLensDemandDto {
  demand: number;
  careerCount: number;
  topCareers: string[];
}

export interface DqLensProgramRowDto {
  programId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  mean: number;
  takenCount: number;
}

export interface DqSkillLensRowDto {
  moduleNo: number;
  moduleKey: string;
  moduleNameEn: string;
  moduleNameTh: string | null;
  moduleShortEn: string;
  domain: string;
  confidence: DqSkillConfidenceDto;
  note: string;
  skillId: string | null;
  skillNameEn: string | null;
  demandThailand: DqLensDemandDto | null;
  demandGlobal: DqLensDemandDto | null;
  mean: number | null;
  takenCount: number;
  studentsInScope: number;
  coveragePct: number | null;
  weakestPrograms: DqLensProgramRowDto[];
}

export interface DqSkillLensResponse {
  scope: string;
  scopeId: string | null;
  rows: DqSkillLensRowDto[];
  counts: {
    exact: number;
    near: number;
    none: number;
    withThailandDemand: number;
    withGlobalDemand: number;
  };
  thailandQuadrantRows: number;
  dqRefreshedAt: string | null;
  methodologyVersion: string;
  asOf: string;
}
