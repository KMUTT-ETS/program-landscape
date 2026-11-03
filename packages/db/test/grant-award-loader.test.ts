import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCount: vi.fn(),
  projectFindMany: vi.fn(),
}));

vi.mock('../src/index', () => ({
  prisma: {
    ingestionRun: { count: mocks.runCount },
    researchServiceProject: { findMany: mocks.projectFindMany },
  },
}));

import { __resetGrantSourceCache, grantAward, loadGrantSourceSynced } from '../src/grant-award';

const NOW = new Date('2026-10-03T12:00:00+07:00');

beforeEach(() => {
  mocks.runCount.mockReset();
  mocks.projectFindMany.mockReset();
  __resetGrantSourceCache();
});
afterEach(() => vi.useRealTimers());

describe('loadGrantSourceSynced', () => {
  it('is true once the grants source has one successful run', async () => {
    mocks.runCount.mockResolvedValue(1);
    await expect(loadGrantSourceSynced()).resolves.toBe(true);
    const where = mocks.runCount.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ status: 'SUCCEEDED', dataSource: { slug: { in: ['kku-research-services', 'xlsx-external-grants'] } } });
  });

  it('is false with no successful run', async () => {
    mocks.runCount.mockResolvedValue(0);
    await expect(loadGrantSourceSynced()).resolves.toBe(false);
  });

  it('caches for 5 minutes and shares one query between concurrent callers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.runCount.mockResolvedValue(1);
    await Promise.all([loadGrantSourceSynced(), loadGrantSourceSynced()]);
    expect(mocks.runCount).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + 4 * 60_000));
    await loadGrantSourceSynced();
    expect(mocks.runCount).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000));
    await loadGrantSourceSynced();
    expect(mocks.runCount).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    mocks.runCount.mockRejectedValueOnce(new Error('db down'));
    await expect(loadGrantSourceSynced()).rejects.toThrow('db down');
    mocks.runCount.mockResolvedValue(1);
    await expect(loadGrantSourceSynced()).resolves.toBe(true);
  });
});

describe('grantAward', () => {
  it('reports not-synced without querying projects', async () => {
    mocks.runCount.mockResolvedValue(0);
    const a = await grantAward(['s1'], NOW);
    expect(a).toEqual({ label: 'external_grant_award', points: null, raw: { reason: 'source-not-synced' } });
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });

  it('reports no-active-staff for an empty staff list', async () => {
    mocks.runCount.mockResolvedValue(1);
    const a = await grantAward([], NOW);
    expect(a.points).toBeNull();
    expect(a.raw).toEqual({ reason: 'no-active-staff' });
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });

  it('queries in-window projects of those staff and sums each project once', async () => {
    mocks.runCount.mockResolvedValue(1);
    mocks.projectFindMany.mockResolvedValue([
      { id: 'rsp-1', budgetThb: 6_000_000n },
      { id: 'rsp-2', budgetThb: null },
    ]);
    const a = await grantAward(['s1', 's2'], NOW);

    const args = mocks.projectFindMany.mock.calls[0]?.[0];
    expect(args.where.fiscalYearBe).toEqual({ gte: 2567, lte: 2569 });
    expect(args.where.members.some.facultyMemberId).toEqual({ in: ['s1', 's2'] });
    expect(args.where).toMatchObject({ ingestionRun: { dataSource: { mocked: false } } });
    expect(args.where.members.some).toMatchObject({ ingestionRun: { dataSource: { mocked: false } } });

    // ฿6 M over 3 years over 2 staff = ฿1 M per staff per year.
    expect(a.raw).toMatchObject({
      bahtPerYear: 2_000_000,
      bahtPerStaffPerYear: 1_000_000,
      staff: 2,
      projects: 2,
      windowFyBe: [2567, 2569],
      floorThb: 100_000,
      capThb: 3_000_000,
      maxPoints: 10,
    });
    expect(a.points).toBeCloseTo(6.77, 2);
  });

  it('de-duplicates staff ids before querying and counting', async () => {
    mocks.runCount.mockResolvedValue(1);
    mocks.projectFindMany.mockResolvedValue([]);
    const a = await grantAward(['s1', 's1', 's2'], NOW);
    const args = mocks.projectFindMany.mock.calls[0]?.[0];
    expect(args.where.members.some.facultyMemberId).toEqual({ in: ['s1', 's2'] });
    expect(a.raw).toMatchObject({ staff: 2 });
  });

  it('gives +0 when the staff have no project in the window', async () => {
    mocks.runCount.mockResolvedValue(1);
    mocks.projectFindMany.mockResolvedValue([]);
    const a = await grantAward(['s1'], NOW);
    expect(a.points).toBe(0);
    expect(a.raw).toMatchObject({ projects: 0, bahtPerYear: 0 });
  });
});
