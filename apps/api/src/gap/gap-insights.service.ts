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
  GAP_INSIGHTS_VERSION,
  GapInsightsOutputSchema,
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

    const messages = buildGapInsightsMessages(input);
    const resp = await this.ai.complete({
      ctx: { module: 'gap-analysis', kind: 'strategic-top-5', userId: params.userId },
      messages,
      temperature: 0.3,
      maxOutputTokens: 2500,
    });
    return this.parseAndPackage(resp.text, resp);
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
    const messages = buildGapInsightsMessages(input);
    const resp = await this.ai.complete({
      ctx: { module: 'gap-analysis', kind: 'program-skills-to-add', userId: params.userId },
      messages,
      temperature: 0.3,
      maxOutputTokens: 1800,
    });
    return this.parseAndPackage(resp.text, resp);
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

    const input: GapInsightsInput = {
      mode: 'sector-brief',
      sectorCode: sector.code,
      sectorNames: { en: sector.nameEn, th: sector.nameTh },
      family: sector.family,
      demandSnapshot: {
        totalDemand: row?.demandIndex ?? 0,
        topSkills: [],
        topEmployers: [],
      },
      supplySnapshot: {
        totalSupply: row?.supplyIndex ?? 0,
        topPrograms: row?.contributingProgramIds ?? [],
      },
      recentPolicySignals: recentPolicy.map((p) => p.title),
    };
    const messages = buildGapInsightsMessages(input);
    const resp = await this.ai.complete({
      ctx: { module: 'gap-analysis', kind: 'sector-brief', userId: params.userId },
      messages,
      temperature: 0.4,
      maxOutputTokens: 2500,
    });
    return this.parseAndPackage(resp.text, resp);
  }

  private parseAndPackage(raw: string, resp: { model: string; aiInferenceId: string | null; tokens: { input: number; output: number }; cost: { usd: number; model: string } }) {
    // Strip code fences the model sometimes injects despite instructions.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    let parsed: GapInsightsOutput | null = null;
    try {
      parsed = GapInsightsOutputSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      this.logger.warn(`gap-insights parse failed: ${(err as Error).message}`);
    }
    return {
      output: parsed,
      rawText: raw,
      model: resp.model,
      aiInferenceId: resp.aiInferenceId,
      tokens: resp.tokens,
      cost: resp.cost,
      methodologyVersion: GAP_INSIGHTS_VERSION,
      confidence: parsed ? 0.7 : 0.2,
    };
  }
}

function placeholder(mode: GapInsightsOutput['mode']) {
  return {
    output: null,
    rawText:
      'ไม่พบการตั้งค่า AI provider — กรุณากำหนดค่า GOOGLE_AI_API_KEY หรือ ANTHROPIC_API_KEY เพื่อสร้าง Gap insights ที่แท้จริง\n\n' +
      `(No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate ${mode} insights.)`,
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
