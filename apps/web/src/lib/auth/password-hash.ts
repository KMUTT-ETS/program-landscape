// Per-user dev-credentials password hashing.
//
// Used ONLY by the dev-credentials NextAuth provider to validate
// passwords stored on User.passwordHash. Production paths never
// invoke these helpers — KKU SSO is the only auth in prod.
//
// Format: 'scrypt:<salt-hex>:<hash-hex>'. scrypt is a Node built-in
// (no external dep). 16-byte salt, 64-byte hash, parameters cost
// N=16384, r=8, p=1 (the default — adequate for a dev-only flow).

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
