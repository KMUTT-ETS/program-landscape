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
let cache: CacheState = { loaded: false };

/** Called by @kku/db's loader. `null` means "loaded, no row". */
export function setOrganizationCache(inst: Institution | null): void {
  cache = { loaded: true, inst };
}

/** Test seam. `undefined` returns the cache to the never-loaded state. */
export function setOrganizationForTest(inst: Institution | null | undefined): void {
  cache = inst === undefined ? { loaded: false } : { loaded: true, inst };
}

export function getInstitution(): Institution {
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
