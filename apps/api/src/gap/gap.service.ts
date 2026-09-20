import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  computeGapMap,
  type DemandBasisOptions,
  type GapMapResult,
  type GapMapRow,
  type GapMapScope,
  type GapThresholds,
} from '@kku/db';
import { CacheService } from '../common/cache.service';

// The gap map is a dozen aggregate queries over 47k postings; a Council
// session has several people opening the same view within minutes of each
// other, so it is cached for five minutes. The key carries BOTH thresholds
// — they change every verdict on the page, and a key that dropped one would
// serve a reader their colleague's answer under their own settings. Same
// reasoning extends the key over the demand basis and its window — see the
// comment inside `map()`.
//
// Invalidation is the taxonomy review API's job (it purges `gap:map:*`
// after every approve/reject/rename/merge), which is why the namespace ends
// where the arguments begin.

export const GAP_MAP_TTL_SECONDS = 300;
export const GAP_MAP_CACHE_NS = 'gap:map';

/** DI token for the compute function — the module binds `computeGapMap`;
 *  unit tests pass a stub through the constructor. */
export const COMPUTE_GAP_MAP = Symbol('COMPUTE_GAP_MAP');

export interface GapMapArgs {
  scope: GapMapScope;
  scopeId: string | null;
  thresholds: GapThresholds;
  demand: DemandBasisOptions;
}

@Injectable()
export class GapService {
  private readonly compute: (args: GapMapArgs) => Promise<GapMapResult>;

  constructor(
    private readonly cache: CacheService,
    @Optional() @Inject(COMPUTE_GAP_MAP) compute?: (args: GapMapArgs) => Promise<GapMapResult>,
  ) {
    this.compute = compute ?? computeGapMap;
  }

  async map(args: GapMapArgs): Promise<GapMapResult> {
    const key = CacheService.keyOf(GAP_MAP_CACHE_NS, {
      scope: args.scope,
      scopeId: args.scopeId,
      under: args.thresholds.under,
      over: args.thresholds.over,
      // Without these two the three bases collide in the cache and a reader
      // gets whichever was computed first under someone else's basis — the
      // same class of bug the thresholds already fixed once.
      basis: args.demand.basis,
      publicWindowMonths: args.demand.publicWindowMonths,
    });
    const hit = await this.cache.get<GapMapResult>(key);
    if (hit !== undefined) return hit;
    const value = await this.compute(args);
    await this.cache.set(key, value, GAP_MAP_TTL_SECONDS);
    return value;
  }

  /** One row, from the same cached map the table is built from — so the
   *  panel and the row behind it can never disagree. The map's freshness,
   *  its reconciliation, and the demand basis it was computed under all
   *  ride along: a row on its own carries no timestamp, no coverage
   *  figures, and no record of which basis produced it, and the panel owes
   *  the reader the same "updated X ago" and the same provenance drawer the
   *  table shows. */
  async field(
    args: GapMapArgs & { slug: string },
  ): Promise<{
    row: GapMapRow | null;
    freshness: GapMapResult['freshness'];
    reconciliation: GapMapResult['reconciliation'];
    demand: GapMapResult['demand'];
  }> {
    const m = await this.map(args);
    return {
      row: m.rows.find((r) => r.slug === args.slug) ?? null,
      freshness: m.freshness,
      reconciliation: m.reconciliation,
      demand: m.demand,
    };
  }
}
