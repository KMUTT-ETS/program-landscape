import { describe, expect, it } from 'vitest';
import {
  API_KEY_LOOKUP_PREFIX_LENGTH,
  API_KEY_PREFIX,
  ApiClientInputSchema,
  apiKeyHashMatches,
  generateApiKey,
  hashApiKey,
  isKeyRowUsable,
} from '../src/api-clients';

const now = new Date('2026-09-30T08:00:00Z');
const liveRow = (key: string, over: Partial<Parameters<typeof isKeyRowUsable>[0]> = {}) => ({
  keyHash: hashApiKey(key),
  revokedAt: null,
  expiresAt: null,
  client: { status: 'ACTIVE' as const },
  ...over,
});

describe('generateApiKey', () => {
  it('produces kpl_live_ + 43 base64url chars, a 16-char prefix and its hash', () => {
    const k = generateApiKey();
    expect(k.key).toMatch(/^kpl_live_[A-Za-z0-9_-]{43}$/);
    expect(k.prefix).toBe(k.key.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH));
    expect(k.prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(k.keyHash).toBe(hashApiKey(k.key));
    expect(generateApiKey().key).not.toBe(k.key);
  });
});

describe('apiKeyHashMatches', () => {
  it('matches only the exact key', () => {
    const { key, keyHash } = generateApiKey();
    expect(apiKeyHashMatches(key, keyHash)).toBe(true);
    expect(apiKeyHashMatches(key + 'x', keyHash)).toBe(false);
    expect(apiKeyHashMatches(key, 'not-hex')).toBe(false);
  });
});

describe('isKeyRowUsable', () => {
  const { key } = generateApiKey();
  it('accepts a live key on an active client', () => {
    expect(isKeyRowUsable(liveRow(key), key, now)).toBe(true);
  });
  it('refuses a wrong key, a revoked key, an expired key and a disabled client', () => {
    expect(isKeyRowUsable(liveRow(key), generateApiKey().key, now)).toBe(false);
    expect(isKeyRowUsable(liveRow(key, { revokedAt: now }), key, now)).toBe(false);
    expect(isKeyRowUsable(liveRow(key, { expiresAt: now }), key, now)).toBe(false);
    expect(isKeyRowUsable(liveRow(key, { client: { status: 'DISABLED' } }), key, now)).toBe(false);
  });
  it('accepts a key whose expiry is still ahead', () => {
    expect(isKeyRowUsable(liveRow(key, { expiresAt: new Date(now.getTime() + 1000) }), key, now)).toBe(true);
  });
});

describe('ApiClientInputSchema', () => {
  const valid = {
    name: 'HR portal',
    allowedSections: ['affiliation', 'education'],
    allowCitizenIdLookup: true,
    allowEmailLookup: false,
    includeInactive: false,
    ipAllowlist: ['10.101.0.0/16'],
    rateLimitPerMinute: 60,
  };
  it('accepts a valid client', () => {
    expect(ApiClientInputSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects an unknown section, a bad CIDR, an out-of-range limit and unknown keys', () => {
    expect(ApiClientInputSchema.safeParse({ ...valid, allowedSections: ['salary'] }).success).toBe(false);
    expect(ApiClientInputSchema.safeParse({ ...valid, ipAllowlist: ['10.0.0.0/33'] }).success).toBe(false);
    expect(ApiClientInputSchema.safeParse({ ...valid, rateLimitPerMinute: 0 }).success).toBe(false);
    expect(ApiClientInputSchema.safeParse({ ...valid, rateLimitPerMinute: 601 }).success).toBe(false);
    // .strict(): a body can never smuggle a key into the audit payload.
    expect(ApiClientInputSchema.safeParse({ ...valid, key: 'kpl_live_x' }).success).toBe(false);
  });
});
