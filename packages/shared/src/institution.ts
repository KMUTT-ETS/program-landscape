/**
 * Institution identity — who this deployment is.
 *
 * Read from the `organization_profile` row (an admin edits it at
 * /admin/organization). Each process fills this cache with
 * `loadOrganization()` from @kku/db — the api and the ingestion worker at
 * boot, every CLI script at the top of main(). The readers here stay
 * synchronous so AI prompt builders and connectors need no plumbing.
 *
 * There is deliberately NO fallback: reading before the cache is loaded,
 * or when no row exists, throws. A white-label install must never quietly
 * call itself Khon Kaen University.
 */

export interface Institution {
  /** Must equal the `สถาบัน` column of the TCAS sheets (trimmed). */
  nameTh: string;
  /** Must equal the name in ranking tables and the Scopus affiliation. */
  nameEn: string;
  shortNameEn: string;
  shortNameTh: string;
  regionTh: string | null;
  regionEn: string | null;
  /** Sent in outbound User-Agents; null omits it. */
  contactEmail: string | null;
  /** Sent in outbound User-Agents. No trailing slash. */
  appUrl: string;
  /**
   * Minimum viable intake for a bachelor programme — council policy, read
   * through `intake-policy.ts`. Below it, a programme is closure-track.
   */
  intakeFloorBachelor: number;
  /** Minimum viable intake for a postgraduate programme — watch-list below. */
  intakeFloorPostgrad: number;
}

export class OrganizationNotLoadedError extends Error {
  constructor() {
    super(
      'Organisation identity read before loadOrganization() ran in this process — ' +
        'call `await loadOrganization()` at the entry point.',
    );
    this.name = 'OrganizationNotLoadedError';
  }
}

export class OrganizationNotConfiguredError extends Error {
  constructor() {
    super('Organisation is not configured yet — an administrator must fill in /admin/organization.');
    this.name = 'OrganizationNotConfiguredError';
  }
}

export class OrganizationVersionConflictError extends Error {
  constructor() {
    super('The organisation profile was changed by someone else — reload and try again.');
    this.name = 'OrganizationVersionConflictError';
  }
}

type CacheState = { loaded: false } | { loaded: true; inst: Institution | null };

/**
 * The cache lives on globalThis, not in module scope. Next.js bundles
 * @kku/shared into the web server while @kku/db loads its own copy from
 * node_modules, so one process can hold two instances of this module.
 * Keyed by a registered symbol, every copy reads and writes the same state.
 * `generation` moves on every write so a slow reader (the refresh poll) can
 * tell that its result is already stale.
 */
interface OrganizationCacheRecord {
  cache: CacheState;
  generation: number;
}

const ORGANIZATION_CACHE_KEY = Symbol.for('program-landscape.organization');

type GlobalWithOrganization = typeof globalThis & { [ORGANIZATION_CACHE_KEY]?: OrganizationCacheRecord };

function cacheRecord(): OrganizationCacheRecord {
  const g = globalThis as GlobalWithOrganization;
  let record = g[ORGANIZATION_CACHE_KEY];
  if (!record) {
    record = { cache: { loaded: false }, generation: 0 };
    g[ORGANIZATION_CACHE_KEY] = record;
  }
  return record;
}

function writeCache(cache: CacheState): void {
  const record = cacheRecord();
  record.cache = cache;
  record.generation += 1;
}

/** Called by @kku/db's loader. `null` means "loaded, no row". */
export function setOrganizationCache(inst: Institution | null): void {
  writeCache({ loaded: true, inst });
}

/** Test seam. `undefined` returns the cache to the never-loaded state. */
export function setOrganizationForTest(inst: Institution | null | undefined): void {
  writeCache(inst === undefined ? { loaded: false } : { loaded: true, inst });
}

/** True once a loader has run in this process (with or without a row). */
export function isOrganizationLoaded(): boolean {
  return cacheRecord().cache.loaded;
}

/** Increments on every cache write; lets a slow loader detect a newer write. */
export function getOrganizationCacheGeneration(): number {
  return cacheRecord().generation;
}

export function getInstitution(): Institution {
  const { cache } = cacheRecord();
  if (!cache.loaded) throw new OrganizationNotLoadedError();
  if (!cache.inst) throw new OrganizationNotConfiguredError();
  return cache.inst;
}

/**
 * The honest identifying User-Agent for outbound fetches:
 * `Program-Landscape/1.0 (+<appUrl>; <contactEmail>)`, with an optional
 * purpose suffix on the product token. Sites that refuse bot User-Agents
 * (the curated report feeds) use a browser string instead.
 */
export function outboundUserAgent(purpose?: string): string {
  const { appUrl, contactEmail } = getInstitution();
  const product = purpose ? `Program-Landscape/1.0 ${purpose}` : 'Program-Landscape/1.0';
  const comment = contactEmail ? `+${appUrl}; ${contactEmail}` : `+${appUrl}`;
  return `${product} (${comment})`;
}

/** True when a source row's institution name is this deployment's (trimmed compare). */
export function isOwnInstitution(institutionName: string | null | undefined): boolean {
  return institutionName?.trim() === getInstitution().nameTh;
}
