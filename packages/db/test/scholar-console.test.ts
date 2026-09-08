import { describe, expect, it, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// The two read-only decisions the admin Scholar console rests on, and the two
// ways each of them can be wrong WITHOUT failing to compile:
//
//   1. `countPapersBySource` splits a person's publications between the
//      Scholar writer and the library index by comparing `source` to a string.
//      A hardcoded copy of that string compiles, reports zero Scholar papers
//      for everybody, and silently hands the whole count to the library index
//      — on the page whose job is deciding whether to spend more credits.
//
//   2. `planScholarBulkTargets` decides who a bulk run will actually charge
//      for. It has to apply the SAME gates as `runScholarFetch`, IN THE SAME
//      ORDER — resolution, then quota, then binding — because quota is checked
//      before binding and a bound-but-recently-fetched person therefore costs
//      nothing. Pricing them anyway over-quotes by 15 credits apiece.
//
// Mocks prisma via '../src/index', the pattern scholar-fetch.test.ts uses.
// ────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  facultyMemberFindMany: vi.fn(),
  runFindMany: vi.fn(),
  researchOutputGroupBy: vi.fn(),
}));

vi.mock('../src/index', () => ({
  prisma: {
    user: { findMany: mocks.userFindMany },
    facultyMember: { findMany: mocks.facultyMemberFindMany },
    scholarFetchRun: { findMany: mocks.runFindMany },
    researchOutput: { groupBy: mocks.researchOutputGroupBy },
  },
}));

import { SCHOLAR_RESEARCH_OUTPUT_SOURCE } from '../src/scholar-fetch';
import { countPapersBySource, planScholarBulkTargets } from '../src/scholar-console';

const NOW = new Date('2026-09-08T10:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.userFindMany.mockResolvedValue([]);
  mocks.facultyMemberFindMany.mockResolvedValue([]);
  mocks.runFindMany.mockResolvedValue([]);
  mocks.researchOutputGroupBy.mockResolvedValue([]);
});

// ── 1. Source attribution ───────────────────────────────────────────────────

describe('countPapersBySource', () => {
  it('attributes rows by the runner’s OWN source constant, not a copy of it', async () => {
    mocks.researchOutputGroupBy.mockResolvedValue([
      { facultyMemberId: 'fm-1', source: SCHOLAR_RESEARCH_OUTPUT_SOURCE, _count: { _all: 7 } },
      { facultyMemberId: 'fm-1', source: 'kku-publications:scopus', _count: { _all: 40 } },
    ]);
    const counts = await countPapersBySource(['fm-1']);
    expect(counts.get('fm-1')).toEqual({ scholar: 7, library: 40 });
  });

  it('would break if the source value were renamed on only one side', async () => {
    // The failure this guards is invisible at the type level: comparing to a
    // stale literal compiles and yields `scholar: 0` for everyone. Feeding a
    // DIFFERENT value proves the comparison is a real comparison rather than
    // something that happens to match today's constant.
    mocks.researchOutputGroupBy.mockResolvedValue([
      { facultyMemberId: 'fm-1', source: `${SCHOLAR_RESEARCH_OUTPUT_SOURCE}-renamed`, _count: { _all: 7 } },
    ]);
    const counts = await countPapersBySource(['fm-1']);
    expect(counts.get('fm-1')).toEqual({ scholar: 0, library: 7 });
  });

  it('counts a NULL source as library, not as Scholar', async () => {
    // Rows predating provenance tracking. The runner always stamps its own
    // source, so an unstamped row cannot have come from it.
    mocks.researchOutputGroupBy.mockResolvedValue([
      { facultyMemberId: 'fm-1', source: null, _count: { _all: 3 } },
    ]);
    expect(countsFor(await countPapersBySource(['fm-1']))).toEqual({ scholar: 0, library: 3 });
  });

  it('does not query at all for an empty set of staff records', async () => {
    expect((await countPapersBySource([])).size).toBe(0);
    expect(mocks.researchOutputGroupBy).not.toHaveBeenCalled();
  });
});

function countsFor(map: Map<string, { scholar: number; library: number }>) {
  return map.get('fm-1');
}

// ── 2. Bulk pre-flight ──────────────────────────────────────────────────────

function account(id: string) {
  return { id, name: `Person ${id}`, employeeId: `HR-${id}` };
}

function member(id: string, opts: { bound?: boolean } = {}) {
  return {
    id: `fm-${id}`,
    nameEn: `Person ${id}`,
    nameTh: `Person ${id}`,
    employeeId: `HR-${id}`,
    isActive: true,
    scholarProfileId: opts.bound ? `profile-${id}` : null,
  };
}

describe('planScholarBulkTargets — the three gates, in the runner’s order', () => {
  it('charges for a linked target outside its window', async () => {
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([member('a', { bound: true })]);

    const plan = await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(plan.chargeableCount).toBe(1);
    expect(plan.targets[0]).toMatchObject({ profileBound: true, quotaBlocked: false });
  });

  it('charges NOTHING for a linked target already fetched inside the window', async () => {
    // The expensive mistake, and the one the console made before this existed:
    // a faculty of 90 refreshed three weeks ago quotes 1,350 credits against a
    // real floor of 0, because the runner refuses at step 2 and never reaches
    // the profile at step 4.
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([member('a', { bound: true })]);
    mocks.runFindMany.mockResolvedValue([
      { userId: 'a', trigger: 'ADMIN_BULK', status: 'SUCCEEDED', startedAt: daysAgo(21) },
    ]);

    const plan = await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(plan.chargeableCount).toBe(0);
    expect(plan.targets[0]).toMatchObject({ profileBound: true, quotaBlocked: true });
    expect(plan.targets[0]?.quotaRetryAt).toBeInstanceOf(Date);
    // Still enqueued: the REFUSED row is the record of why nothing happened.
    expect(plan.runnable).toHaveLength(1);
  });

  it('does not let a SELF fetch block an administrator, or the reverse', async () => {
    // Two independent counters — an admin refresh must not lock somebody out
    // of refreshing their own record.
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([member('a', { bound: true })]);
    mocks.runFindMany.mockResolvedValue([
      { userId: 'a', trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(2) },
    ]);

    const plan = await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(plan.chargeableCount).toBe(1);
  });

  it('exempts SUPER_ADMIN from the quota, so the plan depends on WHO is asking', async () => {
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([member('a', { bound: true })]);
    mocks.runFindMany.mockResolvedValue([
      { userId: 'a', trigger: 'ADMIN', status: 'SUCCEEDED', startedAt: daysAgo(2) },
    ]);

    const asSystem = await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    const asSuper = await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SUPER_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(asSystem.chargeableCount).toBe(0);
    expect(asSuper.chargeableCount).toBe(1);
  });

  it('reports an unlinked target as bound=false and charges nothing', async () => {
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([member('a')]);

    const plan = await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(plan.chargeableCount).toBe(0);
    expect(plan.targets[0]).toMatchObject({ profileBound: false, quotaBlocked: false });
    // Enqueued: its refusal is where SCHOLAR_NEEDS_BINDING comes from.
    expect(plan.runnable).toHaveLength(1);
  });

  it('reports quota BEFORE binding when a target trips both', async () => {
    // The order is the runner's, and it decides what the console SAYS. Quota
    // is checked at step 2 and binding at step 4, so this person's run stops
    // at the quota gate and the console must not tell them to link a profile
    // as though that were the blocker.
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([member('a')]);
    mocks.runFindMany.mockResolvedValue([
      { userId: 'a', trigger: 'ADMIN', status: 'PARTIAL', startedAt: daysAgo(1) },
    ]);

    const plan = await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(plan.targets[0]).toMatchObject({ quotaBlocked: true, profileBound: false });
  });

  it('does NOT enqueue a target with no staff record, and says why', async () => {
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([]); // nothing to match

    const plan = await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(plan.skipped).toHaveLength(1);
    expect(plan.runnable).toHaveLength(0);
    expect(plan.targets[0]?.resolutionRefusal).toMatch(/HR employee id/);
  });

  it('reports an id with no user behind it rather than dropping it', async () => {
    // The dialog's four counts have to add up to the target count, or an
    // operator cannot tell whether somebody was quietly omitted.
    mocks.userFindMany.mockResolvedValue([]);
    const plan = await planScholarBulkTargets({
      userIds: ['ghost'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.targets[0]?.resolutionRefusal).toMatch(/No user record/);
  });

  it('reads accounts, roster and ledger ONCE for the whole batch', async () => {
    mocks.userFindMany.mockResolvedValue([account('a'), account('b'), account('c')]);
    mocks.facultyMemberFindMany.mockResolvedValue([
      member('a', { bound: true }),
      member('b', { bound: true }),
      member('c'),
    ]);

    await planScholarBulkTargets({
      userIds: ['a', 'b', 'c'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    // Resolving and reading the ledger per target is two round trips apiece —
    // 200 inside one HTTP request at the 100-target cap.
    expect(mocks.userFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.facultyMemberFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.runFindMany).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates before planning', async () => {
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([member('a', { bound: true })]);
    const plan = await planScholarBulkTargets({
      userIds: ['a', 'a', ' a ', ''],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.chargeableCount).toBe(1);
  });

  it('takes the point-query path for a single target, not a full roster read', async () => {
    // A row action asks about one person. Loading and bucketing all 3,852
    // staff records to answer that is the whole cost of the batch path paid
    // for nothing.
    mocks.userFindMany.mockResolvedValue([account('a')]);
    mocks.facultyMemberFindMany.mockResolvedValue([member('a', { bound: true })]);

    await planScholarBulkTargets({
      userIds: ['a'],
      actorRole: 'SYSTEM_ADMIN',
      trigger: 'ADMIN_BULK',
      now: NOW,
    });
    // One call, and it is the indexed lookup on employeeId — not the
    // unfiltered read the many-target path takes.
    expect(mocks.facultyMemberFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.facultyMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: 'HR-a' } }),
    );
  });
});
