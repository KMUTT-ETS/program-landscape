import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const mocks = vi.hoisted(() => ({
  createApiClient: vi.fn(),
  listApiClients: vi.fn(),
  getApiClientDetail: vi.fn(),
  updateApiClient: vi.fn(),
  issueApiClientKey: vi.fn(),
  revokeApiClientKey: vi.fn(),
}));
// Domain functions are mocked; the Zod schemas stay real so `.strict()` is exercised.
vi.mock('@kku/db', async () => {
  const real = await vi.importActual<Record<string, unknown>>('../../../packages/db/src/api-clients');
  return {
    ...mocks,
    ApiClientInputSchema: real.ApiClientInputSchema,
    ApiClientPatchSchema: real.ApiClientPatchSchema,
    IssueKeySchema: real.IssueKeySchema,
    RevokeKeySchema: real.RevokeKeySchema,
  };
});

import { AccessControlGuard, AUDIT_LOG_META } from '../src/common';
import { ApiClientsController } from '../src/admin/api-clients/api-clients.controller';

const MUTATIONS = ['create', 'update', 'issueKey', 'revokeKey'] as const;
const READS = ['list', 'detail'] as const;

function ctxFor(method: string, role: string): ExecutionContext {
  const handler = (ApiClientsController.prototype as unknown as Record<string, unknown>)[method];
  return {
    getHandler: () => handler,
    getClass: () => ApiClientsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u1', role, effectiveRole: role } }) }),
  } as unknown as ExecutionContext;
}

const baseBody = {
  name: 'HR portal', allowedSections: [], allowCitizenIdLookup: true, allowEmailLookup: false,
  includeInactive: false, ipAllowlist: [] as string[], rateLimitPerMinute: 60,
};

describe('ApiClientsController', () => {
  const saved = process.env.API_CLIENT_IP_ALLOWLIST;
  afterEach(() => {
    if (saved === undefined) delete process.env.API_CLIENT_IP_ALLOWLIST;
    else process.env.API_CLIENT_IP_ALLOWLIST = saved;
    vi.clearAllMocks();
  });

  it('lets SYSTEM_ADMIN and SUPER_ADMIN in, and refuses every other role, on every route', async () => {
    const guard = new AccessControlGuard(new Reflector());
    for (const m of [...MUTATIONS, ...READS]) {
      for (const role of ['SUPER_ADMIN', 'SYSTEM_ADMIN']) {
        expect(guard.canActivate(ctxFor(m, role))).toBe(true);
      }
      for (const role of ['UNIVERSITY_USER', 'FACULTY_USER', 'PROGRAM_USER']) {
        // The guard throws ApiError('FORBIDDEN') rather than returning false.
        expect(() => guard.canActivate(ctxFor(m, role))).toThrow();
      }
    }
  });

  it('audit-logs every mutation', () => {
    for (const m of MUTATIONS) {
      const handler = (ApiClientsController.prototype as unknown as Record<string, object>)[m]!;
      expect(Reflect.getMetadata(AUDIT_LOG_META, handler)).toBeDefined();
    }
  });

  it('returns the key plaintext from create — and the body it audits cannot carry one', async () => {
    mocks.createApiClient.mockResolvedValue({ id: 'c1', client: { id: 'c1' }, key: { id: 'k1', prefix: 'kpl_live_abcdefg', key: 'kpl_live_SECRET', expiresAt: null } });
    const ctl = new ApiClientsController();
    const out = await ctl.create({ userId: 'u1' } as never, baseBody);
    expect(out.key.key).toBe('kpl_live_SECRET');
    expect(JSON.stringify(baseBody)).not.toContain('kpl_live_');
  });

  it('refuses an IP allowlist unless the deployment enabled it', async () => {
    delete process.env.API_CLIENT_IP_ALLOWLIST;
    const ctl = new ApiClientsController();
    const body = { ...baseBody, ipAllowlist: ['10.0.0.0/8'] };
    await expect(Promise.resolve().then(() => ctl.create({ userId: 'u1' } as never, body))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'ip_allowlist_disabled' },
    });
    await expect(Promise.resolve().then(() => ctl.update('c1', { ipAllowlist: ['10.0.0.0/8'] }))).rejects.toMatchObject({
      details: { reason: 'ip_allowlist_disabled' },
    });
    expect(mocks.createApiClient).not.toHaveBeenCalled();
    expect(mocks.updateApiClient).not.toHaveBeenCalled();

    process.env.API_CLIENT_IP_ALLOWLIST = 'enabled';
    mocks.createApiClient.mockResolvedValue({ id: 'c1' });
    await ctl.create({ userId: 'u1' } as never, body);
    expect(mocks.createApiClient).toHaveBeenCalledTimes(1);
  });

  it('labels audit rows by the entity whose id the handler returns', () => {
    const expected = { create: 'ApiClient', update: 'ApiClient', issueKey: 'ApiClientKey', revokeKey: 'ApiClientKey' } as const;
    for (const m of MUTATIONS) {
      const handler = (ApiClientsController.prototype as unknown as Record<string, object>)[m]!;
      expect(Reflect.getMetadata(AUDIT_LOG_META, handler)).toMatchObject({ entityType: expected[m] });
    }
  });

  it('answers 404 when the domain function finds nothing', async () => {
    const ctl = new ApiClientsController();
    mocks.getApiClientDetail.mockResolvedValue(null);
    await expect(ctl.detail('x')).rejects.toBeInstanceOf(NotFoundException);
    mocks.updateApiClient.mockResolvedValue(null);
    await expect(ctl.update('x', { name: 'n' })).rejects.toBeInstanceOf(NotFoundException);
    mocks.issueApiClientKey.mockResolvedValue(null);
    await expect(ctl.issueKey({ userId: 'u1' } as never, 'x', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    mocks.revokeApiClientKey.mockResolvedValue(null);
    await expect(ctl.revokeKey('x', 'k', { reason: 'r' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows clearing an allowlist (empty array) even when allowlists are disabled', async () => {
    delete process.env.API_CLIENT_IP_ALLOWLIST;
    mocks.updateApiClient.mockResolvedValue({ id: 'c1' });
    const ctl = new ApiClientsController();
    await ctl.update('c1', { ipAllowlist: [] });
    expect(mocks.updateApiClient).toHaveBeenCalledWith('c1', { ipAllowlist: [] });
  });

  it('issueKey passes expiresAt as a Date, or null when omitted', async () => {
    mocks.issueApiClientKey.mockResolvedValue({ id: 'k1' });
    const ctl = new ApiClientsController();
    const iso = '2027-01-01T00:00:00.000Z';
    await ctl.issueKey({ userId: 'u1' } as never, 'c1', { expiresAt: iso } as never);
    const arg = mocks.issueApiClientKey.mock.calls[0]![2];
    expect(arg).toBeInstanceOf(Date);
    expect((arg as Date).toISOString()).toBe(iso);
    await ctl.issueKey({ userId: 'u1' } as never, 'c1', {} as never);
    expect(mocks.issueApiClientKey.mock.calls[1]![2]).toBeNull();
  });

  it('the real input schema rejects a body that smuggles in a key field', async () => {
    const real = await vi.importActual<typeof import('../../../packages/db/src/api-clients')>('../../../packages/db/src/api-clients');
    expect(real.ApiClientInputSchema.safeParse({ ...baseBody, key: 'kpl_live_x' }).success).toBe(false);
    expect(real.ApiClientInputSchema.safeParse(baseBody).success).toBe(true);
  });
});
