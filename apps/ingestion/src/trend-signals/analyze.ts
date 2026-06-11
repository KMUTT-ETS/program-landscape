import { prisma, Prisma } from '@kku/db';
import {
  buildTrendSignalAnalysisMessages,
  TrendSignalAnalysisSchema,
  TREND_SIGNAL_ANALYSIS_VERSION,
  type AiService,
} from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Per-signal AI analysis. For one TrendSignal, asks the model which KKU
// programs + skills it affects and what KKU should do, then writes back:
//   affectedProgramIds   (validated against canonical programs — flat list
//                          kept in sync for all existing consumers),
//   affectedProgramsJson  (per-program job-position candidates: immediate +
//                          1-3yr roles + fit note),
//   affectedSkillIds      (resolved from named skills by exact match),
//   recommendedActionsJson,
//   newInitiativesJson    (white-space re-skill/upskill product ideas for
//                          demanded roles no KKU program supplies),
//   aiInferenceId.
// Idempotent — re-running overwrites the prior analysis.
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyzeTrendSignalParams {
  signalId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
}

export type AnalyzeTrendSignalOutcome =
  | {
      status: 'SUCCEEDED';
      aiInferenceId: string | null;
      affectedPrograms: number;
      affectedSkills: number;
      recommendedActions: number;
      newInitiatives: number;
      confidence: number;
      costUsd: number;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function analyzeTrendSignal(
  params: AnalyzeTrendSignalParams,
): Promise<AnalyzeTrendSignalOutcome> {
  const signal = await prisma.trendSignal.findUnique({ where: { id: params.signalId } });
  if (!signal) return { status: 'SKIPPED', reason: `signal not found: ${params.signalId}` };

  // Canonical programs the model may pick from.
  const programs = await prisma.program.findMany({
    where: { sequenceNoFromSheet: { not: null } },
    select: { id: true, nameEn: true, nameTh: true, faculty: { select: { nameEn: true } } },
  });
  const programIdSet = new Set(programs.map((p) => p.id));

  const messages = buildTrendSignalAnalysisMessages({
    signal: {
      signalType: signal.signalType,
      title: signal.title,
      summaryTh: signal.summaryTh,
      summaryEn: signal.summaryEn,
      sourceUrl: signal.sourceUrl,
      impactScore: signal.impactScore,
    },
    programs: programs.map((p) => ({ id: p.id, nameEn: p.nameEn, nameTh: p.nameTh, faculty: p.faculty?.nameEn ?? '—' })),
  });

  let response;
  try {
    response = await params.ai.extractStructured(
      {
        ctx: {
          module: 'trends',
          kind: 'trend-signal-analysis',
          userId: params.triggeredByUserId ?? null,
          traceId: `trend-signal-${signal.id}`,
        },
        messages,
        methodVersion: TREND_SIGNAL_ANALYSIS_VERSION,
        maxOutputTokens: 4000,
      },
      TrendSignalAnalysisSchema,
    );
  } catch (e) {
    return { status: 'FAILED', reason: (e as Error).message };
  }
  const a = response.parsed;

  // Validate affected programs against the canonical set, deduped by id
  // (first occurrence wins, preserving the model's priority order). The flat
  // affectedProgramIds array stays in sync for every existing consumer.
  const seen = new Set<string>();
  const affectedPrograms = a.affectedPrograms.filter((p) => {
    if (!programIdSet.has(p.programId) || seen.has(p.programId)) return false;
    seen.add(p.programId);
    return true;
  });
  const affectedProgramIds = affectedPrograms.map((p) => p.programId);

  // Resolve named skills → Skill ids by exact (lowercased) name match.
  const names = a.affectedSkills.map((n) => n.trim()).filter(Boolean);
  const lower = [...new Set(names.map((n) => n.toLowerCase()))];
  const skillRows = lower.length
    ? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM skills
        WHERE lower(name_en) IN (${Prisma.join(lower)}) OR lower(name_th) IN (${Prisma.join(lower)})`)
    : [];
  const affectedSkillIds = [...new Set(skillRows.map((r) => r.id))];

  await prisma.trendSignal.update({
    where: { id: signal.id },
    data: {
      affectedProgramIds,
      affectedSkillIds,
      affectedProgramsJson: affectedPrograms as unknown as Prisma.InputJsonValue,
      recommendedActionsJson: a.recommendedActions as unknown as Prisma.InputJsonValue,
      newInitiativesJson: a.newInitiatives as unknown as Prisma.InputJsonValue,
      aiInferenceId: response.aiInferenceId,
    },
  });

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    affectedPrograms: affectedProgramIds.length,
    affectedSkills: affectedSkillIds.length,
    recommendedActions: a.recommendedActions.length,
    newInitiatives: a.newInitiatives.length,
    confidence: a.confidence,
    costUsd: response.cost.usd,
  };
}
