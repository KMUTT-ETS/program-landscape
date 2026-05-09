import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the prisma module surface that AiQuotaGuard touches.
const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  prisma: {
    aiInference: { aggregate: mocks.aggregate },
  },
}));

import { AiQuotaGuard, AI_QUOTA_META } from '../src/common/ai-quota.guard';
import type { ExecutionContext } from '@nestjs/common';

function fakeCtx(user: { userId: string; role: string }, quotaCfg = {}): ExecutionContext {
  const handler = function fakeHandler() {};
  Reflect.defineMetadata(AI_QUOTA_META, quotaCfg, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

const reflector = {
  get<T>(_key: unknown, target: unknown): T | undefined {
    return Reflect.getMetadata(AI_QUOTA_META, target as object) as T | undefined;
  },
} as unknown as InstanceType<typeof import('@nestjs/core').Reflector>;

describe('AiQuotaGuard — role-aggregate cap (prompt 09)', () => {
  beforeEach(() => {
    mocks.aggregate.mockReset();
  });

  it('allows the call when both per-user and per-role spend are under cap', async () => {
    // 1st aggregate call = per-user; 2nd = per-role
    mocks.aggregate
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 0.1 } })
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 5 } });
    const guard = new AiQuotaGuard(reflector);
    const ctx = fakeCtx({ userId: 'u1', role: 'FACULTY_USER' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws RATE_LIMITED with scope=user when per-user cap is breached', async () => {
    // FACULTY_USER cap defaults to $1; spend 1.5
    mocks.aggregate
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 1.5 } })
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 5 } });
    const guard = new AiQuotaGuard(reflector);
    const ctx = fakeCtx({ userId: 'u1', role: 'FACULTY_USER' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: expect.objectContaining({ scope: 'user', capUsd: 1 }),
    });
  });

  it('throws RATE_LIMITED with scope=role when role-aggregate cap is breached', async () => {
    // FACULTY_USER per-user OK ($0.1) but role-aggregate over $20 default
    mocks.aggregate
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 0.1 } })
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 25 } });
    const guard = new AiQuotaGuard(reflector);
    const ctx = fakeCtx({ userId: 'u1', role: 'FACULTY_USER' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: expect.objectContaining({
        scope: 'role',
        role: 'FACULTY_USER',
        capUsd: 20,
      }),
    });
  });

  it('per-user cap is checked before per-role (stable failure surface)', async () => {
    // Both over — user breach surfaces first with scope=user.
    mocks.aggregate
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 5 } })
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 100 } });
    const guard = new AiQuotaGuard(reflector);
    const ctx = fakeCtx({ userId: 'u1', role: 'FACULTY_USER' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: expect.objectContaining({ scope: 'user' }),
    });
  });

  it('fail-open on DB error — quotas are governance, not security', async () => {
    mocks.aggregate.mockRejectedValueOnce(new Error('connection refused'));
    const guard = new AiQuotaGuard(reflector);
    const ctx = fakeCtx({ userId: 'u1', role: 'FACULTY_USER' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('admin tier sees its own caps (not the default tier)', async () => {
    // SYSTEM_ADMIN: per-user $10, role-agg $200. Spend 5 / 150 — both
    // under, which would have BREACHED the FACULTY_USER cap (1 / 20).
    mocks.aggregate
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 5 } })
      .mockResolvedValueOnce({ _sum: { costEstimateUsd: 150 } });
    const guard = new AiQuotaGuard(reflector);
    const ctx = fakeCtx({ userId: 'u1', role: 'SYSTEM_ADMIN' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  describe('concurrency — race conditions on near-cap state', () => {
    // Each guard invocation reads the persisted snapshot independently.
    // We can't enforce strict serialisation at the guard layer (the cap
    // is a soft governance limit, not a hard quota), but we MUST verify
    // that:
    //   1. Each request sees the snapshot as-of its own read.
    //   2. Once a request that pushes spend OVER the cap completes, the
    //      next read reflects the new total and refuses.
    //
    // The race window where N concurrent requests all read "below cap"
    // and all proceed is documented behavior — load test on staging
    // verifies the steady-state ceiling.

    it('5 concurrent reads at $0.10 below cap all succeed independently', async () => {
      // Per-user cap = $1 default for FACULTY_USER. 5 reads at $0.90 each.
      mocks.aggregate.mockImplementation(() =>
        Promise.resolve({ _sum: { costEstimateUsd: 0.9 } }),
      );
      const guard = new AiQuotaGuard(reflector);
      const ctx = fakeCtx({ userId: 'u1', role: 'FACULTY_USER' });

      const results = await Promise.all(
        [1, 2, 3, 4, 5].map(() => guard.canActivate(ctx)),
      );
      expect(results).toEqual([true, true, true, true, true]);
      // 5 requests × 2 reads each (per-user + per-role) = 10 aggregate calls
      expect(mocks.aggregate).toHaveBeenCalledTimes(10);
    });

    it('once spend crosses cap, subsequent calls fail closed', async () => {
      const guard = new AiQuotaGuard(reflector);
      const ctx = fakeCtx({ userId: 'u1', role: 'FACULTY_USER' });

      // First call: under cap ($0.5)
      mocks.aggregate
        .mockResolvedValueOnce({ _sum: { costEstimateUsd: 0.5 } })
        .mockResolvedValueOnce({ _sum: { costEstimateUsd: 5 } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      // Second call after spend crossed: $1.5 > $1 cap → refuse
      mocks.aggregate
        .mockResolvedValueOnce({ _sum: { costEstimateUsd: 1.5 } })
        .mockResolvedValueOnce({ _sum: { costEstimateUsd: 5 } });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
    });

    it('per-user breach for one user does NOT affect another user', async () => {
      // Two users with the same role; user A is over cap, user B is fine.
      const guard = new AiQuotaGuard(reflector);

      // User A: per-user $1.5 (over the $1 cap), role-agg fine
      mocks.aggregate
        .mockResolvedValueOnce({ _sum: { costEstimateUsd: 1.5 } })
        .mockResolvedValueOnce({ _sum: { costEstimateUsd: 5 } });
      await expect(
        guard.canActivate(fakeCtx({ userId: 'userA', role: 'FACULTY_USER' })),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

      // User B: per-user $0.1 (well under), role-agg fine — isolated
      mocks.aggregate
        .mockResolvedValueOnce({ _sum: { costEstimateUsd: 0.1 } })
        .mockResolvedValueOnce({ _sum: { costEstimateUsd: 5 } });
      await expect(
        guard.canActivate(fakeCtx({ userId: 'userB', role: 'FACULTY_USER' })),
      ).resolves.toBe(true);
    });
  });
});
