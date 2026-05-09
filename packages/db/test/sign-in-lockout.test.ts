import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../src/index', async () => {
  const actual = await vi.importActual<typeof import('../src/index')>('../src/index');
  return {
    ...actual,
    prisma: {
      auditLog: {
        count: mocks.count,
        findFirst: mocks.findFirst,
        create: mocks.create,
      },
    },
  };
});

import {
  getSignInLockoutStatus,
  recordSignInFailure,
  recordSignInSuccess,
  LOCKOUT_THRESHOLD,
  LOCKOUT_COOLDOWN_MINUTES,
} from '../src/sign-in-lockout';

const NOW = new Date('2026-05-09T12:00:00.000Z');

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('getSignInLockoutStatus', () => {
  it('returns unlocked when failure count is below threshold', async () => {
    mocks.count.mockResolvedValueOnce(LOCKOUT_THRESHOLD - 1);
    const r = await getSignInLockoutStatus('u1', NOW);
    expect(r.locked).toBe(false);
    expect(r.failedAttemptsInWindow).toBe(LOCKOUT_THRESHOLD - 1);
    expect(r.unlockAt).toBeNull();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('returns locked when failure count meets threshold; unlockAt = lastFailure + cooldown', async () => {
    mocks.count.mockResolvedValueOnce(LOCKOUT_THRESHOLD);
    const lastFailureAt = new Date(NOW.getTime() - 2 * 60 * 1000); // 2 min ago
    mocks.findFirst.mockResolvedValueOnce({ createdAt: lastFailureAt });
    const r = await getSignInLockoutStatus('u1', NOW);
    expect(r.locked).toBe(true);
    expect(r.unlockAt).toEqual(
      new Date(lastFailureAt.getTime() + LOCKOUT_COOLDOWN_MINUTES * 60 * 1000),
    );
  });

  it('returns unlocked once `now` passes the cooldown', async () => {
    mocks.count.mockResolvedValueOnce(LOCKOUT_THRESHOLD);
    const lastFailureAt = new Date(NOW.getTime() - (LOCKOUT_COOLDOWN_MINUTES + 1) * 60 * 1000);
    mocks.findFirst.mockResolvedValueOnce({ createdAt: lastFailureAt });
    const r = await getSignInLockoutStatus('u1', NOW);
    expect(r.locked).toBe(false);
  });

  it('queries with the right window — failures older than 15min are excluded', async () => {
    mocks.count.mockResolvedValueOnce(0);
    await getSignInLockoutStatus('u1', NOW);
    const arg = mocks.count.mock.calls[0]?.[0] as {
      where: { userId: string; action: string; createdAt: { gte: Date } };
    };
    const expectedSince = new Date(NOW.getTime() - 15 * 60 * 1000);
    expect(arg.where.userId).toBe('u1');
    expect(arg.where.action).toBe('auth.signin.fail');
    expect(arg.where.createdAt.gte.getTime()).toBe(expectedSince.getTime());
  });
});

describe('recordSignInFailure', () => {
  it('writes a single audit-log row with the right action', async () => {
    mocks.create.mockResolvedValueOnce({ id: 'a1' });
    await recordSignInFailure({ userId: 'u1', ipAddress: '10.1.2.3', reason: 'bad_password' });
    const arg = mocks.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data.userId).toBe('u1');
    expect(arg.data.action).toBe('auth.signin.fail');
    expect(arg.data.entityType).toBe('User');
    expect(arg.data.ipAddress).toBe('10.1.2.3');
    expect(arg.data.payloadJson).toEqual({ reason: 'bad_password' });
  });
});

describe('recordSignInSuccess', () => {
  it('writes an audit-log row with action auth.signin.ok', async () => {
    mocks.create.mockResolvedValueOnce({ id: 'a2' });
    await recordSignInSuccess({ userId: 'u1', ipAddress: null });
    const arg = mocks.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('auth.signin.ok');
    expect(arg.data.userId).toBe('u1');
  });
});
