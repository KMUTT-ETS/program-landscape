import { z } from 'zod';

// Internal-use program detail report. Pure tabular layout — every
// section is a table with explicit column headers. This is NOT a
// Council-facing brief; it's the analyst working document that puts
// every deep-dive datum into one PDF, formatted for fast tabular
// scanning. The controller pre-formats every field as a string so the
// template stays minimal.

const KvRowSchema = z.object({
  metric: z.string(),
  value: z.string(),
  notes: z.string().default(''),
});

const HealthDimRowSchema = z.object({
  dimension: z.string(),
  score: z.string(),
  dataCompleteness: z.string(),
  topDriver: z.string(),
});

const HealthDriverRowSchema = z.object({
  dimension: z.string(),
  driver: z.string(),
  value: z.string(),
});

const LifecycleSchema = z.object({
  verdict: z.string(),
  trajectoryScore: z.string(),
  methodologyVersion: z.string(),
  generatedAt: z.string(),
  narrative: z.string().default(''),
  drivers: z
    .array(
      z.object({
        direction: z.enum(['lifting', 'drag']),
        label: z.string(),
        contribution: z.string(),
      }),
    )
    .default([]),
});

const StrategicNarrativeSchema = z.object({
  contentMarkdown: z.string(),
  methodVersion: z.string(),
  confidencePct: z.string(),
  generatedAt: z.string(),
});

const AiReadinessSchema = z.object({
  overallScore: z.string(),
  verdict: z.string(),
  summary: z.string().default(''),
  methodologyVersion: z.string(),
  subScores: z.array(KvRowSchema).default([]),
  skillBreakdown: z
    .array(
      z.object({
        category: z.string(),
        count: z.string(),
        share: z.string(),
      }),
    )
    .default([]),
  gaps: z
    .array(
      z.object({
        topic: z.string(),
        severity: z.string(),
        observation: z.string(),
        peerReference: z.string().default(''),
      }),
    )
    .default([]),
  recommendations: z
    .array(
      z.object({
        priority: z.string(),
        title: z.string(),
        detail: z.string(),
        effortHorizon: z.string(),
      }),
    )
    .default([]),
});

const DemandFunnelSchema = z.object({
  anchorEntryYearLabel: z.string(),
  cohortStatus: z.string(),
  programDurationYears: z.string(),
  methodologyVersion: z.string(),
  stages: z
    .array(
      z.object({
        stage: z.string(),
        value: z.string(),
      }),
    )
    .default([]),
  conversions: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        rate: z.string(),
      }),
    )
    .default([]),
  alumniBreakdown: z
    .array(
      z.object({
        bucket: z.string(),
        count: z.string(),
        share: z.string(),
      }),
    )
    .default([]),
  cohortTrend: z
    .array(
      z.object({
        cohortBE: z.string(),
        admitted: z.string(),
        enrolled: z.string(),
        graduated: z.string(),
        dropped: z.string(),
        completed: z.string(),
      }),
    )
    .default([]),
});

const RecruitmentSchema = z.object({
  methodologyVersion: z.string(),
  inProgressNote: z.string().default(''),
  byYear: z
    .array(
      z.object({
        yearBE: z.string(),
        status: z.string(),
        planPerYear: z.string(),
        seats: z.string(),
        overAllocation: z.string(),
        applicants: z.string(),
        competition: z.string(),
        passed: z.string(),
        confirmCh: z.string(),
        reported: z.string(),
        vsPlan: z.string(),
      }),
    )
    .default([]),
  latestRoundsYear: z.string().default(''),
  latestRounds: z
    .array(
      z.object({
        round: z.string(),
        seats: z.string(),
        applicants: z.string(),
        passed: z.string(),
        confirmCh: z.string(),
        reported: z.string(),
      }),
    )
    .default([]),
});

const TcasSchema = z.object({
  history: z
    .array(
      z.object({
        yearRound: z.string(),
        quota: z.string(),
        applicants: z.string(),
        competition: z.string(),
        fillRate: z.string(),
        minScore: z.string(),
        maxScore: z.string(),
      }),
    )
    .default([]),
  peers: z
    .array(
      z.object({
        match: z.string(),
        institution: z.string(),
        programme: z.string(),
        quota: z.string(),
        applicants: z.string(),
        competition: z.string(),
        minScore: z.string(),
      }),
    )
    .default([]),
  peerMatchKey: z.string().default(''),
});

const CohortDistributionSchema = z.object({
  totalActive: z.string(),
  currentAcademicYearBE: z.string(),
  programDurationYears: z.string(),
  summary: z.array(KvRowSchema).default([]),
  rows: z
    .array(
      z.object({
        cohort: z.string(),
        yearInProgram: z.string(),
        status: z.string(),
        students: z.string(),
        share: z.string(),
      }),
    )
    .default([]),
});

const DemographicSchema = z.object({
  catchment: z.string(),
  ageCohort: z.string(),
  source: z.string(),
  baselineYearOneIntake: z.string(),
  fifteenYearContraction: z.string(),
  riskLevel: z.string(),
  projections: z
    .array(
      z.object({
        year: z.string(),
        cohortPopulation: z.string(),
        decline: z.string(),
        shareNeeded: z.string(),
      }),
    )
    .default([]),
});

const OutcomesSchema = z.object({
  surveyYear: z.string(),
  methodologyVersion: z.string(),
  freshnessDate: z.string(),
  sampleSize: z.string(),
  summary: z.array(KvRowSchema).default([]),
  salaryTrajectory: z
    .array(z.object({ year: z.string(), salary: z.string() }))
    .default([]),
  topEmployers: z
    .array(
      z.object({
        employer: z.string(),
        year: z.string(),
        satisfaction: z.string(),
      }),
    )
    .default([]),
});

const SkillsSchema = z.object({
  matchScore: z.string(),
  demandSource: z.string(),
  demandTier: z.string(),
  careerFilterCount: z.string(),
  totalTaught: z.string(),
  ploCount: z.string(),
  major: z
    .array(
      z.object({
        skill: z.string(),
        plo: z.string(),
        compulsoryWeight: z.string(),
        electiveWeight: z.string(),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
  minor: z
    .array(
      z.object({
        skill: z.string(),
        electiveWeight: z.string(),
      }),
    )
    .default([]),
  demanded: z
    .array(
      z.object({
        skill: z.string(),
        peakDemand: z.string(),
        careerCount: z.string(),
        match: z.string(),
      }),
    )
    .default([]),
  gaps: z
    .array(
      z.object({
        skill: z.string(),
        peakDemand: z.string(),
        careerCount: z.string(),
      }),
    )
    .default([]),
});

const FacultySchema = z.object({
  rosterScope: z.string(),
  visibility: z.string(),
  kpis: z.array(KvRowSchema).default([]),
  rankDistribution: z
    .array(
      z.object({
        rank: z.string(),
        count: z.string(),
        share: z.string(),
      }),
    )
    .default([]),
  roster: z
    .array(
      z.object({
        rank: z.string(),
        name: z.string(),
        specialization: z.string().default(''),
        retires: z.string().default(''),
      }),
    )
    .default([]),
});

const FinancialsSchema = z.object({
  methodologyVersion: z.string(),
  headlineFiscalYear: z.string(),
  partialCurrentYearNote: z.string().default(''),
  kpis: z.array(KvRowSchema).default([]),
  waterfall: z
    .array(
      z.object({
        step: z.string(),
        kind: z.string(),
        value: z.string(),
      }),
    )
    .default([]),
  sensitivity: z.string().default(''),
  trend: z
    .array(
      z.object({
        year: z.string(),
        tuition: z.string(),
        subsidy: z.string(),
        net: z.string(),
      }),
    )
    .default([]),
});

const PeerTierSchema = z.object({
  tier: z.string(),
  entries: z
    .array(
      z.object({
        rank: z.string(),
        institution: z.string(),
        country: z.string(),
        qsWorld: z.string(),
        programme: z.string(),
      }),
    )
    .default([]),
});

const PeersSchema = z.object({
  subjectSignature: z.string().default(''),
  rankingYear: z.string().default(''),
  tiers: z.array(PeerTierSchema).default([]),
  aiReview: z
    .object({
      confidencePct: z.string(),
      strengths: z.array(z.object({ claim: z.string() })).default([]),
      weaknesses: z.array(z.object({ claim: z.string() })).default([]),
      contentModernity: z
        .object({ verdict: z.string(), narrative: z.string() })
        .nullable()
        .default(null),
      summary: z.string().default(''),
    })
    .nullable()
    .default(null),
  curatedPeers: z
    .array(
      z.object({
        institution: z.string(),
        country: z.string(),
        programName: z.string(),
        ranking: z.string(),
      }),
    )
    .default([]),
});

const TrendsRowSchema = z.object({
  title: z.string(),
  type: z.string(),
  targeted: z.string(),
  impact: z.string(),
  recommendation: z.string(),
  detected: z.string(),
  rationale: z.string().default(''),
  summary: z.string().default(''),
});

const DecisionsRowSchema = z.object({
  decisionType: z.string(),
  status: z.string(),
  decidedBy: z.string(),
  createdAt: z.string(),
  effectiveDate: z.string().default(''),
  rationale: z.string().default(''),
});

export const ProgramDetailDataSchema = z.object({
  // Cover
  programCode: z.string(),
  nameTh: z.string(),
  nameEn: z.string(),
  level: z.string(),
  status: z.string(),
  facultyTh: z.string(),
  facultyEn: z.string(),
  departmentTh: z.string().default(''),
  departmentEn: z.string().default(''),
  yearEstablished: z.string().default(''),
  dateLabel: z.string(),
  generatedAtLabel: z.string(),
  methodologyVersion: z.string(),

  // Body
  executiveSnapshot: z.array(KvRowSchema).default([]),
  healthDimensions: z.array(HealthDimRowSchema).default([]),
  healthDrivers: z.array(HealthDriverRowSchema).default([]),
  healthMethodologyVersion: z.string().default(''),
  lifecycle: LifecycleSchema.nullable().default(null),
  strategicNarrative: StrategicNarrativeSchema.nullable().default(null),
  aiReadiness: AiReadinessSchema.nullable().default(null),
  demandFunnel: DemandFunnelSchema.nullable().default(null),
  recruitment: RecruitmentSchema.nullable().default(null),
  tcas: TcasSchema.nullable().default(null),
  cohortDistribution: CohortDistributionSchema.nullable().default(null),
  demographic: DemographicSchema.nullable().default(null),
  outcomes: OutcomesSchema.nullable().default(null),
  skills: SkillsSchema.nullable().default(null),
  // v1.2.9: per-program course list materialised from
  // program-courses-extract.v1 (focused course-code AI extractor).
  // ~40-90 courses per Bachelor program. Each row carries class-GPA
  // and gradedCount aggregates so the deep-dive can show academic
  // performance per-course without an additional API trip.
  //
  // Filter: only courses with non-null classGpa appear. `total` is
  // the visible count; `extractedCount` is the unfiltered
  // program_courses row count so the UI can phrase "showing X of Y
  // curriculum courses".
  courses: z
    .object({
      methodVersion: z.string(),
      total: z.number(),
      extractedCount: z.number(),
      rows: z.array(
        z.object({
          courseCode: z.string(),
          courseNameTh: z.string().default(''),
          courseNameEn: z.string().default(''),
          credits: z.number().nullable(),
          classCount: z.number(),
          gradedCount: z.number(),
          classGpa: z.number(),
          byYear: z.record(
            z.object({
              classCount: z.number(),
              gradedCount: z.number(),
              averageClassGpa: z.number().nullable(),
            }),
          ).default({}),
        }),
      ),
      yearsObserved: z.array(z.number()).default([]),
      windowYearsBE: z.object({
        start: z.number().nullable(),
        end: z.number().nullable(),
      }),
      semestersApplied: z.array(z.number()).default([1, 2]),
    })
    .nullable()
    .default(null),
  faculty: FacultySchema.nullable().default(null),
  financials: FinancialsSchema.nullable().default(null),
  peers: PeersSchema.nullable().default(null),
  trends: z.array(TrendsRowSchema).default([]),
  decisions: z.array(DecisionsRowSchema).default([]),
});
export type ProgramDetailData = z.infer<typeof ProgramDetailDataSchema>;
