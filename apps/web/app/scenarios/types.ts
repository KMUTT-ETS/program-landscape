// Shared DTOs for the Scenarios UI. Mirror the API response shapes.

export type ScenarioType = 'SUNSET' | 'MERGE' | 'LAUNCH' | 'RESHAPE' | 'REBALANCE';
export type WorkflowStatus = 'DRAFT' | 'SHARED' | 'COUNCIL_REVIEWED' | 'DECIDED' | 'ARCHIVED';

export interface ScenarioListRow {
  id: string;
  name: string;
  descriptionTh: string | null;
  scenarioType: ScenarioType;
  workflowStatus: WorkflowStatus;
  horizonYears: number;
  isTemplate: boolean;
  affectedProgramIds: string[];
  methodologyVersion: string;
  createdAt: string;
  updatedAt: string;
  user: { name: string | null; email: string } | null;
  _count: { runs: number; results: number };
}

export interface ScenarioTemplate {
  slug: string;
  name: string;
  scenarioType: ScenarioType;
  horizonYears: number;
  descriptionTh: string;
  descriptionEn: string;
  caveatTh: string;
}

export interface ScenarioDetail extends ScenarioListRow {
  descriptionEn: string | null;
  assumptionsJson: Record<string, number>;
  interventionsJson: unknown[];
  collaboratorIds: string[];
  parentScenarioId: string | null;
  runs: ScenarioRunDto[];
  parent: { id: string; name: string } | null;
  children: Array<{ id: string; name: string; workflowStatus: WorkflowStatus }>;
}

export interface ScenarioRunDto {
  id: string;
  runAt: string;
  methodologyVersion: string;
  monteCarloN: number;
  projectionJson: ScenarioEngineOutput;
  sensitivityJson: SensitivityEntryDto[];
  riskRegisterJson: RiskDto[];
  briefAi: { id: string; model: string; confidence: number | null } | null;
}

export interface ScenarioEngineOutput {
  baseline: Outcome;
  scenario: Outcome;
  deltaTotalNetContribution: number;
  deltaTotalRevenue: number;
  deltaTotalCost: number;
  monteCarlo: {
    totalNetContributionCi80: [number, number];
    totalNetContributionMean: number;
    totalNetContributionStdDev: number;
    iterations: number;
  };
  sensitivity: SensitivityEntryDto[];
  methodologyVersion: string;
  seed: number;
  monteCarloN: number;
}

export interface Outcome {
  years: Array<{
    year: number;
    enrolled: number;
    graduates: number;
    revenue: number;
    cost: number;
    netContribution: number;
    skillProduction: Record<string, number>;
  }>;
  totalRevenue: number;
  totalCost: number;
  totalNetContribution: number;
  peakEnrollment: number;
  graduatesCumulative: number;
}

export interface SensitivityEntryDto {
  assumptionKey: string;
  deltaPct: number;
  lowOutcomeDelta: number;
  highOutcomeDelta: number;
}

export interface RiskDto {
  category: 'financial' | 'academic' | 'faculty' | 'brand' | 'regulatory' | 'political';
  severity: 'low' | 'medium' | 'high';
  titleTh: string;
  descriptionTh: string;
  mitigation?: string;
}
