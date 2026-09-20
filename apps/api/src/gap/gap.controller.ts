import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  computeDqSkillLens,
  DemandBasisQuerySchema,
  GAP_MAP_VERSION,
  GAP_VERDICTS,
  JOBTHAI_MIN_POSTINGS_FOR_SIGNAL,
  parseDemandBasis,
  Prisma,
  prisma,
  readJob108Settings,
  ThresholdsSchema,
  type GapMapResult,
  type GapThresholds,
} from '@kku/db';
import { ApiError, type ApiMeta, type DemandBasis, type SessionUser } from '@kku/shared';
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

// `basis` + `publicWindowMonths` reuse `DemandBasisQuerySchema` rather than
// re-declaring `z.enum(DEMAND_BASES)` here — same DRY reasoning as
// `.and(ThresholdsSchema)` below. An unrecognised basis (e.g. `?basis=
// government`) fails validation rather than silently falling back to the
// default: a shared link with a typo should look broken, not different.
//
// `DemandBasisQuerySchema`, not `DemandBasisSchema`: the latter defaults
// `publicWindowMonths` to `DEFAULT_PUBLIC_WINDOW_MONTHS` INSIDE this Zod
// parse, before the handler ever sees it — which would mean
// `q.publicWindowMonths` is never `undefined` and the operator-configured
// stored default (`job108.defaultWindowMonths`) could never win. Leaving
// it optional here lets `parseDemandBasis`'s own precedence chain
// (explicit URL parameter → stored setting → built-in default) decide,
// in one place, without duplicating that logic at the route boundary.
export const MapQuery = z
  .object({
    scope: ScopeSchema.default('university'),
    scopeId: z.string().optional(),
  })
  .and(ThresholdsSchema)
  .and(DemandBasisQuerySchema);
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

/** Human phrase per demand basis, for the drawer — never the source slug.
 *  `all` is worded first because it is the default and because "both
 *  markets" is the phrase that most needs the reader to notice it is not
 *  JobThai alone. */
const DEMAND_BASIS_LABELS: Record<DemandBasis, string> = {
  all: 'Both markets — JobThai private-sector adverts and Thai government announcements',
  private: 'Private sector only — JobThai adverts',
  public: 'Government only — Thai government announcements',
};

/**
 * Provenance that changes with the request, merged over the static
 * `@Provenance` by the response interceptor (which spreads the handler's own
 * `meta` last — see ResponseEnvelopeInterceptor).
 *
 * Facts belong here rather than in the decorator when they are per-request:
 *
 *  - **The thresholds.** They are URL parameters, so two readers can hold the
 *    same `gap-map.v1` stamp and different verdicts. Council-readiness rule 1
 *    puts the calculation method in the drawer; a threshold an analyst moved
 *    for one review is part of that method, and a drawer that shows only the
 *    version would let a shared link look like the default.
 *  - **The demand basis and its window.** Also a URL parameter, and it moves
 *    the demand denominator itself — the same reasoning as the thresholds,
 *    one level upstream of the verdict.
 *  - **How much of the supply total rests on the enrolment proxy**, and **how
 *    many public seats are on the page but not counted into the ratio.** Both
 *    are the softest parts of the numbers shown and both move with the data,
 *    so the sentences carry the counts this response actually computed
 *    rather than a figure that was true on the day it was written.
 */
export function mapMeta(args: {
  thresholds: GapThresholds;
  demand: GapMapResult['demand'];
  reconciliation: Pick<
    GapMapResult['reconciliation'],
    'scoredWithSupply' | 'supplyFromProxy' | 'publicAnnouncements' | 'publicPositions' | 'publicSeats'
  >;
  freshnessDate: string | null;
}): Pick<ApiMeta, 'freshnessDate' | 'caveats' | 'methodologyParameters'> {
  const { scoredWithSupply, supplyFromProxy, publicAnnouncements, publicPositions, publicSeats } = args.reconciliation;
  return {
    freshnessDate: args.freshnessDate,
    methodologyParameters: [
      { label: 'Demand counted from', value: DEMAND_BASIS_LABELS[args.demand.basis] },
      {
        label: 'Public announcements counted since',
        value: `${args.demand.publicWindowFrom} (${args.demand.publicWindowMonths} months back)`,
      },
      { label: 'Under-served below a ratio of', value: args.thresholds.under.toFixed(2) },
      { label: 'Over-served above a ratio of', value: args.thresholds.over.toFixed(2) },
      { label: 'Too few adverts to read, below', value: `${JOBTHAI_MIN_POSTINGS_FOR_SIGNAL} adverts` },
    ],
    caveats: [
      ...MAP_CAVEATS,
      `Part of the KKU supply total rests on a single-year enrolment figure standing in for a multi-cohort mean: ${supplyFromProxy} of the ${scoredWithSupply} scored programmes carrying a graduate figure are counted that way. It is the largest single piece of softness in the supply side.`,
      `Government announcements inside the window report ${publicPositions} positions across ${publicAnnouncements} announcements, offering ${publicSeats} seats. Seats are shown but never weighted into a share — JobThai carries no headcount column, and weighting public seats against private adverts of unknown size would over-weight the public side by an unknowable factor.`,
      "The two sides are extracted differently. Private field-of-study strings come from a deterministic parser tuned to JobThai's corpus; public ones come from a model prompt, because that parser takes the first whitespace-delimited token and government announcements separate disciplines with spaces. Measured over the same 120 postings, the two agreed on 64%; the model recovered 69 discipline names the parser missed, while 17 strings only the parser produced were mostly not disciplines at all.",
      'Government rows feed the field-of-study layer only — they carry no occupation classification, so they create no occupation rows and no programme links, and do not move the JobThai demand-alignment health driver directly.',
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

  /** Precedence: explicit `?publicWindowMonths=` on the request → the
   *  operator-configured `job108.defaultWindowMonths` SystemSetting →
   *  `DEFAULT_PUBLIC_WINDOW_MONTHS`. `parseDemandBasis` is the one place
   *  that resolves the chain; this only supplies its per-request stored
   *  fallback, read fresh on every call so an operator's edit on
   *  /admin/external/ai-search takes effect immediately (SystemSetting has
   *  no cache layer here, unlike academic-year's 60s cache). */
  private async resolveDemand(q: {
    basis?: string;
    publicWindowMonths?: string | number;
  }): Promise<ReturnType<typeof parseDemandBasis>> {
    const settings = await readJob108Settings();
    return parseDemandBasis(q, { defaultPublicWindowMonths: settings.defaultWindowMonths });
  }

  @Get('map')
  @Authorized('programs:read:all')
  @Provenance({ sources: GAP_MAP_SOURCES, methodologyVersion: GAP_MAP_VERSION, caveats: MAP_CAVEATS })
  async map(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(MapQuery)) q: MapQueryT) {
    const eff = await this.clamp(q, user);
    const demand = await this.resolveDemand({ basis: q.basis, publicWindowMonths: q.publicWindowMonths });
    const result = await this.gap.map({ ...eff, thresholds: { under: q.under, over: q.over }, demand });
    // The envelope's freshnessDate is what <FreshnessBadge> reads, and the
    // thresholds, the demand basis and the proxy's weight are per-request
    // facts the drawer owes the reader; @Provenance is static metadata and
    // can carry none of them, so the handler returns the envelope shape and
    // lets the interceptor merge the two. `result.demand` (not the parsed
    // request `demand`) is what mapMeta gets — it carries the window's
    // resolved start date, which the request only ever states in months.
    return {
      data: result,
      meta: mapMeta({
        thresholds: result.thresholds,
        demand: result.demand,
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
    const demand = await this.resolveDemand({ basis: q.basis, publicWindowMonths: q.publicWindowMonths });
    const { row, freshness, reconciliation, demand: resolvedDemand } = await this.gap.field({
      ...eff,
      thresholds,
      demand,
      slug,
    });
    if (!row) throw new ApiError('NOT_FOUND', `no field ${slug}`);
    return {
      data: row,
      meta: mapMeta({ thresholds, demand: resolvedDemand, reconciliation, freshnessDate: freshness.postingsAsOf }),
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
