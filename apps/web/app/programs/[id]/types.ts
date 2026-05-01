// Shape-only types mirroring @kku/db's program-deep-dive exports so
// the client can import without pulling Prisma.

export interface DeepDiveOverview {
  program: {
    id: string;
    code: string;
    nameEn: string;
    nameTh: string;
    level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
    status: 'ACTIVE' | 'PAUSED' | 'SUNSET';
    yearEstablished: number | null;
    faculty: { id: string; nameEn: string; nameTh: string };
    department: { id: string; nameEn: string; nameTh: string } | null;
  };
  health: {
    scopeLabel: string;
    methodologyVersion: string;
    dimensions: {
      demand: HealthCell;
      financial: HealthCell;
      quality: HealthCell;
      relevance: HealthCell;
      capability: HealthCell;
    };
    overall: HealthCell;
    latestFreshness: string | null;
  } | null;
  methodologyVersion: string;
}

export interface HealthCell {
  score: number | null;
  dataCompletenessPct: number;
  drivers: Array<{ label: string; value: number | null }>;
}

export interface DeepDiveDemandFunnel {
  stages: Array<{ key: string; label: string; value: number }>;
  conversions: Array<{ fromKey: string; toKey: string; rate: number | null }>;
  fiveYearTrend: Array<{
    year: number;
    applications: number | null;
    admitted: number | null;
    enrolled: number | null;
    retainedYear2: number | null;
    graduatedOnTime: number | null;
  }>;
  latestFreshness: string | null;
  benchmarks: {
    faculty: { admissionYield: number | null; year2Retention: number | null } | null;
    university: { admissionYield: number | null; year2Retention: number | null } | null;
  } | null;
}

export interface DeepDiveFinancials {
  waterfall: Array<{ label: string; value: number; kind: 'positive' | 'negative' | 'total' }>;
  trend: Array<{ year: number; tuitionRevenue: number | null; totalCost: number | null; netContribution: number | null }>;
  costPerStudent: number | null;
  sensitivity: {
    tuitionPlus5Pct: { tuitionRevenue: number; netContribution: number };
  } | null;
  costMethodologyVersion: string;
  latestFreshness: string | null;
}

export interface DeepDiveSkills {
  taught: Array<{ skillId: string; nameEn: string; nameTh: string; category: string | null; weight: number }>;
  demanded: Array<{ skillId: string; nameEn: string; nameTh: string; category: string | null; jobCount: number }>;
  gaps: Array<{ skillId: string; nameEn: string; nameTh: string; jobCount: number }>;
  surplus: Array<{ skillId: string; nameEn: string; nameTh: string; weight: number }>;
  matchScore: number;
}

export interface DeepDiveOutcomes {
  latest: {
    graduationYear: number;
    employmentRate: number;
    averageSalary: number;
    jobRelevanceScore: number;
    furtherStudyRate: number;
    sampleSize: number;
    freshnessDate: string;
    methodologyVersion: string;
  } | null;
  salaryTrajectory: Array<{ graduationYear: number; averageSalary: number }>;
  topEmployers: Array<{ name: string; year: number; satisfactionScore: number }>;
}

export interface DeepDiveFaculty {
  visibility: 'full' | 'aggregates-only';
  totalActive: number;
  ranks: Record<string, number>;
  averageAgeYears: number | null;
  retiringWithin5Years: number;
  successionRiskPct: number;
  members: Array<{
    id: string;
    rank: string;
    nameEn: string | null;
    nameTh: string | null;
    employeeCode: string | null;
    specialization: string | null;
    retirementDate: string | null;
  }>;
}

export interface DeepDivePeers {
  peers: Array<{
    id: string;
    institution: string;
    country: string;
    programName: string;
    programLevel: string;
    ranking: number | null;
    descriptionUrl: string | null;
  }>;
}

export interface DeepDiveTrends {
  signals: Array<{
    id: string;
    title: string;
    signalType: 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';
    summaryTh: string | null;
    summaryEn: string | null;
    sourceUrl: string | null;
    detectedDate: string;
    impactScore: number;
    isTargetedAtProgram: boolean;
  }>;
}

export interface DeepDiveDecisions {
  decisions: Array<{
    id: string;
    decisionType: string;
    status: string;
    rationaleTh: string | null;
    rationaleEn: string | null;
    effectiveDate: string | null;
    decidedBy: string;
    createdAt: string;
  }>;
  annotations: Array<{
    id: string;
    kind: string;
    sectionKey: string | null;
    bodyTh: string | null;
    bodyEn: string | null;
    author: string;
    createdAt: string;
  }>;
}
