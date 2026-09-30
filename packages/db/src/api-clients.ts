// External API clients — key crypto, admin CRUD, and the call log.
//
// A key is `kpl_live_` + 32 random bytes (base64url, 43 chars). Only its
// SHA-256 is stored; the plaintext exists in exactly one response — the one
// that created it. Lookup is by the first 16 characters (`prefix`), then a
// constant-time hash comparison.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, type ApiClient, type ApiClientStatus, type ApiLookupType } from '@prisma/client';
import { z } from 'zod';
import { ApiError, isValidAllowlistEntry, STAFF_PROFILE_SECTIONS } from '@kku/shared';
import { prisma } from './index';

export const API_KEY_PREFIX = 'kpl_live_';
export const API_KEY_LOOKUP_PREFIX_LENGTH = 16;
/** 32 random bytes as unpadded base64url is 43 characters. */
export const API_KEY_LENGTH = API_KEY_PREFIX.length + 43;

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  keyHash: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, prefix: key.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH), keyHash: hashApiKey(key) };
}

export function apiKeyHashMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every reason a key can fail collapses to `false`: callers must not be able
 *  to tell a revoked key from an unknown one. */
export function isKeyRowUsable(
  row: {
    keyHash: string;
    revokedAt: Date | null;
    expiresAt: Date | null;
    client: { status: ApiClientStatus };
  },
  presented: string,
  now: Date,
): boolean {
  if (!apiKeyHashMatches(presented, row.keyHash)) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return row.client.status === 'ACTIVE';
}

export interface ResolvedApiKey {
  client: ApiClient;
  keyId: string;
}

export async function resolveApiKey(presented: string, now: Date = new Date()): Promise<ResolvedApiKey | null> {
  if (!presented.startsWith(API_KEY_PREFIX) || presented.length !== API_KEY_LENGTH) return null;
  const row = await prisma.apiClientKey.findUnique({
    where: { prefix: presented.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH) },
    include: { client: true },
  });
  if (!row || !isKeyRowUsable(row, presented, now)) return null;
  return { client: row.client, keyId: row.id };
}

// lastUsedAt is written at most once a minute per key, so a busy client does
// not turn every call into two extra UPDATEs.
//
// - The Map holds one entry per key that has authenticated in this process, so
//   it is bounded by the number of admin-issued keys.
// - The transaction rejects if the key or client row has vanished, so callers
//   must `.catch` it (a usage stamp must never fail the request).
// - It also bumps ApiClient.updatedAt, so updatedAt does not mean "settings
//   last changed".
const lastTouchMs = new Map<string, number>();
export async function touchApiKeyUsage(keyId: string, clientId: string, nowMs: number = Date.now()): Promise<void> {
  const prev = lastTouchMs.get(keyId);
  if (prev !== undefined && nowMs - prev < 60_000) return;
  lastTouchMs.set(keyId, nowMs);
  const at = new Date(nowMs);
  await prisma.$transaction([
    prisma.apiClientKey.update({ where: { id: keyId }, data: { lastUsedAt: at } }),
    prisma.apiClient.update({ where: { id: clientId }, data: { lastUsedAt: at } }),
  ]);
}

/** Deliberately has no field for the identifier the caller sent. */
export interface ApiRequestLogEntry {
  clientId: string;
  keyId: string | null;
  lookupType: ApiLookupType | null;
  facultyMemberId: string | null;
  status: number;
  sectionsReturned: string[];
  latencyMs: number;
  ip: string | null;
  requestId: string | null;
}

export async function recordApiRequest(entry: ApiRequestLogEntry): Promise<void> {
  await prisma.apiRequestLog.create({ data: entry });
}

// ─── Admin CRUD ────────────────────────────────────────────────────────────

export const ApiClientInputSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    ownerContact: z.string().trim().max(200).nullable().optional(),
    allowedSections: z.array(z.enum(STAFF_PROFILE_SECTIONS)).max(STAFF_PROFILE_SECTIONS.length)
      .transform((xs) => [...new Set(xs)]),
    allowCitizenIdLookup: z.boolean(),
    allowEmailLookup: z.boolean(),
    includeInactive: z.boolean(),
    ipAllowlist: z
      .array(z.string().trim())
      .max(50)
      .refine((xs) => xs.every(isValidAllowlistEntry), 'every entry must be an IP address or CIDR'),
    rateLimitPerMinute: z.number().int().min(1).max(600),
  })
  .strict();
export type ApiClientInput = z.infer<typeof ApiClientInputSchema>;

export const ApiClientPatchSchema = ApiClientInputSchema.partial()
  .extend({ status: z.enum(['ACTIVE', 'DISABLED']).optional() })
  .strict();
export type ApiClientPatch = z.infer<typeof ApiClientPatchSchema>;

export const IssueKeySchema = z
  .object({ expiresAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional()
      .refine((v) => v == null || Date.parse(v) > Date.now(), 'expiresAt must be in the future'),
  })
  .strict();
export const RevokeKeySchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export interface ApiClientKeyView {
  id: string;
  prefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IssuedApiKey {
  id: string;
  prefix: string;
  /** Plaintext — returned once, never stored, never logged. */
  key: string;
  expiresAt: string | null;
}

export interface ApiClientView {
  id: string;
  name: string;
  description: string | null;
  ownerContact: string | null;
  status: ApiClientStatus;
  allowedSections: string[];
  allowCitizenIdLookup: boolean;
  allowEmailLookup: boolean;
  includeInactive: boolean;
  ipAllowlist: string[];
  rateLimitPerMinute: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiClientSummary extends ApiClientView {
  activeKeys: number;
  requests24h: number;
  requests30d: number;
  notFound30d: number;
}

export interface ApiClientDetail extends ApiClientView {
  keys: ApiClientKeyView[];
  statusCounts30d: Array<{ status: number; count: number }>;
  recentRequests: Array<{
    id: string;
    createdAt: string;
    lookupType: ApiLookupType | null;
    staffName: string | null;
    status: number;
    latencyMs: number;
  }>;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toView(c: ApiClient): ApiClientView {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    ownerContact: c.ownerContact,
    status: c.status,
    allowedSections: c.allowedSections,
    allowCitizenIdLookup: c.allowCitizenIdLookup,
    allowEmailLookup: c.allowEmailLookup,
    includeInactive: c.includeInactive,
    ipAllowlist: c.ipAllowlist,
    rateLimitPerMinute: c.rateLimitPerMinute,
    lastUsedAt: iso(c.lastUsedAt),
    createdAt: c.createdAt.toISOString(),
  };
}

async function insertKey(
  tx: Prisma.TransactionClient,
  clientId: string,
  actorId: string | null,
  expiresAt: Date | null,
): Promise<IssuedApiKey> {
  // A 42-bit prefix collision is vanishingly rare. We look before we insert
  // rather than catching P2002: a unique violation aborts the surrounding
  // Postgres transaction, so a retry after one could never succeed. (A racing
  // insert of the same prefix between the check and the create would still
  // fail the whole call, which is acceptable at this probability.)
  for (let attempt = 0; attempt < 3; attempt++) {
    const g = generateApiKey();
    const taken = await tx.apiClientKey.findUnique({ where: { prefix: g.prefix }, select: { id: true } });
    if (taken) continue;
    const row = await tx.apiClientKey.create({
      data: { clientId, prefix: g.prefix, keyHash: g.keyHash, expiresAt, createdById: actorId },
    });
    return { id: row.id, prefix: row.prefix, key: g.key, expiresAt: iso(row.expiresAt) };
  }
  throw new Error('could not generate a unique API key prefix');
}

const nameTaken = (): ApiError =>
  new ApiError('VALIDATION_FAILED', 'An API client with this name already exists', { reason: 'name_taken' });

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.apiClient.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw nameTaken();
}

export async function createApiClient(
  input: ApiClientInput,
  actorId: string | null,
): Promise<{ id: string; client: ApiClientView; key: IssuedApiKey }> {
  await assertNameFree(input.name);
  try {
    return await prisma.$transaction(async (tx) => {
      const client = await tx.apiClient.create({
        data: {
          ...input,
          description: input.description ?? null,
          ownerContact: input.ownerContact ?? null,
          createdById: actorId,
        },
      });
      const key = await insertKey(tx, client.id, actorId, null);
      return { id: client.id, client: toView(client), key };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

export async function updateApiClient(id: string, patch: ApiClientPatch): Promise<ApiClientView | null> {
  if (patch.name !== undefined) await assertNameFree(patch.name, id);
  try {
    return toView(await prisma.apiClient.update({ where: { id }, data: patch }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return null;
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

export async function issueApiClientKey(
  clientId: string,
  actorId: string | null,
  expiresAt: Date | null,
): Promise<IssuedApiKey | null> {
  const exists = await prisma.apiClient.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!exists) return null;
  return prisma.$transaction((tx) => insertKey(tx, clientId, actorId, expiresAt));
}

export async function revokeApiClientKey(
  clientId: string,
  keyId: string,
  reason: string,
): Promise<ApiClientKeyView | null> {
  // Conditional on revokedAt IS NULL so the first revocation stays
  // authoritative; a second revoke is a no-op that returns the key as it is.
  await prisma.apiClientKey.updateMany({
    where: { id: keyId, clientId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  const row = await prisma.apiClientKey.findFirst({ where: { id: keyId, clientId } });
  return row ? keyView(row) : null;
}

function keyView(k: {
  id: string;
  prefix: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiClientKeyView {
  return {
    id: k.id,
    prefix: k.prefix,
    expiresAt: iso(k.expiresAt),
    revokedAt: iso(k.revokedAt),
    revokedReason: k.revokedReason,
    lastUsedAt: iso(k.lastUsedAt),
    createdAt: k.createdAt.toISOString(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function listApiClients(now: Date = new Date()): Promise<ApiClientSummary[]> {
  const since24h = new Date(now.getTime() - DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);
  const [clients, keys, r24, r30, nf30] = await Promise.all([
    prisma.apiClient.findMany({ orderBy: { name: 'asc' } }),
    prisma.apiClientKey.groupBy({
      by: ['clientId'],
      where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      _count: { _all: true },
    }),
    prisma.apiRequestLog.groupBy({ by: ['clientId'], where: { createdAt: { gte: since24h } }, _count: { _all: true } }),
    prisma.apiRequestLog.groupBy({ by: ['clientId'], where: { createdAt: { gte: since30d } }, _count: { _all: true } }),
    prisma.apiRequestLog.groupBy({
      by: ['clientId'],
      where: { createdAt: { gte: since30d }, status: 404 },
      _count: { _all: true },
    }),
  ]);
  const count = (rows: Array<{ clientId: string; _count: { _all: number } }>, id: string) =>
    rows.find((r) => r.clientId === id)?._count._all ?? 0;
  return clients.map((c) => ({
    ...toView(c),
    activeKeys: count(keys, c.id),
    requests24h: count(r24, c.id),
    requests30d: count(r30, c.id),
    notFound30d: count(nf30, c.id),
  }));
}

export async function getApiClientDetail(id: string, now: Date = new Date()): Promise<ApiClientDetail | null> {
  const client = await prisma.apiClient.findUnique({
    where: { id },
    include: { keys: { orderBy: { createdAt: 'desc' } } },
  });
  if (!client) return null;
  const since30d = new Date(now.getTime() - 30 * DAY_MS);
  const [byStatus, recent] = await Promise.all([
    prisma.apiRequestLog.groupBy({
      by: ['status'],
      where: { clientId: id, createdAt: { gte: since30d } },
      _count: { _all: true },
      orderBy: { status: 'asc' },
    }),
    prisma.apiRequestLog.findMany({ where: { clientId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const memberIds = [...new Set(recent.map((r) => r.facultyMemberId).filter((x): x is string => !!x))];
  const members = memberIds.length
    ? await prisma.facultyMember.findMany({ where: { id: { in: memberIds } }, select: { id: true, nameTh: true } })
    : [];
  const nameOf = new Map(members.map((m) => [m.id, m.nameTh]));
  return {
    ...toView(client),
    keys: client.keys.map(keyView),
    statusCounts30d: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    recentRequests: recent.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      lookupType: r.lookupType,
      staffName: r.facultyMemberId ? nameOf.get(r.facultyMemberId) ?? null : null,
      status: r.status,
      latencyMs: r.latencyMs,
    })),
  };
}
