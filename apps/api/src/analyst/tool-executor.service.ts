import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
  programCourses,
  programFinancials,
  programOverview,
  programDemandFunnel,
  programSkills,
  programFaculty,
  realDataWhere,
  type ProgramOverviewResult,
} from '@kku/db';
import type { SessionUser } from '@kku/shared';
import { clampScopeForUser, seesAllScopes } from '../common/scope-guards';
import {
  CiteSourceInputSchema,
  ComparePeersInputSchema,
  DEFAULT_ASSUMPTIONS,
  GenerateChartInputSchema,
  GetEducationKpisInputSchema,
  GetMethodologyInputSchema,
  GetProgramInputSchema,
  QueryProgramCoursesInputSchema,
  GetRiskPortfolioInputSchema,
  GetStaffKpisInputSchema,
  InterventionSchema,
  ListDataSourcesInputSchema,
  QueryAiExtractionsInputSchema,
  QueryGapsInputSchema,
  QueryPdfLibraryInputSchema,
  QueryPipelineRunsInputSchema,
  QueryProgramsInputSchema,
  QueryRecruitmentInputSchema,
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
import { listPortfolioRisk, scopeFunnelLatestYear } from '@kku/db';

// ═════════════════════════════════════════════════════════════════════
// Analyst tool executor
//
// Maps each tool name to a concrete implementation. Each handler MUST:
//   1. Parse its input with the corresponding Zod schema.
//   2. Return a JSON string (the analyst loop feeds it back to the LLM
//      as a tool_result).
//   3. Cap its own result size (~8 KB) so the LLM context stays sane.
// ═════════════════════════════════════════════════════════════════════

// Tools whose `scope`/`scopeId` arguments need server-side clamping
// against the caller's actual scope. Listed explicitly so a new tool
// doesn't accidentally inherit (or skip) the clamp.
const SPATIAL_TOOLS = new Set(['query_programs', 'get_program', 'query_gaps']);

@Injectable()
export class AnalystToolExecutor {
  private readonly logger = new Logger(AnalystToolExecutor.name);

  /**
   * Execute a tool call.
   *
   * The optional `caller` enables server-side scope authorisation —
   * for spatial tools we clamp the model-supplied `scope`/`scopeId`
   * (or `programId`) against the caller's actual reach. The model
   * doesn't get to escape its caller's scope by passing wider args.
   *
   * `caller` is left optional for backward compatibility with the
   * existing test surface; production call sites in
   * `analyst.service.ts` always pass it.
   */
  async execute(call: ToolCall, caller?: SessionUser): Promise<string> {
    const t0 = Date.now();
    const handler = this.handlers[call.name];
    if (!handler) {
      return JSON.stringify({ error: `Unknown tool: ${call.name}` });
    }
    try {
      // ── Server-side scope clamp (prompt 10) ────────────────────────
      // Apply BEFORE the handler runs so the clamped values are what
      // hit Prisma. The model never sees the clamp — it gets results
      // for whatever it asked, restricted to what the caller is allowed
      // to see. For wider-than-allowed asks, the helper either narrows
      // (FACULTY_USER asking 'university' → narrows to their faculty)
      // or 403s (PROGRAM_USER asking another program's id).
      let clampedInput: unknown = call.input;
      if (caller && SPATIAL_TOOLS.has(call.name)) {
        clampedInput = await clampSpatialInput(call.name, call.input, caller);
      }
      const result = await handler(clampedInput);
      this.logger.debug(`tool ${call.name} ok in ${Date.now() - t0}ms`);
      return JSON.stringify(clip(result));
    } catch (err) {
      if (err instanceof ForbiddenException) {
        this.logger.warn(`tool ${call.name} refused by scope guard: ${err.message}`);
        return JSON.stringify({ error: `forbidden: ${err.message}` });
      }
      this.logger.warn(`tool ${call.name} failed: ${(err as Error).message}`);
      return JSON.stringify({ error: (err as Error).message });
    }
  }

  private handlers: Record<string, (input: unknown) => Promise<unknown>> = {
    query_programs: async (input) => {
      const q = QueryProgramsInputSchema.parse(input);
      // Analyst always operates on the canonical 297 (sheet-seeded
      // KKU programs). Legacy mock-seed Program rows must not surface
      // in tool results — they exist only for staff/student joins.
      const where: Prisma.ProgramWhereInput = { sequenceNoFromSheet: { not: null } };
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
          enrollmentMetrics: { where: realDataWhere(), orderBy: { academicYear: 'desc' }, take: 1, select: { academicYear: true, enrolled: true, graduatedOnTime: true } },
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

    query_program_courses: async (input) => {
      const q = QueryProgramCoursesInputSchema.parse(input);
      return await programCourses(q.programId);
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
        where:
          affectedIds.length > 0
            ? { id: { in: affectedIds } }
            : { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
        take: 30, // cap
        include: {
          enrollmentMetrics: { where: realDataWhere(), orderBy: { academicYear: 'desc' }, take: 1 },
          financialMetrics: { where: realDataWhere(), orderBy: { fiscalYear: 'desc' }, take: 1 },
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
      //
      // SAFETY: $queryRawUnsafe is acceptable here because the SQL string
      // is a constant template — only $1..$4 placeholders are filled, and
      // every value is supplied via Postgres positional parameter binding
      // (q.query, since, `%${q.query}%`, q.limit). No user input is
      // concatenated into the SQL string itself. q.query is also Zod-
      // validated upstream by SearchPolicyDocsInputSchema.
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

    // ── Operational + observability tools ──────────────────────────
    // These wrap the admin endpoints + materialised dashboard summaries
    // so the analyst can answer "is kku-finance live?", "how many
    // curriculum PDFs do we have?", "what's our staff headcount?".

    list_data_sources: async (input) => {
      const q = ListDataSourcesInputSchema.parse(input);
      const sources = await prisma.dataSource.findMany({
        take: q.limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          slug: true,
          name: true,
          ownerContact: true,
          cadenceCron: true,
          scheduleEnabled: true,
          status: true,
          // Latest 7-day window of runs, used to compute a rough
          // success rate without a separate aggregation query.
          ingestionRuns: {
            orderBy: { createdAt: 'desc' },
            take: 7,
            select: {
              status: true,
              createdAt: true,
              recordsLoaded: true,
              durationMs: true,
            },
          },
        },
      });
      const items = sources
        .map((s) => {
          const last = s.ingestionRuns[0];
          const succeeded = s.ingestionRuns.filter(
            (r) => r.status === 'SUCCEEDED',
          ).length;
          const total = s.ingestionRuns.length;
          // DataSource.status is the live "mocked" / "real" tag.
          const mode =
            (s.status === 'mocked' ? 'mocked' : 'real') as 'mocked' | 'real';
          if (q.mode !== 'all' && q.mode !== mode) return null;
          return {
            slug: s.slug,
            name: s.name,
            mode,
            scheduleEnabled: s.scheduleEnabled,
            cadenceCron: s.cadenceCron,
            ownerContact: s.ownerContact,
            lastRunStatus: last?.status ?? null,
            lastRunAt: last?.createdAt ?? null,
            recentSuccessRate:
              total > 0 ? Math.round((succeeded / total) * 100) : null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return { count: items.length, sources: items };
    },

    query_pipeline_runs: async (input) => {
      const q = QueryPipelineRunsInputSchema.parse(input);
      const since = new Date(Date.now() - q.windowDays * 86_400_000);
      const where: Prisma.IngestionRunWhereInput = {
        createdAt: { gte: since },
      };
      if (q.status) where.status = q.status;
      if (q.slug) {
        const src = await prisma.dataSource.findUnique({
          where: { slug: q.slug },
          select: { id: true },
        });
        if (!src) return { count: 0, runs: [], note: `unknown slug: ${q.slug}` };
        where.dataSourceId = src.id;
      }
      const runs = await prisma.ingestionRun.findMany({
        where,
        take: q.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          trigger: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          recordsLoaded: true,
          recordsFailed: true,
          errorCode: true,
          errorMessage: true,
          dataSource: { select: { slug: true, name: true } },
        },
      });
      return {
        count: runs.length,
        runs: runs.map((r) => ({
          slug: r.dataSource.slug,
          sourceName: r.dataSource.name,
          status: r.status,
          trigger: r.trigger,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          durationMs: r.durationMs,
          recordsLoaded: r.recordsLoaded,
          recordsFailed: r.recordsFailed,
          errorCode: r.errorCode,
          // Trim long error messages so they don't blow the LLM context.
          errorMessage:
            r.errorMessage && r.errorMessage.length > 400
              ? r.errorMessage.slice(0, 400) + ' …'
              : r.errorMessage,
        })),
      };
    },

    query_pdf_library: async (input) => {
      const q = QueryPdfLibraryInputSchema.parse(input);
      const where: Prisma.PdfDocumentWhereInput = {};
      if (q.sourceCategory) where.sourceCategory = q.sourceCategory as never;
      if (q.processingStatus) where.processingStatus = q.processingStatus;
      if (q.query) {
        where.OR = [
          { originalFilename: { contains: q.query, mode: 'insensitive' } },
          { sourceOrg: { contains: q.query, mode: 'insensitive' } },
        ];
      }
      const rows = await prisma.pdfDocument.findMany({
        where,
        take: q.limit,
        orderBy: { uploadedAt: 'desc' },
        select: {
          id: true,
          originalFilename: true,
          sourceCategory: true,
          sourceOrg: true,
          processingStatus: true,
          uploadedAt: true,
          pageCount: true,
          fileSize: true,
        },
      });
      return { count: rows.length, pdfs: rows };
    },

    query_ai_extractions: async (input) => {
      const q = QueryAiExtractionsInputSchema.parse(input);
      const where: Prisma.AiExtractionWhereInput = {};
      if (q.extractionType) where.extractionKind = q.extractionType;
      if (q.reviewStatus) where.reviewStatus = q.reviewStatus;
      // AiExtraction uses a generic (sourceEntityType, sourceEntityId)
      // anchor — for PROGRAM_DIGEST rows the program id is stored
      // there. Matches the materialise pipeline in @kku/db.
      if (q.programId) {
        where.sourceEntityType = 'program';
        where.sourceEntityId = q.programId;
      }
      const rows = await prisma.aiExtraction.findMany({
        where,
        take: q.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          extractionKind: true,
          sourceEntityType: true,
          sourceEntityId: true,
          reviewStatus: true,
          confidence: true,
          methodVersion: true,
          createdAt: true,
        },
      });
      // Resolve program names for any program-anchored rows in a single
      // batched lookup so the LLM gets a human-readable label.
      const programIds = [
        ...new Set(
          rows
            .filter((r) => r.sourceEntityType === 'program')
            .map((r) => r.sourceEntityId),
        ),
      ];
      const programs = programIds.length
        ? await prisma.program.findMany({
            where: { id: { in: programIds } },
            select: { id: true, code: true, nameEn: true },
          })
        : [];
      const programById = new Map(programs.map((p) => [p.id, p]));
      return {
        count: rows.length,
        extractions: rows.map((r) => {
          const p =
            r.sourceEntityType === 'program'
              ? programById.get(r.sourceEntityId)
              : undefined;
          return {
            id: r.id,
            extractionKind: r.extractionKind,
            sourceEntityType: r.sourceEntityType,
            sourceEntityId: r.sourceEntityId,
            programCode: p?.code ?? null,
            programNameEn: p?.nameEn ?? null,
            reviewStatus: r.reviewStatus,
            confidence: r.confidence,
            methodVersion: r.methodVersion,
            createdAt: r.createdAt,
          };
        }),
      };
    },

    get_education_kpis: async (input) => {
      const q = GetEducationKpisInputSchema.parse(input);
      const include = new Set(
        q.include ?? ['student', 'location', 'tuition', 'performance', 'entryScores', 'recruitment'],
      );
      const facWhere = q.facultyName ? { facultyName: q.facultyName } : {};
      const out: Record<string, unknown> = {};
      if (include.has('student')) {
        const totalActive = await prisma.educationStudentCube.aggregate({
          where: { ...facWhere, statusCode: 10 },
          _sum: { studentCount: true },
        });
        out.studentTotalActive = totalActive._sum.studentCount ?? 0;
      }
      if (include.has('location')) {
        const byRegion = await prisma.educationStudentLocationCube.groupBy({
          by: ['thaiRegion'],
          where: facWhere,
          _sum: { studentCount: true },
        });
        out.studentByRegion = byRegion.map((r) => ({
          region: r.thaiRegion,
          studentCount: r._sum.studentCount ?? 0,
        }));
      }
      if (include.has('tuition')) {
        const tuitionByYear = await prisma.educationTuitionCube.groupBy({
          by: ['academicYearBe'],
          where: facWhere,
          _sum: { revenueThb: true, studentCount: true },
          orderBy: { academicYearBe: 'desc' },
          take: 5,
        });
        out.tuitionByYear = tuitionByYear.map((r) => ({
          academicYearBe: r.academicYearBe,
          revenueThb: Number(r._sum.revenueThb ?? 0),
          studentCount: r._sum.studentCount ?? 0,
        }));
      }
      if (include.has('performance')) {
        const perf = await prisma.educationPerformanceCube.aggregate({
          where: facWhere,
          _sum: { gpaSum: true, gpaCount: true, entryGpaSum: true, entryGpaCount: true },
        });
        out.gpaAverage =
          (perf._sum.gpaCount ?? 0) > 0
            ? Number((perf._sum.gpaSum ?? 0)) / (perf._sum.gpaCount ?? 1)
            : null;
        out.entryGpaAverage =
          (perf._sum.entryGpaCount ?? 0) > 0
            ? Number((perf._sum.entryGpaSum ?? 0)) / (perf._sum.entryGpaCount ?? 1)
            : null;
      }
      if (include.has('entryScores')) {
        const topSubjects = await prisma.educationEntryScoreCube.groupBy({
          by: ['subjectCode', 'subjectName'],
          _sum: { scoreSum: true, scoreCount: true, studentCount: true },
          orderBy: { _sum: { studentCount: 'desc' } },
          take: 5,
        });
        out.topEntryScoreSubjects = topSubjects.map((r) => ({
          subjectCode: r.subjectCode,
          subjectName: r.subjectName,
          meanScore:
            (r._sum.scoreCount ?? 0) > 0
              ? Number((r._sum.scoreSum ?? 0)) / (r._sum.scoreCount ?? 1)
              : null,
          studentCount: r._sum.studentCount ?? 0,
        }));
      }
      if (include.has('recruitment')) {
        // ADMISSION_STAT via the funnel adapter — latest COMPLETE year.
        const totals = await scopeFunnelLatestYear('university', null);
        if (totals.entryYearBE !== null) {
          out.recruitmentLatestYearBe = totals.entryYearBE;
          out.recruitmentTotals = {
            planPerYear: totals.planPerYear,
            enrollSeats: totals.enrollSeats,
            totalApplicants: totals.totalApplicants,
            regReported: totals.regReported,
          };
        }
      }
      return out;
    },

    get_staff_kpis: async (input) => {
      const q = GetStaffKpisInputSchema.parse(input);
      const include = new Set(q.include ?? ['workforce', 'compensation', 'research', 'lifecycle']);
      const facWhere = q.facultyName ? { facultyName: q.facultyName } : {};
      const out: Record<string, unknown> = {};
      if (include.has('workforce')) {
        const total = await prisma.facultyMember.count({ where: { isActive: true } });
        const byRank = await prisma.facultyMember.groupBy({
          by: ['rank'],
          where: { isActive: true },
          _count: true,
        });
        out.workforceTotalActive = total;
        out.workforceByRank = byRank.map((r) => ({ rank: r.rank, count: r._count }));
      }
      if (include.has('compensation')) {
        // "Where salaries come from" — sum headcount + sum salary per
        // salType. Same shape as the /staff/compensation viz uses.
        const rows = await prisma.staffCompensationCube.findMany({
          where: { ...facWhere, isAcademic: true },
          select: { salType: true, headcount: true, sumSalary: true, fiscalYear: true },
        });
        const latestFy = Math.max(0, ...rows.map((r) => r.fiscalYear));
        const map = new Map<string, { headcount: number; sumSalary: number }>();
        for (const r of rows.filter((r) => r.fiscalYear === latestFy)) {
          const k = (r.salType ?? '').trim() || 'เงินรายได้';
          const acc = map.get(k) ?? { headcount: 0, sumSalary: 0 };
          acc.headcount += r.headcount;
          acc.sumSalary += Number(r.sumSalary);
          map.set(k, acc);
        }
        out.compensationBySalType = [...map.entries()].map(([salType, v]) => ({
          salType,
          headcount: v.headcount,
          totalMonthlySalaryThb: v.sumSalary,
        }));
      }
      if (include.has('research')) {
        const total = await prisma.researchOutput.count();
        const recentYear = new Date().getUTCFullYear();
        const last5 = await prisma.researchOutput.count({
          where: { year: { gte: recentYear - 5 } },
        });
        out.researchOutputTotal = total;
        out.researchOutputLast5Years = last5;
      }
      if (include.has('lifecycle')) {
        const joiners = await prisma.facultyMember.count({
          where: {
            hireDate: {
              gte: new Date(Date.now() - 365 * 86_400_000),
            },
          },
        });
        const retiringSoon = await prisma.facultyMember.count({
          where: {
            isActive: true,
            retirementDate: {
              not: null,
              lte: new Date(Date.now() + 5 * 365 * 86_400_000),
            },
          },
        });
        out.joinersLast12Months = joiners;
        out.retiringWithin5Years = retiringSoon;
      }
      return out;
    },

    get_risk_portfolio: async (input) => {
      const q = GetRiskPortfolioInputSchema.parse(input);
      const rows = await listPortfolioRisk({
        level: q.level,
        facultyId: q.facultyId,
      });
      const filtered = q.riskLevel
        ? rows.filter((r) => r.kkuRiskLevel === q.riskLevel)
        : rows;
      const top = filtered
        .slice()
        .sort((a, b) => (b.kkuMatrixScore ?? 0) - (a.kkuMatrixScore ?? 0))
        .slice(0, q.limit);
      return {
        count: top.length,
        portfolio: top.map((r) => ({
          programId: r.programId,
          programCode: r.programCode,
          programNameEn: r.programNameEn,
          facultyNameEn: r.facultyNameEn,
          kkuRiskLevel: r.kkuRiskLevel,
          kkuMatrixScore: r.kkuMatrixScore,
          likelihoodBin: r.likelihoodBin,
          impactBin: r.impactBin,
          directRevenueAtRiskThb:
            r.directRevenueAtRiskThb !== null
              ? Number(r.directRevenueAtRiskThb)
              : null,
          dominantDriver:
            // Highest of L1/L2/L3 — same heuristic /risks uses for the
            // driver-mix donut.
            [
              { name: 'L1 recruitment decay', value: r.l1 ?? 0 },
              { name: 'L2 AI disruption', value: r.l2 ?? 0 },
              { name: 'L3 demographic', value: r.l3 ?? 0 },
            ].sort((a, b) => b.value - a.value)[0]?.name ?? null,
        })),
      };
    },

    query_recruitment: async (input) => {
      const q = QueryRecruitmentInputSchema.parse(input);
      // ADMISSION_STAT: latest COMPLETE year, aggregated per program.
      const nowCe = new Date().getUTCFullYear();
      const yearRows = await prisma.admissionCampaignStat.findMany({
        where: { programId: { not: null } },
        select: { acadYearBE: true },
        distinct: ['acadYearBE'],
        orderBy: { acadYearBE: 'desc' },
      });
      const latestYear =
        q.entryYearBe ?? yearRows.map((r) => r.acadYearBE).find((y) => y - 543 < nowCe) ?? null;
      if (latestYear === null) return { count: 0, rows: [] };
      const where: Prisma.AdmissionCampaignStatWhereInput = {
        acadYearBE: latestYear,
        programId: { not: null },
      };
      if (q.programId) where.programId = q.programId;
      if (q.facultyId) where.facultyId = q.facultyId;
      const rows = await prisma.admissionCampaignStat.findMany({
        where,
        select: {
          programId: true,
          recruitmentProgramId: true,
          planPerYear: true,
          enrollSeats: true,
          totalApplicants: true,
          regReported: true,
          program: { select: { code: true, nameEn: true, faculty: { select: { nameEn: true } } } },
        },
      });
      // Roll campaign tracks up per program. Plan = Σ over sub-programs of MAX.
      type Acc = {
        programCode?: string; programNameEn?: string; facultyNameEn?: string;
        seats: number; applicants: number; reported: number;
        planBySub: Map<string, number>;
      };
      const byProg = new Map<string, Acc>();
      for (const r of rows) {
        const key = r.programId!;
        let a = byProg.get(key);
        if (!a) {
          a = { programCode: r.program?.code, programNameEn: r.program?.nameEn, facultyNameEn: r.program?.faculty?.nameEn, seats: 0, applicants: 0, reported: 0, planBySub: new Map() };
          byProg.set(key, a);
        }
        a.seats += r.enrollSeats ?? 0;
        a.applicants += r.totalApplicants ?? 0;
        a.reported += r.regReported ?? 0;
        if (r.planPerYear != null) {
          a.planBySub.set(r.recruitmentProgramId, Math.max(a.planBySub.get(r.recruitmentProgramId) ?? 0, r.planPerYear));
        }
      }
      const aggregated = [...byProg.values()]
        .map((a) => {
          const plan = [...a.planBySub.values()].reduce((s, v) => s + v, 0);
          return {
            programCode: a.programCode,
            programNameEn: a.programNameEn,
            facultyNameEn: a.facultyNameEn,
            planPerYear: plan > 0 ? plan : null,
            enrollSeats: a.seats,
            totalApplicants: a.applicants,
            regReported: a.reported,
            competitionRatio: a.seats > 0 && a.applicants > 0 ? Number((a.applicants / a.seats).toFixed(2)) : null,
          };
        })
        .sort((x, y) => y.totalApplicants - x.totalApplicants)
        .slice(0, q.limit);
      return { count: aggregated.length, entryYearBe: latestYear, rows: aggregated };
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

// ── Spatial clamp for tool inputs ────────────────────────────────────
// Mirrors the HTTP-route clamp in apps/api/src/common/scope-guards.ts.
// Refuses to expand the model's reach past the caller's actual scope.
async function clampSpatialInput(
  toolName: string,
  rawInput: unknown,
  caller: SessionUser,
): Promise<unknown> {
  // Admin-grade + UNIVERSITY_USER pass through untouched.
  if (seesAllScopes(caller.role)) return rawInput;
  if (!rawInput || typeof rawInput !== 'object') return rawInput;
  const input = { ...(rawInput as Record<string, unknown>) };

  switch (toolName) {
    case 'query_programs':
    case 'query_gaps': {
      const scope = (input.scope as 'university' | 'faculty' | 'department' | 'program' | undefined) ?? 'university';
      const scopeId = (input.scopeId as string | null | undefined) ?? null;
      const eff = await clampScopeForUser(scope, scopeId, caller);
      input.scope = eff.scope;
      input.scopeId = eff.scopeId;
      return input;
    }
    case 'get_program': {
      const programId = input.programId as string | undefined;
      if (!programId) return input;
      // For PROGRAM_USER, only their own program; for FACULTY_USER,
      // any program inside their faculty. Resolve via the same helper
      // — it 403s on out-of-scope.
      const eff = await clampScopeForUser('program', programId, caller);
      input.programId = eff.scopeId;
      return input;
    }
    default:
      return input;
  }
}
