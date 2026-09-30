import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '@kku/shared';

const mocks = vi.hoisted(() => ({
  resolveApiKey: vi.fn(),
  touchApiKeyUsage: vi.fn().mockResolvedValue(undefined),
  recordApiRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@kku/db', () => mocks);

import { API_KEY_AUTH_META, ApiKeyGuard } from '../src/external/api-key.guard';
import type { CacheService } from '../src/common/cache.service';

const client = {
  id: 'c1',
  status: 'ACTIVE',
  ipAllowlist: [] as string[],
  rateLimitPerMinute: 2,
};

function ctx(req: Record<string, unknown>, enabled = true) {
  const handler = function h() {};
  if (enabled) Reflect.defineMetadata(API_KEY_AUTH_META, true, handler);
  const res = { setHeader: vi.fn() };
  const c = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { c, res };
}

function guardWith(counts: Array<number | undefined>) {
  const cache = { incrWindow: vi.fn() } as unknown as CacheService;
  for (const n of counts) (cache.incrWindow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(n);
  return new ApiKeyGuard(new Reflector(), cache);
}

async function thrown(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected a throw');
}

beforeEach(() => {
  mocks.resolveApiKey.mockReset();
  mocks.recordApiRequest.mockClear();
  client.ipAllowlist = [];
});

describe('ApiKeyGuard', () => {
  it('does nothing on routes without @ApiKeyAuth()', async () => {
    const { c } = ctx({ headers: {} }, false);
    await expect(guardWith([]).canActivate(c)).resolves.toBe(true);
    expect(mocks.resolveApiKey).not.toHaveBeenCalled();
  });

  it('attaches the client on a valid key', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer kpl_live_abc' }, ip: '10.0.0.1' };
    await expect(guardWith([1]).canActivate(ctx(req).c)).resolves.toBe(true);
    expect(req.apiClient).toEqual({ client, keyId: 'k1' });
  });

  it('gives one identical 401 for a missing header, a non-bearer header and an unusable key', async () => {
    mocks.resolveApiKey.mockResolvedValue(null);
    const errors = await Promise.all([
      thrown(guardWith([]).canActivate(ctx({ headers: {} }).c)),
      thrown(guardWith([]).canActivate(ctx({ headers: { authorization: 'Basic abc' } }).c)),
      thrown(guardWith([]).canActivate(ctx({ headers: { authorization: 'Bearer kpl_live_wrong' } }).c)),
    ]);
    const shapes = errors.map((e) => JSON.stringify({ code: e.code, message: e.message, details: e.details }));
    expect(new Set(shapes).size).toBe(1);
    expect(errors[0]!.code).toBe('UNAUTHORIZED');
  });

  it('refuses a caller outside the allowlist with 403 ip_not_allowed and logs it', async () => {
    client.ipAllowlist = ['10.101.0.0/16'];
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const e = await thrown(
      guardWith([]).canActivate(ctx({ headers: { authorization: 'Bearer kpl_live_abc' }, ip: '192.168.1.5' }).c),
    );
    expect(e.code).toBe('FORBIDDEN');
    expect(e.details).toEqual({ reason: 'ip_not_allowed' });
    expect(mocks.recordApiRequest).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1', status: 403 }));
  });

  it('returns 429 with Retry-After past the per-client limit', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const { c, res } = ctx({ headers: { authorization: 'Bearer kpl_live_abc' }, ip: '10.0.0.1' });
    const e = await thrown(guardWith([3]).canActivate(c));
    expect(e.code).toBe('RATE_LIMITED');
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(mocks.recordApiRequest).toHaveBeenCalledWith(expect.objectContaining({ status: 429 }));
  });

  it('allows the call when the rate-limit store is unavailable', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const req = { headers: { authorization: 'Bearer kpl_live_abc' }, ip: '10.0.0.1' };
    await expect(guardWith([undefined]).canActivate(ctx(req).c)).resolves.toBe(true);
  });
});
