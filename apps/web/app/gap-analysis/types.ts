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

export interface RiskRowDto {
  programId: string;
  programCode: string;
  nameTh: string;
  nameEn: string;
  currentGraduates: number;
  projectedSupply5yr: number;
  projectedSupplyAfterDemographic: number;
  estimatedRegionalDemand: number;
  oversupplyPct: number;
  recommendationHint: 'reduce-intake' | 'rebalance' | 'repurpose' | 'watch';
}
