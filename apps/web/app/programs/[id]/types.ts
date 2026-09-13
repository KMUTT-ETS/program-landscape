// Shape-only types mirroring @kku/db's program-deep-dive exports so
// the client can import without pulling Prisma.

export interface DeepDiveStrategicNarrative {
  contentMarkdown: string;
  confidence: number;
  methodVersion: string;
  generatedAt: string;
}

// ─── Research expertise (program-research-expertise.v1) ─────────────────

export interface DeepDiveResearchExpertiseTheme {
  name: string;
  paperCount: number;
  /** 2-3 verbatim titles drawn from the roster's actual publications. */
  exampleTitles: string[];
  yearSpan: string;
  trend: 'rising' | 'steady' | 'fading';
  evidenceNote: string;
}

export interface DeepDiveResearchExpertiseRecommendation {
  action: string;
  rationale: string;
  horizonMonths: number;
  /** Theme name(s) (matching a `themes[].name`) this recommendation builds on. */
  themeRefs: string[];
}

export interface DeepDiveResearchExpertisePayload {
  themes: DeepDiveResearchExpertiseTheme[];
  recommendations: {
    curriculum: DeepDiveResearchExpertiseRecommendation[];
    positioning: DeepDiveResearchExpertiseRecommendation[];
    research: DeepDiveResearchExpertiseRecommendation[];
  };
  caveats: string[];
  confidence: number;
}

export interface DeepDiveResearchExpertiseResult {
  payload: DeepDiveResearchExpertisePayload;
  methodVersion: string;
  generatedAt: string;
  analysedPaperCount: number;
  totalDistinctPapers: number;
}

export type DeepDiveResearchExpertiseVerdict = 'ok' | 'thin' | 'no-roster';

export interface DeepDiveResearchExpertiseReadiness {
  rosterSize: number;
  distinctPaperCount: number;
  readiness: DeepDiveResearchExpertiseVerdict;
}

/** GET /programs/:id/research-expertise — `result` is null until a brief
 *  has been generated (`pnpm expertise:generate`); `readiness` explains
 *  why (no curated roster / roster too thin / just not generated yet). */
export interface DeepDiveResearchExpertise {
  result: DeepDiveResearchExpertiseResult | null;
  readiness: DeepDiveResearchExpertiseReadiness | null;
}

export interface DeepDiveAiReadinessGap {
  topic: string;
  severity: 'major' | 'moderate' | 'minor';
  observation: string;
  peerReference: string | null;
}

export interface DeepDiveAiReadinessRecommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  effortHorizon: 'short' | 'medium' | 'long';
}

export interface DeepDiveAiReadiness {
  overallScore: number;
  subScores: {
    curriculumIntegration: number;
    skillResilience: number;
    researchPresence: number;
    pedagogicalReadiness: number | null;
  };
  skillBreakdown: {
    aiNative: number;
    aiAugmented: number;
    aiDisplaceable: number;
    neutral: number;
  };
  aiPublicationsLast3Years: number;
  totalPublicationsLast3Years: number;
  gaps: DeepDiveAiReadinessGap[];
  recommendations: DeepDiveAiReadinessRecommendation[];
  summary: string;
  methodologyVersion: string;
  generatedAt: string;
}

export type DeepDiveLifecycleVerdict = 'SUNSET' | 'STABLE' | 'RISING' | 'FRONTIER';

export interface DeepDiveLifecycleDriver {
  label: string;
  contribution: number;
  raw: unknown;
}

export type DeepDiveLifecycleGateName =
  | 'oldSchoolContentCap'
  | 'aiReadinessStableCap'
  | 'aiReadinessFrontierCap'
  | 'lowLabourMarketAlignmentStableCap'
  | 'lowLabourMarketAlignmentFrontierCap'
  | 'lowRevenuePotentialFrontierCap';

/** Gap #8 closure (lifecycle.v1.2): one modifier gate that capped the
 *  trajectory-score verdict. `from` is the counterfactual at that step. */
export interface DeepDiveLifecycleGateEffect {
  name: DeepDiveLifecycleGateName;
  from: DeepDiveLifecycleVerdict;
  to: DeepDiveLifecycleVerdict;
  reason: string;
}

export interface DeepDiveLifecycle {
  verdict: DeepDiveLifecycleVerdict;
  /** Counterfactual verdict from trajectory score alone, with gates
   *  skipped. Equals `verdict` when no gate fired. */
  ungatedVerdict: DeepDiveLifecycleVerdict;
  trajectoryScore: number;
  drivers: DeepDiveLifecycleDriver[];
  /** Modifier gates that fired, in application order. */
  gatesApplied: DeepDiveLifecycleGateEffect[];
  narrative: string;
  methodologyVersion: string;
  generatedAt: string;
}

export interface DeepDiveOverview {
  program: {
    id: string;
    code: string;
    nameEn: string;
    nameTh: string;
    level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
    status: 'ACTIVE' | 'PAUSED' | 'SUNSET';
    yearEstablished: number | null;
    curriculumYearBE: number | null;
    faculty: { id: string; nameEn: string; nameTh: string };
    department: { id: string; nameEn: string; nameTh: string } | null;
  };
  health: {
    scopeLabel: string;
    methodologyVersion: string;
    dimensions: {
      attractiveness: HealthCell;
      financial: HealthCell;
      capability: HealthCell;
      outcomes: HealthCell;
      relevance: HealthCell;
    };
    overall: HealthCell;
    latestFreshness: string | null;
  } | null;
  /** ISO timestamp (full DateTime, time-of-day preserved) of the most
   *  recent pipeline-output for this program. Drives the "Updated Xh
   *  ago" badge on the Health card. Distinct from
   *  `health.latestFreshness` which describes underlying registrar
   *  data vintage (a `@db.Date`, always midnight UTC). */
  lastAnalysedAt: string | null;
  /** Whether the analyses below predate the programme's current
   *  curriculum document. Optional on purpose — a response cached from
   *  before this field existed must render, not crash. `pendingAttachedAt`
   *  is a string, not a Date: it has crossed JSON to get here. */
  staleness?: {
    stale: boolean;
    reason: 'none' | 'unanalysed-revision' | 'superseded-document';
    pendingRevisionId: string | null;
    pendingCurriculumYearBE: number | null;
    pendingAttachedAt: string | null;
    /** True when no revision for this programme has ever completed
     *  analysis — i.e. this is the programme's first. Optional so an older
     *  cached response (from before this field existed) still renders. */
    isFirstAnalysis?: boolean;
  };
  methodologyVersion: string;
}

export interface HealthCell {
  score: number | null;
  dataCompletenessPct: number;
  /** Per-driver breakdown. `raw` carries the underlying numbers/payload
   *  used to compute the driver's score — surfaced in the deep-dive
   *  Health Score Breakdown panel so Council can audit the calculation. */
  drivers: Array<{ label: string; value: number | null; raw?: unknown }>;
}

/** Mean of program-level dimension scores (null dims excluded). */
export interface DeepDiveDimensionMeans {
  attractiveness: number | null;
  financial: number | null;
  capability: number | null;
  outcomes: number | null;
  relevance: number | null;
  sampleSize: number;
}

/** University + faculty program-level dimension averages overlaid on the
 *  Health radar. From GET /programs/:id/health-benchmarks. */
export interface DeepDiveHealthBenchmarks {
  methodologyVersion: string;
  programCount: number;
  university: DeepDiveDimensionMeans;
  faculty: DeepDiveDimensionMeans | null;
  facultyId: string | null;
  facultyNameTh: string | null;
}

export interface DeepDiveDemandFunnel {
  /** Entry year (BE) the funnel is anchored on. */
  anchorEntryYearBE: number | null;
  anchorEntryYearCE: number | null;
  /** True when the cohort has had time to complete (entry ≤ currentBE − duration − 1). */
  cohortCompleted: boolean;
  programDurationYears: number | null;
  stages: Array<{ key: string; label: string; value: number }>;
  conversions: Array<{ fromKey: string; toKey: string; rate: number | null }>;
  alumniBreakdown: Array<{ bucket: string; count: number; pct: number }>;
  stillEnrolledForAnchor: number;
  cohortTrend: Array<{
    entryYearBE: number;
    entryYearCE: number;
    admittedTotal: number;
    enrolled: number;
    stillEnrolled: number;
    graduated: number;
    droppedTotal: number;
    renouncedOrNoReport: number;
    cohortCompleted: boolean;
  }>;
  latestFreshness: string | null;
  benchmarks: {
    faculty: { admissionYield: number | null; year2Retention: number | null } | null;
    university: { admissionYield: number | null; year2Retention: number | null } | null;
  } | null;
  methodologyVersion: string;
}

export interface DeepDiveAiPeerEntry {
  rankInTier: number;
  institutionName: string;
  country: string;
  qsWorldRank: number | null;
  theWorldRank: number | null;
  qsAsiaRank: number | null;
  websiteUrl: string | null;
  peerProgramName: string;
  peerProgramUrl: string | null;
  rationale: string;
  confidence: number;
  subjectArea: string | null;
}

export interface DeepDiveAiPeerReviewBullet {
  claim: string;
  evidence: string;
}

export interface DeepDiveAiPeerReviewRecommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  effortHorizon: 'short' | 'medium' | 'long';
}

export interface DeepDivePeerReviewContentGap {
  topic: string;
  kkuStatus: string;
  peerExamples: string;
  severity: 'major' | 'moderate' | 'minor';
  recommendation: string;
}

export interface DeepDiveAiPeerReview {
  strengths: DeepDiveAiPeerReviewBullet[];
  weaknesses: DeepDiveAiPeerReviewBullet[];
  tierVerdicts: {
    WORLD: string;
    ASIA: string;
    SOUTHEAST_ASIA: string;
    THAILAND_PEER: string;
  };
  contentModernity: {
    verdict: 'OLD_SCHOOL' | 'IN_BETWEEN' | 'FRONTIER';
    narrative: string;
  } | null;
  contentGaps: DeepDivePeerReviewContentGap[] | null;
  recommendations: DeepDiveAiPeerReviewRecommendation[];
  subjectBenchmarkSummary: string;
  confidence: number;
  generatedAt: string;
  methodVersion: string;
  peerCountTotal: number;
}

export interface DeepDiveAiPeers {
  subjectSignature: string | null;
  tiers: {
    WORLD: DeepDiveAiPeerEntry[];
    ASIA: DeepDiveAiPeerEntry[];
    SOUTHEAST_ASIA: DeepDiveAiPeerEntry[];
    THAILAND_PEER: DeepDiveAiPeerEntry[];
  };
  selectedAt: string | null;
  rankingYear: number | null;
  review: DeepDiveAiPeerReview | null;
}

export interface DeepDiveTcasStats {
  history: Array<{
    entryYearBE: number;
    round: string;
    quota: number;
    applicants: number;
    admittedPass1: number;
    admittedPass2: number;
    competitionRatio: number;
    fillRate: number;
    minScorePass1: number | null;
    maxScorePass1: number | null;
    minScorePass2: number | null;
    maxScorePass2: number | null;
    sourceUrl: string;
  }>;
  peers: Array<{
    institutionName: string;
    facultyName: string | null;
    programmeName: string;
    entryYearBE: number;
    round: string;
    quota: number;
    applicants: number;
    competitionRatio: number;
    minScorePass1: number | null;
    maxScorePass1: number | null;
    matchTier: 'exact' | 'subject';
  }>;
  latestEntryYearBE: number | null;
  yearsObserved: number[];
  peerMatchKey: string | null;
}

export interface DeepDiveDemographicOutlook {
  catchmentRegion: 'Northeast' | 'TH';
  source: string;
  ageCohort: '18-22' | '23-29';
  baselineYearOneIntake: number | null;
  funnelBaseline: {
    entryYearBE: number;
    plan: number;
    applicants: number;
    reportedIn: number;
    reportedRate: number;
    competitionRatio: number;
  } | null;
  projections: Array<{
    year: number;
    cohortPopulation: number;
    cohortPopulationRegional: number | null;
    requiredShareOfCohort: number | null;
    cohortDeclinePct: number;
    projectedApplicants: number | null;
    competitionRatio: number | null;
    superCritical: boolean | null;
  }>;
  fifteenYearContraction: number;
  superCriticalYear: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
}

export interface DeepDiveStudentCohorts {
  cohorts: Array<{
    entryYearBE: number;
    entryYearCE: number;
    studentCount: number;
    yearInProgramme: number;
    status: 'incoming' | 'on-track' | 'delayed';
  }>;
  totalActive: number;
  currentAcademicYearBE: number;
  programDurationYears: number | null;
  incomingCount: number;
  onTrackCount: number;
  delayedCount: number;
  refreshedAt: string | null;
}

export interface DeepDiveFinancials {
  waterfall: Array<{ label: string; value: number; kind: 'positive' | 'negative' | 'total' }>;
  trend: Array<{
    year: number;
    tuitionRevenue: number | null;
    facultyCostSubsidy: number | null;
    netContribution: number | null;
  }>;
  /** The academic year (CE) the headline KPIs are sourced from — the
   *  latest one that has finished billing. Excludes the in-progress
   *  academic year (health-score.v3.9 / financial-year.ts). */
  latestFiscalYear: number | null;
  /** True when a more recent academic year exists in the data but is
   *  still being billed — an academic year's tuition straddles two
   *  fiscal-year cycles, so the in-progress year never has more than
   *  ~one semester collected regardless of how healthy the program is.
   *  Never promoted to `latestFiscalYear`; see `partialFiscalYear` +
   *  `partialTuitionRevenueSoFar` for the informational figure. */
  partialCurrentYearAvailable: boolean;
  /** The in-progress academic year (CE), when `partialCurrentYearAvailable`
   *  is true. Null otherwise. */
  partialFiscalYear: number | null;
  /** That in-progress year's tuition collected so far. Informational
   *  only — never enters the score or any figure above. Null when
   *  `partialCurrentYearAvailable` is false. */
  partialTuitionRevenueSoFar: number | null;
  /** Annual government-funded faculty salary subsidy for this program.
   *  Informational — NOT netted from tuition (Thai public university
   *  model: salaries paid from the government block grant).
   *  SUPERSEDED by `salaryByFunding` when present (more accurate split). */
  governmentFacultySubsidy: number | null;
  /** Government investment per enrolled student per year. */
  costPerStudent: number | null;
  /** Enrolment-weighted salary breakdown by funding source (kku-hr cube).
   *  Multi-program staff: contribution to THIS program is weighted by
   *  share of enrolment across all programs they teach. */
  salaryByFunding: {
    methodologyVersion: string;
    totalAnnualThb: number;
    contributingMembers: number;
    unresolvedMembers: number;
    sourceFiscalYear: number | null;
    entries: Array<{
      salType: string;
      annualThb: number;
      share: number;
    }>;
  } | null;
  sensitivity: {
    tuitionPlus5Pct: { tuitionRevenue: number; netContribution: number };
  } | null;
  costMethodologyVersion: string;
  latestFreshness: string | null;
}

export interface DeepDiveSkills {
  taught: Array<{
    skillId: string;
    nameEn: string;
    nameTh: string;
    category: string | null;
    weight: number;
    /** Aggregate signal from compulsory courses + PLOs (MAJOR contribution). */
    compulsoryWeight: number | null;
    /** Aggregate signal from elective courses (MINOR contribution). */
    electiveWeight: number | null;
    /** True when this skill appears in a Program Learning Outcome. */
    pickedFromPlo: boolean;
    /** Verbatim PLO/course quote justifying the mapping. */
    evidenceQuote: string | null;
  }>;
  /** Skills with MAJOR contribution (PLO-tagged or compulsory ≥ 0.5). */
  majorContributorCount: number;
  /** Skills with MINOR contribution (elective only / compulsory < 0.5, no PLO). */
  minorContributorCount: number;
  /** How many taught skills are explicitly tagged in PLOs. */
  ploSkillCount: number;
  demanded: Array<{
    skillId: string;
    nameEn: string;
    nameTh: string;
    category: string | null;
    /** Peak demand share across this program's target careers. */
    peakDemandPct: number;
    /** Number of target careers where this skill clears threshold. */
    careerCount: number;
    /** AI-determined: does the curriculum teach this demanded skill? */
    curriculumMatched: boolean | null;
    /** 'plo' | 'course' | 'extracted-skill' | 'unmatched' | null. */
    matchSource: string | null;
    /** 0..1 strength of curriculum coverage. */
    relatedness: number | null;
    /** Verbatim PLO/course quote evidence (when matched). */
    evidenceQuote: string | null;
    fit?: DemandSkillFit | null;
    fitReason?: string | null;
  }>;
  gaps: Array<{ skillId: string; nameEn: string; nameTh: string; peakDemandPct: number; careerCount: number }>;
  surplus: Array<{
    skillId: string;
    nameEn: string;
    nameTh: string;
    weight: number;
    compulsoryWeight: number | null;
    pickedFromPlo: boolean;
  }>;
  matchScore: number;
  demandSource: string;
  /** Tier of the fallback chain that produced the demand rows.
   *  'thailand-job-postings' is preferred; 'global-*' fires when Thai
   *  data is sparse for the program's career set. */
  demandTier: string;
  /** Number of labour-market careers the demand was filtered to.
   *  0 = no career mapping yet → shows "unfiltered" banner. */
  careerFilterCount: number;
  careerFilterIds: number[];
  /** Domestic demand (JobThai), rendered behind a source toggle — never blended with LinkedIn. */
  jobThai: DeepDiveJobThaiSkills;
}

export interface DeepDiveJobThaiSkills {
  /** 'no-links' and 'below-floor' are data gaps, not zero demand. */
  status: 'ok' | 'no-links' | 'below-floor';
  postings: number;
  occupationCount: number;
  occupations: Array<{ category: string; subcategory: string; postingCount: number; linkScore: number }>;
  /** True once the AI curriculum check has run against JobThai demand. */
  aiComputed: boolean;
  /** Same figure as the jobthai_demand_alignment health driver; null before the AI check. */
  matchScore: number | null;
  /** Relevant demanded skills the score rests on. */
  relevantCount: number;
  /** Below this many relevant skills matchScore is null — the ratio is unstable. */
  minRelevantSkills: number;
  demanded: Array<{
    skillId: string;
    nameEn: string;
    nameTh: string;
    category: string | null;
    /** % of the linked postings naming this skill. */
    demandPct: number;
    occupationCount: number;
    curriculumMatched: boolean | null;
    relevant: boolean | null;
    fit: DemandSkillFit | null;
    fitReason: string | null;
    matchSource: string | null;
    evidenceQuote: string | null;
  }>;
  /** Other degree fields employers accept for the same jobs (fit = other-profession). */
  alsoAccepted: Array<{ skillId: string; nameEn: string; nameTh: string; fitReason: string | null }>;
  generic: Array<{ skillId: string; nameEn: string; nameTh: string; demandPct: number }>;
  gaps: Array<{ skillId: string; nameEn: string; nameTh: string; demandPct: number; occupationCount: number; fit: DemandSkillFit | null; fitReason: string | null }>;
  surplus: Array<{ skillId: string; nameEn: string; nameTh: string; pickedFromPlo: boolean }>;
}

/** demand-match.v4 — how a demanded skill fits the programme's profession. */
export type DemandSkillFit = 'core' | 'supporting' | 'other-profession' | 'not-relevant' | 'uncertain';

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
  /** Where the roster came from. `program` = program-specific link table;
   *  `department` = all FacultyMembers in the program's department;
   *  `faculty` = all FacultyMembers in the parent Faculty (broadest
   *  fallback when no per-program/per-department roster exists). */
  rosterScope: 'program' | 'department' | 'faculty';
  totalActive: number;
  ranks: Record<string, number>;
  averageAgeYears: number | null;
  retiringWithin5Years: number;
  successionRiskPct: number;
  totalPublications: number;
  /** Share of the roster's publication record that came from the on-demand
   *  Google Scholar import rather than the scheduled library pipeline.
   *  Mirrors `ResearchSourceComposition` in `@kku/db`. */
  researchSourceComposition: {
    staffOnScholar: number;
    staffWithResearch: number;
    papersFromScholar: number;
    papersTotal: number;
    /** Library rows a Scholar import has raised the citations of. Non-zero
     *  means Scholar has reached even the analyses that filter its rows out. */
    libraryPapersTouchedByScholar: number;
    denominator: string;
  };
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

// ─── Recruitment funnel (TcasAdmissionFunnel — full TCAS round 1–4) ─────────

export interface DeepDiveRecruitmentRoundRow {
  round: string;
  enrollSeats: number | null;
  planPerYear: number | null;
  totalApplicants: number | null;
  totalPassed: number | null;
  sendClearinghouse: number | null;
  confirmClearinghouse: number | null;
  sendRegReported: number | null;
  regReported: number | null;
}

export interface DeepDiveRecruitmentYearTotals {
  entryYearBE: number;
  entryYearCE: number;
  isComplete: boolean;
  planPerYear: number | null;
  enrollSeats: number;
  totalApplicants: number;
  totalPassed: number;
  sendClearinghouse: number;
  confirmClearinghouse: number;
  sendRegReported: number;
  regReported: number;
  competitionRatio: number | null;
  overAllocationFactor: number | null;
  fillRateVsPlan: number | null;
  registrationYield: number | null;
  rounds: number;
}

export interface DeepDiveRecruitment {
  programId: string;
  byYear: DeepDiveRecruitmentYearTotals[];
  latestRounds: { entryYearBE: number; rounds: DeepDiveRecruitmentRoundRow[] } | null;
  inProgressRounds: { entryYearBE: number; rounds: DeepDiveRecruitmentRoundRow[] } | null;
  methodologyVersion: string;
}

// v1.2.9 — per-program course list from program-courses-extract.v1
// joined with class_offerings grade-distribution aggregates. Only
// courses with non-null classGpa in the selected semester window
// appear; the deep-dive surfaces only courses where we have
// verifiable GPA data.
export interface DeepDiveCourseYearCell {
  classCount: number;
  gradedCount: number;
  averageClassGpa: number | null;
}

export interface DeepDiveCourseRow {
  courseCode: string;
  courseNameTh: string;
  courseNameEn: string;
  credits: number | null;
  classCount: number;
  gradedCount: number;
  classGpa: number;
  /** Per-year cell keyed by ACADYEAR_BE. UI renders as columns. */
  byYear: Record<string, DeepDiveCourseYearCell>;
}

export interface DeepDiveCourses {
  methodVersion: string;
  /** Number of rows returned (= courses with GPA data in the window). */
  total: number;
  /** Total program_courses on file (some without GPA data); the UI
   *  uses the gap (extractedCount - total) for context. */
  extractedCount: number;
  rows: DeepDiveCourseRow[];
  /** Sorted ascending; UI uses for column headers. */
  yearsObserved: number[];
  windowYearsBE: { start: number | null; end: number | null };
  /** Semesters that filtered the aggregate (default [1, 2]). */
  semestersApplied: number[];
}

// ─── Curriculum revision (program-curriculum-revision.v1) ───────────────

export interface DeepDiveCurriculumEnhance {
  courseCode: string;
  courseNameTh: string;
  /** Verbatim from the course's own Thai description. Empty when the model
   *  paraphrased and the validator blanked it. */
  currentlyCoversQuote: string;
  themeRefs: string[];
  addition: string;
  additionDetail: string;
  effort: 'MINOR' | 'MODERATE' | 'MAJOR';
  evidencePaperTitles: string[];
}

export interface DeepDiveCurriculumNewCourse {
  titleTh: string;
  titleEn: string;
  credits: number;
  placementYear: number;
  placementSemester: number;
  themeRefs: string[];
  rationale: string;
  couldBeTaughtBy: Array<{ name: string; rank: string }>;
  evidencePaperTitles: string[];
}

export interface DeepDiveCurriculumPromotion {
  courseCode: string;
  courseNameTh: string;
  currentCategory: string;
  proposedCategory: string;
  themeRefs: string[];
  rationale: string;
}

export interface DeepDiveCurriculumRevisionPayload {
  coverageSummary: {
    themesTotal: number;
    themesReflectedInCurriculum: number;
    themesAbsent: string[];
    narrative: string;
  };
  enhanceCourses: DeepDiveCurriculumEnhance[];
  newCourseProposals: DeepDiveCurriculumNewCourse[];
  promotionCandidates: DeepDiveCurriculumPromotion[];
  confidence: number;
  caveats: string[];
}

/** GET /programs/:id/curriculum-revision — `result` is null until the
 *  advice has been generated (`pnpm curriculum:revision-generate`);
 *  `readiness` explains why (no research analysis to derive from / no
 *  extracted course list / just not generated yet). */
export interface DeepDiveCurriculumRevision {
  result: {
    payload: DeepDiveCurriculumRevisionPayload;
    methodVersion: string;
    generatedAt: string;
    courseCount: number;
    /** How many of `courseCount` carry a curriculum category. Zero means
     *  the promotion lane could not be answered at all — a missing input,
     *  not a finding that no course qualifies. */
    coursesWithCategory: number;
  } | null;
  readiness: {
    readiness: 'ok' | 'thin' | 'no-research' | 'no-courses';
    courseCount: number;
    distinctPaperCount: number;
  };
}
