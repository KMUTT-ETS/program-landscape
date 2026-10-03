// Wire types for the Risks module's UI. Mirrors RisksController DTOs.
// Keep in sync with apps/api/src/risks/risks.controller.ts.

export type RiskTier = 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type KkuRiskLevel = 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
export type RiskMeasureKind =
  | 'CURRICULUM_MODERNIZE'
  | 'CURRICULUM_DIFFERENTIATE'
  | 'RECRUITMENT_CHANNEL'
  | 'RECRUITMENT_TARGETING'
  | 'COHORT_REDUCTION'
  | 'PROGRAM_MERGE'
  | 'PROGRAM_PHASE_OUT'
  | 'PARTNERSHIP_INDUSTRY'
  | 'FACULTY_HIRE'
  | 'TUITION_ADJUST';
export type RiskMeasureStatus = 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED';
export type RiskMeasureHorizon = 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';

export const HORIZON_LABEL: Record<RiskMeasureHorizon, { en: string; window: string }> = {
  SHORT_TERM: { en: 'Short term', window: '0–12 months' },
  MEDIUM_TERM: { en: 'Medium term', window: '1–3 years' },
  LONG_TERM: { en: 'Long term', window: '3–5 years' },
};

export const HORIZON_TONE: Record<RiskMeasureHorizon, string> = {
  SHORT_TERM: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  MEDIUM_TERM: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  LONG_TERM: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
};
export type RiskIndicatorSeverity = 'OK' | 'WARN' | 'CRITICAL';

export interface PortfolioRiskRow {
  programId: string;
  programCode: string;
  programNameTh: string;
  programNameEn: string;
  curriculumYearBE: number | null;
  facultyId: string;
  facultyNameTh: string;
  facultyNameEn: string;
  composite: number | null;
  tier: RiskTier;
  l1: number | null;
  l2: number | null;
  l3: number | null;
  directRevenueAtRiskThb: number | null;
  strandedCostThb: number | null;
  impactScore: number | null;
  likelihoodBin: number | null;
  impactBin: number | null;
  kkuMatrixScore: number | null;
  kkuRiskLevel: KkuRiskLevel;
  assessedAt: string;
}

export interface UniversityAverages {
  level: string;
  programCount: number;
  l1: number | null;
  l2: number | null;
  l3: number | null;
  composite: number | null;
  impactScore: number | null;
  kkuMatrixScore: number | null;
}

export interface PortfolioResponse {
  rows: PortfolioRiskRow[];
  summary: {
    total: number;
    byTier: Record<RiskTier, number>;
    byKkuLevel: Record<KkuRiskLevel, number>;
    kkuMatrixCells: number[][]; // [likelihoodBin-1][impactBin-1]
    totalRevenueAtRiskThb: number;
    totalStrandedCostThb: number;
    programsWithoutAssessment: number;
  };
  universityAverages: UniversityAverages;
  methodologyVersion: string;
}

export interface DriversResponseV2 {
  methodology: { version: string; docPath: string };
  cohort: {
    yearlyDeclinePct: number;
    fiveYearProjectionPct: number;
    source: string;
    projection: Array<{ yearBE: number; cohortIndex: number }>;
  };
  automationRisk: {
    total: number;
    counts: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN', number>;
    sampleByTier: Record<'LOW' | 'MEDIUM' | 'HIGH', Array<{ id: string; nameEn: string; nameTh: string }>>;
  };
  competitiveness: {
    programsRankedCount: number;
    level: string;
    ratioHistogram: Array<{ range: string; count: number }>;
  };
  aiReadiness: {
    total: number;
    buckets: Array<{ range: string; count: number; meanScore: number }>;
    severityCounts: { major: number; moderate: number; minor: number };
  };
}

export interface IndicatorBreachesResponse {
  indicator: {
    slug: string;
    labelTh: string;
    labelEn: string;
    descriptionTh: string;
    descriptionEn: string;
    formula: string;
    warnThreshold: number;
    criticalThreshold: number;
    alarmDirection: string;
  };
  severityCounts: { critical: number; warn: number; ok: number; total: number };
  valueHistogram: Array<{ range: string; count: number; severity: 'OK' | 'WARN' | 'CRITICAL' }>;
  breaches: Array<{
    programId: string;
    programCode: string;
    programNameTh: string;
    programNameEn: string;
    facultyId: string;
    facultyNameTh: string;
    value: number | null;
    severity: 'OK' | 'WARN' | 'CRITICAL';
    observedAt: string;
    freshnessDate: string;
  }>;
}

// KKU criteria — exact mapping from the institutional risk-management policy.
export const KKU_LEVEL_LABEL: Record<KkuRiskLevel, { th: string; en: string }> = {
  NEEDS_DATA: { th: 'ข้อมูลไม่พอ', en: 'Needs more data' },
  LOW: { th: 'ต่ำ', en: 'Low' },
  MODERATE: { th: 'ปานกลาง', en: 'Moderate' },
  HIGH: { th: 'สูง', en: 'High' },
  VERY_HIGH: { th: 'สูงมาก', en: 'Very high' },
};

export const KKU_LEVEL_FILL: Record<KkuRiskLevel, string> = {
  NEEDS_DATA: 'rgb(100 116 139)', // slate
  LOW: 'rgb(34 197 94)', // green
  MODERATE: 'rgb(234 179 8)', // yellow
  HIGH: 'rgb(249 115 22)', // orange
  VERY_HIGH: 'rgb(220 38 38)', // red (KKU "สีแดง")
};

// Score → KKU level (mirror of kkuRiskLevelFromScore in @kku/db).
export function kkuLevelFromMatrixScore(score: number | null): KkuRiskLevel {
  if (score == null) return 'NEEDS_DATA';
  if (score >= 16) return 'VERY_HIGH';
  if (score >= 10) return 'HIGH';
  if (score >= 5) return 'MODERATE';
  return 'LOW';
}

export interface IndicatorRow {
  slug: string;
  labelTh: string;
  labelEn: string;
  descriptionTh: string;
  descriptionEn: string;
  formula: string;
  warnThreshold: number;
  criticalThreshold: number;
  alarmDirection: string;
  methodologyVersion: string;
  latestBreaches: { critical: number; warn: number; ok: number; total: number };
}

export interface IndicatorsResponse {
  indicators: IndicatorRow[];
  methodologyVersion: string;
}

export interface DriversResponse {
  methodology: { version: string; docPath: string };
  cohort: { yearlyDeclinePct: number; fiveYearProjectionPct: number; source: string };
  automationRisk: {
    total: number;
    counts: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN', number>;
    sampleByTier: Record<'LOW' | 'MEDIUM' | 'HIGH', Array<{ id: string; nameEn: string; nameTh: string }>>;
  };
  competitiveness: { programsRankedCount: number; level: string };
}

export interface ProgramProfileResponse {
  program: {
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    facultyId: string;
    facultyNameTh: string;
    facultyNameEn: string;
    level: string;
    durationYears: number | null;
    totalCredits: number | null;
    recruitmentSummaryTh: string | null;
  };
  latestAssessment: {
    id: string;
    assessedAt: string;
    l1RecruitmentScore: number | null;
    l1RecruitmentConfidence: number | null;
    l2AiDisruptionScore: number | null;
    l2AiDisruptionConfidence: number | null;
    l3DemographicScore: number | null;
    l3DemographicConfidence: number | null;
    composite: number | null;
    tier: RiskTier;
    directRevenueAtRiskThb: number | null;
    strandedCostThb: number | null;
    impactScore: number | null;
    likelihoodBin: number | null;
    impactBin: number | null;
    kkuMatrixScore: number | null;
    kkuRiskLevel: KkuRiskLevel;
    narrativeTh: string | null;
    narrativeEn: string | null;
    dataGaps: Array<{ field: string; reason: string }> | null;
    methodologyVersion: string;
    confidence: number | null;
    measures: Array<{
      id: string;
      kind: RiskMeasureKind;
      titleTh: string;
      titleEn: string;
      rationaleTh: string;
      rationaleEn: string | null;
      costClass: string | null;
      horizon: RiskMeasureHorizon;
      expectedDeltaThb: number | null;
      priority: number;
      status: RiskMeasureStatus;
      decisionId: string | null;
      evidence: unknown;
    }>;
  } | null;
  history: Array<{ id: string; assessedAt: string; composite: number | null; tier: RiskTier }>;
  indicatorStatus: Array<{
    slug: string;
    labelEn: string;
    labelTh: string;
    severity: RiskIndicatorSeverity | null;
    value: number | null;
    warnThreshold: number;
    criticalThreshold: number;
    alarmDirection: string;
    observedAt: string | null;
  }>;
  tcasYears: Array<{
    year: number;
    plan: number | null;
    applicants: number | null;
    reported: number | null;
    /** True for the BE cohort still being filled. Counts are partial — excluded from L1/KRIs/percentile. */
    inProgress: boolean;
  }>;
  skillAutomation: {
    total: number;
    counts: { LOW: number; MEDIUM: number; HIGH: number; UNKNOWN: number };
    weightedShares: { LOW: number; MEDIUM: number; HIGH: number; UNKNOWN: number };
    topHighRiskSkills: Array<{ skillId: string; nameEn: string; nameTh: string; weight: number }>;
  };
  universityAverages: UniversityAverages;
  l2Breakdown: {
    overallScore: number | null;
    composition: Array<{
      key: 'skillPressure' | 'readinessDeficit' | 'disruptionSignal';
      value: number;
      weight: number;
    }>;
    readinessRelevanceScore: number | null;
    readinessSummary: string | null;
    readinessMethodVersion: string | null;
    topGaps: Array<{ topic: string; severity: 'major' | 'moderate' | 'minor'; observation: string }>;
    topRecommendations: Array<{
      priority: 'high' | 'medium' | 'low';
      title: string;
      detail: string;
    }>;
  };
}

export const TIER_TONE: Record<RiskTier, string> = {
  NEEDS_DATA: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
  LOW: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  MODERATE: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  HIGH: 'bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/30',
  CRITICAL: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

// Composite tier label — DESCRIBES LIKELIHOOD ONLY (max of L1/L2/L3 drivers).
// Risk = Likelihood × Impact, but this tier doesn't include impact — that's
// what the KKU/ERM 5×5 score is for. Naming the tier "X likelihood" rather
// than "X risk" prevents confusion when (e.g.) composite is MODERATE but
// the program's financial exposure is small → ERM band ends up LOW.
export const TIER_LABEL: Record<RiskTier, string> = {
  NEEDS_DATA: 'Needs more data',
  LOW: 'Low likelihood',
  MODERATE: 'Moderate likelihood',
  HIGH: 'High likelihood',
  CRITICAL: 'Critical likelihood',
};

export const TIER_FILL_HEX: Record<RiskTier, string> = {
  NEEDS_DATA: 'rgb(100 116 139)',
  LOW: 'rgb(16 185 129)',
  MODERATE: 'rgb(251 191 36)',
  HIGH: 'rgb(249 115 22)',
  CRITICAL: 'rgb(244 63 94)',
};

export const MEASURE_KIND_LABEL: Record<RiskMeasureKind, string> = {
  CURRICULUM_MODERNIZE: 'Modernise curriculum',
  CURRICULUM_DIFFERENTIATE: 'Differentiate offering',
  RECRUITMENT_CHANNEL: 'Recruitment channel',
  RECRUITMENT_TARGETING: 'Audience targeting',
  COHORT_REDUCTION: 'Reduce cohort size',
  PROGRAM_MERGE: 'Merge with another program',
  PROGRAM_PHASE_OUT: 'Phase out',
  PARTNERSHIP_INDUSTRY: 'Industry partnership',
  FACULTY_HIRE: 'Hire specialist faculty',
  TUITION_ADJUST: 'Adjust tuition',
};

// ─── Self-competition (program-overlap spec §10.2) ──────────────────────
// Type-only re-export of GET /risks/self-competition's row shape — erased at
// compile time, so no Prisma reaches the client bundle.
export type { SelfCompetitionKri, SelfCompetitionRow } from '@kku/db';
