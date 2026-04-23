import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  AiCall,
  Provenance,
  ZodValidationPipe,
} from '../common';
import { ScenariosService } from './scenarios.service';
import { ScenarioInsightsService } from './scenario-insights.service';
import {
  InterventionSchema,
  ScenarioAssumptionsSchema,
  type Intervention,
  type ScenarioInsightsInput,
} from '@kku/shared';

// Scenarios API — Strategic Scenario Planner (prompt 09)

const ScenarioTypeEnum = z.enum(['SUNSET', 'MERGE', 'LAUNCH', 'RESHAPE', 'REBALANCE']);
const WorkflowStatusEnum = z.enum(['DRAFT', 'SHARED', 'COUNCIL_REVIEWED', 'DECIDED', 'ARCHIVED']);

const ListQuerySchema = z.object({
  status: WorkflowStatusEnum.optional(),
  scenarioType: ScenarioTypeEnum.optional(),
  creator: z.string().optional(),
  affectedProgramId: z.string().optional(),
  includeTemplates: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('false'),
});
type ListQuery = z.infer<typeof ListQuerySchema>;

const CreateBodySchema = z.object({
  name: z.string().min(1),
  descriptionTh: z.string().optional(),
  scenarioType: ScenarioTypeEnum,
  horizonYears: z.number().int().min(1).max(20).default(5),
  scope: z.enum(['UNIVERSITY', 'FACULTY', 'DEPARTMENT', 'PROGRAM']).default('UNIVERSITY'),
  scopeId: z.string().optional(),
  affectedProgramIds: z.array(z.string()).default([]),
  assumptions: ScenarioAssumptionsSchema.partial().optional(),
  interventions: z.array(InterventionSchema).optional(),
  parentScenarioId: z.string().optional(),
  templateSlug: z.string().optional(),
});
type CreateBody = z.infer<typeof CreateBodySchema>;

const PatchBodySchema = z.object({
  name: z.string().optional(),
  descriptionTh: z.string().optional(),
  descriptionEn: z.string().optional(),
  assumptions: ScenarioAssumptionsSchema.partial().optional(),
  interventions: z.array(InterventionSchema).optional(),
  affectedProgramIds: z.array(z.string()).optional(),
  horizonYears: z.number().int().min(1).max(20).optional(),
  collaboratorIds: z.array(z.string()).optional(),
});
type PatchBody = z.infer<typeof PatchBodySchema>;

const RunBodySchema = z.object({
  monteCarloN: z.number().int().min(10).max(2000).default(100),
  seed: z.number().int().default(42),
});
type RunBody = z.infer<typeof RunBodySchema>;

const CompareBodySchema = z.object({
  scenarioIds: z.array(z.string()).min(2).max(4),
});
type CompareBody = z.infer<typeof CompareBodySchema>;

const ShareBodySchema = z.object({
  collaboratorIds: z.array(z.string()).default([]),
});
type ShareBody = z.infer<typeof ShareBodySchema>;

const DecideBodySchema = z.object({
  decisionType: z.enum(['CLOSE', 'MERGE', 'LAUNCH', 'RESTRUCTURE', 'KEEP_AS_IS', 'OTHER']),
  rationaleTh: z.string().optional(),
  rationaleEn: z.string().optional(),
  effectiveDate: z.coerce.date().optional(),
});
type DecideBody = z.infer<typeof DecideBodySchema>;

const BriefBodySchema = z.object({
  mode: z.enum(['suggest-assumptions', 'identify-risks', 'compare-narrative', 'devils-advocate', 'what-would-change-my-mind']),
  // optional — mode-specific extra params
  scenarioIds: z.array(z.string()).optional(),
  apparentBestReason: z.string().optional(),
});
type BriefBody = z.infer<typeof BriefBodySchema>;

@Controller('/scenarios')
export class ScenariosController {
  constructor(
    private readonly scenarios: ScenariosService,
    private readonly insights: ScenarioInsightsService,
  ) {}

  @Get('templates')
  @Authorized('programs:read:all')
  async templates() {
    return this.scenarios.listTemplates();
  }

  @Get()
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'scenarios', name: 'Scenarios' }] })
  async list(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery,
  ) {
    return this.scenarios.list({
      userId: user.userId,
      userRole: user.role,
      status: q.status,
      scenarioType: q.scenarioType,
      creator: q.creator,
      affectedProgramId: q.affectedProgramId,
      includeTemplates: q.includeTemplates,
    });
  }

  @Post()
  @Authorized('programs:read:all')
  @AuditLog({ action: 'scenario.create', entityType: 'Scenario' })
  async create(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(CreateBodySchema)) body: CreateBody,
  ) {
    return this.scenarios.create({
      userId: user.userId,
      ...body,
      interventions: body.interventions as Intervention[] | undefined,
    });
  }

  @Get(':id')
  @Authorized('programs:read:all')
  async get(@AuthSession() user: SessionUser, @Param('id') id: string) {
    return this.scenarios.get(id, user.userId, user.role);
  }

  @Patch(':id')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'scenario.patch', entityType: 'Scenario' })
  async patch(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchBodySchema)) body: PatchBody,
  ) {
    return this.scenarios.patch(id, user.userId, user.role, {
      ...body,
      interventions: body.interventions as Intervention[] | undefined,
    });
  }

  @Post(':id/run')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'scenario.run', entityType: 'Scenario' })
  async run(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RunBodySchema)) body: RunBody,
  ) {
    return this.scenarios.run(id, user.userId, user.role, body);
  }

  @Get(':id/results')
  @Authorized('programs:read:all')
  async results(@AuthSession() user: SessionUser, @Param('id') id: string) {
    return this.scenarios.getLatestResult(id, user.userId, user.role);
  }

  @Post(':id/compare')
  @Authorized('programs:read:all')
  async compare(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CompareBodySchema)) body: CompareBody,
  ) {
    // `id` is the "anchor" scenario; body.scenarioIds is the set to compare against.
    return this.scenarios.compare([id, ...body.scenarioIds.filter((x) => x !== id)], user.userId, user.role);
  }

  @Post(':id/share')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'scenario.share', entityType: 'Scenario' })
  async share(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ShareBodySchema)) body: ShareBody,
  ) {
    return this.scenarios.share(id, user.userId, user.role, body.collaboratorIds);
  }

  @Post(':id/council-review')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'scenario.council_review', entityType: 'Scenario' })
  async councilReview(@AuthSession() user: SessionUser, @Param('id') id: string) {
    return this.scenarios.markCouncilReviewed(id, user.userId, user.role);
  }

  @Post(':id/decide')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'scenario.decide', entityType: 'Scenario' })
  async decide(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecideBodySchema)) body: DecideBody,
  ) {
    return this.scenarios.decide(id, user.userId, user.role, body);
  }

  @Post(':id/brief')
  @Authorized('programs:read:all')
  @AiCall({ module: 'scenarios' })
  async brief(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(BriefBodySchema)) body: BriefBody,
  ) {
    // Pull the scenario + latest run to build the AI context.
    const scenario = await this.scenarios.get(id, user.userId, user.role);
    const latest = scenario.runs[0];
    const projection = latest?.projectionJson as unknown as {
      scenario: { totalNetContribution: number; totalRevenue: number; totalCost: number };
      monteCarlo: { totalNetContributionCi80: [number, number] };
      sensitivity: Array<{ assumptionKey: string; lowOutcomeDelta: number; highOutcomeDelta: number }>;
    } | undefined;

    const ctx = {
      id: scenario.id,
      name: scenario.name,
      scenarioType: scenario.scenarioType,
      horizonYears: scenario.horizonYears,
      assumptions: scenario.assumptionsJson as Record<string, number>,
      affectedProgramNames: [], // pulled via join in a future iteration
      totalNetContribution: projection?.scenario.totalNetContribution,
      totalRevenue: projection?.scenario.totalRevenue,
      totalCost: projection?.scenario.totalCost,
      monteCarloCi80: projection?.monteCarlo.totalNetContributionCi80,
      topSensitivityAssumptions: projection?.sensitivity.slice(0, 3).map((s) => ({
        key: s.assumptionKey,
        impact: Math.max(Math.abs(s.lowOutcomeDelta), Math.abs(s.highOutcomeDelta)),
      })),
    };

    let input: ScenarioInsightsInput;
    if (body.mode === 'suggest-assumptions') {
      input = {
        mode: 'suggest-assumptions',
        scenario: {
          id: ctx.id,
          name: ctx.name,
          scenarioType: ctx.scenarioType,
          horizonYears: ctx.horizonYears,
          assumptions: ctx.assumptions,
          affectedProgramNames: ctx.affectedProgramNames,
        },
        currentAssumptions: ctx.assumptions,
      };
    } else if (body.mode === 'identify-risks') {
      input = { mode: 'identify-risks', scenario: ctx };
    } else if (body.mode === 'compare-narrative') {
      if (!body.scenarioIds || body.scenarioIds.length === 0) {
        throw new Error('scenarioIds required for compare-narrative');
      }
      // Fan-out: pull each scenario + latest run.
      const scenarios = await Promise.all(
        [id, ...body.scenarioIds.filter((x) => x !== id)].slice(0, 4).map(async (sid) => {
          const s = await this.scenarios.get(sid, user.userId, user.role);
          const r = s.runs[0];
          const proj = r?.projectionJson as unknown as typeof projection;
          return {
            id: s.id,
            name: s.name,
            scenarioType: s.scenarioType,
            horizonYears: s.horizonYears,
            assumptions: s.assumptionsJson as Record<string, number>,
            affectedProgramNames: [],
            totalNetContribution: proj?.scenario.totalNetContribution,
            monteCarloCi80: proj?.monteCarlo.totalNetContributionCi80,
          };
        }),
      );
      input = { mode: 'compare-narrative', scenarios };
    } else if (body.mode === 'devils-advocate') {
      input = {
        mode: 'devils-advocate',
        scenario: ctx,
        apparentBestReason: body.apparentBestReason ?? 'Highest projected net contribution',
      };
    } else {
      input = { mode: 'what-would-change-my-mind', scenario: ctx };
    }
    return this.insights.generate(input, user.userId);
  }
}
