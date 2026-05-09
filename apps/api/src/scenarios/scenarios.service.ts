import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { prisma, type Prisma } from '@kku/db';
import {
  buildBaselineSnapshot,
  DEFAULT_ASSUMPTIONS,
  InterventionSchema,
  runScenario,
  SCENARIO_ENGINE_VERSION,
  SCENARIO_TEMPLATES,
  ScenarioAssumptionsSchema,
  type BaselineProgram,
  type EngineInput,
  type Intervention,
  type RiskEntry,
  type ScenarioAssumptions,
  type ScenarioRunResult,
  type ScenarioType,
  type ScenarioWorkflowStatus,
} from '@kku/shared';

// ═════════════════════════════════════════════════════════════════════
// Scenarios service — wraps the engine, builds baseline snapshots from
// the DB, and handles workflow transitions (DRAFT → SHARED → ... → DECIDED).
// ═════════════════════════════════════════════════════════════════════

// Privilege tiers, post legacy-removal (2026-05-09):
//   COUNCIL_TIER = roles allowed to see every scenario across the
//                  university and to drive the workflow forward
//                  (mark Council-reviewed, finalise a decision).
//                  Maps the legacy COUNCIL/EXECUTIVE/ADMIN trio onto
//                  the v2 taxonomy: admin-grade + UNIVERSITY_USER
//                  (UNIVERSITY_USER absorbed legacy COUNCIL/EXECUTIVE).
//   SYSTEM_TIER  = SUPER_ADMIN only — owns global content (templates)
//                  and can override any scenario edit. SYSTEM_ADMIN
//                  is intentionally excluded so that day-to-day
//                  operators can't rewrite template fixtures.
const COUNCIL_TIER_ROLES = new Set(['SUPER_ADMIN', 'SYSTEM_ADMIN', 'UNIVERSITY_USER']);
const SYSTEM_TIER_ROLES = new Set(['SUPER_ADMIN']);

function isCouncilTier(role: string): boolean {
  return COUNCIL_TIER_ROLES.has(role);
}
function isSystemTier(role: string): boolean {
  return SYSTEM_TIER_ROLES.has(role);
}

export interface ScenarioListFilter {
  userId: string;
  userRole: string;
  status?: ScenarioWorkflowStatus;
  scenarioType?: ScenarioType;
  creator?: string;
  affectedProgramId?: string;
  includeTemplates?: boolean;
}

@Injectable()
export class ScenariosService {
  private readonly logger = new Logger(ScenariosService.name);

  // ── List / get ─────────────────────────────────────────────────────
  async list(f: ScenarioListFilter) {
    const where: Prisma.ScenarioWhereInput = {};
    if (f.status) where.workflowStatus = f.status;
    if (f.scenarioType) where.scenarioType = f.scenarioType;
    if (f.creator) where.userId = f.creator;
    if (f.affectedProgramId) where.affectedProgramIds = { has: f.affectedProgramId };
    // Default: hide archived + only show templates OR what the user owns / is shared with.
    if (!f.includeTemplates) where.isTemplate = false;
    // Visibility: council-tier roles see everything. Anyone else sees
    // their own + scenarios shared with them + SHARED/COUNCIL_REVIEWED/
    // DECIDED snapshots. FACULTY_USER + PROGRAM_USER fall here.
    if (!isCouncilTier(f.userRole)) {
      where.OR = [
        { userId: f.userId },
        { collaboratorIds: { has: f.userId } },
        { workflowStatus: { in: ['SHARED', 'COUNCIL_REVIEWED', 'DECIDED'] } },
      ];
    }
    return prisma.scenario.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        _count: { select: { runs: true, results: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  async get(id: string, userId: string, userRole: string) {
    const scenario = await prisma.scenario.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        runs: {
          orderBy: { runAt: 'desc' },
          take: 5,
          include: { briefAi: { select: { id: true, model: true, confidence: true } } },
        },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, workflowStatus: true } },
      },
    });
    if (!scenario) throw new NotFoundException('Scenario not found');
    this.assertReadable(scenario, userId, userRole);
    return scenario;
  }

  // ── Create / update ────────────────────────────────────────────────
  async create(params: {
    userId: string;
    name: string;
    descriptionTh?: string;
    scenarioType: ScenarioType;
    horizonYears: number;
    scope: 'UNIVERSITY' | 'FACULTY' | 'DEPARTMENT' | 'PROGRAM';
    scopeId?: string;
    affectedProgramIds?: string[];
    assumptions?: Partial<ScenarioAssumptions>;
    interventions?: Intervention[];
    parentScenarioId?: string;
    templateSlug?: string; // copy-from-template shortcut
  }) {
    // If templateSlug given, merge template values.
    if (params.templateSlug) {
      const template = SCENARIO_TEMPLATES.find((t) => t.slug === params.templateSlug);
      if (!template) throw new NotFoundException(`template ${params.templateSlug} not found`);
      // Templates that reference programs use `programSelector`; fill in a sensible default.
      const interventions: Intervention[] = [];
      if (template.interventionBlueprint.length > 0) {
        const firstProgram = (
          await prisma.program.findFirst({
            where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
            select: { id: true },
          })
        )?.id;
        for (const blueprint of template.interventionBlueprint) {
          // Blueprint is partially typed — cast after materialising the ids.
          const { programSelector: _ps, ...rest } = blueprint as Record<string, unknown>;
          if ((rest as { programId?: string }).programId == null && firstProgram) {
            (rest as { programId?: string }).programId = firstProgram;
          }
          interventions.push(InterventionSchema.parse(rest));
        }
      }
      return prisma.scenario.create({
        data: {
          userId: params.userId,
          name: params.name || template.name,
          descriptionTh: template.descriptionTh,
          descriptionEn: template.descriptionEn,
          scope: 'UNIVERSITY',
          scenarioType: template.scenarioType,
          horizonYears: template.horizonYears,
          assumptionsJson: template.assumptions,
          interventionsJson: interventions,
          affectedProgramIds: params.affectedProgramIds ?? [],
          methodologyVersion: SCENARIO_ENGINE_VERSION,
          workflowStatus: 'DRAFT',
        },
      });
    }

    // Plain creation.
    const assumptions = ScenarioAssumptionsSchema.parse({ ...DEFAULT_ASSUMPTIONS, ...params.assumptions });
    const interventions: Intervention[] = (params.interventions ?? []).map((i) => InterventionSchema.parse(i));
    return prisma.scenario.create({
      data: {
        userId: params.userId,
        name: params.name,
        descriptionTh: params.descriptionTh,
        scope: params.scope,
        scopeId: params.scopeId,
        scenarioType: params.scenarioType,
        horizonYears: params.horizonYears,
        assumptionsJson: assumptions,
        interventionsJson: interventions,
        affectedProgramIds: params.affectedProgramIds ?? [],
        parentScenarioId: params.parentScenarioId,
        methodologyVersion: SCENARIO_ENGINE_VERSION,
        workflowStatus: 'DRAFT',
      },
    });
  }

  async patch(
    id: string,
    userId: string,
    userRole: string,
    patch: {
      name?: string;
      descriptionTh?: string;
      descriptionEn?: string;
      assumptions?: Partial<ScenarioAssumptions>;
      interventions?: Intervention[];
      affectedProgramIds?: string[];
      horizonYears?: number;
      collaboratorIds?: string[];
    },
  ) {
    const existing = await prisma.scenario.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    this.assertEditable(existing, userId, userRole);
    const data: Prisma.ScenarioUpdateInput = {};
    if (patch.name) data.name = patch.name;
    if (patch.descriptionTh !== undefined) data.descriptionTh = patch.descriptionTh;
    if (patch.descriptionEn !== undefined) data.descriptionEn = patch.descriptionEn;
    if (patch.assumptions) {
      const merged = ScenarioAssumptionsSchema.parse({ ...DEFAULT_ASSUMPTIONS, ...(existing.assumptionsJson as object), ...patch.assumptions });
      data.assumptionsJson = merged;
    }
    if (patch.interventions) {
      data.interventionsJson = patch.interventions.map((i) => InterventionSchema.parse(i));
    }
    if (patch.affectedProgramIds) data.affectedProgramIds = { set: patch.affectedProgramIds };
    if (patch.horizonYears) data.horizonYears = patch.horizonYears;
    if (patch.collaboratorIds) data.collaboratorIds = { set: patch.collaboratorIds };
    return prisma.scenario.update({ where: { id }, data });
  }

  // ── Run engine ─────────────────────────────────────────────────────
  async run(id: string, userId: string, userRole: string, opts: { monteCarloN?: number; seed?: number } = {}) {
    const scenario = await prisma.scenario.findUnique({ where: { id } });
    if (!scenario) throw new NotFoundException();
    this.assertReadable(scenario, userId, userRole);

    const baseline = await this.buildBaseline(scenario.affectedProgramIds);
    const assumptions = ScenarioAssumptionsSchema.parse({ ...DEFAULT_ASSUMPTIONS, ...(scenario.assumptionsJson as object) });
    const interventions: Intervention[] = Array.isArray(scenario.interventionsJson)
      ? (scenario.interventionsJson as unknown[]).map((i) => InterventionSchema.parse(i))
      : [];

    const engineInput: EngineInput = {
      baseline,
      assumptions,
      interventions,
      horizonYears: scenario.horizonYears,
      monteCarloN: opts.monteCarloN ?? 100,
      seed: opts.seed ?? 42,
    };
    const t0 = Date.now();
    const result: ScenarioRunResult = runScenario(engineInput);
    const durationMs = Date.now() - t0;
    this.logger.log(`scenario ${id} ran in ${durationMs}ms (${baseline.programs.length} programs, ${interventions.length} interventions)`);

    const run = await prisma.scenarioRun.create({
      data: {
        scenarioId: id,
        assumptionsSnapshot: assumptions,
        interventionsSnapshot: interventions,
        projectionJson: result,
        sensitivityJson: result.sensitivity,
        riskRegisterJson: [],
        methodologyVersion: result.methodologyVersion,
        monteCarloN: result.monteCarloN,
        seed: BigInt(result.seed),
      },
    });

    // Flatten key metrics into ScenarioResult rows for dashboard queries.
    const scalarMetrics: Array<{ metric: string; value: number }> = [
      { metric: 'totalNetContribution', value: result.scenario.totalNetContribution },
      { metric: 'totalRevenue', value: result.scenario.totalRevenue },
      { metric: 'totalCost', value: result.scenario.totalCost },
      { metric: 'peakEnrollment', value: result.scenario.peakEnrollment },
      { metric: 'graduatesCumulative', value: result.scenario.graduatesCumulative },
      { metric: 'deltaTotalNetContribution', value: result.deltaTotalNetContribution },
      { metric: 'monteCarloMean', value: result.monteCarlo.totalNetContributionMean },
      { metric: 'monteCarloCi80Low', value: result.monteCarlo.totalNetContributionCi80[0] },
      { metric: 'monteCarloCi80High', value: result.monteCarlo.totalNetContributionCi80[1] },
    ];
    // Bulk insert — was 9 sequential create() calls (~9× round-trips).
    // createMany batches into one INSERT and is the BullMQ-job hot path
    // for every scenario run. Prompt-15 N+1 fix.
    await prisma.scenarioResult.createMany({
      data: scalarMetrics.map(({ metric, value }) => ({
        scenarioId: id,
        metric,
        value,
      })),
    });

    return { runId: run.id, result, durationMs };
  }

  async getLatestResult(id: string, userId: string, userRole: string) {
    const scenario = await prisma.scenario.findUnique({ where: { id } });
    if (!scenario) throw new NotFoundException();
    this.assertReadable(scenario, userId, userRole);
    const run = await prisma.scenarioRun.findFirst({
      where: { scenarioId: id },
      orderBy: { runAt: 'desc' },
      include: { briefAi: true },
    });
    return run;
  }

  // ── Compare ────────────────────────────────────────────────────────
  async compare(scenarioIds: string[], userId: string, userRole: string) {
    if (scenarioIds.length > 4) throw new Error('Compare supports up to 4 scenarios');
    const scenarios = await Promise.all(
      scenarioIds.map(async (id) => {
        const scenario = await prisma.scenario.findUnique({
          where: { id },
          include: {
            runs: { orderBy: { runAt: 'desc' }, take: 1 },
          },
        });
        if (!scenario) throw new NotFoundException(`scenario ${id} not found`);
        this.assertReadable(scenario, userId, userRole);
        return scenario;
      }),
    );
    return { scenarios };
  }

  // ── Workflow transitions ───────────────────────────────────────────
  async share(id: string, userId: string, userRole: string, collaboratorIds: string[]) {
    const s = await prisma.scenario.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    this.assertEditable(s, userId, userRole);
    return prisma.scenario.update({
      where: { id },
      data: {
        workflowStatus: 'SHARED',
        collaboratorIds: { set: collaboratorIds },
      },
    });
  }

  async markCouncilReviewed(id: string, userId: string, userRole: string) {
    // Council-tier only — admin-grade + UNIVERSITY_USER per the v2
    // taxonomy. UNIVERSITY_USER absorbs the legacy COUNCIL/EXECUTIVE
    // population that used to drive this transition.
    if (!isCouncilTier(userRole)) {
      throw new ForbiddenException(
        'Only admin-grade or University-level users can mark scenarios as Council-reviewed',
      );
    }
    const s = await prisma.scenario.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    return prisma.scenario.update({
      where: { id },
      data: { workflowStatus: 'COUNCIL_REVIEWED' },
    });
  }

  async decide(
    id: string,
    userId: string,
    userRole: string,
    body: { decisionType: 'CLOSE' | 'MERGE' | 'LAUNCH' | 'RESTRUCTURE' | 'KEEP_AS_IS' | 'OTHER'; rationaleTh?: string; rationaleEn?: string; effectiveDate?: Date },
  ) {
    // Council-tier only finalises a decision (creates a CouncilDecision
    // record linked to the scenario).
    if (!isCouncilTier(userRole)) {
      throw new ForbiddenException(
        'Only admin-grade or University-level users can finalise a Council decision',
      );
    }
    const s = await prisma.scenario.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    const [scenarioUpdated, decision] = await prisma.$transaction([
      prisma.scenario.update({
        where: { id },
        data: { workflowStatus: 'DECIDED' },
      }),
      prisma.councilDecision.create({
        data: {
          userId,
          scenarioId: id,
          // Title defaults from the scenario — editable in the decision UI.
          title: `${body.decisionType}: ${s.name}`,
          decisionType: body.decisionType,
          affectedProgramIds: s.affectedProgramIds,
          rationaleTh: body.rationaleTh,
          rationaleEn: body.rationaleEn,
          effectiveDate: body.effectiveDate,
          status: 'PROPOSED',
        },
      }),
    ]);
    return { scenario: scenarioUpdated, decision };
  }

  // ── Risk register attach ───────────────────────────────────────────
  async attachRiskRegister(runId: string, risks: RiskEntry[], briefAiInferenceId?: string) {
    return prisma.scenarioRun.update({
      where: { id: runId },
      data: {
        riskRegisterJson: risks,
        briefAiInferenceId: briefAiInferenceId ?? undefined,
      },
    });
  }

  // ── Templates ──────────────────────────────────────────────────────
  async listTemplates() {
    return SCENARIO_TEMPLATES.map((t) => ({
      slug: t.slug,
      name: t.name,
      scenarioType: t.scenarioType,
      horizonYears: t.horizonYears,
      descriptionTh: t.descriptionTh,
      descriptionEn: t.descriptionEn,
      caveatTh: t.caveatTh,
    }));
  }

  // ── Baseline construction ──────────────────────────────────────────
  private async buildBaseline(affectedProgramIds: string[]) {
    // If caller didn't specify affected programs, run on the canonical
    // 297 (sheet-seeded ACTIVE programs) — scenarios are decisions on
    // the curriculum landscape, not on legacy mock-seed rows.
    const where: Prisma.ProgramWhereInput = affectedProgramIds.length > 0
      ? { id: { in: affectedProgramIds } }
      : { status: 'ACTIVE', sequenceNoFromSheet: { not: null } };
    const programs = await prisma.program.findMany({
      where,
      include: {
        enrollmentMetrics: { orderBy: { academicYear: 'desc' }, take: 1 },
        financialMetrics: { orderBy: { fiscalYear: 'desc' }, take: 1 },
        programSkills: { select: { skillId: true } },
      },
    });
    const baselinePrograms: BaselineProgram[] = programs.map((p) => {
      const latestEnrollment = p.enrollmentMetrics[0];
      const latestFinancial = p.financialMetrics[0];
      const currentEnrollment = latestEnrollment?.enrolled ?? 0;
      const tuition = latestFinancial?.tuitionRevenue
        ? Number(latestFinancial.tuitionRevenue) / Math.max(currentEnrollment, 1)
        : 30_000;
      // FinancialMetric has allocated sub-costs; sum them for total cost
      // per student. Prefer `costPerStudent` if present.
      const cost = latestFinancial?.costPerStudent
        ? Number(latestFinancial.costPerStudent)
        : latestFinancial
          ? (Number(latestFinancial.directCost) +
              Number(latestFinancial.allocatedFacultyCost) +
              Number(latestFinancial.allocatedFacilityCost) +
              Number(latestFinancial.allocatedOverhead)) /
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
        currentGraduates: latestEnrollment?.graduatedOnTime ?? 0,
        tuitionPerStudent: tuition,
        costPerStudent: cost,
        skillIds: p.programSkills.map((s) => s.skillId),
      };
    });

    // Demographic multipliers for the next 20 years (baseline × scenario defaults).
    const currentYear = new Date().getFullYear();
    const demos = await prisma.demographicProjection.findMany({
      where: { region: 'TH', ageCohort: '18-22', year: { gte: currentYear, lte: currentYear + 20 } },
      orderBy: { year: 'asc' },
    });
    const baseYear = currentYear;
    const basePop = demos.find((d) => d.year === baseYear)?.population ?? 4_500_000;
    const demographicMultiplierByYear: Record<string, number> = {};
    for (const d of demos) {
      demographicMultiplierByYear[String(d.year)] = basePop > 0 ? d.population / basePop : 1;
    }

    return buildBaselineSnapshot({
      baseYear,
      programs: baselinePrograms,
      demographicMultiplierByYear,
    });
  }

  // ── Authorisation helpers ──────────────────────────────────────────
  private assertReadable(s: { userId: string; collaboratorIds: string[]; workflowStatus: ScenarioWorkflowStatus; isTemplate: boolean }, userId: string, userRole: string) {
    if (s.isTemplate) return;
    if (s.userId === userId) return;
    if (s.collaboratorIds.includes(userId)) return;
    if (isCouncilTier(userRole)) return;
    if (['SHARED', 'COUNCIL_REVIEWED', 'DECIDED'].includes(s.workflowStatus)) return;
    throw new ForbiddenException('Not visible to this user');
  }

  private assertEditable(s: { userId: string; collaboratorIds: string[]; workflowStatus: ScenarioWorkflowStatus; isTemplate: boolean }, userId: string, userRole: string) {
    // Templates are global content — only SUPER_ADMIN may edit them.
    // SYSTEM_ADMIN is intentionally excluded so day-to-day operators
    // can't rewrite the canonical scenario fixtures.
    if (s.isTemplate && !isSystemTier(userRole)) {
      throw new ForbiddenException('Templates can only be edited by SUPER_ADMIN');
    }
    if (s.workflowStatus === 'DECIDED' || s.workflowStatus === 'ARCHIVED') {
      throw new ForbiddenException('DECIDED / ARCHIVED scenarios are immutable');
    }
    if (s.userId === userId) return;
    if (s.collaboratorIds.includes(userId)) return;
    // SUPER_ADMIN can override any scenario edit.
    if (isSystemTier(userRole)) return;
    throw new ForbiddenException('Not editable by this user');
  }
}
