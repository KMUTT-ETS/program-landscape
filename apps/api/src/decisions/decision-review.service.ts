import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  computeHealthScores,
  getAiModelOverrideStore,
  prisma,
  PrismaAiInferenceRecorder,
  snapshotGapMap,
  summariseSnapshotGap,
  type DecisionSnapshot,
} from '@kku/db';
import {
  buildDecisionReviewMessages,
  createAiService,
  DECISION_REVIEW_VERSION,
  DecisionReviewOutputSchema,
  type AiProviderId,
  type AiService,
  type DecisionReviewInput,
  type DecisionReviewOutput,
} from '@kku/shared';
import type { OutcomeReviewHorizon } from "@kku/db";

// AI-generated post-decision outcome review. Same factory pattern as
// gap-brief / scenario-insights / benchmarking-insights services.

@Injectable()
export class DecisionReviewService implements OnModuleInit {
  private readonly logger = new Logger(DecisionReviewService.name);
  private ai!: AiService;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const recorder = new PrismaAiInferenceRecorder();
    const providerId = (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId;
    const intelSphereUrl = this.config.get<string>('KKU_INTELSPHERE_URL');
    const intelSphereKey = this.config.get<string>('KKU_INTELSPHERE_API_KEY');
    this.ai = createAiService({
      recorder,
      providerId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
        intelSphere:
          intelSphereUrl && intelSphereKey
            ? { url: intelSphereUrl, apiKey: intelSphereKey }
            : undefined,
      },
      modelOverrideResolver: getAiModelOverrideStore(),
    });
  }

  private hasProvider(): boolean {
    return Boolean(
      this.config.get<string>('GOOGLE_AI_API_KEY') ||
        this.config.get<string>('ANTHROPIC_API_KEY'),
    );
  }

  async generate(params: {
    decisionId: string;
    horizon: OutcomeReviewHorizon;
    userId: string;
  }) {
    const decision = await prisma.councilDecision.findUnique({
      where: { id: params.decisionId },
      include: {
        milestones: true,
      },
    });
    if (!decision) throw new NotFoundException();
    if (!decision.effectiveDate) {
      throw new Error('Decision has no effectiveDate — cannot compute horizon');
    }
    if (!decision.snapshotJson) {
      throw new Error('Decision has no captured snapshot — transition to COUNCIL_REVIEWED first');
    }

    // Resolve affected programs for the prompt.
    const programs = await prisma.program.findMany({
      where: decision.affectedProgramIds.length > 0 ? { id: { in: decision.affectedProgramIds } } : { id: 'none' },
      select: { id: true, code: true, nameEn: true, nameTh: true },
    });

    const snapshot = decision.snapshotJson as unknown as DecisionSnapshot;
    const scope = decision.facultyId ? 'faculty' as const : 'university' as const;
    const scopeId = decision.facultyId ?? undefined;

    // Recompute current state.
    const [currentHealth, currentGapMap] = await Promise.all([
      computeHealthScores(scope, scopeId ?? null),
      snapshotGapMap(scope, scopeId ?? null),
    ]);

    const input: DecisionReviewInput = {
      decisionTitle: decision.title,
      decisionType: decision.decisionType,
      horizon: params.horizon,
      effectiveDate: decision.effectiveDate.toISOString().slice(0, 10),
      affectedPrograms: programs,
      snapshot: {
        healthSummary: summariseHealth(snapshot.health),
        riskSummary: RISK_REGISTER_POINTER,
        topSkillGapsSummary: summariseSnapshotGap(snapshot),
        recentTrendCount: snapshot.recentTrendCount,
      },
      current: {
        healthSummary: summariseHealth(currentHealth),
        riskSummary: RISK_REGISTER_POINTER,
        topSkillGapsSummary: summariseSnapshotGap({ gapMap: currentGapMap }),
        recentTrendCount: 0,
      },
      milestones: decision.milestones.map((m) => ({
        title: m.title,
        status: m.status,
        targetDate: m.targetDate ? m.targetDate.toISOString().slice(0, 10) : null,
        completedDate: m.completedDate ? m.completedDate.toISOString().slice(0, 10) : null,
      })),
    };

    if (!this.hasProvider()) {
      return this.persistPlaceholder(params.decisionId, params.horizon, input);
    }

    const messages = buildDecisionReviewMessages(input);
    const resp = await this.ai.complete({
      ctx: { module: 'decisions', kind: 'outcome-review', userId: params.userId },
      messages,
      temperature: 0.3,
      maxOutputTokens: 2500,
    });

    const cleaned = resp.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    let parsed: DecisionReviewOutput | null = null;
    try {
      parsed = DecisionReviewOutputSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      this.logger.warn(`decision-review parse failed: ${(err as Error).message}`);
    }

    // Persist — overwrites any existing review for this (decisionId, horizon).
    const persisted = await prisma.decisionOutcomeReview.upsert({
      where: {
        decisionId_horizon: { decisionId: params.decisionId, horizon: params.horizon },
      },
      update: {
        narrativeTh: parsed?.narrativeTh ?? resp.text,
        narrativeEn: parsed?.narrativeEn,
        whatWorkedJson: { th: parsed?.whatWorkedTh ?? [] },
        whatDidntWorkJson: { th: parsed?.whatDidntWorkTh ?? [] },
        lessonsJson: { th: parsed?.lessonsTh ?? [] },
        aiInferenceId: resp.aiInferenceId,
        methodologyVersion: DECISION_REVIEW_VERSION,
      },
      create: {
        decisionId: params.decisionId,
        horizon: params.horizon,
        narrativeTh: parsed?.narrativeTh ?? resp.text,
        narrativeEn: parsed?.narrativeEn,
        whatWorkedJson: { th: parsed?.whatWorkedTh ?? [] },
        whatDidntWorkJson: { th: parsed?.whatDidntWorkTh ?? [] },
        lessonsJson: { th: parsed?.lessonsTh ?? [] },
        aiInferenceId: resp.aiInferenceId,
        methodologyVersion: DECISION_REVIEW_VERSION,
      },
    });

    return { review: persisted, parsed, raw: resp.text, model: resp.model, aiInferenceId: resp.aiInferenceId };
  }

  private async persistPlaceholder(
    decisionId: string,
    horizon: OutcomeReviewHorizon,
    input: DecisionReviewInput,
  ) {
    const narrative =
      'ไม่พบการตั้งค่า AI provider — การสรุปผลลัพธ์เชิงอัตโนมัติยังไม่สามารถทำได้. กรุณาตั้งค่า GOOGLE_AI_API_KEY หรือ ANTHROPIC_API_KEY.';
    const review = await prisma.decisionOutcomeReview.upsert({
      where: { decisionId_horizon: { decisionId, horizon } },
      update: {
        narrativeTh: narrative,
        whatWorkedJson: { th: [], placeholder: true },
        whatDidntWorkJson: { th: [], placeholder: true },
        lessonsJson: { th: [], placeholder: true },
        methodologyVersion: DECISION_REVIEW_VERSION,
      },
      create: {
        decisionId,
        horizon,
        narrativeTh: narrative,
        whatWorkedJson: { th: [], placeholder: true },
        whatDidntWorkJson: { th: [], placeholder: true },
        lessonsJson: { th: [], placeholder: true },
        methodologyVersion: DECISION_REVIEW_VERSION,
      },
    });
    return { review, parsed: null, raw: narrative, model: 'none', aiInferenceId: null, inputContext: input };
  }
}

// ── Summaries ────────────────────────────────────────────────────────
// The AI prompt takes stringified summaries rather than raw JSON so the
// token budget stays controlled.
function summariseHealth(health: unknown): string {
  if (!Array.isArray(health)) return '(no data)';
  const scores = health as Array<{ overall: { score: number | null } }>;
  const nonNull = scores.map((s) => s.overall.score).filter((s): s is number => s != null);
  if (nonNull.length === 0) return '(no health scores)';
  const avg = nonNull.reduce((a, b) => a + b, 0) / nonNull.length;
  return `${health.length} entities, avg overall ${avg.toFixed(0)}/100, ${nonNull.length} with non-null data`;
}

/**
 * The seven-lens analyzer's `computeRisks` oversupply lens is retired: it
 * inferred risk from a skill-level demand-vs-supply ratio that the gap map
 * no longer computes. Programme risk lives in the risk register
 * (risk-scoring), which this prompt does not read, so say so rather than
 * feeding the model "(no data)" — which it reads as "risk was not assessed".
 */
const RISK_REGISTER_POINTER = '(not part of this review — see the risk register at /risks)';
