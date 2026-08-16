import { z } from 'zod';

// Internal-use program detail report. Pure tabular layout — every
// section is a table with explicit column headers. This is NOT a
// Council-facing brief; it's the analyst working document that puts
// every deep-dive datum into one PDF, formatted for fast tabular
// scanning. The controller pre-formats every field as a string so the
// template stays minimal.

// KvRowSchema is a display-only summary row (metric name / value / note),
// reused across six sections (executive snapshot, AI-readiness sub-scores,
// cohort summary, outcomes summary, faculty KPIs, financials KPIs) that
// each mean something different under the same shape. These rows are
// rendered as text in a table — never charted, never parsed back out as a
// number. Do not retype `value` to a number: a single `string → number`
// flip cannot serve six unrelated concrete meanings (score / verdict label
// / currency / compound fraction, etc.) at once. Where a chart genuinely
// needs one of these numbers, add a separate, dedicated numeric field next
// to the KV row instead — see `aiReadiness.subScoreValues` for the pattern.
const KvRowSchema = z.object({
  metric: z.string(),
  value: z.string(),
  notes: z.string().default(''),
});

const HealthDimRowSchema = z.object({
  dimension: z.string(),
  score: z.number().finite().nullable(),
  dataCompleteness: z.number().finite().nullable(),
  // Was a single compound string ("TCAS fill rate (72)"). Split into a
  // display label and a dedicated numeric value — a chart-blocking
  // compound field, not a display-vs-numeric ambiguity.
  topDriverLabel: z.string().nullable(),
  topDriverValue: z.number().finite().nullable(),
});

const HealthDriverRowSchema = z.object({
  dimension: z.string(),
  driver: z.string(),
  value: z.number().finite().nullable(),
});

const LifecycleSchema = z.object({
  verdict: z.string(),
  trajectoryScore: z.number().finite().nullable(),
  methodologyVersion: z.string(),
  generatedAt: z.string(),
  narrative: z.string().default(''),
  drivers: z
    .array(
      z.object({
        // Redundant with the sign of `contribution` once it's a real
        // signed number — kept as a convenience discriminator for
        // icon/color selection so the template doesn't have to branch on
        // sign itself. Leans DISPLAY per the schema inventory.
        direction: z.enum(['lifting', 'drag']),
        label: z.string(),
        contribution: z.number().finite().nullable(),
      }),
    )
    .default([]),
});

const StrategicNarrativeSchema = z.object({
  contentMarkdown: z.string(),
  methodVersion: z.string(),
  confidencePct: z.number().finite().nullable(),
  generatedAt: z.string(),
});

const AiReadinessSchema = z.object({
  overallScore: z.number().finite().nullable(),
  verdict: z.string(),
  summary: z.string().default(''),
  methodologyVersion: z.string(),
  // Display-only KV rows (metric label + pre-formatted value + note) —
  // stays a KvRowSchema array per the decision at the top of this file.
  // `value` on this array carries the literal 'no data' sentinel string
  // for the unmeasured Pedagogical-readiness row today; it is text, not
  // parsed back out.
  subScores: z.array(KvRowSchema).default([]),
  // Dedicated numeric companion to `subScores` above, in row order, for
  // the chart-led rebuild (BarsH). `score` is null for the 'no data'
  // case instead of the sentinel string.
  subScoreValues: z
    .array(
      z.object({
        label: z.string(),
        score: z.number().finite().nullable(),
      }),
    )
    .default([]),
  skillBreakdown: z
    .array(
      z.object({
        category: z.string(),
        count: z.number().finite().nullable(),
        share: z.number().finite().nullable(),
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
  // Was a single compound string ("BE 2564 (CE 2021)"). Split into the two
  // numbers that already exist upstream by these names.
  anchorEntryYearBE: z.number().finite().nullable(),
  anchorEntryYearCE: z.number().finite().nullable(),
  // Binary label derived from the boolean `cohortCompleted`. Stays DISPLAY
  // per the schema inventory — it's a convenience discriminator, not a
  // number wearing a string costume.
  cohortStatus: z.string(),
  programDurationYears: z.number().finite().nullable(),
  methodologyVersion: z.string(),
  stages: z
    .array(
      z.object({
        stage: z.string(),
        value: z.number().finite().nullable(),
      }),
    )
    .default([]),
  conversions: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        rate: z.number().finite().nullable(),
      }),
    )
    .default([]),
  alumniBreakdown: z
    .array(
      z.object({
        bucket: z.string(),
        count: z.number().finite().nullable(),
        share: z.number().finite().nullable(),
      }),
    )
    .default([]),
  cohortTrend: z
    .array(
      z.object({
        cohortBE: z.number().finite().nullable(),
        admitted: z.number().finite().nullable(),
        enrolled: z.number().finite().nullable(),
        graduated: z.number().finite().nullable(),
        dropped: z.number().finite().nullable(),
        // Binary label derived from the per-row boolean `cohortCompleted`.
        // Stays DISPLAY, same rationale as `cohortStatus` above.
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
        yearBE: z.number().finite().nullable(),
        status: z.string(),
        planPerYear: z.number().finite().nullable(),
        seats: z.number().finite().nullable(),
        // The raw over-allocation factor (e.g. 1.23), always emitted when
        // measured. The old string was '' both when the factor was ≤ 1.05
        // (measured but unremarkable) AND when it was null (never
        // measured) — those are different facts; the template now decides
        // its own highlight threshold against a real nullable number.
        overAllocation: z.number().finite().nullable(),
        applicants: z.number().finite().nullable(),
        // Raw ratio (e.g. 1.23), not a percentage.
        competition: z.number().finite().nullable(),
        passed: z.number().finite().nullable(),
        confirmCh: z.number().finite().nullable(),
        reported: z.number().finite().nullable(),
        // Percentage (0–100 scale), matching the rest of the schema's
        // percentage fields.
        vsPlan: z.number().finite().nullable(),
      }),
    )
    .default([]),
  latestRoundsYear: z.number().finite().nullable().default(null),
  latestRounds: z
    .array(
      z.object({
        // Genuinely a string upstream — TCAS sub-rounds like "3.1"/"3.2"
        // exist, so this is not a lightly-formatted number. Do not cast.
        round: z.string(),
        seats: z.number().finite().nullable(),
        applicants: z.number().finite().nullable(),
        passed: z.number().finite().nullable(),
        confirmCh: z.number().finite().nullable(),
        reported: z.number().finite().nullable(),
      }),
    )
    .default([]),
});

const TcasSchema = z.object({
  history: z
    .array(
      z.object({
        // Was a single compound string ("BE 2567 R2"). Split into the
        // year (numeric axis value) and round (stays a string — see the
        // note on `latestRounds[].round` above).
        yearBE: z.number().finite().nullable(),
        round: z.string(),
        quota: z.number().finite().nullable(),
        applicants: z.number().finite().nullable(),
        // Raw ratio, not a percentage.
        competition: z.number().finite().nullable(),
        // Percentage (0–100 scale).
        fillRate: z.number().finite().nullable(),
        minScore: z.number().finite().nullable(),
        maxScore: z.number().finite().nullable(),
      }),
    )
    .default([]),
  peers: z
    .array(
      z.object({
        match: z.string(),
        institution: z.string(),
        programme: z.string(),
        quota: z.number().finite().nullable(),
        applicants: z.number().finite().nullable(),
        competition: z.number().finite().nullable(),
        minScore: z.number().finite().nullable(),
      }),
    )
    .default([]),
  peerMatchKey: z.string().default(''),
});

const CohortDistributionSchema = z.object({
  totalActive: z.number().finite().nullable(),
  currentAcademicYearBE: z.number().finite().nullable(),
  programDurationYears: z.number().finite().nullable(),
  // Display-only KV rows (Incoming / On-track / Delayed), stays a
  // KvRowSchema array per the decision at the top of this file.
  summary: z.array(KvRowSchema).default([]),
  // Dedicated numeric companion to `summary` above, same row order, for
  // the chart-led rebuild — same pattern as `aiReadiness.subScoreValues`.
  summaryValues: z
    .array(
      z.object({
        label: z.string(),
        count: z.number().finite().nullable(),
        sharePct: z.number().finite().nullable(),
      }),
    )
    .default([]),
  rows: z
    .array(
      z.object({
        // Was a single compound string ("BE 2567 (CE 2024)"). Split into
        // the two numbers, same pattern as `demandFunnel.anchorEntryYear*`.
        cohortBE: z.number().finite().nullable(),
        cohortCE: z.number().finite().nullable(),
        // Was "Year 0" / "Year N" built from the raw int. Emit the raw
        // int; the template adds the "Year " prefix.
        yearInProgram: z.number().finite().nullable(),
        status: z.string(),
        students: z.number().finite().nullable(),
        share: z.number().finite().nullable(),
      }),
    )
    .default([]),
});

const DemographicSchema = z.object({
  catchment: z.string(),
  ageCohort: z.string(),
  source: z.string(),
  baselineYearOneIntake: z.number().finite().nullable(),
  // Signed, raw. `.nullable()` even though the upstream interface
  // (`ProgramDemographicOutlook.fifteenYearContraction`) is a plain
  // `number` today — no site in the builder guarded it, which the schema
  // inventory flagged as a live risk if that upstream contract ever
  // loosens. Formatting (the em-dash / sign convention) moved to
  // `format.ts` — the builder no longer touches this value.
  fifteenYearContraction: z.number().finite().nullable(),
  riskLevel: z.string(),
  projections: z
    .array(
      z.object({
        year: z.number().finite().nullable(),
        // Was baked into the year string as " (today)" on the first row.
        // Split out so the template can badge it without string matching.
        isCurrentYear: z.boolean(),
        // Raw population count. Was pre-divided by 1,000,000 and rounded
        // to 2dp for display ("2.35M") — the template now owns that
        // formatting.
        cohortPopulation: z.number().finite().nullable(),
        // Signed, raw — `cohortDeclinePct` is POSITIVE when the cohort
        // shrinks and NEGATIVE when it grows. Do not normalise, clamp or
        // absolute this; see `format.ts` for the render-time convention.
        decline: z.number().finite().nullable(),
        // Percentage (0–100 scale) — the fraction × 100 conversion is
        // preserved from the original formatter, only the string
        // formatting (toFixed + '%') is dropped.
        shareNeeded: z.number().finite().nullable(),
      }),
    )
    .default([]),
});

const OutcomesSchema = z.object({
  surveyYear: z.number().finite().nullable(),
  methodologyVersion: z.string(),
  freshnessDate: z.string(),
  sampleSize: z.number().finite().nullable(),
  // Display-only KV rows, stays a KvRowSchema array per the decision at
  // the top of this file — these 4 rows are heterogeneous in unit
  // (percentage / currency / percentage / percentage), so a generic
  // numeric companion array (label + value) would lose the unit; the
  // named fields below are more useful to a chart than re-parsing the
  // label.
  summary: z.array(KvRowSchema).default([]),
  employmentRatePct: z.number().finite().nullable(),
  averageSalary: z.number().finite().nullable(),
  jobRelevanceScorePct: z.number().finite().nullable(),
  furtherStudyRatePct: z.number().finite().nullable(),
  salaryTrajectory: z
    .array(
      z.object({
        year: z.number().finite().nullable(),
        salary: z.number().finite().nullable(),
      }),
    )
    .default([]),
  topEmployers: z
    .array(
      z.object({
        employer: z.string(),
        year: z.number().finite().nullable(),
        // Percentage (0–100 scale).
        satisfaction: z.number().finite().nullable(),
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
  yearEstablished: z.number().finite().nullable().default(null),
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
