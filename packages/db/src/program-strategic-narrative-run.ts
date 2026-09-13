import {
  buildProgramStrategicNarrativeMessages,
  ProgramStrategicNarrativeSchema,
  PROGRAM_STRATEGIC_NARRATIVE_VERSION,
  countMissingNarrativeChannels,
  narrativeConfidenceCeiling,
  lintBannedTells,
  type AiService,
  type ProgramStrategicNarrativeInput,
  extractStructuredWithParseRetry,
} from '@kku/shared';
import { prisma } from './index';
import { computeHealthScores } from './health-score';
import { realDataWhere } from './data-quality';
import { DEMAND_SOURCE_LINKEDIN, demandMatchSourceWhere } from './demand-match-sources';
import { activeRevisionIdFor } from './program-revision';
import {
  programAiReadiness,
  programDemandFunnel,
  programDemographicOutlook,
  programLifecycleVerdict,
  programTcasStats,
  programFinancials,
  programOutcomes,
  programTrends,
  programStudentCohorts,
} from './program-deep-dive';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-computes the strategic narrative for one program. Composes EVERY
// existing helper output into a snapshot, then asks Pro thinking to
// draft an official-format Council brief in markdown.
//
// Idempotent — upserts on programId. Re-running supersedes the prior
// narrative.
//
// This lives in @kku/db (not apps/ingestion) so BOTH the per-program
// pipeline AND the deep-dive "Regenerate" button run the IDENTICAL
// prompt (program-strategic-narrative). The regenerate endpoint used to
// call the cockpit brief, which is a DIFFERENT prompt — that mismatch is
// the bug this relocation fixes.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunStrategicNarrativeParams {
  programId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
}

export type StrategicNarrativeOutcome =
  | {
      status: 'SUCCEEDED';
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      contentLength: number;
      contentMarkdown: string;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function generateProgramStrategicNarrative(
  params: RunStrategicNarrativeParams,
): Promise<StrategicNarrativeOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    select: {
      id: true,
      nameTh: true,
      nameEn: true,
      level: true,
      durationYears: true,
      yearEstablished: true,
      faculty: { select: { nameEn: true } },
    },
  });
  if (!program) return { status: 'SKIPPED', reason: `program not found: ${params.programId}` };

  // Pull every signal in parallel.
  const [
    healthRows,
    aiReadiness,
    lifecycle,
    tcas,
    financials,
    demand,
    demographic,
    peerReviewRow,
    outcomes,
    trends,
    cohorts,
    demandMatchSummary,
    riskRow,
  ] = await Promise.all([
    computeHealthScores('program', program.id),
    programAiReadiness(program.id),
    programLifecycleVerdict(program.id),
    programTcasStats(program.id),
    programFinancials(program.id),
    programDemandFunnel(program.id),
    programDemographicOutlook(program.id),
    prisma.programPeerReview.findUnique({ where: { programId: program.id } }),
    programOutcomes(program.id),
    programTrends(program.id),
    programStudentCohorts(program.id),
    fetchDemandMatchSummary(program.id),
    prisma.riskAssessment.findFirst({
      where: { programId: program.id },
      orderBy: { assessedAt: 'desc' },
      select: {
        compositeScore: true,
        l1RecruitmentScore: true,
        l2AiDisruptionScore: true,
        l3DemographicScore: true,
        directRevenueAtRiskThb: true,
        strandedCostThb: true,
      },
    }),
  ]);

  const health = healthRows[0] ?? null;

  // Compose the input snapshot for the prompt.
  const tcasLatest = tcas.history.at(-1) ?? null;

  const peerReviewPayload = peerReviewRow?.payloadJson as
    | {
        contentModernity?: { verdict: 'OLD_SCHOOL' | 'IN_BETWEEN' | 'FRONTIER' };
        strengths?: Array<{ claim: string; evidence: string }>;
        weaknesses?: Array<{ claim: string; evidence: string }>;
        subjectBenchmarkSummary?: string;
      }
    | null
    | undefined;

  // Kept as its own const (rather than inlined into the builder call) so
  // it can also be handed to countMissingNarrativeChannels() below — see
  // FIX 1.
  const narrativeInput: ProgramStrategicNarrativeInput = {
    programNameTh: program.nameTh,
    programNameEn: program.nameEn,
    programLevel: program.level as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
    programFaculty: program.faculty.nameEn,
    programDurationYears: program.durationYears,
    yearEstablished: program.yearEstablished,
    lifecycle: lifecycle
      ? { verdict: lifecycle.verdict, trajectoryScore: lifecycle.trajectoryScore }
      : null,
    health: health
      ? {
          overallScore: health.overall.score,
          attractiveness: health.dimensions.attractiveness.score,
          financial: health.dimensions.financial.score,
          capability: health.dimensions.capability.score,
          outcomes: health.dimensions.outcomes.score,
          relevance: health.dimensions.relevance.score,
          completenessPct: health.overall.dataCompletenessPct,
        }
      : null,
    aiReadiness: aiReadiness
      ? {
          overallScore: aiReadiness.overallScore,
          curriculumIntegration: aiReadiness.subScores.curriculumIntegration,
          skillResilience: aiReadiness.subScores.skillResilience,
          researchPresence: aiReadiness.subScores.researchPresence,
          aiSkillCount: aiReadiness.skillBreakdown.aiNative,
          totalSkills:
            aiReadiness.skillBreakdown.aiNative +
            aiReadiness.skillBreakdown.aiAugmented +
            aiReadiness.skillBreakdown.aiDisplaceable +
            aiReadiness.skillBreakdown.neutral,
        }
      : null,
    tcas: tcasLatest
      ? {
          latestYearBE: tcasLatest.entryYearBE,
          competitionRatio: tcasLatest.competitionRatio,
          fillRate: tcasLatest.fillRate,
          minScore: tcasLatest.minScorePass1,
        }
      : null,
    financial:
      financials.latestFiscalYear !== null
        ? {
            fiscalYear: financials.latestFiscalYear,
            tuitionRevenueThb:
              financials.trend.find((t) => t.year === financials.latestFiscalYear)
                ?.tuitionRevenue ?? 0,
            netContributionPerStudent:
              financials.costPerStudent === null ? null : -financials.costPerStudent,
            governmentFacultySubsidyThb: financials.governmentFacultySubsidy,
          }
        : null,
    demand:
      demand.anchorEntryYearBE !== null && demand.cohortTrend.length > 0
        ? (() => {
            const anchor = demand.cohortTrend.find(
              (c) => c.entryYearBE === demand.anchorEntryYearBE,
            );
            return anchor
              ? {
                  anchorEntryYearBE: anchor.entryYearBE,
                  admittedTotal: anchor.admittedTotal,
                  enrolled: anchor.enrolled,
                  graduated: anchor.graduated,
                  droppedTotal: anchor.droppedTotal,
                  stillEnrolled: anchor.stillEnrolled,
                }
              : null;
          })()
        : null,
    demographic: demographic
      ? {
          regionLabel:
            demographic.catchmentRegion === 'Northeast'
              ? 'Northeast Thailand'
              : 'Thailand',
          requiredShareAt10Y:
            demographic.projections.find(
              (p) => p.year === new Date().getUTCFullYear() + 10,
            )?.requiredShareOfCohort ?? null,
          fifteenYearContractionPct: demographic.fifteenYearContraction,
          riskLevel: demographic.riskLevel,
        }
      : null,
    peerReview: peerReviewPayload
      ? {
          contentModernityVerdict: peerReviewPayload.contentModernity?.verdict ?? null,
          topStrength: peerReviewPayload.strengths?.[0]?.claim ?? '',
          topWeakness: peerReviewPayload.weaknesses?.[0]?.claim ?? '',
          subjectBenchmarkSummary: peerReviewPayload.subjectBenchmarkSummary ?? '',
        }
      : null,
    // outcomes.latest is graduationYear-anchored (programOutcomes() doesn't
    // return a distinct surveyYear on the latest row); rendered in the
    // prompt as "cohort graduation year" so the label stays accurate.
    outcomes: outcomes.latest
      ? {
          surveyYear: outcomes.latest.graduationYear,
          // GraduateOutcome.employmentRate / furtherStudyRate are stored
          // 0..1 (same convention health-score.ts's outcomes driver
          // converts from) — scaled to 0..100 for the prompt.
          employmentRatePct: outcomes.latest.employmentRate * 100,
          averageSalaryThb: outcomes.latest.averageSalary,
          furtherStudyRatePct: outcomes.latest.furtherStudyRate * 100,
          sampleSize: outcomes.latest.sampleSize,
        }
      : null,
    demandMatch: demandMatchSummary,
    trendSignals: trends.signals.slice(0, 5).map((s) => ({
      title: s.title,
      signalType: s.signalType,
      impactScorePct: s.impactScore * 100,
      recommendation: s.summaryEn ?? s.summaryTh ?? 'no recommendation on file',
    })),
    risk:
      riskRow && riskRow.compositeScore !== null
        ? {
            compositeScore: riskRow.compositeScore,
            topLikelihoodDriver: describeTopLikelihoodDriver(riskRow),
            topImpactDimension: describeTopImpactDimension(riskRow),
          }
        : null,
    cohorts:
      cohorts.refreshedAt !== null
        ? {
            totalActive: cohorts.totalActive,
            delayedSharePct:
              cohorts.totalActive > 0 ? (cohorts.delayedCount / cohorts.totalActive) * 100 : null,
          }
        : null,
  };

  const messages = buildProgramStrategicNarrativeMessages(narrativeInput);

  const extractionParams = {
    ctx: {
      module: 'programs',
      kind: 'program-strategic-narrative',
      userId: params.triggeredByUserId ?? null,
      traceId: `narrative-${program.id}`,
    },
    methodVersion: PROGRAM_STRATEGIC_NARRATIVE_VERSION,
    // Bumped 4096 → 50000 on 2026-05-13 — see program-digest/run.ts.
    maxOutputTokens: 50000,
  };

  let response = await extractStructuredWithParseRetry(
    params.ai,
    { ...extractionParams, messages },
    ProgramStrategicNarrativeSchema,
    'program-strategic-narrative',
  );

  // FIX 2 (docs/prompt-standard.md `## Banned AI tells`): the prompt-level
  // ban is not airtight — the audit reproduced "robust" verbatim twice on
  // the same snapshot. Post-generation lint with exactly one corrective
  // retry; if the retry still violates, persist the retry's output anyway
  // and log a warning (no schema change — the bulk-run report surfaces
  // violation counts from these log lines).
  const initialTellViolations = lintBannedTells(response.parsed.contentMarkdown);
  if (initialTellViolations.length > 0) {
    const correctionMessages = [
      ...messages,
      { role: 'assistant' as const, content: response.rawText },
      {
        role: 'user' as const,
        content: `Your draft used banned phrase(s): ${initialTellViolations
          .map((v) => `"${v.phrase}"`)
          .join(', ')}. Rewrite the ENTIRE brief without any of these words or their close paraphrases — keep the same structure, length cap, and grounding rules. Return the corrected JSON in the same format as before.`,
      },
    ];
    const retryResponse = await extractStructuredWithParseRetry(
      params.ai,
      { ...extractionParams, messages: correctionMessages },
      ProgramStrategicNarrativeSchema,
      'program-strategic-narrative',
    );
    const retryViolations = lintBannedTells(retryResponse.parsed.contentMarkdown);
    if (retryViolations.length > 0) {
      console.warn(
        `[program-strategic-narrative] banned-tell lint still failing after retry for program ${program.id}: ${retryViolations.map((v) => v.phrase).join(', ')}`,
      );
    }
    response = retryResponse;
  }

  // FIX 1 (docs/prompt-standard.md `## Confidence rubric`): the model's
  // self-report is a floor-signal only — clamp it to a deterministic
  // ceiling computed from how many of the 13 input channels are missing.
  // The gate showed the model self-report 0.75 with 6 of 13 channels
  // missing, where the rubric's own bands say <0.5 — prose can't fix
  // self-grading, so this is enforced mechanically.
  const missingChannelCount = countMissingNarrativeChannels(narrativeInput);
  const ceiling = narrativeConfidenceCeiling(missingChannelCount);
  let confidence = response.parsed.confidence;
  if (confidence > ceiling) {
    console.warn(
      `[program-strategic-narrative] confidence clamped for program ${program.id}: reported=${confidence} ceiling=${ceiling} (missingChannels=${missingChannelCount})`,
    );
    confidence = ceiling;
  }

  // Provenance: which curriculum revision produced this row. NULL is the
  // pre-feature baseline. See packages/db/src/program-revision.ts.
  const programRevisionId = await activeRevisionIdFor(program.id);

  await prisma.programStrategicNarrative.upsert({
    where: { programId: program.id },
    create: {
      programId: program.id,
      programRevisionId,
      methodVersion: PROGRAM_STRATEGIC_NARRATIVE_VERSION,
      contentMarkdown: response.parsed.contentMarkdown,
      confidence,
      generatedByAiInferenceId: response.aiInferenceId,
    },
    update: {
      // Re-stamped on update too: an upsert that only stamps on create would
      // leave a re-run carrying the PREVIOUS revision's id — confidently
      // wrong, which is worse than unstamped.
      programRevisionId,
      methodVersion: PROGRAM_STRATEGIC_NARRATIVE_VERSION,
      contentMarkdown: response.parsed.contentMarkdown,
      confidence,
      generatedAt: new Date(),
      generatedByAiInferenceId: response.aiInferenceId,
    },
  });

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    contentLength: response.parsed.contentMarkdown.length,
    contentMarkdown: response.parsed.contentMarkdown,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR-MARKET DEMAND channel — reuses the same table + filter the
// health-score relevance driver reads (scoreRelevanceProgram() in
// health-score.ts: ProgramDemandMatch rows where relevant=true, gated by
// realDataWhere()). Null when there are no relevant-demand rows for this
// program yet (data gap, not zero demand).
// ─────────────────────────────────────────────────────────────────────────────
async function fetchDemandMatchSummary(programId: string): Promise<{
  matchedDemanded: number;
  relevantDemanded: number;
  topUnmatchedSkills: string[];
} | null> {
  const rows = await prisma.programDemandMatch.findMany({
    where: { programId, relevant: true, ...demandMatchSourceWhere(DEMAND_SOURCE_LINKEDIN), ...realDataWhere() },
    select: { matched: true, skillId: true },
  });
  if (rows.length === 0) return null;

  const matchedDemanded = rows.filter((r) => r.matched).length;
  const unmatchedSkillIds = rows
    .filter((r) => !r.matched)
    .map((r) => r.skillId)
    .slice(0, 5);
  const skills = unmatchedSkillIds.length
    ? await prisma.skill.findMany({
        where: { id: { in: unmatchedSkillIds } },
        select: { id: true, nameEn: true },
      })
    : [];
  const nameById = new Map(skills.map((s) => [s.id, s.nameEn]));
  const topUnmatchedSkills = unmatchedSkillIds.map((id) => nameById.get(id) ?? id);

  return { matchedDemanded, relevantDemanded: rows.length, topUnmatchedSkills };
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK channel derivation — picks the highest-scoring of the three
// likelihood drivers and the larger of the two impact dimensions off the
// latest RiskAssessment row. Both return a "no X computed" label rather
// than throwing when every candidate is null (a data gap within an
// otherwise-present risk row, not an absent channel).
// ─────────────────────────────────────────────────────────────────────────────
type RiskRowForNarrative = {
  compositeScore: number | null;
  l1RecruitmentScore: number | null;
  l2AiDisruptionScore: number | null;
  l3DemographicScore: number | null;
  directRevenueAtRiskThb: unknown;
  strandedCostThb: unknown;
};

function describeTopLikelihoodDriver(row: RiskRowForNarrative): string {
  const drivers: Array<[string, number | null]> = [
    ['L1 recruitment/TCAS competition decay', row.l1RecruitmentScore],
    [
      'L2 AI-disruption (share of taught skills at high automation risk)',
      row.l2AiDisruptionScore,
    ],
    ['L3 demographic ceiling', row.l3DemographicScore],
  ];
  const present = drivers.filter((d): d is [string, number] => d[1] !== null);
  const top = present.sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'no likelihood driver computed';
}

function describeTopImpactDimension(row: RiskRowForNarrative): string {
  const revenue = row.directRevenueAtRiskThb === null ? null : Number(row.directRevenueAtRiskThb);
  const stranded = row.strandedCostThb === null ? null : Number(row.strandedCostThb);
  if (revenue === null && stranded === null) return 'no impact dimension computed';
  if (stranded === null || (revenue !== null && revenue >= stranded)) {
    return 'direct revenue at risk';
  }
  return 'stranded cost';
}
