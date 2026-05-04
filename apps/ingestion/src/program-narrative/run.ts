import { prisma } from '@kku/db';
import {
  buildProgramStrategicNarrativeMessages,
  ProgramStrategicNarrativeSchema,
  PROGRAM_STRATEGIC_NARRATIVE_VERSION,
  type AiService,
} from '@kku/shared';
import {
  computeHealthScores,
  programAiReadiness,
  programDemandFunnel,
  programDemographicOutlook,
  programLifecycleVerdict,
  programTcasStats,
  programFinancials,
} from '@kku/db';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-computes the strategic narrative for one program. Composes EVERY
// existing helper output into a snapshot, then asks Pro thinking to
// draft an official-format Council brief in markdown.
//
// Idempotent — upserts on programId. Re-running supersedes the prior
// narrative.
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
  ] = await Promise.all([
    computeHealthScores('program', program.id),
    programAiReadiness(program.id),
    programLifecycleVerdict(program.id),
    programTcasStats(program.id),
    programFinancials(program.id),
    programDemandFunnel(program.id),
    programDemographicOutlook(program.id),
    prisma.programPeerReview.findUnique({ where: { programId: program.id } }),
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

  const messages = buildProgramStrategicNarrativeMessages({
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
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'programs',
        kind: 'program-strategic-narrative',
        userId: params.triggeredByUserId ?? null,
        traceId: `narrative-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_STRATEGIC_NARRATIVE_VERSION,
      maxOutputTokens: 4096,
    },
    ProgramStrategicNarrativeSchema,
  );

  await prisma.programStrategicNarrative.upsert({
    where: { programId: program.id },
    create: {
      programId: program.id,
      methodVersion: PROGRAM_STRATEGIC_NARRATIVE_VERSION,
      contentMarkdown: response.parsed.contentMarkdown,
      confidence: response.parsed.confidence,
      generatedByAiInferenceId: response.aiInferenceId,
    },
    update: {
      methodVersion: PROGRAM_STRATEGIC_NARRATIVE_VERSION,
      contentMarkdown: response.parsed.contentMarkdown,
      confidence: response.parsed.confidence,
      generatedAt: new Date(),
      generatedByAiInferenceId: response.aiInferenceId,
    },
  });

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    confidence: response.parsed.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    contentLength: response.parsed.contentMarkdown.length,
  };
}
