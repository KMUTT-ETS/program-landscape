import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, prisma, computeHealthScores, queryMetricByScope, HEALTH_SCORE_VERSION, type HealthScoreRow } from '@kku/db';
import {
  ApiError,
  createAiService,
  type AiProviderId,
  type AiService,
  type ScopeLevel,
} from '@kku/shared';
import { PrismaAiInferenceRecorder } from '@kku/db';

// Cockpit service — scope-aware reads from the materialized views and
// the health-score service. Also owns the AI brief pipeline (wraps
// AiService) and kicks off Council Pack PDF exports through
// PdfGenerationService.
//
// KPIs, heatmap, matrix, rollup are thin reads — the materialized views
// are the single source of truth. Brief + export are the only calls
// that mutate state (audit-logged at the controller via @AuditLog).

@Injectable()
export class CockpitService implements OnModuleInit {
  private readonly logger = new Logger(CockpitService.name);
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
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // KPIs
  // ────────────────────────────────────────────────────────────────────
  async kpis(scope: ScopeLevel, scopeId: string | null) {
    const enrollment = await queryMetricByScope({
      scope,
      scopeId: scopeId ?? undefined,
      family: 'enrollment',
    });
    const financial = await queryMetricByScope({
      scope,
      scopeId: scopeId ?? undefined,
      family: 'financial',
    });
    const latestEnrollment = enrollment.at(-1);
    const latestFinancial = financial.at(-1);

    const programCount = await countProgramsAtScope(scope, scopeId);

    // Health rollup at the child scope — use it to derive danger + quality counts.
    const scores = await computeHealthScores(scope, scopeId);
    const dangerZone = scores.filter((s) => (s.overall.score ?? 100) < 40).length;
    const qualityConcern = scores.filter(
      (s) => (s.dimensions.quality.score ?? 100) < 50,
    ).length;

    return {
      programCount,
      enrolledTotal: latestEnrollment?.enrolledTotal ?? null,
      netContributionTotal: latestFinancial?.netContributionTotal ?? null,
      dangerZoneCount: dangerZone,
      qualityConcernCount: qualityConcern,
      // Average curriculum age — derived from Program.yearEstablished
      // vs current year. Null when scope has no programs.
      averageCurriculumAgeYears: await averageCurriculumAge(scope, scopeId),
      methodologyVersion: HEALTH_SCORE_VERSION,
      latestFreshness:
        latestFinancial?.latestFreshness ?? latestEnrollment?.latestFreshness ?? null,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Heatmap — rows = scope children, cols = 5 dimensions.
  // ────────────────────────────────────────────────────────────────────
  async heatmap(scope: ScopeLevel, scopeId: string | null) {
    const scores = await computeHealthScores(scope, scopeId);
    return { methodologyVersion: HEALTH_SCORE_VERSION, rows: scores };
  }

  // ────────────────────────────────────────────────────────────────────
  // BCG-style bubble matrix — X demand growth, Y competitive position,
  // size = revenue, colour = net contribution.
  //
  // For v1 the inputs lean on the synthetic seed data. Real demand
  // growth needs JobThai/JobsDB connectors (mocked); real competitive
  // position needs peer data (mocked). Clearly flag `dataCompleteness`.
  // ────────────────────────────────────────────────────────────────────
  async matrix(scope: ScopeLevel, scopeId: string | null) {
    const bubbles = await bubblesForScope(scope, scopeId);
    return {
      methodologyVersion: HEALTH_SCORE_VERSION,
      axisX: { label: 'Market demand (5-yr trend)', minLabel: 'Declining', maxLabel: 'Growing' },
      axisY: { label: 'KKU competitive position', minLabel: 'Weak', maxLabel: 'Strong' },
      sizeLabel: 'Annual revenue',
      colorLabel: 'Net contribution',
      bubbles,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Rollup tree — node per faculty/department/program with headline KPIs.
  // ────────────────────────────────────────────────────────────────────
  async rollup(scope: ScopeLevel, scopeId: string | null) {
    const scores = await computeHealthScores(scope, scopeId);
    // Join in enrollment + financial per child.
    const enriched: Array<HealthScoreRow & {
      enrolledTotal: number | null;
      netContributionTotal: number | null;
      programCount: number;
    }> = [];
    for (const s of scores) {
      const e = await queryMetricByScope({
        scope: s.scope as ScopeLevel,
        scopeId: s.scopeId,
        family: 'enrollment',
      });
      const f = await queryMetricByScope({
        scope: s.scope as ScopeLevel,
        scopeId: s.scopeId,
        family: 'financial',
      });
      const le = e.at(-1);
      const lf = f.at(-1);
      enriched.push({
        ...s,
        enrolledTotal: le?.enrolledTotal ?? null,
        netContributionTotal: lf?.netContributionTotal ?? null,
        programCount: le?.programCount ?? 0,
      });
    }
    return { methodologyVersion: HEALTH_SCORE_VERSION, nodes: enriched };
  }

  // ────────────────────────────────────────────────────────────────────
  // AI brief generation — wraps AiService.complete, records to
  // AiInference (the recorder does that automatically).
  //
  // Gracefully stubs when no provider key is set: returns a placeholder
  // narrative that tells the operator what's missing, with confidence 0.
  // ────────────────────────────────────────────────────────────────────
  async generateBrief(req: {
    scope: ScopeLevel;
    scopeId: string | null;
    style: 'thai-narrative' | 'executive-summary' | 'full-deep-dive';
    userId: string;
  }) {
    const kpis = await this.kpis(req.scope, req.scopeId);
    const heatmap = await this.heatmap(req.scope, req.scopeId);

    const hasProvider = Boolean(
      this.config.get<string>('GOOGLE_AI_API_KEY') ||
        this.config.get<string>('ANTHROPIC_API_KEY'),
    );
    if (!hasProvider) {
      return {
        text:
          'ไม่พบการตั้งค่า AI provider — กรุณากำหนดค่า GOOGLE_AI_API_KEY หรือ ANTHROPIC_API_KEY ' +
          'เพื่อสร้าง Council brief ที่แท้จริง\n\n' +
          '(No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate a real brief.)',
        model: 'none',
        confidence: 0,
        aiInferenceId: null,
        tokens: { input: 0, output: 0 },
        cost: { usd: 0, model: 'none' },
        methodologyVersion: HEALTH_SCORE_VERSION,
      };
    }

    const styleDirective =
      req.style === 'thai-narrative'
        ? 'Write in Thai, conversational narrative suitable for Council opening remarks. 3-4 paragraphs.'
        : req.style === 'executive-summary'
          ? 'Write a Thai executive summary, 1 page, with bullet-point takeaways.'
          : 'Write a Thai full deep-dive, ~2 pages, structured with sections.';

    const context = summariseContextForBrief(req.scope, req.scopeId, kpis, heatmap.rows);
    const resp = await this.ai.complete({
      ctx: { module: 'cockpit', kind: 'council-brief', userId: req.userId },
      messages: [
        {
          role: 'system',
          content:
            'You are writing a Council-facing brief for KKU senior leadership. Be precise, cite the specific programs + scores you reference, acknowledge data gaps explicitly. Never fabricate numbers. Output Thai primary.',
        },
        {
          role: 'user',
          content:
            `${styleDirective}\n\n` +
            `Scope: ${req.scope}${req.scopeId ? ' / ' + req.scopeId : ''}\n\n` +
            `Context:\n${context}\n\n` +
            `Methodology version: ${HEALTH_SCORE_VERSION}. Note data-completeness gaps where relevant.`,
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 2000,
    });

    return {
      text: resp.text,
      model: resp.model,
      confidence: 0.7, // coarse — real confidence from model introspection lands later
      aiInferenceId: resp.aiInferenceId,
      tokens: resp.tokens,
      cost: resp.cost,
      methodologyVersion: HEALTH_SCORE_VERSION,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Saved views — per-user filter persistence.
  // ────────────────────────────────────────────────────────────────────
  async listSavedViews(userId: string) {
    return prisma.savedCockpitView.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
      take: 50,
    });
  }

  async saveView(
    userId: string,
    input: { name: string; viewMode: string; scope: string; scopeId: string | null; filters: Record<string, unknown> },
  ) {
    return prisma.savedCockpitView.create({
      data: {
        userId,
        name: input.name,
        viewMode: input.viewMode,
        scope: input.scope,
        scopeId: input.scopeId,
        filtersJson: input.filters as Prisma.InputJsonValue,
      },
    });
  }

  async deleteSavedView(userId: string, id: string) {
    const view = await prisma.savedCockpitView.findUnique({ where: { id } });
    if (!view) throw new ApiError('NOT_FOUND', 'view not found');
    if (view.userId !== userId) throw new ApiError('FORBIDDEN', "can't delete another user's view");
    await prisma.savedCockpitView.delete({ where: { id } });
  }

  async touchSavedView(userId: string, id: string) {
    const view = await prisma.savedCockpitView.findUnique({ where: { id } });
    if (!view || view.userId !== userId) return;
    await prisma.savedCockpitView.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers — pure functions, no service-level state.
// ──────────────────────────────────────────────────────────────────────────

async function countProgramsAtScope(scope: ScopeLevel, scopeId: string | null): Promise<number> {
  if (scope === 'university') {
    return prisma.program.count({ where: { status: 'ACTIVE' } });
  }
  if (scope === 'faculty' && scopeId) {
    return prisma.program.count({ where: { facultyId: scopeId, status: 'ACTIVE' } });
  }
  if (scope === 'department' && scopeId) {
    return prisma.program.count({ where: { departmentId: scopeId, status: 'ACTIVE' } });
  }
  if (scope === 'program' && scopeId) {
    const exists = await prisma.program.findUnique({ where: { id: scopeId } });
    return exists ? 1 : 0;
  }
  return 0;
}

async function averageCurriculumAge(scope: ScopeLevel, scopeId: string | null): Promise<number | null> {
  const whereClause: Prisma.ProgramWhereInput = { yearEstablished: { not: null } };
  if (scope === 'faculty' && scopeId) whereClause.facultyId = scopeId;
  if (scope === 'department' && scopeId) whereClause.departmentId = scopeId;
  if (scope === 'program' && scopeId) whereClause.id = scopeId;

  const rows = await prisma.program.findMany({
    where: whereClause,
    select: { yearEstablished: true },
  });
  const thisYear = new Date().getFullYear();
  const ages = rows
    .map((r) => (r.yearEstablished !== null ? thisYear - r.yearEstablished : null))
    .filter((a): a is number => a !== null);
  if (ages.length === 0) return null;
  return ages.reduce((s, a) => s + a, 0) / ages.length;
}

interface Bubble {
  id: string;
  label: string;
  level: string;
  x: number;          // 0-100 — demand growth
  y: number;          // 0-100 — competitive position
  size: number;       // revenue
  color: number;      // net contribution (can be negative)
  dataCompletenessPct: number;
}

async function bubblesForScope(scope: ScopeLevel, scopeId: string | null): Promise<Bubble[]> {
  // We always show programs as bubbles. At university scope this could
  // be a LOT — the client-side BubbleMatrix handles ~300 points fine
  // but we still cap at 200 for the first render; users zoom/filter
  // to see more.
  const where: Prisma.ProgramWhereInput = {};
  if (scope === 'faculty' && scopeId) where.facultyId = scopeId;
  if (scope === 'department' && scopeId) where.departmentId = scopeId;
  if (scope === 'program' && scopeId) where.id = scopeId;

  const programs = await prisma.program.findMany({
    where,
    take: 200,
    select: { id: true, code: true, nameEn: true, nameTh: true, level: true },
  });

  const bubbles: Bubble[] = [];
  for (const p of programs) {
    const financial = await queryMetricByScope({
      scope: 'program',
      scopeId: p.id,
      family: 'financial',
    });
    const lf = financial.at(-1);
    // Demand growth + competitive position need real signals; for now
    // we derive placeholders from the quality score and financial
    // trajectory. This is NOT a BCG matrix on real data — it's a
    // scaffolded one that the prompt-14 wiring slots into.
    const scores = await computeHealthScores('program', p.id);
    const sc = scores[0];
    if (!sc) continue;
    const competitive = sc.dimensions.quality.score ?? 50;
    const demandGrowth = sc.dimensions.demand.score ?? 50;
    const revenue = lf?.tuitionRevenueTotal ?? 0;
    const netContrib = lf?.netContributionTotal ?? 0;
    const completeness =
      ((sc.dimensions.quality.dataCompletenessPct ?? 0) +
        (sc.dimensions.demand.dataCompletenessPct ?? 0)) /
      2;

    bubbles.push({
      id: p.id,
      label: `${p.code} ${p.nameEn}`,
      level: p.level,
      x: demandGrowth,
      y: competitive,
      size: revenue,
      color: netContrib,
      dataCompletenessPct: completeness,
    });
  }

  return bubbles;
}

function summariseContextForBrief(
  scope: ScopeLevel,
  scopeId: string | null,
  kpis: Awaited<ReturnType<CockpitService['kpis']>>,
  rows: HealthScoreRow[],
): string {
  const lines: string[] = [];
  lines.push(`Programs at scope: ${kpis.programCount}`);
  lines.push(`Enrolled (latest): ${kpis.enrolledTotal ?? 'n/a'}`);
  lines.push(`Net contribution (latest): ${kpis.netContributionTotal ?? 'n/a'} THB`);
  lines.push(`Programs in danger zone (<40 overall): ${kpis.dangerZoneCount}`);
  lines.push(`Programs with quality concern: ${kpis.qualityConcernCount}`);
  lines.push(`Average curriculum age: ${kpis.averageCurriculumAgeYears?.toFixed(1) ?? 'n/a'} years`);
  lines.push('');
  lines.push('Children (top 10 by overall score):');
  rows
    .filter((r) => r.overall.score !== null)
    .sort((a, b) => (b.overall.score ?? 0) - (a.overall.score ?? 0))
    .slice(0, 10)
    .forEach((r) => {
      lines.push(
        `  ${r.scopeLabel}: overall=${r.overall.score?.toFixed(0)} ` +
          `(completeness=${r.overall.dataCompletenessPct.toFixed(0)}%)`,
      );
    });
  lines.push('');
  lines.push('Children (bottom 10):');
  rows
    .filter((r) => r.overall.score !== null)
    .sort((a, b) => (a.overall.score ?? 100) - (b.overall.score ?? 100))
    .slice(0, 10)
    .forEach((r) => {
      lines.push(
        `  ${r.scopeLabel}: overall=${r.overall.score?.toFixed(0)} ` +
          `(completeness=${r.overall.dataCompletenessPct.toFixed(0)}%)`,
      );
    });
  void scope;
  void scopeId;
  return lines.join('\n');
}
