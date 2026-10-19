// Per-user password hashing for the Credentials NextAuth provider.
//
// Validates passwords stored on User.passwordHash. SSO is the only auth
// most installations ever use, but two cases need a password: local
// development, and the first administrator of a fresh installation, who
// has to sign in before that installation's SSO exists at all (see
// packages/db/src/setup.ts).
//
// Format: 'scrypt:<salt-hex>:<hash-hex>'. scrypt is a Node built-in
// (no external dep). 16-byte salt, 64-byte hash, parameters cost
// N=16384, r=8, p=1 (the default).

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  if (!plain || plain.length < 4) {
    throw new Error('password must be at least 4 characters');
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_LEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN) return false;
  const actual = scryptSync(plain, salt, KEY_LEN);
  return timingSafeEqual(actual, expected);
}

export interface PasswordLoginOptions {
  /**
   * Development only. Accepts the shared `DEV_AUTH_PASSWORD` for accounts
   * that have no stored hash — which is every SSO-provisioned user. In
   * production that would be one string opening the whole university, and
   * it is the reason `assertLocalAuthSafe()` exists.
   */
  allowDevFallback: boolean;
}

/**
 * Whether `password` signs this account in.
 *
 * A stored hash is checked first and alone: the shared development
 * password must never open an account that set a real one, or enabling
 * the fallback on a machine would hand over the bootstrap admin too.
 */
export function passwordMatches(
  user: { passwordHash: string | null },
  password: string,
  options: PasswordLoginOptions,
): boolean {
  if (user.passwordHash) return verifyPassword(password, user.passwordHash);
  if (!options.allowDevFallback) return false;
  return password === (process.env.DEV_AUTH_PASSWORD ?? 'kku-dev');
}

export interface PasswordFormVisibility {
  localAuthEnabled: boolean;
  ssoConfigured: boolean;
  /** `/signin?password=1` — the escape hatch, see below. */
  forced: boolean;
}

/**
 * Whether the sign-in page shows a password form at all.
 *
 * Hidden wherever SSO is configured, so an installation whose accounts are
 * all SSO accounts does not invite anyone to type a password. Two
 * exceptions: development, and an explicit request.
 *
 * The explicit request matters more than it looks. The first admin of a
 * fresh installation signs in with a password; the moment that
 * installation wires SSO, this rule would hide the only door they have.
 * If nobody has been promoted to admin through SSO by then, the
 * university has locked itself out of its own system.
 */
export function shouldOfferPasswordForm(v: PasswordFormVisibility): boolean {
  return v.localAuthEnabled || v.forced || !v.ssoConfigured;
}
