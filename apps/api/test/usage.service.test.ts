import { beforeEach, describe, expect, it, vi } from 'vitest';

// UsageService.cached() is the thing under test: it must key on every
// argument that changes the answer (namespace + args), and detail reads
// must never go through it at all. Mock the @kku/db query surface so we
// can assert compute-call counts without a database.
const mocks = vi.hoisted(() => ({
  usageByModule: vi.fn(),
  usageByProgram: vi.fn(),
  usageSummary: vi.fn(),
  usageMedianDwell: vi.fn(),
  usageUsers: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  recordPageView: vi.fn(),
  usageActions: vi.fn(),
  usageByModule: mocks.usageByModule,
  usageByProgram: mocks.usageByProgram,
  usageByRole: vi.fn(),
  usageByViewerFaculty: vi.fn(),
  usageMedianDwell: mocks.usageMedianDwell,
  usageProgramViewers: vi.fn(),
  usageSummary: mocks.usageSummary,
  usageUserTimeline: vi.fn(),
  usageUsers: mocks.usageUsers,
}));

import { UsageService } from '../src/usage/usage.service';
import type { CacheService } from '../src/common/cache.service';

// A Map-backed stand-in for the Redis-backed CacheService — same get/set
// surface the service calls, none of the Redis plumbing.
class FakeCache {
  private readonly store = new Map<string, unknown>();

  get = vi.fn(async (key: string): Promise<unknown> => {
    return this.store.has(key) ? this.store.get(key) : undefined;
  });

  set = vi.fn(async (key: string, value: unknown): Promise<void> => {
    this.store.set(key, value);
  });
}

describe('UsageService — aggregate caching', () => {
  beforeEach(() => {
    mocks.usageByModule.mockReset().mockResolvedValue([{ module: 'cockpit', views: 1 }]);
    mocks.usageByProgram.mockReset().mockResolvedValue([]);
    mocks.usageSummary.mockReset().mockResolvedValue({ totalViews: 1, totalSessions: 1 });
    mocks.usageMedianDwell.mockReset().mockResolvedValue(1000);
    mocks.usageUsers.mockReset().mockResolvedValue({ rows: [], total: 0, signinOnly: 0 });
  });

  it('does not recompute an identical aggregate call the second time', async () => {
    const svc = new UsageService(new FakeCache() as unknown as CacheService);

    await svc.modules(30, true);
    await svc.modules(30, true);

    expect(mocks.usageByModule).toHaveBeenCalledTimes(1);
  });

  it('computes separately when excludeAdmins differs — the key must carry it', async () => {
    const svc = new UsageService(new FakeCache() as unknown as CacheService);

    await svc.modules(30, true);
    await svc.modules(30, false);

    expect(mocks.usageByModule).toHaveBeenCalledTimes(2);
  });

  it('computes separately when facultyId differs — the key must carry it', async () => {
    const svc = new UsageService(new FakeCache() as unknown as CacheService);

    await svc.programs(30, true, null);
    await svc.programs(30, true, 'fac-1');
    await svc.programs(30, true, null); // repeat of the first — should hit cache

    expect(mocks.usageByProgram).toHaveBeenCalledTimes(2);
  });

  it('computes separately when days differs — the key must carry it', async () => {
    const svc = new UsageService(new FakeCache() as unknown as CacheService);

    await svc.modules(30, true);
    await svc.modules(90, true);

    expect(mocks.usageByModule).toHaveBeenCalledTimes(2);
  });

  it('bundles summary + medianDwell under one cache key so a repeat call recomputes neither', async () => {
    const svc = new UsageService(new FakeCache() as unknown as CacheService);

    await svc.summary(30, true);
    await svc.summary(30, true);

    expect(mocks.usageSummary).toHaveBeenCalledTimes(1);
    expect(mocks.usageMedianDwell).toHaveBeenCalledTimes(1);
  });

  it('uses distinct namespaces for distinct aggregates so one does not shadow another', async () => {
    const cache = new FakeCache();
    const svc = new UsageService(cache as unknown as CacheService);

    await svc.modules(30, true);
    await svc.programs(30, true, null);

    expect(mocks.usageByModule).toHaveBeenCalledTimes(1);
    expect(mocks.usageByProgram).toHaveBeenCalledTimes(1);
  });
});

describe('UsageService — detail reads are never cached', () => {
  beforeEach(() => {
    mocks.usageUsers.mockReset().mockResolvedValue({ rows: [], total: 0, signinOnly: 0 });
  });

  it('recomputes users() on every call, even with identical arguments', async () => {
    const svc = new UsageService(new FakeCache() as unknown as CacheService);
    const opts = { activity: 'views' as const, page: 1, pageSize: 25 };

    await svc.users(30, true, null, opts);
    await svc.users(30, true, null, opts);

    expect(mocks.usageUsers).toHaveBeenCalledTimes(2);
    expect(mocks.usageUsers).toHaveBeenLastCalledWith(30, true, null, opts);
  });
});
