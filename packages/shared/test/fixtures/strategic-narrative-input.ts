import type { ProgramStrategicNarrativeInput } from '../../src/ai/prompts/program-strategic-narrative';

// ─────────────────────────────────────────────────────────────────────────────
// Hand-written synthetic fixture for program-strategic-narrative.v2 builder
// tests. Covers every channel the builder can render (including the five
// added in v2) with plausible magnitudes. Not captured data — no PII, no
// real program identity.
// ─────────────────────────────────────────────────────────────────────────────

export const FIXTURE_INPUT: ProgramStrategicNarrativeInput = {
  programNameTh: 'หลักสูตรวิทยาศาสตรบัณฑิต สาขาวิชาวิทยาการคอมพิวเตอร์ประยุกต์',
  programNameEn: 'Bachelor of Science in Applied Computer Science',
  programLevel: 'BACHELOR',
  programFaculty: 'Faculty of Science',
  programDurationYears: 4,
  yearEstablished: 2005,
  lifecycle: {
    verdict: 'STABLE',
    trajectoryScore: 58,
  },
  health: {
    overallScore: 64.2,
    attractiveness: 71.0,
    financial: 55.5,
    capability: 68.0,
    outcomes: 62.3,
    relevance: 60.1,
    completenessPct: 82,
  },
  aiReadiness: {
    overallScore: 57,
    curriculumIntegration: 48,
    skillResilience: 63,
    researchPresence: 41,
    aiSkillCount: 9,
    totalSkills: 34,
  },
  tcas: {
    latestYearBE: 2568,
    competitionRatio: 2.4,
    fillRate: 0.91,
    minScore: 62.5,
  },
  financial: {
    fiscalYear: 2568,
    tuitionRevenueThb: 8_400_000,
    netContributionPerStudent: 12_500,
    governmentFacultySubsidyThb: 3_100_000,
  },
  demand: {
    anchorEntryYearBE: 2564,
    admittedTotal: 120,
    enrolled: 112,
    graduated: 94,
    droppedTotal: 14,
    stillEnrolled: 4,
  },
  demographic: {
    regionLabel: 'Northeast Thailand',
    requiredShareAt10Y: 0.00042,
    fifteenYearContractionPct: 22.5,
    riskLevel: 'medium',
  },
  peerReview: {
    contentModernityVerdict: 'IN_BETWEEN',
    topStrength: 'Strong applied-project component in years 3-4.',
    topWeakness: 'No dedicated MLOps or cloud-infrastructure course.',
    subjectBenchmarkSummary:
      'Comparable curricula at 3 ASEAN peer institutions include a capstone-linked industry practicum; KKU offers an elective, not a requirement.',
  },
  outcomes: {
    surveyYear: 2024,
    employmentRatePct: 87.5,
    averageSalaryThb: 22_400,
    furtherStudyRatePct: 8.1,
    sampleSize: 61,
  },
  demandMatch: {
    matchedDemanded: 14,
    relevantDemanded: 21,
    topUnmatchedSkills: [
      'Cloud infrastructure (IaC)',
      'MLOps',
      'Data engineering pipelines',
      'Container orchestration',
      'Site reliability engineering',
    ],
  },
  trendSignals: [
    {
      title: 'National AI workforce strategy sets 2027 upskilling target for public universities',
      signalType: 'POLICY',
      impactScorePct: 72,
      recommendation: 'Audit curriculum against the ministry AI-literacy baseline by Q2 2027.',
    },
    {
      title: 'Regional employers report rising demand for cloud-native graduates',
      signalType: 'MARKET',
      impactScorePct: 65,
      recommendation: 'Add a cloud-infrastructure elective within two admissions cycles.',
    },
  ],
  risk: {
    compositeScore: 47,
    topLikelihoodDriver: 'L2 AI-disruption (share of taught skills at high automation risk)',
    topImpactDimension: 'direct revenue at risk',
  },
  cohorts: {
    totalActive: 410,
    delayedSharePct: 11.2,
  },
};
