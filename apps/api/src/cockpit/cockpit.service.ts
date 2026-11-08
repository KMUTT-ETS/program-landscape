import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  prisma,
  computeHealthScores,
  currentlyEnrolledStudents,
  queryMetricByScope,
  generateProgramStrategicNarrative,
  HEALTH_SCORE_VERSION,
  realDataSql,
  type HealthScoreRow,
} from '@kku/db';
import {
  ApiError,
  createAiService,
  PROGRAM_STRATEGIC_NARRATIVE_VERSION,
  type AiProviderId,
  type AiService,
  type ScopeLevel,
  displayShortNames,
} from '@kku/shared';
import { PrismaAiInferenceRecorder, getAiModelOverrideStore } from '@kku/db';

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
      modelOverrideResolver: getAiModelOverrideStore(),
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

    // Currently-enrolled HEADCOUNT (not yearly intake) — sourced from the
    // education_student_cube via `currentlyEnrolledStudents()`, which is
    // the single source of truth for this KPI across home + cockpit.
    // Returns the total of registrar status codes 10-39 (= 36,133 at
    // university scope, matching KKU's public registry stat).
    const enrolledTotal = await currentlyEnrolledStudents(scope, scopeId);
    // Net contribution = FY 2024+ aggregate at scope. See helper note
    // for why we don't read the MV's latest-fiscal-year pivot here.
    const netContributionTotal = await netContributionAggregateAtScope(scope, scopeId);

    const programCount = await countProgramsAtScope(scope, scopeId);

    // Health rollup at the child scope — drives risk count + data confidence.
    const scores = await computeHealthScores(scope, scopeId);
    const dangerZone = scores.filter((s) => (s.overall.score ?? 100) < 40).length;
    const qualityConcern = scores.filter(
      (s) => (s.dimensions.outcomes.score ?? 100) < 50,
    ).length;

    // Average data completeness across the rows visible in the heatmap.
    // 0-100. Null when no rows. Tells Council how trustworthy the rest
    // of the dashboard is at this scope.
    const completenessSamples = scores
      .map((s) => s.overall.dataCompletenessPct)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const dataCompletenessPct =
      completenessSamples.length > 0
        ? completenessSamples.reduce((a, b) => a + b, 0) / completenessSamples.length
        : null;

    // Enrolment trend — programs at this scope with 3-yr enrolment history.
    // Used to count "at risk" (zero-enrolment OR crashing ≤-50%) and
    // "surging" (≥+50%). Replaces the stale "qualityConcern" + "avg
    // curriculum age" stats.
    const trend = await enrolmentTrendCountsAtScope(scope, scopeId);

    return {
      programCount,
      enrolledTotal,
      netContributionTotal,
      dangerZoneCount: dangerZone,
      qualityConcernCount: qualityConcern,
      atRiskCount: trend.zeroEnrolment + trend.crashing,
      surgingCount: trend.surging,
      programsWithTrend: trend.totalWithTrend,
      dataCompletenessPct,
      // Average curriculum age — derived from Program.yearEstablished
      // vs current year. Null when scope has no programs (or, today,
      // when yearEstablished is unpopulated, which is everywhere).
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
      axisY: { label: `${displayShortNames().en} competitive position`, minLabel: 'Weak', maxLabel: 'Strong' },
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
            `You are writing a Council-facing brief for ${displayShortNames().en} senior leadership. Be precise, cite the specific programs + scores you reference, acknowledge data gaps explicitly. Never fabricate numbers. Output Thai primary.`,
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
  // Program strategic narrative — regenerates via the SAME prompt the
  // per-program pipeline uses (program-strategic-narrative), persisting to
  // the programStrategicNarrative table so the deep-dive's pre-computed
  // view picks it up. The deep-dive "Regenerate" button routes here.
  //
  // This is deliberately NOT generateBrief() — that is the cockpit Council
  // brief, a different prompt. Routing regenerate through generateBrief was
  // the bug that produced "the result seems to come from a different prompt".
  // ────────────────────────────────────────────────────────────────────
  async regenerateStrategicNarrative(programId: string, userId: string) {
    const hasProvider = Boolean(
      this.config.get<string>('GOOGLE_AI_API_KEY') ||
        this.config.get<string>('ANTHROPIC_API_KEY'),
    );
    if (!hasProvider) {
      throw new ApiError(
        'AI_PROVIDER_ERROR',
        'No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate the strategic narrative.',
      );
    }

    const outcome = await generateProgramStrategicNarrative({
      programId,
      ai: this.ai,
      triggeredByUserId: userId,
    });

    if (outcome.status === 'SKIPPED') {
      throw new ApiError('NOT_FOUND', outcome.reason);
    }
    if (outcome.status !== 'SUCCEEDED') {
      throw new ApiError(
        'AI_PROVIDER_ERROR',
        `Strategic narrative generation failed: ${outcome.reason}`,
      );
    }

    return {
      text: outcome.contentMarkdown,
      model: 'program-strategic-narrative',
      confidence: outcome.confidence,
      aiInferenceId: outcome.aiInferenceId,
      tokens: { input: outcome.tokensInput, output: outcome.tokensOutput },
      cost: { usd: outcome.costUsd, model: 'program-strategic-narrative' },
      methodologyVersion: PROGRAM_STRATEGIC_NARRATIVE_VERSION,
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

interface EnrolmentTrendCounts {
  zeroEnrolment: number;
  crashing: number; // 3-yr delta ≤ -50% (excluding zero-enrolment programs)
  surging: number;  // 3-yr delta ≥ +50%
  totalWithTrend: number;
}

async function enrolmentTrendCountsAtScope(
  scope: ScopeLevel,
  scopeId: string | null,
): Promise<EnrolmentTrendCounts> {
  if (scope === 'program' && scopeId) {
    // Single-program scope is degenerate — the cockpit redirects to the
    // deep-dive in this case, so just return zeros.
    return { zeroEnrolment: 0, crashing: 0, surging: 0, totalWithTrend: 0 };
  }

  const facultyFilter =
    scope === 'faculty' && scopeId ? Prisma.sql`AND p.faculty_id = ${scopeId}` : Prisma.empty;
  const deptFilter =
    scope === 'department' && scopeId ? Prisma.sql`AND p.department_id = ${scopeId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{ zero_enrolment: bigint; crashing: bigint; surging: bigint; total_with_trend: bigint }>
  >`
    WITH latest AS (
      SELECT program_id, MAX(academic_year) as max_year FROM enrollment_metrics em0
      WHERE ${realDataSql('em0')}
      GROUP BY program_id
    ),
    trends AS (
      SELECT
        p.id,
        now_em.enrolled::int as latest,
        old_em.enrolled::int as old,
        CASE
          WHEN old_em.enrolled IS NOT NULL AND old_em.enrolled > 0
          THEN ((now_em.enrolled::numeric - old_em.enrolled::numeric) / old_em.enrolled::numeric) * 100
          ELSE NULL
        END as delta_pct
      FROM programs p
      JOIN latest l ON l.program_id = p.id
      JOIN enrollment_metrics now_em ON now_em.program_id = p.id AND now_em.academic_year = l.max_year
      LEFT JOIN enrollment_metrics old_em ON old_em.program_id = p.id AND old_em.academic_year = l.max_year - 3
      WHERE p.status = 'ACTIVE'
        AND p.sequence_no_from_sheet IS NOT NULL
        AND ${realDataSql('now_em')}
        AND (old_em.id IS NULL OR ${realDataSql('old_em')})
      ${facultyFilter}
      ${deptFilter}
    )
    SELECT
      COUNT(*) FILTER (WHERE latest = 0)::bigint as zero_enrolment,
      COUNT(*) FILTER (WHERE latest > 0 AND delta_pct IS NOT NULL AND delta_pct <= -50)::bigint as crashing,
      COUNT(*) FILTER (WHERE delta_pct IS NOT NULL AND delta_pct >= 50)::bigint as surging,
      COUNT(*)::bigint as total_with_trend
    FROM trends;
  `;
  const r = rows[0];
  return {
    zeroEnrolment: Number(r?.zero_enrolment ?? 0n),
    crashing: Number(r?.crashing ?? 0n),
    surging: Number(r?.surging ?? 0n),
    totalWithTrend: Number(r?.total_with_trend ?? 0n),
  };
}

// FY 2024+ net-contribution aggregate at scope. Matches the home
// dashboard's headline "Net contribution · FY 2024+ aggregate" —
// the cockpit was previously using the MV's single-latest-fiscal-year
// pivot which produced ~45× smaller numbers at university scope.
async function netContributionAggregateAtScope(
  scope: ScopeLevel,
  scopeId: string | null,
): Promise<number | null> {
  const programFilter: Prisma.ProgramWhereInput = {
    status: 'ACTIVE',
    sequenceNoFromSheet: { not: null },
    ...(scope === 'faculty' && scopeId ? { facultyId: scopeId } : {}),
    ...(scope === 'department' && scopeId ? { departmentId: scopeId } : {}),
  };
  const where: Prisma.FinancialMetricWhereInput = {
    fiscalYear: { gte: 2024 },
    program: programFilter,
    ...(scope === 'program' && scopeId ? { programId: scopeId } : {}),
  };
  const agg = await prisma.financialMetric.aggregate({
    _sum: { netContribution: true },
    where,
  });
  return agg._sum.netContribution !== null ? Number(agg._sum.netContribution) : null;
}

async function countProgramsAtScope(scope: ScopeLevel, scopeId: string | null): Promise<number> {
  // Cockpit operates on the canonical 297 (sheet-seeded) only. Legacy
  // mock-seed rows that still exist for staff/student joins must not
  // inflate the headline count.
  const canonical: Prisma.ProgramWhereInput = { sequenceNoFromSheet: { not: null } };
  if (scope === 'university') {
    return prisma.program.count({ where: { ...canonical, status: 'ACTIVE' } });
  }
  if (scope === 'faculty' && scopeId) {
    return prisma.program.count({ where: { ...canonical, facultyId: scopeId, status: 'ACTIVE' } });
  }
  if (scope === 'department' && scopeId) {
    return prisma.program.count({ where: { ...canonical, departmentId: scopeId, status: 'ACTIVE' } });
  }
  if (scope === 'program' && scopeId) {
    const exists = await prisma.program.findUnique({ where: { id: scopeId } });
    return exists ? 1 : 0;
  }
  return 0;
}

async function averageCurriculumAge(scope: ScopeLevel, scopeId: string | null): Promise<number | null> {
  const whereClause: Prisma.ProgramWhereInput = {
    yearEstablished: { not: null },
    sequenceNoFromSheet: { not: null },
  };
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
  // The bubble matrix is scoped to canonical-active programs only —
  // sequenceNoFromSheet IS NOT NULL AND status = 'ACTIVE'. Same scoping
  // rule as the headline KPI count (297). Without the ACTIVE filter the
  // matrix was including 4 SUNSET rows, surfacing 301 — those are
  // programs in wind-down and shouldn't influence the strategic
  // landscape view.
  const where: Prisma.ProgramWhereInput = {
    sequenceNoFromSheet: { not: null },
    status: 'ACTIVE',
  };
  if (scope === 'faculty' && scopeId) where.facultyId = scopeId;
  if (scope === 'department' && scopeId) where.departmentId = scopeId;
  if (scope === 'program' && scopeId) where.id = scopeId;

  const programs = await prisma.program.findMany({
    where,
    select: { id: true, code: true, nameEn: true, nameTh: true, level: true },
  });

  // Per-program fetch of (financial latest, health score). Originally
  // sequential (11s+ on prod). Naive Promise.all over all 297 programs
  // opened ~3000 simultaneous connections and tripped Postgres'
  // max_connections ceiling. Sweet spot: chunked Promise.all at
  // CHUNK_SIZE in parallel, sequential across chunks. With Prisma's
  // pool of ~17 (dev) / 10 (prod), 8-at-a-time runs warm without
  // queuing. Verified prod 2026-05-10. Demand growth + competitive
  // position are placeholders derived from quality + financial
  // trajectory — prompt-14 wiring will replace.
  const CHUNK_SIZE = 8;
  const enriched: Array<Bubble | null> = [];
  for (let i = 0; i < programs.length; i += CHUNK_SIZE) {
    const chunk = programs.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (p): Promise<Bubble | null> => {
        const [financial, scores] = await Promise.all([
          queryMetricByScope({ scope: 'program', scopeId: p.id, family: 'financial' }),
          computeHealthScores('program', p.id),
        ]);
        const lf = financial.at(-1);
        const sc = scores[0];
        if (!sc) return null;
        const competitive = sc.dimensions.outcomes.score ?? 50;
        const demandGrowth = sc.dimensions.attractiveness.score ?? 50;
        const revenue = lf?.tuitionRevenueTotal ?? 0;
        const netContrib = lf?.netContributionTotal ?? 0;
        const completeness =
          ((sc.dimensions.outcomes.dataCompletenessPct ?? 0) +
            (sc.dimensions.attractiveness.dataCompletenessPct ?? 0)) /
          2;
        return {
          id: p.id,
          label: `${p.code} ${p.nameEn}`,
          level: p.level as string,
          x: demandGrowth,
          y: competitive,
          size: revenue,
          color: netContrib,
          dataCompletenessPct: completeness,
        };
      }),
    );
    enriched.push(...chunkResults);
  }

  return enriched.filter((b): b is Bubble => b !== null);
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
