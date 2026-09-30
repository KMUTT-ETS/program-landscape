import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@kku/shared';

const m = vi.hoisted(() => ({
  keyFindUnique: vi.fn(),
  keyUpdate: vi.fn(),
  keyUpdateMany: vi.fn(),
  keyFindFirst: vi.fn(),
  keyCreate: vi.fn(),
  clientUpdate: vi.fn(),
  clientFindFirst: vi.fn(),
  clientCreate: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../src/index', () => ({
  prisma: {
    apiClientKey: {
      findUnique: m.keyFindUnique,
      update: m.keyUpdate,
      updateMany: m.keyUpdateMany,
      findFirst: m.keyFindFirst,
      create: m.keyCreate,
    },
    apiClient: { update: m.clientUpdate, findFirst: m.clientFindFirst, create: m.clientCreate },
    $transaction: m.transaction,
  },
}));

import {
  API_KEY_LENGTH,
  API_KEY_LOOKUP_PREFIX_LENGTH,
  API_KEY_PREFIX,
  ApiClientInputSchema,
  ApiClientPatchSchema,
  IssueKeySchema,
  createApiClient,
  resolveApiKey,
  revokeApiClientKey,
  touchApiKeyUsage,
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
    expect(k.key.length).toBe(API_KEY_LENGTH);
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

describe('ApiClientInputSchema extras', () => {
  const valid = {
    name: 'HR portal',
    allowedSections: ['affiliation', 'education'],
    allowCitizenIdLookup: true,
    allowEmailLookup: false,
    includeInactive: false,
    ipAllowlist: [],
    rateLimitPerMinute: 60,
  };
  it('collapses duplicate sections', () => {
    const r = ApiClientInputSchema.parse({ ...valid, allowedSections: ['affiliation', 'affiliation', 'education'] });
    expect(r.allowedSections).toEqual(['affiliation', 'education']);
  });
  it('patch schema accepts status, rejects unknown keys, still dedupes', () => {
    expect(ApiClientPatchSchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
    expect(ApiClientPatchSchema.safeParse({ createdById: 'x' }).success).toBe(false);
    expect(ApiClientPatchSchema.parse({ allowedSections: ['education', 'education'] }).allowedSections).toEqual([
      'education',
    ]);
  });
});

describe('IssueKeySchema', () => {
  it('refuses a past expiry and accepts a future one with an offset', () => {
    expect(IssueKeySchema.safeParse({ expiresAt: '2020-01-01T00:00:00Z' }).success).toBe(false);
    expect(IssueKeySchema.safeParse({ expiresAt: '2099-01-01T00:00:00+07:00' }).success).toBe(true);
    expect(IssueKeySchema.safeParse({ expiresAt: null }).success).toBe(true);
    expect(IssueKeySchema.safeParse({}).success).toBe(true);
  });
});

describe('DB-touching functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolveApiKey rejects malformed keys without a lookup', async () => {
    const bad = ['', 'Bearer', 'abc_live_' + 'x'.repeat(43), API_KEY_PREFIX + 'x'.repeat(7), API_KEY_PREFIX + 'x'.repeat(44)];
    expect(bad[3]).toHaveLength(16);
    expect(bad[4]).toHaveLength(53);
    for (const b of bad) expect(await resolveApiKey(b)).toBeNull();
    expect(m.keyFindUnique).not.toHaveBeenCalled();
  });

  it('touchApiKeyUsage writes once per minute per key', async () => {
    m.transaction.mockResolvedValue([]);
    await touchApiKeyUsage('key-touch', 'c1', 1_000_000);
    await touchApiKeyUsage('key-touch', 'c1', 1_000_000 + 30_000);
    expect(m.transaction).toHaveBeenCalledTimes(1);
    await touchApiKeyUsage('key-touch', 'c1', 1_000_000 + 61_000);
    expect(m.transaction).toHaveBeenCalledTimes(2);
    expect(m.keyUpdate).toHaveBeenCalledTimes(2);
    expect(m.clientUpdate).toHaveBeenCalledTimes(2);
  });

  it('createApiClient turns a case-insensitive name clash into a name_taken ApiError', async () => {
    m.clientFindFirst.mockResolvedValue({ id: 'other' });
    m.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ apiClient: { findFirst: m.clientFindFirst, create: m.clientCreate }, apiClientKey: {} }),
    );
    const input = ApiClientInputSchema.parse({
      name: ' HR Portal ',
      allowedSections: [],
      allowCitizenIdLookup: false,
      allowEmailLookup: false,
      includeInactive: false,
      ipAllowlist: [],
      rateLimitPerMinute: 60,
    });
    const err = await createApiClient(input, null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_FAILED');
    expect((err as ApiError).details).toEqual({ reason: 'name_taken' });
    expect(m.clientFindFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'HR Portal', mode: 'insensitive' } },
      select: { id: true },
    });
    expect(m.clientCreate).not.toHaveBeenCalled();
  });

  it('revokeApiClientKey revokes only a not-yet-revoked key', async () => {
    m.keyUpdateMany.mockResolvedValue({ count: 0 });
    m.keyFindFirst.mockResolvedValue({
      id: 'k1',
      prefix: 'kpl_live_abcdefg',
      expiresAt: null,
      revokedAt: new Date('2026-01-01T00:00:00Z'),
      revokedReason: 'first',
      lastUsedAt: null,
      createdAt: new Date('2025-12-01T00:00:00Z'),
    });
    const v = await revokeApiClientKey('c1', 'k1', 'second');
    expect(m.keyUpdateMany.mock.calls[0]![0].where).toEqual({ id: 'k1', clientId: 'c1', revokedAt: null });
    expect(v?.revokedReason).toBe('first');
    m.keyFindFirst.mockResolvedValue(null);
    expect(await revokeApiClientKey('c1', 'nope', 'reason')).toBeNull();
  });
});
