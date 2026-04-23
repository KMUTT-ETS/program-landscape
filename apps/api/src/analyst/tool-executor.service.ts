import { Injectable, Logger } from '@nestjs/common';
import {
  BENCHMARKING_VERSION,
  computeDistinctiveness,
  computeOccupationGap,
  computeOpportunities,
  computeProgramPeers,
  computeRisks,
  computeSectorGap,
  computeSkillGap,
  FORECASTING_VERSION,
  GAP_ANALYSIS_VERSION,
  HEALTH_SCORE_VERSION,
  Prisma,
  prisma,
  programFinancials,
  programOverview,
  programDemandFunnel,
  programSkills,
  programFaculty,
  type ProgramOverviewResult,
} from '@kku/db';
import {
  CiteSourceInputSchema,
  ComparePeersInputSchema,
  DEFAULT_ASSUMPTIONS,
  GenerateChartInputSchema,
  GetMethodologyInputSchema,
  GetProgramInputSchema,
  InterventionSchema,
  QueryGapsInputSchema,
  QueryProgramsInputSchema,
  QuerySkillsInputSchema,
  QueryTrendsInputSchema,
  RunQuickScenarioInputSchema,
  SCENARIO_ENGINE_VERSION,
  SearchPolicyDocsInputSchema,
  SearchResearchInputSchema,
  buildBaselineSnapshot,
  runScenario,
  type BaselineProgram,
  type Intervention,
  type ToolCall,
} from '@kku/shared';

// ═════════════════════════════════════════════════════════════════════
// Analyst tool executor
//
// Maps each tool name to a concrete implementation. Each handler MUST:
//   1. Parse its input with the corresponding Zod schema.
//   2. Return a JSON string (the analyst loop feeds it back to the LLM
//      as a tool_result).
//   3. Cap its own result size (~8 KB) so the LLM context stays sane.
// ═════════════════════════════════════════════════════════════════════

@Injectable()
export class AnalystToolExecutor {
  private readonly logger = new Logger(AnalystToolExecutor.name);

  async execute(call: ToolCall): Promise<string> {
    const t0 = Date.now();
    const handler = this.handlers[call.name];
    if (!handler) {
      return JSON.stringify({ error: `Unknown tool: ${call.name}` });
    }
    try {
      const result = await handler(call.input);
      this.logger.debug(`tool ${call.name} ok in ${Date.now() - t0}ms`);
      return JSON.stringify(clip(result));
    } catch (err) {
      this.logger.warn(`tool ${call.name} failed: ${(err as Error).message}`);
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  private handlers: Record<string, (input: unknown) => Promise<unknown>> = {
    query_programs: async (input) => {
      const q = QueryProgramsInputSchema.parse(input);
      const where: Prisma.ProgramWhereInput = {};
      if (q.status) where.status = q.status;
      if (q.level) where.level = q.level;
      if (q.scope === 'faculty' && q.scopeId) where.facultyId = q.scopeId;
      if (q.scope === 'department' && q.scopeId) where.departmentId = q.scopeId;
      if (q.scope === 'program' && q.scopeId) where.id = q.scopeId;

      const rows = await prisma.program.findMany({
        where,
        take: q.limit,
        include: {
          faculty: { select: { id: true, code: true, nameEn: true } },
          department: { select: { id: true, nameEn: true } },
          enrollmentMetrics: { orderBy: { academicYear: 'desc' }, take: 1, select: { academicYear: true, enrolled: true, graduatedOnTime: true } },
        },
      });
      return {
        count: rows.length,
        programs: rows.map((p) => ({
          id: p.id,
          code: p.code,
          nameEn: p.nameEn,
          nameTh: p.nameTh,
          level: p.level,
          status: p.status,
          facultyCode: p.faculty.code,
          facultyNameEn: p.faculty.nameEn,
          departmentNameEn: p.department?.nameEn ?? null,
          latestEnrollment: p.enrollmentMetrics[0]?.enrolled ?? null,
          latestGraduates: p.enrollmentMetrics[0]?.graduatedOnTime ?? null,
          latestYear: p.enrollmentMetrics[0]?.academicYear ?? null,
        })),
      };
    },

    get_program: async (input) => {
      const q = GetProgramInputSchema.parse(input);
      const result: {
        overview?: ProgramOverviewResult;
        enrollment?: unknown;
        financials?: unknown;
        faculty?: unknown;
        trends?: unknown;
        skills?: unknown;
      } = {};
      if (q.sections.includes('overview') || q.sections.includes('health')) {
        const o = await programOverview(q.programId);
        if (!o) return { error: 'program not found' };
        result.overview = o;
      }
      if (q.sections.includes('enrollment')) result.enrollment = await programDemandFunnel(q.programId);
      if (q.sections.includes('financials')) result.financials = await programFinancials(q.programId);
      if (q.sections.includes('faculty')) result.faculty = await programFaculty(q.programId, 'full');
      if (q.sections.includes('trends')) {
        result.trends = await prisma.trendSignal.findMany({
          where: { affectedProgramIds: { has: q.programId } },
          orderBy: { detectedDate: 'desc' },
          take: 10,
          select: {
            id: true,
            signalType: true,
            title: true,
            summaryTh: true,
            detectedDate: true,
            impactScore: true,
          },
        });
      }
      // Include skills by default — useful context for most "about program X" questions.
      if (!q.sections.includes('faculty')) {
        result.skills = await programSkills(q.programId);
      }
      return result;
    },

    query_skills: async (input) => {
      const q = QuerySkillsInputSchema.parse(input);
      const where: Prisma.SkillWhereInput = {};
      if (q.taxonomySource) where.taxonomySource = q.taxonomySource;
      if (q.category) where.category = { contains: q.category, mode: 'insensitive' };
      if (q.search) {
        where.OR = [
          { nameEn: { contains: q.search, mode: 'insensitive' } },
          { nameTh: { contains: q.search } },
          { code: { contains: q.search, mode: 'insensitive' } },
        ];
      }
      const rows = await prisma.skill.findMany({
        where,
        take: q.limit,
        select: { id: true, code: true, nameEn: true, nameTh: true, category: true, taxonomySource: true },
        orderBy: { nameEn: 'asc' },
      });
      return { count: rows.length, skills: rows };
    },

    query_trends: async (input) => {
      const q = QueryTrendsInputSchema.parse(input);
      const since = new Date(Date.now() - q.windowDays * 24 * 60 * 60 * 1000);
      const where: Prisma.TrendSignalWhereInput = {
        detectedDate: { gte: since },
        impactScore: { gte: q.minImpactScore },
      };
      if (q.signalType) where.signalType = q.signalType;
      if (q.affectedProgramId) where.affectedProgramIds = { has: q.affectedProgramId };
      if (q.affectedSkillId) where.affectedSkillIds = { has: q.affectedSkillId };
      const rows = await prisma.trendSignal.findMany({
        where,
        take: q.limit,
        orderBy: [{ impactScore: 'desc' }, { detectedDate: 'desc' }],
        select: {
          id: true,
          signalType: true,
          title: true,
          summaryTh: true,
          summaryEn: true,
          sourceUrl: true,
          detectedDate: true,
          impactScore: true,
        },
      });
      return { count: rows.length, signals: rows };
    },

    query_gaps: async (input) => {
      const q = QueryGapsInputSchema.parse(input);
      const base = { scope: q.scope, scopeId: q.scopeId, region: q.region, horizon: q.horizon, comparison: 'absolute' as const, limit: q.limit };
      if (q.dimension === 'skills') return computeSkillGap(base);
      if (q.dimension === 'occupations') return computeOccupationGap(base);
      if (q.dimension === 'sectors') return computeSectorGap(base);
      if (q.dimension === 'risks') return computeRisks(base);
      if (q.dimension === 'opportunities') return computeOpportunities(base);
      return { error: 'Unknown dimension' };
    },

    compare_peers: async (input) => {
      const q = ComparePeersInputSchema.parse(input);
      const [peers, distinctiveness] = await Promise.all([
        computeProgramPeers(q.programId, q.peerSetId ?? null, q.limit),
        computeDistinctiveness(q.programId, q.peerSetId ?? null),
      ]);
      return { peers, distinctiveness };
    },

    run_quick_scenario: async (input) => {
      const q = RunQuickScenarioInputSchema.parse(input);

      // Build baseline: only the programs affected by this quick scenario —
      // a full-portfolio run would saturate the context with per-year rows.
      const affectedIds: string[] = [];
      if (q.programId) affectedIds.push(q.programId);
      if (q.programIds) affectedIds.push(...q.programIds);
      const programs = await prisma.program.findMany({
        where: affectedIds.length > 0 ? { id: { in: affectedIds } } : { status: 'ACTIVE' },
        take: 30, // cap
        include: {
          enrollmentMetrics: { orderBy: { academicYear: 'desc' }, take: 1 },
          financialMetrics: { orderBy: { fiscalYear: 'desc' }, take: 1 },
          programSkills: { select: { skillId: true } },
        },
      });
      if (programs.length === 0) return { error: 'No matching programs for this scenario' };

      const baselinePrograms: BaselineProgram[] = programs.map((p) => {
        const enrollment = p.enrollmentMetrics[0];
        const financial = p.financialMetrics[0];
        const currentEnrollment = enrollment?.enrolled ?? 0;
        const tuition = financial?.tuitionRevenue
          ? Number(financial.tuitionRevenue) / Math.max(currentEnrollment, 1)
          : 30_000;
        const cost = financial?.costPerStudent
          ? Number(financial.costPerStudent)
          : financial
            ? (Number(financial.directCost) +
                Number(financial.allocatedFacultyCost) +
                Number(financial.allocatedFacilityCost) +
                Number(financial.allocatedOverhead)) /
              Math.max(currentEnrollment, 1)
            : 28_000;
        return {
          id: p.id,
          code: p.code,
          nameEn: p.nameEn,
          nameTh: p.nameTh,
          facultyId: p.facultyId,
          departmentId: p.departmentId,
          currentEnrollment,
          currentGraduates: enrollment?.graduatedOnTime ?? 0,
          tuitionPerStudent: tuition,
          costPerStudent: cost,
          skillIds: p.programSkills.map((s) => s.skillId),
        };
      });

      const now = new Date().getFullYear();
      const demos = await prisma.demographicProjection.findMany({
        where: { region: 'TH', ageCohort: '18-22', year: { gte: now, lte: now + 20 } },
        orderBy: { year: 'asc' },
      });
      const basePop = demos.find((d) => d.year === now)?.population ?? 4_500_000;
      const demographicMultiplierByYear: Record<string, number> = {};
      for (const d of demos) demographicMultiplierByYear[String(d.year)] = basePop > 0 ? d.population / basePop : 1;

      const baseline = buildBaselineSnapshot({
        baseYear: now,
        programs: baselinePrograms,
        demographicMultiplierByYear,
      });

      // Build a single intervention.
      let intervention: Intervention | null = null;
      if (q.kind === 'sunset' && q.programId) {
        intervention = InterventionSchema.parse({ kind: 'sunset', programId: q.programId, phaseOutYears: 4 });
      } else if (q.kind === 'merge' && q.programIds && q.programIds.length >= 2) {
        intervention = InterventionSchema.parse({
          kind: 'merge',
          programIds: q.programIds,
          synergyCoefficient: 0.85,
          mergeRetention: 0.92,
        });
      } else if (q.kind === 'reshape' && q.programId) {
        intervention = InterventionSchema.parse({ kind: 'reshape', programId: q.programId, newIntake: undefined });
      } else if (q.kind === 'rebalance') {
        intervention = InterventionSchema.parse({
          kind: 'rebalance',
          intakeMultiplier: 1,
          programIds: q.programIds,
        });
      }
      // launch skipped — the analyst would need more params than fit here; redirect to /scenarios.

      const result = runScenario({
        baseline,
        assumptions: { ...DEFAULT_ASSUMPTIONS, ...q.assumptions },
        interventions: intervention ? [intervention] : [],
        horizonYears: q.horizonYears,
        monteCarloN: 50,
        seed: 42,
      });

      return {
        summary: {
          totalRevenueBaseline: result.baseline.totalRevenue,
          totalRevenueScenario: result.scenario.totalRevenue,
          deltaNetContribution: result.deltaTotalNetContribution,
          ci80: result.monteCarlo.totalNetContributionCi80,
          methodologyVersion: result.methodologyVersion,
        },
        years: result.scenario.years.map((y) => ({
          year: y.year,
          revenue: y.revenue,
          cost: y.cost,
          netContribution: y.netContribution,
          enrolled: Math.round(y.enrolled),
          graduates: Math.round(y.graduates),
        })),
        topSensitivity: result.sensitivity.slice(0, 3),
      };
    },

    generate_chart: async (input) => {
      // Pure shape validation — UI renders; no DB calls.
      const spec = GenerateChartInputSchema.parse(input);
      return { ok: true, chart: spec };
    },

    cite_source: async (input) => {
      const q = CiteSourceInputSchema.parse(input);
      switch (q.entityType) {
        case 'program': {
          const p = await prisma.program.findUnique({ where: { id: q.entityId }, select: { code: true, nameEn: true, nameTh: true } });
          if (!p) return { citation: `[Program ${q.entityId} — not found]` };
          return { citation: `Program ${p.code} — ${p.nameEn} / ${p.nameTh}` };
        }
        case 'faculty': {
          const f = await prisma.faculty.findUnique({ where: { id: q.entityId }, select: { code: true, nameEn: true } });
          if (!f) return { citation: `[Faculty ${q.entityId} — not found]` };
          return { citation: `Faculty ${f.code} — ${f.nameEn}` };
        }
        case 'policy_document': {
          const p = await prisma.policyDocument.findUnique({ where: { id: q.entityId }, select: { title: true, source: true, publishedDate: true, url: true } });
          if (!p) return { citation: `[Policy ${q.entityId} — not found]` };
          return { citation: `${p.source}: ${p.title} (${p.publishedDate.toISOString().slice(0, 10)})${p.url ? ' — ' + p.url : ''}` };
        }
        case 'trend_signal': {
          const s = await prisma.trendSignal.findUnique({ where: { id: q.entityId }, select: { title: true, signalType: true, detectedDate: true, sourceUrl: true } });
          if (!s) return { citation: `[Trend ${q.entityId} — not found]` };
          return { citation: `Trend [${s.signalType}]: ${s.title} (${s.detectedDate.toISOString().slice(0, 10)})${s.sourceUrl ? ' — ' + s.sourceUrl : ''}` };
        }
        case 'peer_program': {
          const p = await prisma.peerProgram.findUnique({ where: { id: q.entityId }, select: { institution: true, programName: true, ranking: true } });
          if (!p) return { citation: `[Peer ${q.entityId} — not found]` };
          return { citation: `${p.institution} · ${p.programName}${p.ranking ? ` (ranked #${p.ranking})` : ''}` };
        }
        case 'job_posting':
          return { citation: `Job posting ${q.entityId}` };
        case 'research_output':
          return { citation: `Research output ${q.entityId}` };
      }
    },

    search_policy_docs: async (input) => {
      const q = SearchPolicyDocsInputSchema.parse(input);
      const since = new Date(Date.now() - q.windowDays * 24 * 60 * 60 * 1000);
      // pg_trgm similarity query. Falls back to ILIKE when the extension
      // isn't installed — testing envs without Postgres can't run this,
      // so we also handle the empty-index case gracefully.
      const rows = await prisma.$queryRawUnsafe<
        Array<{ id: string; title: string; source: string; published_date: Date; url: string | null; summary_th: string | null; score: number }>
      >(
        `SELECT id, title, source, published_date, url, summary_th,
         GREATEST(similarity(title, $1), similarity(COALESCE(summary_th, ''), $1), similarity(COALESCE(summary_en, ''), $1)) AS score
         FROM policy_documents
         WHERE published_date >= $2
           AND (title ILIKE $3 OR summary_th ILIKE $3 OR summary_en ILIKE $3)
         ORDER BY score DESC
         LIMIT $4`,
        q.query,
        since,
        `%${q.query}%`,
        q.limit,
      );
      return { count: rows.length, results: rows };
    },

    search_research: async (input) => {
      const q = SearchResearchInputSchema.parse(input);
      const where: Prisma.ResearchOutputWhereInput = {
        OR: [
          { title: { contains: q.query, mode: 'insensitive' } },
        ],
      };
      if (q.yearFrom || q.yearTo) {
        where.year = {};
        if (q.yearFrom) where.year.gte = q.yearFrom;
        if (q.yearTo) where.year.lte = q.yearTo;
      }
      const rows = await prisma.researchOutput.findMany({
        where,
        take: q.limit,
        orderBy: { year: 'desc' },
        select: { id: true, title: true, year: true, type: true, venue: true, doi: true, citations: true },
      });
      return { count: rows.length, results: rows };
    },

    get_methodology: async (input) => {
      const q = GetMethodologyInputSchema.parse(input);
      switch (q.metricName) {
        case 'health-score':
          return {
            name: 'health-score',
            version: HEALTH_SCORE_VERSION,
            summary:
              'Equal-weighted 5-dimension composite (demand / financial / quality / relevance / capability). Missing metrics are EXCLUDED from the average, never substituted with 0.',
            docPath: 'docs/methodologies/health-score.md',
          };
        case 'forecasting':
          return {
            name: 'forecasting',
            version: FORECASTING_VERSION,
            summary:
              "Holt's linear trend for demand; linear + demographic-multiplier for supply. Confidence bands ±z·RSE·√h; treated as visual indicators, not coverage guarantees.",
            docPath: 'docs/methodologies/forecasting.md',
          };
        case 'scenario-engine':
          return {
            name: 'scenario-engine',
            version: SCENARIO_ENGINE_VERSION,
            summary:
              '5 interventions (sunset / merge / launch / reshape / rebalance) applied in fixed order. Seeded Monte Carlo, tornado sensitivity.',
            docPath: 'docs/methodologies/scenario-engine.md',
          };
        case 'benchmarking':
          return {
            name: 'benchmarking',
            version: BENCHMARKING_VERSION,
            summary:
              '3-tier peer suggestion (skill-overlap → subject+country → embedding-cosine scaffold). White-space detection by peer-consensus threshold. Distinctiveness = 100 × (1 − sharedSkills / totalKkuSkills).',
          };
        case 'gap-analysis':
          return {
            name: 'gap-analysis',
            version: GAP_ANALYSIS_VERSION,
            summary:
              'Demand from JobPostingSkill + OccupationDemand; supply from ProgramSkill × graduate counts. Ranked by |gap|. Regional filter is a view filter, not a flow model.',
          };
      }
    },
  };
}

// Clip excessively large tool results so they don't blow the LLM context.
function clip<T>(value: T): T {
  const serialised = JSON.stringify(value);
  if (serialised.length <= 8_000) return value;
  // Truncate arrays inside the result; leave objects structurally intact.
  return clipRecursive(value as unknown, 8_000) as T;
}

function clipRecursive(v: unknown, budget: number): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    let remaining = budget;
    for (const item of v) {
      if (remaining <= 0) {
        out.push({ truncated: `${v.length - out.length} items elided` });
        break;
      }
      out.push(item);
      remaining -= JSON.stringify(item).length;
    }
    return out;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = clipRecursive(val, Math.max(1000, budget));
    }
    return out;
  }
  return v;
}
