import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  computeSectorGap,
  computeSkillGap,
  getAiModelOverrideStore,
  prisma,
  PrismaAiInferenceRecorder,
  type SectorGapRow,
  type SkillGapRow,
} from '@kku/db';
import {
  buildGapInsightsMessages,
  createAiService,
  extractStructuredWithParseRetry,
  GAP_INSIGHTS_VERSION,
  GapInsightsOutputSchema,
  lintBannedTells,
  type AiMessage,
  type AiProviderId,
  type AiService,
  type GapInsightsInput,
  type GapInsightsOutput,
} from '@kku/shared';

// Wraps AiService for the three gap-insights modes. Each mode builds its
// own context from live gap data before calling the model so the prompt
// has numeric grounding and not fabricated stats.
@Injectable()
export class GapInsightsService implements OnModuleInit {
  private readonly logger = new Logger(GapInsightsService.name);
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

  async generateStrategicTop5(params: {
    scope: 'university' | 'faculty' | 'department' | 'program';
    scopeId: string | null;
    userId: string;
  }) {
    if (!this.hasProvider()) return placeholder('strategic-top-5');

    const [skillGap, sectorGap] = await Promise.all([
      computeSkillGap({ scope: params.scope, scopeId: params.scopeId ?? undefined, horizon: 0, comparison: 'absolute', region: 'TH', limit: 10 }),
      computeSectorGap({ scope: params.scope, scopeId: params.scopeId ?? undefined, horizon: 0, comparison: 'absolute', region: 'TH', limit: 30 }),
    ]);

    const scopeLabel =
      params.scope === 'university' ? 'KKU (all faculties)' : await resolveScopeLabel(params.scope, params.scopeId);

    const input: GapInsightsInput = {
      mode: 'strategic-top-5',
      scopeLabel,
      topSkillGaps: skillGap.rows.slice(0, 10).map((r: SkillGapRow) => ({
        skillId: r.skillId,
        nameEn: r.nameEn,
        nameTh: r.nameTh,
        gap: r.gap,
        demand: r.demand,
        supply: r.supply,
      })),
      sectorSnapshot: sectorGap.rows.map((r: SectorGapRow) => ({
        sectorCode: r.sectorCode,
        nameEn: r.nameEn,
        family: r.family,
        demand: r.demandIndex,
        supply: r.supplyIndex,
        trend: r.trend,
      })),
      demographicNote:
        'Thailand 18–22 cohort projected to shrink ~1.8%/year through 2035. Supply forecasts apply demographic multiplier accordingly.',
    };

    return this.generateAndPackage(input, 'strategic-top-5', { temperature: 0.3, maxOutputTokens: 2500 }, params.userId);
  }

  async generateProgramSkillsToAdd(params: { programId: string; userId: string }) {
    if (!this.hasProvider()) return placeholder('program-skills-to-add');

    const program = await prisma.program.findUnique({
      where: { id: params.programId },
      select: { id: true, nameEn: true, nameTh: true },
    });
    if (!program) throw new Error(`program ${params.programId} not found`);
    const currentSkillRows = await prisma.programSkill.findMany({
      where: { programId: params.programId },
      include: { skill: { select: { id: true, nameEn: true, nameTh: true } } },
    });
    const currentSkillIds = new Set(currentSkillRows.map((r) => r.skillId));
    // Demanded-but-missing: top skill gap rows where the skill isn't in currentSkills.
    const skillGap = await computeSkillGap({ scope: 'university', horizon: 0, comparison: 'absolute', region: 'TH', limit: 50 });
    const missing = skillGap.rows.filter((r) => r.gap > 0 && !currentSkillIds.has(r.skillId)).slice(0, 12);

    const input: GapInsightsInput = {
      mode: 'program-skills-to-add',
      programId: params.programId,
      programName: { en: program.nameEn, th: program.nameTh },
      currentSkills: currentSkillRows.map((r) => ({ id: r.skill.id, nameEn: r.skill.nameEn, nameTh: r.skill.nameTh })),
      topDemandedSkillsMissing: missing.map((m) => ({
        id: m.skillId,
        nameEn: m.nameEn,
        nameTh: m.nameTh,
        demandEvidence: `demand=${m.demand.toFixed(1)}, top employers: ${m.topDemandingEmployers.slice(0, 2).join(', ')}`,
      })),
    };
    return this.generateAndPackage(
      input,
      'program-skills-to-add',
      { temperature: 0.3, maxOutputTokens: 1800 },
      params.userId,
    );
  }

  async generateSectorBrief(params: { sectorCode: string; userId: string }) {
    if (!this.hasProvider()) return placeholder('sector-brief');

    const sector = await prisma.sector.findUnique({ where: { code: params.sectorCode } });
    if (!sector) throw new Error(`sector ${params.sectorCode} not found`);

    // Use sector-gap row as quantitative anchor.
    const sectorGap = await computeSectorGap({ scope: 'university', horizon: 0, comparison: 'absolute', region: 'TH', limit: 100 });
    const row = sectorGap.rows.find((r) => r.sectorCode === params.sectorCode);

    // Recent policy signals tagged with this sector (best-effort: title or summary contains sector name or BCG keyword).
    const recentPolicy = await prisma.trendSignal.findMany({
      where: {
        signalType: 'POLICY',
        OR: [
          { title: { contains: sector.nameEn, mode: 'insensitive' } },
          { title: { contains: sector.nameTh } },
        ],
      },
      orderBy: { detectedDate: 'desc' },
      take: 3,
    });

    // NEW (gap-insights.v2, closing the audit's channel gap): topSkills/
    // topEmployers used to always be sent empty even though the prompt's
    // rubric already told the model to cite them by name. Derive both
    // from the same computeSkillGap() rows the Gap Analyzer module uses,
    // restricted to this sector's member skills (SkillSector join).
    const { topSkills, topEmployers } = await this.sectorDemandDetail(sector.id);

    const input: GapInsightsInput = {
      mode: 'sector-brief',
      sectorCode: sector.code,
      sectorNames: { en: sector.nameEn, th: sector.nameTh },
      family: sector.family,
      demandSnapshot: {
        totalDemand: row?.demandIndex ?? 0,
        topSkills,
        topEmployers,
      },
      supplySnapshot: {
        totalSupply: row?.supplyIndex ?? 0,
        topPrograms: row?.contributingProgramIds ?? [],
      },
      recentPolicySignals: recentPolicy.map((p) => p.title),
    };
    return this.generateAndPackage(input, 'sector-brief', { temperature: 0.4, maxOutputTokens: 2500 }, params.userId);
  }

  /** Top 5 demanded skill names + top 5 employer names for a sector,
   *  derived from computeSkillGap() rows whose skill belongs to the
   *  sector (SkillSector join), sorted by demand. See CHANNEL MANIFEST
   *  in the prompt file for why this replaced two permanently-empty
   *  arrays in v1. */
  private async sectorDemandDetail(
    sectorId: string,
  ): Promise<{ topSkills: string[]; topEmployers: string[] }> {
    const memberSkillIds = new Set(
      (await prisma.skillSector.findMany({ where: { sectorId }, select: { skillId: true } })).map(
        (s) => s.skillId,
      ),
    );
    if (memberSkillIds.size === 0) return { topSkills: [], topEmployers: [] };

    const skillGap = await computeSkillGap({
      scope: 'university',
      horizon: 0,
      comparison: 'absolute',
      region: 'TH',
      limit: 200,
    });
    const sectorRows = skillGap.rows
      .filter((r) => memberSkillIds.has(r.skillId) && r.demand > 0)
      .sort((a, b) => b.demand - a.demand);

    const topSkills = sectorRows.slice(0, 5).map((r) => r.nameEn);
    const topEmployers = [
      ...new Set(sectorRows.flatMap((r) => r.topDemandingEmployers)),
    ].slice(0, 5);
    return { topSkills, topEmployers };
  }

  /** Structured extraction + a corrective retry on parse failure
   *  (extractStructuredWithParseRetry), then a banned-tell lint pass
   *  over the free-text fields with one corrective retry — mirrors
   *  program-strategic-narrative-run.ts's two-fix pattern, adapted for
   *  a multi-field structured payload instead of one markdown string. */
  private async generateAndPackage(
    input: GapInsightsInput,
    kind: GapInsightsOutput['mode'],
    modelParams: { temperature: number; maxOutputTokens: number },
    userId: string,
  ) {
    const messages = buildGapInsightsMessages(input);
    const extractionParams = {
      ctx: { module: 'gap-analysis', kind, userId },
      methodVersion: GAP_INSIGHTS_VERSION,
      maxOutputTokens: modelParams.maxOutputTokens,
    };

    let response = await extractStructuredWithParseRetry(
      this.ai,
      { ...extractionParams, messages },
      GapInsightsOutputSchema,
      `gap-insights.${kind}`,
    );

    const violations = lintBannedTells(collectFreeText(response.parsed));
    if (violations.length > 0) {
      const correctionMessages: AiMessage[] = [
        ...messages,
        { role: 'assistant', content: response.rawText },
        {
          role: 'user',
          content: `Your draft used banned phrase(s): ${violations
            .map((v) => `"${v.phrase}"`)
            .join(', ')}. Rewrite the ENTIRE JSON without any of these words or their close paraphrases — keep the same structure and grounding rules. Return the corrected JSON in the same format as before.`,
        },
      ];
      const retry = await extractStructuredWithParseRetry(
        this.ai,
        { ...extractionParams, messages: correctionMessages },
        GapInsightsOutputSchema,
        `gap-insights.${kind}`,
      );
      const retryViolations = lintBannedTells(collectFreeText(retry.parsed));
      if (retryViolations.length > 0) {
        this.logger.warn(
          `gap-insights banned-tell lint still failing after retry (kind=${kind}): ${retryViolations.map((v) => v.phrase).join(', ')}`,
        );
      }
      response = retry;
    }

    return {
      output: response.parsed,
      rawText: response.rawText,
      model: response.model,
      aiInferenceId: response.aiInferenceId,
      tokens: response.tokens,
      cost: response.cost,
      methodologyVersion: GAP_INSIGHTS_VERSION,
      confidence: response.confidence,
    };
  }
}

/** Free-text prose fields per mode, joined for the banned-tell lint. */
function collectFreeText(output: GapInsightsOutput): string {
  if (output.mode === 'strategic-top-5') {
    return output.gaps.map((g) => `${g.title} ${g.rationale}`).join(' ');
  }
  if (output.mode === 'program-skills-to-add') {
    return output.result.skillsToAdd.map((s) => s.evidence).join(' ');
  }
  return [
    output.brief.title,
    output.brief.body,
    output.brief.strategicImplications.join(' '),
    output.brief.headlineMetrics.map((m) => m.label).join(' '),
  ].join(' ');
}

function placeholder(mode: GapInsightsOutput['mode']) {
  return {
    output: null,
    rawText: `No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate ${mode} insights.`,
    model: 'none',
    aiInferenceId: null,
    tokens: { input: 0, output: 0 },
    cost: { usd: 0, model: 'none' },
    methodologyVersion: GAP_INSIGHTS_VERSION,
    confidence: 0,
  };
}

async function resolveScopeLabel(scope: 'faculty' | 'department' | 'program', id: string | null): Promise<string> {
  if (!id) return scope;
  if (scope === 'faculty') {
    const f = await prisma.faculty.findUnique({ where: { id }, select: { nameEn: true } });
    return f ? `Faculty of ${f.nameEn}` : scope;
  }
  if (scope === 'department') {
    const d = await prisma.department.findUnique({ where: { id }, select: { nameEn: true } });
    return d ? `Department of ${d.nameEn}` : scope;
  }
  const p = await prisma.program.findUnique({ where: { id }, select: { nameEn: true } });
  return p ? `Program ${p.nameEn}` : scope;
}
