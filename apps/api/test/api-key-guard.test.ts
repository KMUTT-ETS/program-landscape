import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller, Post, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiError } from '@kku/shared';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';

const mocks = vi.hoisted(() => ({
  resolveApiKey: vi.fn(),
  touchApiKeyUsage: vi.fn().mockResolvedValue(undefined),
  recordApiRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@kku/db', () => mocks);

import { API_KEY_AUTH_META, ApiKeyAuth, ApiKeyGuard, requestIdOf } from '../src/external/api-key.guard';
import { JwtAuthGuard } from '../src/common/jwt-auth.guard';
import { PUBLIC_META } from '../src/common/decorators';
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

// ---------------------------------------------------------------------------
// Security-review follow-ups
// ---------------------------------------------------------------------------

const bearer = { authorization: 'Bearer kpl_live_abc' };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ApiKeyGuard — Redis unavailable', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:05Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('keeps enforcing the per-client limit in process memory', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client: { ...client, id: 'mem-1' }, keyId: 'k1' });
    const g = guardWith([undefined, undefined, undefined]);
    const req = () => ctx({ headers: bearer, ip: '10.0.0.1' }).c;
    await expect(g.canActivate(req())).resolves.toBe(true);
    await expect(g.canActivate(req())).resolves.toBe(true);
    const e = await thrown(g.canActivate(req()));
    expect(e.code).toBe('RATE_LIMITED');
  });

  it('starts a fresh window the next minute', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client: { ...client, id: 'mem-2' }, keyId: 'k1' });
    const g = guardWith([undefined, undefined, undefined, undefined]);
    const req = () => ctx({ headers: bearer, ip: '10.0.0.1' }).c;
    await g.canActivate(req());
    await g.canActivate(req());
    vi.setSystemTime(new Date('2026-09-30T10:01:01Z'));
    await expect(g.canActivate(req())).resolves.toBe(true);
  });
});

describe('ApiKeyGuard — bounded logging', () => {
  it('logs a 429 once per window, not on every rejected call', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const g = guardWith([3, 4, 5]);
    for (let i = 0; i < 3; i++) {
      const e = await thrown(g.canActivate(ctx({ headers: bearer, ip: '10.0.0.1' }).c));
      expect(e.code).toBe('RATE_LIMITED');
    }
    const calls429 = mocks.recordApiRequest.mock.calls.filter((c) => c[0].status === 429);
    expect(calls429).toHaveLength(1);
  });

  it('logs a 403 ip_not_allowed at most once per client per minute', async () => {
    client.ipAllowlist = ['10.101.0.0/16'];
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const g = guardWith([]);
    for (let i = 0; i < 3; i++) {
      const e = await thrown(g.canActivate(ctx({ headers: bearer, ip: '192.168.1.5' }).c));
      expect(e.code).toBe('FORBIDDEN');
    }
    expect(mocks.recordApiRequest.mock.calls.filter((c) => c[0].status === 403)).toHaveLength(1);
  });
});

describe('ApiKeyGuard — IP allowlist edges', () => {
  it('accepts an IPv4-mapped IPv6 caller inside the allowed range', async () => {
    client.ipAllowlist = ['10.101.0.0/16'];
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    await expect(guardWith([1]).canActivate(ctx({ headers: bearer, ip: '::ffff:10.101.5.7' }).c)).resolves.toBe(true);
  });

  it('refuses when req.ip is undefined and the allowlist is non-empty', async () => {
    client.ipAllowlist = ['10.101.0.0/16'];
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const e = await thrown(guardWith([1]).canActivate(ctx({ headers: bearer }).c));
    expect(e.code).toBe('FORBIDDEN');
  });
});

describe('ApiKeyGuard — logging failures never fail the request', () => {
  it('resolves true when touchApiKeyUsage rejects', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    mocks.touchApiKeyUsage.mockRejectedValueOnce(new Error('db down'));
    await expect(guardWith([1]).canActivate(ctx({ headers: bearer, ip: '10.0.0.1' }).c)).resolves.toBe(true);
    await tick();
  });

  it('throws only its own ApiError when recordApiRequest rejects', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    mocks.recordApiRequest.mockRejectedValueOnce(new Error('db down'));
    const e = await thrown(guardWith([3]).canActivate(ctx({ headers: bearer, ip: '10.0.0.1' }).c));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('RATE_LIMITED');
    await tick();
  });
});

describe('requestIdOf', () => {
  const r = (x: Record<string, unknown>) => x as unknown as Parameters<typeof requestIdOf>[0];
  it('keeps a well-formed id', () => {
    expect(requestIdOf(r({ headers: { 'x-request-id': 'abc-123' } }))).toBe('abc-123');
  });
  it('drops an over-long or malformed id', () => {
    expect(requestIdOf(r({ headers: { 'x-request-id': 'a'.repeat(200) } }))).toBeNull();
    expect(requestIdOf(r({ headers: { 'x-request-id': 'x y' } }))).toBeNull();
  });
  it('prefers req.id over the header', () => {
    expect(requestIdOf(r({ id: 'from-req', headers: { 'x-request-id': 'from-header' } }))).toBe('from-req');
  });
});

describe('@ApiKeyAuth() with the real decorator and guards', () => {
  @Controller('t')
  class MixedController {
    @Post('ext')
    @ApiKeyAuth()
    ext() {}

    @Post('plain')
    plain() {}
  }

  @Controller('c')
  @ApiKeyAuth()
  class WholeController {
    @Post('a')
    a() {}
    @Post('b')
    b() {}
  }

  function realCtx(cls: new () => object, method: string, headers: Record<string, string> = {}) {
    const handler = (cls.prototype as Record<string, unknown>)[method] as () => void;
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          ip: '10.0.0.1',
          header: (n: string) => headers[n.toLowerCase()],
        }),
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
    } as unknown as ExecutionContext;
  }

  const reflector = new Reflector();
  const jwt = new JwtAuthGuard(reflector, {
    getOrThrow: () => 'test-secret-at-least-32-characters-long',
  } as unknown as ConfigService);

  it('JwtAuthGuard lets an @ApiKeyAuth() route through without any token', async () => {
    const c = realCtx(MixedController, 'ext');
    expect(reflector.getAllAndOverride(PUBLIC_META, [c.getHandler(), c.getClass()])).toBe(true);
    await expect(jwt.canActivate(c)).resolves.toBe(true);
  });

  it('JwtAuthGuard still refuses the undecorated route without a token', async () => {
    const e = await thrown(jwt.canActivate(realCtx(MixedController, 'plain')));
    expect(e.code).toBe('UNAUTHORIZED');
  });

  it('ApiKeyGuard enforces on the same route when no key is presented', async () => {
    const e = await thrown(guardWith([]).canActivate(realCtx(MixedController, 'ext')));
    expect(e.code).toBe('UNAUTHORIZED');
  });

  it('ApiKeyGuard is a no-op on the undecorated route', async () => {
    await expect(guardWith([]).canActivate(realCtx(MixedController, 'plain'))).resolves.toBe(true);
    expect(mocks.resolveApiKey).not.toHaveBeenCalled();
  });

  it('a class-level @ApiKeyAuth() makes ApiKeyGuard enforce on every method', async () => {
    for (const m of ['a', 'b']) {
      const e = await thrown(guardWith([]).canActivate(realCtx(WholeController, m)));
      expect(e.code).toBe('UNAUTHORIZED');
      await expect(jwt.canActivate(realCtx(WholeController, m))).resolves.toBe(true);
    }
  });

  it('skips the default throttler bucket, and only that one', () => {
    const handler = MixedController.prototype.ext;
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, handler)).toBe(true);
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}heavy`, handler)).toBeUndefined();
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, MixedController.prototype.plain)).toBeUndefined();
    expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, WholeController)).toBe(true);
  });
});
