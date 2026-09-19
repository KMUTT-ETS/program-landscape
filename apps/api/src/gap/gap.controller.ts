import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  computeDqSkillLens,
  GAP_MAP_VERSION,
  GAP_VERDICTS,
  JOBTHAI_MIN_POSTINGS_FOR_SIGNAL,
  Prisma,
  prisma,
  ThresholdsSchema,
  type GapMapResult,
  type GapThresholds,
} from '@kku/db';
import { ApiError, type ApiMeta, type SessionUser } from '@kku/shared';
import {
  AiCall,
  AiQuota,
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
  clampScopeForUser,
} from '../common';
import { GAP_MAP_SOURCES, GapBriefService, type BriefVerdictFilter } from './gap-brief.service';
import { GapService } from './gap.service';

// Gap Analyzer API — the demand-first map (gap-map.v1). Programme scope is
// not a map: the page redirects it to the Deep-Dive, and the api refuses it.

const ScopeSchema = z.enum(['university', 'faculty', 'department']);

/** `GAP_VERDICTS` is the single list of what the map can say about a field;
 *  spelling it out a second time here is how a sixth verdict
 *  (`supply-unknown`) silently becomes unfilterable. The cast only turns a
 *  readonly array into the non-empty tuple `z.enum` asks for — the values,
 *  and the `BriefVerdictFilter` union they must match, come from @kku/db. */
const VERDICT_FILTERS = ['all', ...GAP_VERDICTS] as [BriefVerdictFilter, ...BriefVerdictFilter[]];
const VerdictFilterSchema = z.enum(VERDICT_FILTERS);

export const MapQuery = z
  .object({
    scope: ScopeSchema.default('university'),
    scopeId: z.string().optional(),
  })
  .and(ThresholdsSchema);
type MapQueryT = z.infer<typeof MapQuery>;

export const BriefBody = z
  .object({
    scope: ScopeSchema.default('university'),
    scopeId: z.string().optional(),
    verdict: VerdictFilterSchema.default('all'),
    facultyId: z.string().optional(),
  })
  .and(ThresholdsSchema);
type BriefBodyT = z.infer<typeof BriefBody>;

const DisagreementBody = z.object({
  aiInferenceId: z.string().optional(),
  bodyEn: z.string().max(4000).optional(),
  bodyTh: z.string().max(4000).optional(),
});

const MAP_CAVEATS = [
  'JobThai adverts are national and Bangkok-weighted (37 % Bangkok, 3.3 % Isan); they carry no salary and no posting date.',
  "Only adverts whose minimum education level admits a bachelor's graduate are counted; postgraduate programmes are listed but not scored.",
  "A programme assigned to two fields counts in both fields' supply; the reconciliation line states how many.",
  'A field whose programmes carry no graduate figure is reported as supply-unknown — a missing measurement, never a shortfall.',
  'Proposed fields are shown before review; the provenance drawer states how many are unreviewed.',
  'The map is cached for five minutes and purged when a taxonomy row is approved, so a map computed concurrently with an approval can serve pre-approval rows until that cache expires. Ingestion has no cache service, so a taxonomy rebuild from the JobThai connector purges nothing at all — the map waits the five minutes out.',
];

/**
 * Provenance that changes with the request, merged over the static
 * `@Provenance` by the response interceptor (which spreads the handler's own
 * `meta` last — see ResponseEnvelopeInterceptor).
 *
 * Two facts belong here rather than in the decorator:
 *
 *  - **The thresholds.** They are URL parameters, so two readers can hold the
 *    same `gap-map.v1` stamp and different verdicts. Council-readiness rule 1
 *    puts the calculation method in the drawer; a threshold an analyst moved
 *    for one review is part of that method, and a drawer that shows only the
 *    version would let a shared link look like the default.
 *  - **How much of the supply total rests on the enrolment proxy.** It is the
 *    softest part of the supply side and it moves with the data, so the
 *    sentence carries the counts this response actually computed rather than a
 *    figure that was true on the day it was written.
 */
export function mapMeta(args: {
  thresholds: GapThresholds;
  reconciliation: Pick<GapMapResult['reconciliation'], 'scoredWithSupply' | 'supplyFromProxy'>;
  freshnessDate: string | null;
}): Pick<ApiMeta, 'freshnessDate' | 'caveats' | 'methodologyParameters'> {
  const { scoredWithSupply, supplyFromProxy } = args.reconciliation;
  return {
    freshnessDate: args.freshnessDate,
    methodologyParameters: [
      { label: 'Under-served below a ratio of', value: args.thresholds.under.toFixed(2) },
      { label: 'Over-served above a ratio of', value: args.thresholds.over.toFixed(2) },
      { label: 'Too few adverts to read, below', value: `${JOBTHAI_MIN_POSTINGS_FOR_SIGNAL} adverts` },
    ],
    caveats: [
      ...MAP_CAVEATS,
      `Part of the KKU supply total rests on a single-year enrolment figure standing in for a multi-cohort mean: ${supplyFromProxy} of the ${scoredWithSupply} scored programmes carrying a graduate figure are counted that way. It is the largest single piece of softness in the supply side.`,
    ],
  };
}

@Controller('/gap')
export class GapController {
  constructor(
    private readonly gap: GapService,
    private readonly briefs: GapBriefService,
  ) {}

  private async clamp(
    q: { scope: 'university' | 'faculty' | 'department'; scopeId?: string },
    user: SessionUser,
  ): Promise<{ scope: 'university' | 'faculty' | 'department'; scopeId: string | null }> {
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    // A PROGRAM_USER's clamp lands on 'program'. The map is a portfolio
    // view — a single programme is a Deep-Dive, not a field map — so the
    // route refuses rather than silently widening the user's scope.
    if (eff.scope === 'program') throw new ApiError('NOT_FOUND', 'programme scope has no gap map');
    return { scope: eff.scope, scopeId: eff.scopeId };
  }

  @Get('map')
  @Authorized('programs:read:all')
  @Provenance({ sources: GAP_MAP_SOURCES, methodologyVersion: GAP_MAP_VERSION, caveats: MAP_CAVEATS })
  async map(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(MapQuery)) q: MapQueryT) {
    const eff = await this.clamp(q, user);
    const result = await this.gap.map({ ...eff, thresholds: { under: q.under, over: q.over } });
    // The envelope's freshnessDate is what <FreshnessBadge> reads, and the
    // thresholds and the proxy's weight are per-request facts the drawer owes
    // the reader; @Provenance is static metadata and can carry none of them,
    // so the handler returns the envelope shape and lets the interceptor merge
    // the two.
    return {
      data: result,
      meta: mapMeta({
        thresholds: result.thresholds,
        reconciliation: result.reconciliation,
        freshnessDate: result.freshness.postingsAsOf,
      }),
    };
  }

  @Get('map/fields/:slug')
  @Authorized('programs:read:all')
  @Provenance({ sources: GAP_MAP_SOURCES, methodologyVersion: GAP_MAP_VERSION, caveats: MAP_CAVEATS })
  async fieldDetail(
    @AuthSession() user: SessionUser,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(MapQuery)) q: MapQueryT,
  ) {
    const eff = await this.clamp(q, user);
    const thresholds = { under: q.under, over: q.over };
    const { row, freshness, reconciliation } = await this.gap.field({ ...eff, thresholds, slug });
    if (!row) throw new ApiError('NOT_FOUND', `no field ${slug}`);
    return {
      data: row,
      meta: mapMeta({ thresholds, reconciliation, freshnessDate: freshness.postingsAsOf }),
    };
  }

  @Post('brief')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 10, ttl: 60_000 }, ai_hourly: { limit: 60, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'gap-analysis' })
  @AiCall({ module: 'gap-analysis' })
  async brief(@AuthSession() user: SessionUser, @Body(new ZodValidationPipe(BriefBody)) body: BriefBodyT) {
    const eff = await this.clamp(body, user);
    return this.briefs.generate({
      ...eff,
      verdict: body.verdict,
      facultyId: body.facultyId ?? null,
      thresholds: { under: body.under, over: body.over },
      userId: user.userId,
    });
  }

  @Post('brief/disagreements')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'gap_brief.disagreement', entityType: 'Annotation' })
  async disagree(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(DisagreementBody)) body: z.infer<typeof DisagreementBody>,
  ) {
    const data: Prisma.AnnotationUncheckedCreateInput = {
      userId: user.userId,
      entityType: 'gap-map',
      entityId: 'gap-brief',
      kind: 'disagreement',
      sectionKey: 'gap-brief',
      aiInferenceId: body.aiInferenceId,
      bodyEn: body.bodyEn,
      bodyTh: body.bodyTh,
    };
    try {
      return await prisma.annotation.create({ data });
    } catch (err) {
      // An aiInferenceId the caller made up is a caller mistake (400), not
      // a server fault — the same mapping the job-fields review API uses.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ApiError('VALIDATION_FAILED', 'unknown aiInferenceId');
      }
      throw err;
    }
  }

  // Digital-competency attainment lens — unchanged; the page moved to
  // /education/digital-competency and still reads this server-side.
  @Get('digital-competency')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'kku-dq', name: 'KKU Digital Intelligence (DQ) test · LTIC' },
      {
        id: 'kmitl-skill-mapping',
        name: 'LinkedIn labour-market skill demand · subscribed by MHESI (API hosted by KMITL)',
      },
      { id: 'dq-module-skills', name: 'Curated DQ module → skill-taxonomy mapping' },
    ],
    methodologyVersion: 'dq-skill-lens.v1',
  })
  async digitalCompetency(
    @AuthSession() user: SessionUser,
    @Query(
      new ZodValidationPipe(
        z.object({
          scope: z.enum(['university', 'faculty', 'department', 'program']).default('university'),
          scopeId: z.string().optional(),
        }),
      ),
    )
    q: { scope: 'university' | 'faculty' | 'department' | 'program'; scopeId?: string },
  ) {
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    return computeDqSkillLens({ scope: eff.scope, scopeId: eff.scopeId ?? null });
  }
}
