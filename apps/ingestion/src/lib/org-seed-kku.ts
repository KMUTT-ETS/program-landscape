// Pure helpers for scripts/org-seed-kku.ts (kept here so they are testable
// without running the script's main()).
import { z } from 'zod';
import { KKU_REFERENCE_ORGANIZATION, type OrganizationIdentityInput } from '@kku/shared';

/** `--check` exit code when no organisation profile exists. */
export const ORG_SEED_CHECK_MISSING_EXIT = 3;

export interface OrgSeedArgs {
  /** No writes: exit 0 when a profile exists, ORG_SEED_CHECK_MISSING_EXIT when none. */
  check: boolean;
}

export function parseOrgSeedArgs(argv: readonly string[]): OrgSeedArgs {
  let check = false;
  for (const arg of argv) {
    if (arg === '--check') check = true;
    else throw new Error(`org-seed-kku: unknown argument "${arg}" (only --check is accepted)`);
  }
  return { check };
}

const ContactEmail = z.string().trim().email();

/** The only two environment keys the seed reads. */
export interface OrgSeedEnv {
  INSTITUTION_CONTACT_EMAIL?: string;
  OPENALEX_MAILTO?: string;
}

/**
 * KKU's profile as first seeded. Before white-label, KKU's outbound
 * User-Agent carried INSTITUTION_CONTACT_EMAIL (falling back to
 * OPENALEX_MAILTO); this carries that value into the database exactly once.
 * A malformed value is dropped (null) rather than failing the deploy.
 */
export function kkuSeedIdentity(env: OrgSeedEnv): OrganizationIdentityInput {
  const raw = env.INSTITUTION_CONTACT_EMAIL?.trim() || env.OPENALEX_MAILTO?.trim() || null;
  const parsed = raw === null ? null : ContactEmail.safeParse(raw);
  const contactEmail = parsed?.success ? parsed.data : null;
  return { ...KKU_REFERENCE_ORGANIZATION, contactEmail, expectedVersion: null };
}
