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
  // Peer context for the same dimension. Null means the comparison could
  // not be computed (no faculty, or no scored programmes contributed) —
  // NOT a mean of zero. A bare programme score answers "how did we do?"
  // but not "compared with what?", which is the question a reader of a
  // single-programme report cannot otherwise answer.
  facultyMean: z.number().finite().nullable().default(null),
  universityMean: z.number().finite().nullable().default(null),
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
  matchScore: z.number().finite().nullable(),
  demandSource: z.string(),
  demandTier: z.string(),
  careerFilterCount: z.number().finite().nullable(),
  totalTaught: z.number().finite().nullable(),
  ploCount: z.number().finite().nullable(),
  major: z
    .array(
      z.object({
        skill: z.string(),
        // Was the string 'Yes' / '' — a boolean mis-encoded as a string,
        // not a display label. Per the schema inventory: neither NUMERIC
        // nor prose DISPLAY, so pass the real boolean through.
        plo: z.boolean(),
        compulsoryWeight: z.number().finite().nullable(),
        electiveWeight: z.number().finite().nullable(),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
  minor: z
    .array(
      z.object({
        skill: z.string(),
        electiveWeight: z.number().finite().nullable(),
      }),
    )
    .default([]),
  demanded: z
    .array(
      z.object({
        skill: z.string(),
        peakDemand: z.number().finite().nullable(),
        careerCount: z.number().finite().nullable(),
        // Tri-state pass-through of the upstream `curriculumMatched:
        // boolean | null`. Deliberately NOT collapsed to a plain boolean —
        // per the schema inventory, `null` ("no AI match decision yet") is
        // semantically distinct from `false` ("confirmed gap"), and
        // collapsing them would be the same zero-looks-like-missing
        // failure mode this refactor exists to avoid, on a boolean instead
        // of a number.
        match: z.boolean().nullable(),
      }),
    )
    .default([]),
  gaps: z
    .array(
      z.object({
        skill: z.string(),
        peakDemand: z.number().finite().nullable(),
        careerCount: z.number().finite().nullable(),
      }),
    )
    .default([]),
});

const FacultySchema = z.object({
  rosterScope: z.string(),
  visibility: z.string(),
  // Display-only KV rows, stays a KvRowSchema array per the decision at
  // the top of this file. The "Senior share (Prof + Assoc Prof)" row is
  // the hardest case the schema inventory flagged: it concatenates three
  // numbers into one compound string ("8/24 (33%)"). Rather than splitting
  // KvRowSchema's polymorphism for this one row, the KV row stays as the
  // display string it is and the three numbers get dedicated companions
  // below — same pattern as `aiReadiness.subScoreValues` /
  // `cohortDistribution.summaryValues`.
  kpis: z.array(KvRowSchema).default([]),
  seniorRankCount: z.number().finite().nullable(),
  totalRankedCount: z.number().finite().nullable(),
  seniorRankSharePct: z.number().finite().nullable(),
  rankDistribution: z
    .array(
      z.object({
        rank: z.string(),
        count: z.number().finite().nullable(),
        share: z.number().finite().nullable(),
      }),
    )
    .default([]),
  roster: z
    .array(
      z.object({
        rank: z.string(),
        // Was `m.nameEn || m.nameTh || '—'`. Stays DISPLAY, but the
        // em-dash "no name available" sentinel becomes a genuine null
        // rather than a fake string value.
        name: z.string().nullable(),
        specialization: z.string().default(''),
        retires: z.string().default(''),
      }),
    )
    .default([]),
});

const FinancialsSchema = z.object({
  methodologyVersion: z.string(),
  headlineFiscalYear: z.number().finite().nullable(),
  partialCurrentYearNote: z.string().default(''),
  // Display-only KV rows, stays a KvRowSchema array per the decision at
  // the top of this file — including "Government investment / student",
  // which now correctly uses a `!== null` guard rather than a truthy
  // check (see program-detail-data.ts / program-deep-dive.ts — a
  // measured 0 must survive as 0, not collapse to '—').
  kpis: z.array(KvRowSchema).default([]),
  waterfall: z
    .array(
      z.object({
        step: z.string(),
        kind: z.string(),
        // Raw signed contribution — maps directly onto the Waterfall
        // chart primitive's `delta`. Was pre-signed with a literal '−'
        // prefix and Math.abs()'d for display; the sign now lives in the
        // number itself.
        value: z.number().finite().nullable(),
        // Whether this bar is an absolute total (drawn from zero) rather
        // than a delta continuing from the running total — the Waterfall
        // primitive's own `isTotal` concept. True for the closing "Net
        // contribution" bar (kind === 'total').
        isTotal: z.boolean(),
      }),
    )
    .default([]),
  // Was one narrative sentence embedding two numbers ("...net
  // contribution becomes X THB (revenue Y THB)."). Split into the two
  // numbers that already exist upstream, rather than retyped — a
  // sentence can't become a single z.number() without dropping
  // information.
  sensitivity: z
    .object({
      tuitionPlus5Pct: z.object({
        tuitionRevenue: z.number().finite().nullable(),
        netContribution: z.number().finite().nullable(),
      }),
    })
    .nullable()
    .default(null),
  trend: z
    .array(
      z.object({
        year: z.number().finite().nullable(),
        tuition: z.number().finite().nullable(),
        subsidy: z.number().finite().nullable(),
        net: z.number().finite().nullable(),
      }),
    )
    .default([]),
});

const PeerTierSchema = z.object({
  tier: z.string(),
  entries: z
    .array(
      z.object({
        rank: z.number().finite().nullable(),
        institution: z.string(),
        country: z.string(),
        qsWorld: z.number().finite().nullable(),
        programme: z.string(),
      }),
    )
    .default([]),
});

const PeersSchema = z.object({
  subjectSignature: z.string().default(''),
  rankingYear: z.number().finite().nullable().default(null),
  tiers: z.array(PeerTierSchema).default([]),
  aiReview: z
    .object({
      // Percentage (0–100 scale) — the fraction × 100 conversion is
      // preserved from the original formatter, only the toFixed + '%'
      // string formatting is dropped.
      confidencePct: z.number().finite().nullable(),
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
        ranking: z.number().finite().nullable(),
      }),
    )
    .default([]),
});

// A single recommendation item inside one of the three research-expertise
// lanes (curriculum / positioning / research strategy). `horizonMonths` is
// the AI-authored action horizon (1–60 upstream) — a plain count, not a
// percentage or score, so it renders via `formatCount`, not `formatScore`.
const ResearchExpertiseRecommendationSchema = z.object({
  action: z.string(),
  rationale: z.string(),
  horizonMonths: z.number().finite().nullable(),
  themeRefs: z.array(z.string()).default([]),
});

// Research expertise — reference-table shape, no chart (see
// sections/research-expertise.tsx). Sourced from `ProgramResearchExpertise`
// (packages/db/src/program-deep-dive.ts's `programResearchExpertise()`), an
// INSERT-ONLY table the ops runner (`pnpm expertise:generate`) accretes —
// this schema captures the LATEST row's payload plus its accompanying
// input-stats snapshot (`analysedPaperCount` / `totalDistinctPapers`), not
// every historical run.
//
// `confidence` arrived from the read helper as a bare 0–1 fraction
// (`ProgramResearchExpertiseSchema.confidence` in
// packages/shared/src/ai/prompts/program-research-expertise.ts). Renamed to
// `confidencePct` and pre-multiplied ×100 here, matching every other
// confidence field in this schema (`strategicNarrative.confidencePct`,
// `peers.aiReview.confidencePct`) — the "percentage fields are 0–100" rule
// documented on those fields applies here too; do not multiply again at
// render time.
const ResearchExpertiseSchema = z.object({
  methodVersion: z.string(),
  generatedAt: z.string(),
  // The counts-basis pair the section's caption line must state explicitly
  // ("theme counts refer to the N most significant papers analysed, of M
  // total") — `paperCount` on each theme below counts WITHIN the analysed
  // set, never the full roster total, and a reader who isn't told the basis
  // could easily misread it as a full-roster figure.
  analysedPaperCount: z.number().finite(),
  totalDistinctPapers: z.number().finite(),
  confidencePct: z.number().finite(),
  themes: z
    .array(
      z.object({
        name: z.string(),
        paperCount: z.number().finite().nullable(),
        exampleTitles: z.array(z.string()).default([]),
        // Genuinely a display string upstream ("2018–2026"), not two years
        // to be split — see `ProgramResearchExpertiseSchema.themes[].yearSpan`
        // in the prompt template. Do not parse this back into numbers.
        yearSpan: z.string(),
        trend: z.enum(['rising', 'steady', 'fading']),
        evidenceNote: z.string().default(''),
      }),
    )
    .default([]),
  recommendations: z.object({
    curriculum: z.array(ResearchExpertiseRecommendationSchema).default([]),
    positioning: z.array(ResearchExpertiseRecommendationSchema).default([]),
    research: z.array(ResearchExpertiseRecommendationSchema).default([]),
  }),
  caveats: z.array(z.string()).default([]),
});

const TrendsRowSchema = z.object({
  title: z.string(),
  type: z.string(),
  // Binary label derived from the boolean `isTargetedAtProgram`. Stays
  // DISPLAY per the schema inventory — a convenience discriminator, not
  // a number wearing a string costume.
  targeted: z.string(),
  // Was a single compound string ("72 (High)"). Split into the numeric
  // score and the bucket label. `impactScore` is a 0–1 fraction
  // upstream; this is × 100 here to match the rest of the schema's
  // percentage-scale convention (0–100) — do NOT multiply again at
  // render time. That exact double-scaling mistake is what batch 2
  // found and fixed on `demandFunnel.alumniBreakdown[].share`, which
  // was already 0–100 and got run through a ×100 helper anyway.
  impactScorePct: z.number().finite().nullable(),
  impactBucket: z.string(),
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
  // ISO date, DISPLAY (dates stay display strings per the plan) — was
  // `.default('')` when absent; a decision with no effective date yet is
  // a real "not decided when" fact, not an empty string.
  effectiveDate: z.string().nullable(),
  rationale: z.string().default(''),
});

// Digital Intelligence (DQ) competency. `status` is carried through
// rather than collapsed to "has data / no data" because the four states
// are not interchangeable: `not-applicable` (a non-bachelor programme —
// DQ is an undergraduate instrument) must render as nothing at all,
// while `below-floor` (1–4 tested students) must say why the figures are
// withheld. Telling a programme with four tested students that it was
// never tested is the error the distinction exists to prevent — see
// programDigitalCompetency() in packages/db/src/program-deep-dive.ts.
const DigitalCompetencySchema = z.object({
  status: z.enum(['ok', 'below-floor', 'no-data', 'not-applicable']),
  rawMean: z.number().finite().nullable().default(null),
  driverScore: z.number().finite().nullable().default(null),
  scoredStudents: z.number().finite().default(0),
  passRatePct: z.number().finite().nullable().default(null),
  /** The suppression floor, quoted in the copy so it moves with the
   *  query layer instead of being written twice. */
  minCellStudents: z.number().finite().default(5),
  /** KKU's own pass mark, disclosed wherever the score is shown. */
  passMark: z.number().finite().nullable().default(null),
  modules: z
    .array(
      z.object({
        moduleNo: z.number().finite(),
        label: z.string(),
        mean: z.number().finite().nullable(),
        universityMean: z.number().finite().nullable(),
      }),
    )
    .default([]),
  weakest: z.array(z.object({ label: z.string(), mean: z.number().finite() })).default([]),
  methodologyVersion: z.string().default(''),
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
  // Sample sizes for the two comparison means above. Carried so the
  // report can say what the programme is being compared WITH — a faculty
  // mean over three programmes and one over forty are different claims,
  // and a reader given only the number cannot tell them apart.
  healthBenchmark: z
    .object({
      facultyNameTh: z.string().nullable().default(null),
      facultySampleSize: z.number().finite().nullable().default(null),
      universitySampleSize: z.number().finite().default(0),
      methodologyVersion: z.string().default(''),
    })
    .nullable()
    .default(null),
  // Dedicated numeric companions to the "Overall health score" /
  // "data completeness" figures that otherwise only exist pre-formatted
  // inside `executiveSnapshot`'s display-only KV row (which this file's
  // header comment explicitly forbids parsing back into a number). Same
  // pattern as `aiReadiness.subScoreValues` / `cohortDistribution.
  // summaryValues` — a chart (here, the cover's stat block) needs the
  // raw composite, not the per-dimension breakdown in `healthDimensions`
  // and not a re-derivation of it. Sourced directly from
  // `overview.health.overall.{score,dataCompletenessPct}` in the
  // builder — no new methodology, just exposed as a number.
  // `healthOverallScore` is null when the methodology has no non-null
  // dimension to average (never 0). `healthOverallCompletenessPct` is
  // not null in practice (the upstream value is a non-nullable 0–100)
  // but stays nullable here for the same defensive reason as
  // `healthDimensions[].dataCompleteness`.
  healthOverallScore: z.number().finite().nullable().default(null),
  healthOverallCompletenessPct: z.number().finite().nullable().default(null),
  lifecycle: LifecycleSchema.nullable().default(null),
  strategicNarrative: StrategicNarrativeSchema.nullable().default(null),
  aiReadiness: AiReadinessSchema.nullable().default(null),
  demandFunnel: DemandFunnelSchema.nullable().default(null),
  recruitment: RecruitmentSchema.nullable().default(null),
  tcas: TcasSchema.nullable().default(null),
  cohortDistribution: CohortDistributionSchema.nullable().default(null),
  demographic: DemographicSchema.nullable().default(null),
  outcomes: OutcomesSchema.nullable().default(null),
  // Sits with outcomes, matching the deep-dive page, where digital
  // competency is a sub-block of Outcomes rather than its own top-level
  // section.
  digitalCompetency: DigitalCompetencySchema.nullable().default(null),
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
  // v2026-08-17: research-expertise brief. Null when the ops runner
  // (`pnpm expertise:generate`) hasn't produced a row for this program yet
  // — a real, expected state for `no-roster`/`thin` programs and for any
  // program the bulk run hasn't reached — the section renders an explained
  // empty note rather than omitting itself, so a Council reader can tell
  // "not yet analysed" apart from a PDF that silently dropped the section.
  researchExpertise: ResearchExpertiseSchema.nullable().default(null),
  trends: z.array(TrendsRowSchema).default([]),
  decisions: z.array(DecisionsRowSchema).default([]),
});
export type ProgramDetailData = z.infer<typeof ProgramDetailDataSchema>;
