import { Prisma, type OrganizationProfile, type PrismaClient } from '@prisma/client';
import {
  OrganizationVersionConflictError,
  getOrganizationCacheGeneration,
  isOrganizationLoaded,
  setOrganizationCache,
  OrganizationNotConfiguredError,
  type BrandAssetKind,
  type BrandTokens,
  type Institution,
  type OrganizationBrandInput,
  type OrganizationIdentityInput,
} from '@kku/shared';
import { prisma } from './index';

// The organisation this installation serves — see
// docs/superpowers/specs/2026-10-15-white-label-organization-design.md §4.
// Every process calls loadOrganization() once at its entry point; @kku/shared's
// synchronous getInstitution() then reads the cache this fills.

const SINGLETON_ID = 'default';

export type OrgClient = Pick<PrismaClient, 'organizationProfile' | 'tcasAdmissionStat' | '$queryRaw'>;

/**
 * Loader state lives on globalThis beside @kku/shared's cache (same reason:
 * the Next.js server can hold two copies of these modules in one process).
 */
interface OrganizationLoaderState {
  /** Version of the row the cache was last filled from. */
  loadedVersion: number | null;
  /** The in-flight first load shared by ensureOrganizationLoaded() callers. */
  ensuring: Promise<void> | null;
}

const LOADER_STATE_KEY = Symbol.for('program-landscape.organization.loader');

type GlobalWithLoader = typeof globalThis & { [LOADER_STATE_KEY]?: OrganizationLoaderState };

function loaderState(): OrganizationLoaderState {
  const g = globalThis as GlobalWithLoader;
  let state = g[LOADER_STATE_KEY];
  if (!state) {
    state = { loadedVersion: null, ensuring: null };
    g[LOADER_STATE_KEY] = state;
  }
  return state;
}

function applyRow(row: OrganizationProfile | null): Institution | null {
  const inst = row ? profileToInstitution(row) : null;
  setOrganizationCache(inst);
  loaderState().loadedVersion = row?.version ?? null;
  return inst;
}

export function profileToInstitution(row: OrganizationProfile): Institution {
  return {
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    shortNameTh: row.shortNameTh,
    shortNameEn: row.shortNameEn,
    regionTh: row.regionTh,
    regionEn: row.regionEn,
    contactEmail: row.contactEmail,
    appUrl: row.appUrl,
    intakeFloorBachelor: row.intakeFloorBachelor,
    intakeFloorPostgrad: row.intakeFloorPostgrad,
    openalexInstitutionId: row.openalexInstitutionId,
  };
}

/** The product name is fixed; only the tagline carries the organisation. */
export function organizationTagline(shortNameEn: string): string {
  return `${shortNameEn} Curriculum Intelligence Platform`;
}

export async function getOrganizationProfile(client: OrgClient = prisma): Promise<OrganizationProfile | null> {
  return client.organizationProfile.findUnique({ where: { id: SINGLETON_ID } });
}

/** Reads the row and fills the shared cache. Returns null when no row exists. */
export async function loadOrganization(client: OrgClient = prisma): Promise<Institution | null> {
  const row = await getOrganizationProfile(client);
  return applyRow(row);
}

/**
 * Loads the profile once per process if nothing has loaded it yet; a no-op
 * otherwise. Concurrent callers share one load; a failed load is forgotten so
 * the next call retries. Request handlers whose code path reads the identity
 * await this, so a skipped or failed boot-time load heals on first use.
 */
export async function ensureOrganizationLoaded(client: OrgClient = prisma): Promise<void> {
  if (isOrganizationLoaded()) return;
  const state = loaderState();
  if (!state.ensuring) {
    state.ensuring = loadOrganization(client)
      .then(() => undefined)
      .finally(() => {
        state.ensuring = null;
      });
  }
  await state.ensuring;
}

/**
 * Long-running processes only. Polls the row every `intervalMs` and reloads
 * when its version moved. A failed poll keeps the last good identity — a
 * database blip must not turn every AI call into "not configured".
 */
export function startOrganizationRefresh(client: OrgClient = prisma, intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    const startedAt = getOrganizationCacheGeneration();
    void getOrganizationProfile(client)
      .then((row) => {
        // A save or another load wrote the cache while this read was in
        // flight; its result is newer than ours, so ours must not win.
        if (getOrganizationCacheGeneration() !== startedAt) return;
        const version = row?.version ?? null;
        if (version === loaderState().loadedVersion) return;
        applyRow(row);
      })
      .catch((err: unknown) => {
        console.warn(`[organization] refresh failed, keeping last identity: ${(err as Error).message}`);
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Creates the profile (expectedVersion null) or updates it under an
 * optimistic lock. Throws OrganizationVersionConflictError when someone else
 * saved first. Refreshes this process's cache immediately.
 */
export async function saveOrganizationIdentity(
  input: OrganizationIdentityInput,
  userId: string,
  client: OrgClient = prisma,
): Promise<OrganizationProfile> {
  const { expectedVersion, ...fields } = input;
  if (expectedVersion === null) {
    try {
      await client.organizationProfile.create({ data: { id: SINGLETON_ID, ...fields, updatedBy: userId } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new OrganizationVersionConflictError();
      throw err;
    }
  } else {
    const { count } = await client.organizationProfile.updateMany({
      where: { id: SINGLETON_ID, version: expectedVersion },
      data: { ...fields, updatedBy: userId, version: { increment: 1 } },
    });
    if (count === 0) throw new OrganizationVersionConflictError();
  }
  const row = await getOrganizationProfile(client);
  if (!row) throw new Error('organization_profile row vanished after save');
  applyRow(row);
  return row;
}

export const ASSET_COLUMN: Record<BrandAssetKind, 'logoLightKey' | 'logoDarkKey' | 'faviconKey'> = {
  'logo-light': 'logoLightKey',
  'logo-dark': 'logoDarkKey',
  favicon: 'faviconKey',
};

/**
 * The `?v=` cache-buster for a brand asset. An uploaded asset's key is
 * `<kind>/<sha256>.<ext>`, so the token carries its content: after a DB restore
 * a version number can repeat with different bytes, and a version-only token
 * would let browsers keep the old `immutable` copy for a year. No key (or a key
 * without a hash) → the bare version.
 */
export function assetToken(version: number, key: string | null): string {
  const hash = key ? /\/([0-9a-f]{12})[0-9a-f]*\.[a-z0-9]+$/.exec(key)?.[1] : undefined;
  return hash ? `${version}-${hash}` : String(version);
}

export function brandAssetUrls(
  row: Pick<OrganizationProfile, 'logoLightKey' | 'logoDarkKey' | 'faviconKey' | 'version'>,
): { logoLightUrl: string | null; logoDarkUrl: string | null; faviconUrl: string | null } {
  const url = (kind: BrandAssetKind, key: string | null) =>
    key ? `/brand/${kind}?v=${assetToken(row.version, key)}` : null;
  return {
    logoLightUrl: url('logo-light', row.logoLightKey),
    logoDarkUrl: url('logo-dark', row.logoDarkKey),
    faviconUrl: url('favicon', row.faviconKey),
  };
}

async function reloadAfterWrite(client: OrgClient): Promise<OrganizationProfile> {
  const row = await getOrganizationProfile(client);
  if (!row) throw new OrganizationNotConfiguredError();
  applyRow(row);
  return row;
}

/** Saves brand colours and their derived tokens under the version lock. */
export async function saveOrganizationBrand(
  input: OrganizationBrandInput,
  brandTokensJson: BrandTokens | null,
  userId: string,
  client: OrgClient = prisma,
): Promise<OrganizationProfile> {
  if (!(await getOrganizationProfile(client))) throw new OrganizationNotConfiguredError();
  const { count } = await client.organizationProfile.updateMany({
    where: { id: SINGLETON_ID, version: input.expectedVersion },
    data: {
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      brandTokensJson: brandTokensJson === null ? Prisma.JsonNull : (brandTokensJson as unknown as Prisma.InputJsonValue),
      updatedBy: userId,
      version: { increment: 1 },
    },
  });
  if (count === 0) throw new OrganizationVersionConflictError();
  return reloadAfterWrite(client);
}

/** Sets or clears one asset key; always bumps version so cached URLs bust. */
export async function setOrganizationAsset(
  kind: BrandAssetKind,
  key: string | null,
  userId: string,
  client: OrgClient = prisma,
): Promise<OrganizationProfile> {
  const { count } = await client.organizationProfile.updateMany({
    where: { id: SINGLETON_ID },
    data: { [ASSET_COLUMN[kind]]: key, updatedBy: userId, version: { increment: 1 } },
  });
  if (count === 0) throw new OrganizationNotConfiguredError();
  return reloadAfterWrite(client);
}
