/** The private-sector board. Hand-delivered XLSX drops; see docs/data-sources/jobthai.md.
 *
 *  `packages/db/src/jobthai.ts` and `packages/db/src/demand-match-sources.ts` each
 *  carry their own copy of this slug, predating this module. This one is the
 *  demand-denominator vocabulary; fold the other two in here when something
 *  next touches them, rather than adding a fourth. */
export const PRIVATE_DEMAND_SOURCE = 'jobthai';

/** Thai government and state-enterprise announcements; see docs/data-sources/job-108.md. */
export const PUBLIC_DEMAND_SOURCE = 'job-108';

export const DEMAND_BASES = ['all', 'private', 'public'] as const;
export type DemandBasis = (typeof DEMAND_BASES)[number];

/**
 * `all` is the default because excluding the state biases the map against
 * exactly the nursing, public-health, teaching and agriculture programmes a
 * regional university exists to feed.
 */
export const DEFAULT_DEMAND_BASIS: DemandBasis = 'all';

/**
 * How far back public announcements count. JobThai's own window is
 * undocumented and underivable — the 2026-09 drop has no date column — so no
 * value here achieves true comparability. It is a visible parameter rather
 * than a constant precisely so it can be argued with.
 */
export const DEFAULT_PUBLIC_WINDOW_MONTHS = 12;

const SOURCES_BY_BASIS: Record<DemandBasis, readonly string[]> = {
  all: [PRIVATE_DEMAND_SOURCE, PUBLIC_DEMAND_SOURCE],
  private: [PRIVATE_DEMAND_SOURCE],
  public: [PUBLIC_DEMAND_SOURCE],
};

/** Source slugs whose postings form the demand denominator under `basis`.
 *
 *  Returns a fresh mutable array rather than the shared constant: callers feed
 *  it straight into Prisma `{ in: [...] }` and `Prisma.sql` array parameters,
 *  neither of which accepts a `readonly string[]` under strict mode. */
export function demandSourcesFor(basis: DemandBasis): string[] {
  return [...SOURCES_BY_BASIS[basis]];
}
