import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  computeForecastAccuracy,
  computeOccupationGap,
  computeOpportunities,
  computeProgramDemandGaps,
  computeRegionalGap,
  computeRisks,
  computeSectorGap,
  computeSkillGap,
} from '@kku/db';
import type { SessionUser } from '@kku/shared';
import {
  AuthSession,
  Authorized,
  AiCall,
  Provenance,
  ZodValidationPipe,
  AiQuota,
} from '../common';
import { GapInsightsService } from './gap-insights.service';

// Gap Analyzer API (prompt 08). All reads are scope-aware via a shared
// query schema; insight generation is a mutation-like call that writes
// one AiInference row per request through the AiService recorder.

const FilterQuerySchema = z.object({
  scope: z.enum(['university', 'faculty', 'department', 'program']).default('university'),
  scopeId: z.string().optional(),
  region: z.string().default('TH'),
  // Using union of literals (not coerce.number + refine) so TS narrows to
  // 0 | 3 | 5 | 10 and downstream compute* functions type-match cleanly.
  horizon: z
    .union([z.literal('0'), z.literal('3'), z.literal('5'), z.literal('10')])
    .transform((v): 0 | 3 | 5 | 10 => Number(v) as 0 | 3 | 5 | 10)
    .default('0'),
  comparison: z.enum(['absolute', 'per-capita', 'growth-adjusted']).default('absolute'),
  limit: z.coerce.number().int().positive().max(200).default(30),
});
type FilterQuery = z.infer<typeof FilterQuerySchema>;

const InsightBodySchema = z.object({
  mode: z.enum(['strategic-top-5', 'program-skills-to-add', 'sector-brief']),
  scope: z.enum(['university', 'faculty', 'department', 'program']).default('university'),
  scopeId: z.string().optional(),
  programId: z.string().optional(),
  sectorCode: z.string().optional(),
});
type InsightBody = z.infer<typeof InsightBodySchema>;

@Controller('/gap')
export class GapController {
  constructor(private readonly insights: GapInsightsService) {}

  @Get('skills')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'job-postings', name: 'Job postings' }, { id: 'program-skills', name: 'Program skills' }] })
  async skills(@Query(new ZodValidationPipe(FilterQuerySchema)) q: FilterQuery) {
    return computeSkillGap(q);
  }

  @Get('occupations')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'occupation-demand', name: 'Occupation demand' }] })
  async occupations(@Query(new ZodValidationPipe(FilterQuerySchema)) q: FilterQuery) {
    return computeOccupationGap(q);
  }

  @Get('sectors')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'sectors', name: 'BCG + S-curve sectors' }] })
  async sectors(@Query(new ZodValidationPipe(FilterQuerySchema)) q: FilterQuery) {
    return computeSectorGap(q);
  }

  @Get('regional/:province')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'occupation-demand', name: 'Occupation demand' }] })
  async regional(
    @Param('province') province: string,
    @Query(new ZodValidationPipe(FilterQuerySchema)) q: FilterQuery,
  ) {
    return computeRegionalGap({ ...q, region: province });
  }

  @Get('opportunities')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'job-postings', name: 'Job postings' }, { id: 'program-skills', name: 'Program skills' }] })
  async opportunities(@Query(new ZodValidationPipe(FilterQuerySchema)) q: FilterQuery) {
    return computeOpportunities(q);
  }

  @Get('risks')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'enrollment-metrics', name: 'Enrollment metrics' }, { id: 'demographic-projections', name: 'Demographic projections' }] })
  async risks(@Query(new ZodValidationPipe(FilterQuerySchema)) q: FilterQuery) {
    return computeRisks(q);
  }

  @Get('program-demand-gaps')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'program-demand-match', name: 'AI demand-match per program' },
      { id: 'kmitl-skill-mapping', name: 'LinkedIn labour-market skill demand · subscribed by MHESI (API hosted by KMITL)' },
    ],
  })
  async programDemandGaps(@Query(new ZodValidationPipe(FilterQuerySchema)) q: FilterQuery) {
    return computeProgramDemandGaps(q);
  }

  @Get('forecast-accuracy')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'forecast-runs', name: 'Forecast run history' }] })
  async forecastAccuracy() {
    return computeForecastAccuracy();
  }

  @Post('insights/generate')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 10, ttl: 60_000 }, ai_hourly: { limit: 60, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'gap-analysis' })
  @AiCall({ module: 'gap-analysis' })
  async generateInsights(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(InsightBodySchema)) body: InsightBody,
  ) {
    if (body.mode === 'strategic-top-5') {
      return this.insights.generateStrategicTop5({
        scope: body.scope,
        scopeId: body.scopeId ?? null,
        userId: user.userId,
      });
    }
    if (body.mode === 'program-skills-to-add') {
      if (!body.programId) throw new Error('programId required for program-skills-to-add');
      return this.insights.generateProgramSkillsToAdd({
        programId: body.programId,
        userId: user.userId,
      });
    }
    if (body.mode === 'sector-brief') {
      if (!body.sectorCode) throw new Error('sectorCode required for sector-brief');
      return this.insights.generateSectorBrief({
        sectorCode: body.sectorCode,
        userId: user.userId,
      });
    }
    throw new Error(`unknown mode ${String((body as { mode: string }).mode)}`);
  }
}
