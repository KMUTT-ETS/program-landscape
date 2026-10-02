import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runFindMany: vi.fn(),
  memberFindMany: vi.fn(),
}));

vi.mock('../src/index', () => ({
  prisma: {
    ingestionRun: { findMany: mocks.runFindMany },
    researchServiceProjectMember: { findMany: mocks.memberFindMany },
  },
}));

import { __resetGrantGateCache, fundedStaffIds, grantEngagementDriver, loadGrantGate } from '../src/grant-engagement';

const NOW = new Date('2026-11-15T12:00:00+07:00');
const DAY = 86_400_000;
const daily = (n: number) => Array.from({ length: n }, (_, i) => ({ completedAt: new Date(NOW.getTime() - (i + 0.2) * DAY) }));

beforeEach(() => {
  mocks.runFindMany.mockReset();
  mocks.memberFindMany.mockReset();
  __resetGrantGateCache();
});

afterEach(() => vi.useRealTimers());

describe('loadGrantGate cache', () => {
  it('never caches or serves the cache for an explicit now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.runFindMany.mockResolvedValue(daily(40));
    const future = new Date(NOW.getTime() + 400 * DAY);
    const f = await loadGrantGate(future);
    expect(f.open).toBe(false); // stale at the future instant
    const real = await loadGrantGate();
    expect(real.open).toBe(true);
    expect(mocks.runFindMany).toHaveBeenCalledTimes(2);
  });

  it('shares one query between concurrent cold callers', async () => {
    mocks.runFindMany.mockResolvedValue(daily(40));
    await Promise.all([loadGrantGate(), loadGrantGate()]);
    expect(mocks.runFindMany).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure', async () => {
    mocks.runFindMany.mockRejectedValueOnce(new Error('db down'));
    await expect(loadGrantGate()).rejects.toThrow('db down');
    mocks.runFindMany.mockResolvedValue([]);
    await expect(loadGrantGate()).resolves.toEqual({ open: false, reason: 'source-not-synced' });
    expect(mocks.runFindMany).toHaveBeenCalledTimes(2);
  });
});

describe('loadGrantGate', () => {
  it('reads successful runs of the grants source once and caches the result', async () => {
    mocks.runFindMany.mockResolvedValue(daily(40));
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const a = await loadGrantGate();
    const b = await loadGrantGate();
    expect(a.open).toBe(true);
    expect(b).toEqual(a);
    expect(mocks.runFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.runFindMany).toHaveBeenCalledWith({
      where: { status: 'SUCCEEDED', completedAt: { not: null }, dataSource: { slug: 'kku-research-services' } },
      select: { completedAt: true },
    });
  });
});

describe('fundedStaffIds', () => {
  it('returns the distinct staff with a membership in the window, real data only', async () => {
    mocks.memberFindMany.mockResolvedValue([{ facultyMemberId: 'a' }, { facultyMemberId: 'b' }]);
    const ids = await fundedStaffIds(['a', 'b', 'c'], { fromFyBe: 2567, toFyBe: 2569 });
    expect([...ids].sort()).toEqual(['a', 'b']);
    expect(mocks.memberFindMany).toHaveBeenCalledWith({
      where: {
        facultyMemberId: { in: ['a', 'b', 'c'] },
        project: { fiscalYearBe: { gte: 2567, lte: 2569 } },
        ingestionRun: { dataSource: { mocked: false } },
      },
      select: { facultyMemberId: true },
      distinct: ['facultyMemberId'],
    });
  });

  it('does not query for an empty staff list', async () => {
    expect((await fundedStaffIds([], { fromFyBe: 2567, toFyBe: 2569 })).size).toBe(0);
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });
});

describe('grantEngagementDriver', () => {
  it('is null with the gate reason while the gate is closed, without reading memberships', async () => {
    mocks.runFindMany.mockResolvedValue(daily(5));
    const d = await grantEngagementDriver(['a', 'b'], NOW);
    expect(d.label).toBe('external_grant_engagement');
    expect(d.value).toBeNull();
    expect(d.raw).toMatchObject({ reason: 'awaiting-green-history', daysOfHistory: 4 });
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it('scores the funded share when the gate is open, and a real zero when nobody is funded', async () => {
    mocks.runFindMany.mockResolvedValue(daily(40));
    mocks.memberFindMany.mockResolvedValueOnce([{ facultyMemberId: 'a' }]);
    const d = await grantEngagementDriver(['a', 'b', 'c', 'd', 'e'], NOW);
    expect(d.value).toBeCloseTo((1 / 5 / 0.6) * 100, 5);
    expect(d.raw).toMatchObject({ fundedStaff: 1, staff: 5, windowFyBe: [2567, 2569], target: 0.6, lowerBound: true });
    expect((d.raw as { caveat?: unknown }).caveat).toMatch(/^Lower bound: about 30%/);

    mocks.memberFindMany.mockResolvedValueOnce([]);
    const z = await grantEngagementDriver(['a'], NOW);
    expect(z.value).toBe(0);
  });
});
