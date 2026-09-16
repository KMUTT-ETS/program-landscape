import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  computeGapMap,
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
// serve a reader their colleague's answer under their own settings.
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
    });
    const hit = await this.cache.get<GapMapResult>(key);
    if (hit !== undefined) return hit;
    const value = await this.compute(args);
    await this.cache.set(key, value, GAP_MAP_TTL_SECONDS);
    return value;
  }

  /** One row, from the same cached map the table is built from — so the
   *  panel and the row behind it can never disagree. The map's freshness
   *  rides along: a row on its own carries no timestamp, and the panel owes
   *  the reader the same "updated X ago" the table shows. */
  async field(
    args: GapMapArgs & { slug: string },
  ): Promise<{ row: GapMapRow | null; freshness: GapMapResult['freshness'] }> {
    const m = await this.map(args);
    return { row: m.rows.find((r) => r.slug === args.slug) ?? null, freshness: m.freshness };
  }
}
