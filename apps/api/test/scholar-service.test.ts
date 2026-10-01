import { describe, expect, it, vi, beforeEach } from 'vitest';
import 'reflect-metadata';

// ────────────────────────────────────────────────────────────────────────────
// Google Scholar API layer — the four things that are load-bearing and would
// otherwise be decoration:
//
//   1. The bulk cap is enforced on the SERVER, and it counts distinct people
//      rather than the length of the id array.
//   2. `scholar:admin` actually gates the admin routes — the guard refuses a
//      non-admin role rather than the permission merely existing.
//   3. A refusal from the runner surfaces as a distinguishable outcome, not a
//      silent success — both at the queue handler and on the status endpoint.
//   4. The credit estimate prices bound and unbound targets differently.
//
// Tests 1 and 2 are written to fail under mutation: flipping `>` to `>=`,
// removing the cap, counting raw ids instead of distinct ones, or dropping
// the @Authorized decorator each break at least one assertion here.
// ────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  resolveScholarFacultyMember: vi.fn(),
  bindScholarProfile: vi.fn(),
  loadScholarRoster: vi.fn(),
  planScholarBulkTargets: vi.fn(),
  userFindUnique: vi.fn(),
  facultyMemberFindUnique: vi.fn(),
  scholarFetchRunFindMany: vi.fn(),
  bindAttemptFindMany: vi.fn(),
  bindAttemptCreate: vi.fn(),
  fetchScrapingBeePage: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  SCHOLAR_NEEDS_BINDING: 'needs-binding',
  resolveScholarFacultyMember: mocks.resolveScholarFacultyMember,
  bindScholarProfile: mocks.bindScholarProfile,
  loadScholarRoster: mocks.loadScholarRoster,
  planScholarBulkTargets: mocks.planScholarBulkTargets,
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    facultyMember: { findUnique: mocks.facultyMemberFindUnique },
    scholarFetchRun: { findMany: mocks.scholarFetchRunFindMany },
    scholarBindAttempt: {
      findMany: mocks.bindAttemptFindMany,
      create: mocks.bindAttemptCreate,
    },
  },
}));

// The transport lives on its own subpath, NOT the barrel — mocking
// '@kku/shared' alone leaves the real HTTP client in place, which then makes a
// live ScrapingBee call (it 401s on the test key, but with a valid key it would
// spend real credits). See packages/shared/test/scholar-barrel-graph.test.ts.
vi.mock('@kku/shared/src/scholar/scrapingbee', async () => {
  // Only the network call is stubbed. `configFromEnv` stays REAL because
  // several tests exercise the misconfiguration path and rely on it throwing
  // ScrapingBeeConfigError when the key is absent.
  const actual = await vi.importActual<typeof import('@kku/shared/src/scholar/scrapingbee')>('@kku/shared/src/scholar/scrapingbee');
  return { ...actual, fetchScrapingBeePage: mocks.fetchScrapingBeePage };
});

vi.mock('@kku/shared', async () => {
  const actual = await vi.importActual<typeof import('@kku/shared')>('@kku/shared');
  return { ...actual, fetchScrapingBeePage: mocks.fetchScrapingBeePage };
});

import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import {
  GOOGLE_PAGE_CREDIT_COST,
  GOOGLE_SEARCH_CREDIT_COST,
  ROLE_PERMISSIONS,
  can,
} from '@kku/shared';
import type { Role, SessionUser } from '@kku/shared';
import { AccessControlGuard } from '../src/common/access.guard';
import { ScholarController } from '../src/scholar/scholar.controller';
import { ScholarService, estimateScholarBulkCredits } from '../src/scholar/scholar.service';
import { buildJobOptions } from '../src/ai-jobs/ai-jobs-queue.service';

const enqueue = vi.fn();
const countRunning = vi.fn();
const queue = { enqueue, countRunning } as unknown as import('../src/ai-jobs/ai-jobs-queue.service').AiJobsQueueService;

function buildService(opts: { bulkMax?: string | number; bindMax?: string | number } = {}): ScholarService {
  const config = {
    get: (key: string) => {
      if (key === 'SCHOLAR_BULK_MAX_TARGETS') return opts.bulkMax;
      if (key === 'SCHOLAR_BIND_MAX_PER_DAY') return opts.bindMax;
      return undefined;
    },
  } as unknown as import('@nestjs/config').ConfigService;
  return new ScholarService(queue, config);
}

const ADMIN = { userId: 'admin-1', role: 'SYSTEM_ADMIN' as Role };

/** What the mocked ScrapingBee client hands back. Reassigned per test so the
 *  billed-credit assertions can vary it. */
let fetchPageResult: { html: string; status: number; creditsUsed: number | null } = {
  html: '<html/>',
  status: 200,
  creditsUsed: 15,
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  enqueue.mockReset();
  countRunning.mockReset();
  enqueue.mockImplementation(async () => 'job-id');
  countRunning.mockResolvedValue(0);
  mocks.loadScholarRoster.mockResolvedValue([]);
  // Default plan: everyone resolves, everyone is linked, nobody is inside
  // their 30-day window — the shape the cap tests care about. The planner
  // itself is exercised in packages/db; this is the seam the service sees.
  mocks.planScholarBulkTargets.mockImplementation(
    async ({ userIds }: { userIds: readonly string[] }) => {
      const targets = [...new Set(userIds)].map((userId) => ({
        userId,
        profileBound: true,
        quotaBlocked: false,
        quotaRetryAt: null,
        quotaReason: null,
        resolutionRefusal: null,
      }));
      return {
        targets,
        runnable: targets,
        skipped: [],
        chargeableCount: targets.length,
      };
    },
  );
  mocks.bindAttemptFindMany.mockResolvedValue([]);
  mocks.bindAttemptCreate.mockResolvedValue({ id: 'bind-1' });
  mocks.scholarFetchRunFindMany.mockResolvedValue([]);
  fetchPageResult = { html: '<html/>', status: 200, creditsUsed: 15 };
  mocks.fetchScrapingBeePage.mockImplementation(async () => fetchPageResult);
  // configFromEnv() runs on the bind path; without a key it throws before the
  // behaviour under test is reached.
  process.env.SCRAPINGBEE_API_KEY = 'test-key-not-a-real-secret';
  // Default: everyone resolves to a staff record with a bound profile.
  mocks.resolveScholarFacultyMember.mockImplementation(async (userId: string) => ({
    user: { id: userId, name: 'Somchai Example' },
    member: {
      id: `fm-${userId}`,
      nameEn: 'Somchai Example',
      nameTh: 'สมชาย ตัวอย่าง',
      employeeId: null,
      isActive: true,
      scholarProfileId: `profile-${userId}`,
    },
    refusal: null,
  }));
});

/** A `ScholarBulkPlan` from a short description of its targets. */
function planOf(
  targets: Array<{
    userId: string;
    profileBound?: boolean;
    quotaBlocked?: boolean;
    resolutionRefusal?: string | null;
  }>,
) {
  const full = targets.map((t) => ({
    userId: t.userId,
    profileBound: t.profileBound ?? false,
    quotaBlocked: t.quotaBlocked ?? false,
    quotaRetryAt: null,
    quotaReason: null,
    resolutionRefusal: t.resolutionRefusal ?? null,
  }));
  const runnable = full.filter((t) => t.resolutionRefusal === null);
  return {
    targets: full,
    runnable,
    skipped: full.filter((t) => t.resolutionRefusal !== null),
    chargeableCount: runnable.filter((t) => t.profileBound && !t.quotaBlocked).length,
  };
}

// ── 1. Bulk cap ────────────────────────────────────────────────────────────

describe('ScholarService.enqueueBulk — the server enforces the cap', () => {
  const ids = (n: number, prefix = 'u') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it('accepts a request of exactly the cap', async () => {
    const svc = buildService({ bulkMax: 100 });
    const result = await svc.enqueueBulk(ids(100), ADMIN);
    expect(result.targetCount).toBe(100);
    expect(result.enqueued).toHaveLength(100);
    expect(enqueue).toHaveBeenCalledTimes(100);
  });

  it('rejects one over the cap, and enqueues NOTHING', async () => {
    const svc = buildService({ bulkMax: 100 });
    await expect(svc.enqueueBulk(ids(101), ADMIN)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { max: 100, requested: 101 },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('honours a lowered SCHOLAR_BULK_MAX_TARGETS from the environment', async () => {
    const svc = buildService({ bulkMax: 3 });
    await expect(svc.enqueueBulk(ids(4), ADMIN)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { max: 3, requested: 4 },
    });
    await expect(svc.enqueueBulk(ids(3), ADMIN)).resolves.toMatchObject({ targetCount: 3 });
  });

  it('falls back to 100 when the env var is absent or nonsense', async () => {
    expect(buildService().bulkMaxTargets()).toBe(100);
    expect(buildService({ bulkMax: 'not-a-number' }).bulkMaxTargets()).toBe(100);
    expect(buildService({ bulkMax: 0 }).bulkMaxTargets()).toBe(100);
  });

  it('de-duplicates BEFORE counting: 150 ids naming 40 people is a 40-person run', async () => {
    const distinct = ids(40);
    const withDupes = [...distinct, ...distinct, ...distinct.slice(0, 30)]; // 110
    const padded = [...withDupes, ...distinct.slice(0, 40)]; // 150 entries, 40 distinct
    expect(padded).toHaveLength(150);

    const svc = buildService({ bulkMax: 100 });
    const result = await svc.enqueueBulk(padded, ADMIN);

    expect(result.targetCount).toBe(40);
    expect(result.duplicatesDropped).toBe(110);
    expect(result.enqueued).toHaveLength(40);
    expect(enqueue).toHaveBeenCalledTimes(40);
  });

  it('refuses a request with no usable ids', async () => {
    const svc = buildService({ bulkMax: 100 });
    await expect(svc.enqueueBulk(['  ', ''], ADMIN)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues ADMIN_BULK with the actor role, never the job trigger', async () => {
    const svc = buildService({ bulkMax: 100 });
    await svc.enqueueBulk(['u1'], ADMIN);
    expect(enqueue).toHaveBeenCalledWith({
      kind: 'SCHOLAR_FETCH',
      entityId: 'u1',
      triggeredByUserId: 'admin-1',
      trigger: 'MANUAL',
      scholarTrigger: 'ADMIN_BULK',
      scholarActorRole: 'SYSTEM_ADMIN',
    });
  });
});

// ── 2. Authorization ───────────────────────────────────────────────────────

describe('scholar:admin — the permission and the guard that uses it', () => {
  it('is granted to SUPER_ADMIN and SYSTEM_ADMIN, and to nobody else', () => {
    // The grant is implicit (a spread and a filter in permissions.ts), so it
    // is asserted rather than assumed.
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.has('scholar:admin')).toBe(true);
    expect(ROLE_PERMISSIONS.SYSTEM_ADMIN.has('scholar:admin')).toBe(true);
    expect(ROLE_PERMISSIONS.UNIVERSITY_USER.has('scholar:admin')).toBe(false);
    expect(ROLE_PERMISSIONS.FACULTY_USER.has('scholar:admin')).toBe(false);
    expect(ROLE_PERMISSIONS.PROGRAM_USER.has('scholar:admin')).toBe(false);
  });

  it('can() agrees, with no scope context needed', () => {
    const user = (role: Role): SessionUser =>
      ({ userId: 'u', role, email: 'e@kku.ac.th' }) as unknown as SessionUser;
    expect(can(user('SYSTEM_ADMIN'), 'scholar:admin')).toBe(true);
    expect(can(user('UNIVERSITY_USER'), 'scholar:admin')).toBe(false);
  });

  const guard = new AccessControlGuard(new Reflector());

  function ctxFor(handler: (...args: never[]) => unknown, role: Role): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => ScholarController,
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u1', role }, query: {} }) }),
    } as unknown as ExecutionContext;
  }

  const adminRoutes: Array<[string, (...args: never[]) => unknown]> = [
    ['fetchForUser', ScholarController.prototype.fetchForUser],
    ['fetchBulk', ScholarController.prototype.fetchBulk],
    ['runs', ScholarController.prototype.runs],
  ];

  for (const [name, handler] of adminRoutes) {
    it(`${name} refuses UNIVERSITY_USER, FACULTY_USER and PROGRAM_USER`, () => {
      for (const role of ['UNIVERSITY_USER', 'FACULTY_USER', 'PROGRAM_USER'] as Role[]) {
        expect(() => guard.canActivate(ctxFor(handler, role))).toThrow(/scholar:admin/);
      }
    });

    it(`${name} admits SYSTEM_ADMIN and SUPER_ADMIN`, () => {
      expect(guard.canActivate(ctxFor(handler, 'SYSTEM_ADMIN'))).toBe(true);
      expect(guard.canActivate(ctxFor(handler, 'SUPER_ADMIN'))).toBe(true);
    });
  }

  it('leaves the self routes open to every role — they only touch the caller', () => {
    const selfRoutes = [
      ScholarController.prototype.fetchMe,
      ScholarController.prototype.bindMe,
      ScholarController.prototype.statusMe,
    ];
    for (const handler of selfRoutes) {
      expect(guard.canActivate(ctxFor(handler as never, 'PROGRAM_USER'))).toBe(true);
    }
  });
});

// ── 3. Refusals must not read as success ───────────────────────────────────

describe('ScholarService.selfStatus — a refusal is visible and explains itself', () => {
  const NOW_RUN = {
    id: 'run-1',
    status: 'REFUSED' as const,
    trigger: 'SELF' as const,
    startedAt: new Date('2026-09-01T00:00:00Z'),
    finishedAt: new Date('2026-09-01T00:00:01Z'),
    papersFound: 0,
    papersInserted: 0,
    citationsUpdated: 0,
    creditsUsed: 0,
    errorText: 'needs-binding: No Google Scholar profile is linked to this staff record yet.',
  };

  it('surfaces the needs-binding refusal as a branchable flag, not prose to parse', async () => {
    mocks.resolveScholarFacultyMember.mockResolvedValue({
      user: { id: 'u1', name: 'Somchai Example' },
      member: {
        id: 'fm-1',
        nameEn: 'Somchai Example',
        nameTh: 'สมชาย',
        employeeId: null,
        isActive: true,
        scholarProfileId: null,
      },
      refusal: null,
    });
    mocks.scholarFetchRunFindMany.mockResolvedValue([NOW_RUN]);

    const status = await buildService().selfStatus('u1', 'FACULTY_USER');

    expect(status.profile).toEqual({ bound: false });
    expect(status.needsBinding).toBe(true);
    expect(status.lastRun?.needsBinding).toBe(true);
    expect(status.lastRun?.status).toBe('REFUSED');
    // A REFUSED run does not consume the allowance, so a fetch is still
    // possible right now — the blocker is the binding, not the quota.
    expect(status.nextEligibleAt).toBeNull();
  });

  it('reports no staff record as an explained refusal rather than an empty panel', async () => {
    mocks.resolveScholarFacultyMember.mockResolvedValue({
      user: { id: 'u1', name: null },
      member: null,
      refusal: 'No staff record matches the name "Somchai Example".',
    });
    mocks.scholarFetchRunFindMany.mockResolvedValue([]);

    const status = await buildService().selfStatus('u1', 'FACULTY_USER');

    expect(status.staffRecord).toEqual({
      linked: false,
      reason: 'No staff record matches the name "Somchai Example".',
    });
    // Nothing to bind and nothing to fetch — the fix is an HR/name problem,
    // so the UI must not be told to prompt for a profile URL.
    expect(status.needsBinding).toBe(false);
    expect(status.lastRun).toBeNull();
  });

  it('takes nextEligibleAt from the quota unit rather than recomputing the window', async () => {
    // selfStatus reads the real clock; pin it inside the 30-day window so the
    // assertion does not start failing on the day the window closes.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T00:00:00Z'));
    try {
      const startedAt = new Date('2026-09-01T00:00:00Z');
      mocks.facultyMemberFindUnique.mockResolvedValue({
        scholarProfileId: 'abc',
        scholarProfileUrl: 'https://scholar.google.com/citations?user=abc',
        scholarBoundAt: startedAt,
      });
      mocks.scholarFetchRunFindMany.mockResolvedValue([
        { ...NOW_RUN, status: 'SUCCEEDED' as const, errorText: null, papersFound: 12, startedAt },
      ]);

      const status = await buildService().selfStatus('u1', 'FACULTY_USER');

      expect(status.profile).toMatchObject({ bound: true, scholarProfileId: 'abc' });
      expect(status.needsBinding).toBe(false);
      // 30 days on from the successful run — decideScholarQuota's own retryAt.
      expect(status.nextEligibleAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(status.quotaReason).toMatch(/One fetch per 30 days/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exempts SUPER_ADMIN, matching the quota unit', async () => {
    mocks.facultyMemberFindUnique.mockResolvedValue({
      scholarProfileId: 'abc',
      scholarProfileUrl: null,
      scholarBoundAt: null,
    });
    mocks.scholarFetchRunFindMany.mockResolvedValue([
      { ...NOW_RUN, status: 'SUCCEEDED' as const, errorText: null, startedAt: new Date() },
    ]);
    const status = await buildService().selfStatus('u1', 'SUPER_ADMIN');
    expect(status.nextEligibleAt).toBeNull();
  });
});

describe('ScholarService.bindOwnProfile — a refused bind is a 400, not a 500', () => {
  it('maps the runner refusal message through, unaltered', async () => {
    mocks.bindScholarProfile.mockRejectedValue(
      new Error('That Scholar profile does not appear to belong to this person.'),
    );
    await expect(buildService().bindOwnProfile('u1', 'https://scholar.google.com/citations?user=x', 'FACULTY_USER'))
      .rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'That Scholar profile does not appear to belong to this person.',
      });
  });

  it('refuses before fetching when the account has no staff record', async () => {
    mocks.resolveScholarFacultyMember.mockResolvedValue({
      user: null,
      member: null,
      refusal: 'No user record for this account.',
    });
    await expect(buildService().bindOwnProfile('u1', 'https://scholar.google.com/citations?user=x', 'FACULTY_USER'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.bindScholarProfile).not.toHaveBeenCalled();
  });
});

// ── 4. Bulk pricing ────────────────────────────────────────────────────────

describe('estimateScholarBulkCredits', () => {
  it('charges an unbound target the SEARCH plus a page — it is no longer free', () => {
    const targets = [
      { profileBound: true },
      { profileBound: true },
      { profileBound: true },
      { profileBound: false },
      { profileBound: false },
    ];
    // REVERSED ON 2026-09-09, and this test asserted the opposite until then.
    // `runScholarFetch` used to check scholarProfileId at step 4 and refuse
    // before `fetchAllPages`, so an unbound target really did spend nothing.
    // It no longer refuses: it searches Google Scholar for the person's
    // English full name at 75 credits, then walks whatever profile that
    // resolves at 15 a page. Quoting these at zero would tell an operator a
    // 100-person unlinked batch is free and then bill ~9,000 credits.
    expect(estimateScholarBulkCredits(targets)).toBe(
      3 * GOOGLE_PAGE_CREDIT_COST + 2 * (GOOGLE_SEARCH_CREDIT_COST + GOOGLE_PAGE_CREDIT_COST),
    );
  });

  it('is zero for an empty run, and NOT for an all-unbound one', () => {
    expect(estimateScholarBulkCredits([])).toBe(0);
    // The all-unbound run was the zero case under the old binding gate. It is
    // now the dearest shape a run can have, and the commonest one at rollout.
    expect(estimateScholarBulkCredits([{ profileBound: false }, { profileBound: false }])).toBe(
      2 * (GOOGLE_SEARCH_CREDIT_COST + GOOGLE_PAGE_CREDIT_COST),
    );
    expect(estimateScholarBulkCredits([{ profileBound: true }])).toBe(GOOGLE_PAGE_CREDIT_COST);
  });

  it('charges nothing for a target inside its 30-day window, linked or not', () => {
    // The quota is step 2 and binding is step 4, so a recently-fetched person
    // refuses BEFORE either the name search or the profile walk. This is the
    // one gate left that still costs nothing. Omitting it over-quotes in the
    // expensive direction: a faculty of 90 refreshed three weeks ago prices at
    // 1,350 credits against a floor of 0.
    expect(
      estimateScholarBulkCredits([
        { profileBound: true, quotaBlocked: true },
        { profileBound: false, quotaBlocked: true },
      ]),
    ).toBe(0);
    expect(
      estimateScholarBulkCredits([
        { profileBound: true, quotaBlocked: true },
        { profileBound: true, quotaBlocked: false },
      ]),
    ).toBe(GOOGLE_PAGE_CREDIT_COST);
  });

  it('the bulk enqueue quotes the plan it was given, and enqueues every runnable target', async () => {
    // u0, u1 linked and clear; u2 unlinked; u3 linked but inside its window.
    // Three of the four reach Google — u2 by searching for its name first.
    mocks.planScholarBulkTargets.mockResolvedValue(
      planOf([
        { userId: 'u0', profileBound: true },
        { userId: 'u1', profileBound: true },
        { userId: 'u2', profileBound: false },
        { userId: 'u3', profileBound: true, quotaBlocked: true },
      ]),
    );

    const result = await buildService({ bulkMax: 100 }).enqueueBulk(['u0', 'u1', 'u2', 'u3'], ADMIN);

    expect(result.estimatedCredits).toBe(
      2 * GOOGLE_PAGE_CREDIT_COST + (GOOGLE_SEARCH_CREDIT_COST + GOOGLE_PAGE_CREDIT_COST),
    );
    // `chargeableCount` counts PROFILE WALKS — targets that already know their
    // id — because that is what the stale-quote token is about: somebody
    // linking or unlinking between the quote and the send. It is deliberately
    // NOT "everything that costs something" any more; u2 costs the most of the
    // four and is not in it.
    expect(result.chargeableCount).toBe(2);
    // All four are still enqueued. Only u3's refusal is free now — u2's run
    // spends a 75-credit search before it can refuse.
    expect(result.enqueued).toHaveLength(4);
  });

  it('flags targets with no staff record — and does NOT enqueue them', async () => {
    mocks.planScholarBulkTargets.mockResolvedValue(
      planOf([{ userId: 'u0', resolutionRefusal: 'No staff record matches.' }]),
    );
    const result = await buildService({ bulkMax: 100 }).enqueueBulk(['u0'], ADMIN);

    expect(result.targets[0]).toMatchObject({
      userId: 'u0',
      profileBound: false,
      resolutionRefusal: 'No staff record matches.',
    });
    // Their job would reach refusedWithoutRun, which writes no ledger row —
    // a worker slot spent and no trace of it.
    expect(result.skipped).toHaveLength(1);
    expect(result.enqueued).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('prices the whole batch in ONE pre-flight, not one per target', async () => {
    await buildService({ bulkMax: 100 }).enqueueBulk(['u0', 'u1', 'u2'], ADMIN);
    // The planner reads accounts, roster and ledger once each for the batch.
    // Resolving per target meant 100 unfiltered scans of ~3,800 staff rows,
    // plus a ledger read apiece, inside a single HTTP request.
    expect(mocks.planScholarBulkTargets).toHaveBeenCalledTimes(1);
    expect(mocks.planScholarBulkTargets).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['u0', 'u1', 'u2'], trigger: 'ADMIN_BULK' }),
    );
  });

  it('prices the quota against the ADMIN who asked, not the target', async () => {
    // SUPER_ADMIN is exempt from the fetch quota, so the same roster is
    // blocked for one administrator and clear for another. Passing the wrong
    // role here would quote somebody else's allowance.
    await buildService({ bulkMax: 100 }).enqueueBulk(['u0'], { userId: 'admin-1', role: 'SUPER_ADMIN' });
    expect(mocks.planScholarBulkTargets).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'SUPER_ADMIN' }),
    );
  });
});

// ── 4b. The quote is a token, not an advisory ──────────────────────────────
//
// Between the console quoting a run and the operator confirming it, targets
// can BIND their own profiles from /profile — self-service, no administrator
// involved — and every one that does turns a free refusal into a paid profile
// walk. Ten selected with two linked quotes 30 credits; if eight link in the
// meantime, confirming would spend at least 150 against 30 shown.

describe('ScholarService.enqueueBulk — a stale quote is refused, not honoured', () => {
  it('refuses when more people would now be fetched than the quote covered', async () => {
    mocks.planScholarBulkTargets.mockResolvedValue(
      planOf([
        { userId: 'u0', profileBound: true },
        { userId: 'u1', profileBound: true },
        { userId: 'u2', profileBound: true },
      ]),
    );
    await expect(
      buildService({ bulkMax: 100 }).enqueueBulk(['u0', 'u1', 'u2'], ADMIN, 1),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { quoted: 1, actual: 3 },
    });
    // Nothing queued: the refusal has to come BEFORE the spend, or it is not a
    // guard at all.
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('refuses in the cheap direction too — a quote must describe the run either way', async () => {
    mocks.planScholarBulkTargets.mockResolvedValue(
      planOf([{ userId: 'u0', profileBound: false }]),
    );
    await expect(
      buildService({ bulkMax: 100 }).enqueueBulk(['u0'], ADMIN, 1),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('proceeds when the quote still describes the run', async () => {
    mocks.planScholarBulkTargets.mockResolvedValue(
      planOf([
        { userId: 'u0', profileBound: true },
        { userId: 'u1', profileBound: false },
      ]),
    );
    const result = await buildService({ bulkMax: 100 }).enqueueBulk(['u0', 'u1'], ADMIN, 1);
    expect(result.enqueued).toHaveLength(2);
    expect(result.chargeableCount).toBe(1);
  });

  it('still enqueues when no quote was sent — the endpoint stays callable by hand', async () => {
    mocks.planScholarBulkTargets.mockResolvedValue(
      planOf([{ userId: 'u0', profileBound: true }]),
    );
    const result = await buildService({ bulkMax: 100 }).enqueueBulk(['u0'], ADMIN);
    expect(result.enqueued).toHaveLength(1);
  });

  it('accepts a quote of ZERO rather than treating it as "no quote sent"', async () => {
    // `if (expectedChargeableCount)` instead of a typeof check would skip the
    // comparison for the commonest shape of a run at rollout — everyone
    // unlinked, nothing chargeable — which is precisely when an unnoticed
    // bind flips the bill from nothing to something.
    mocks.planScholarBulkTargets.mockResolvedValue(
      planOf([{ userId: 'u0', profileBound: true }]),
    );
    await expect(
      buildService({ bulkMax: 100 }).enqueueBulk(['u0'], ADMIN, 0),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { quoted: 0, actual: 1 } });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

// ── 5. Binding is metered ──────────────────────────────────────────────────

describe('ScholarService.bindOwnProfile — every attempt is capped and recorded', () => {
  const URL = 'https://scholar.google.com/citations?user=abc123XYZ';

  function attemptsAgo(...minutes: number[]) {
    const now = Date.now();
    return minutes.map((m) => ({ createdAt: new Date(now - m * 60_000) }));
  }

  it('records a REFUSED bind WITH the credits it already spent', async () => {
    // The page is fetched to read the name off it, so a mismatch has already
    // been billed. This is the whole reason the table exists.
    mocks.bindScholarProfile.mockImplementation(async (input: { fetchPage: (u: string) => Promise<unknown> }) => {
      await input.fetchPage(URL);
      throw new Error('That Scholar profile does not appear to belong to this person.');
    });
    fetchPageResult = { html: '<html/>', status: 200, creditsUsed: 15 };

    await expect(buildService().bindOwnProfile('u1', URL, 'FACULTY_USER')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    expect(mocks.bindAttemptCreate).toHaveBeenCalledTimes(1);
    expect(mocks.bindAttemptCreate.mock.calls[0][0].data).toMatchObject({
      userId: 'u1',
      outcome: 'REFUSED',
      creditsUsed: 15,
      scholarProfileId: 'abc123XYZ',
    });
  });

  it('records a successful bind with its credits too', async () => {
    mocks.bindScholarProfile.mockImplementation(async (input: { fetchPage: (u: string) => Promise<unknown> }) => {
      await input.fetchPage(URL);
      return { scholarProfileId: 'abc123XYZ', profileName: 'Somchai Example', creditsUsed: 15 };
    });
    fetchPageResult = { html: '<html/>', status: 200, creditsUsed: 15 };

    await buildService().bindOwnProfile('u1', URL, 'FACULTY_USER');

    expect(mocks.bindAttemptCreate.mock.calls[0][0].data).toMatchObject({
      outcome: 'BOUND',
      creditsUsed: 15,
      profileName: 'Somchai Example',
    });
  });

  it('refuses over the daily cap BEFORE spending a credit', async () => {
    mocks.bindAttemptFindMany.mockResolvedValue(attemptsAgo(10, 20, 30, 40, 50)); // 5, the default

    await expect(buildService().bindOwnProfile('u1', URL, 'FACULTY_USER')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });

    expect(mocks.bindScholarProfile).not.toHaveBeenCalled();
    // No row: this attempt cost nothing, and recording it would make
    // tomorrow's allowance smaller than the cap says it is.
    expect(mocks.bindAttemptCreate).not.toHaveBeenCalled();
  });

  it('admits the attempt that lands exactly ON the cap boundary', async () => {
    // Four prior attempts against a cap of five — the fifth must go through,
    // or the cap is really four.
    mocks.bindAttemptFindMany.mockResolvedValue(attemptsAgo(10, 20, 30, 40));
    mocks.bindScholarProfile.mockResolvedValue({
      scholarProfileId: 'abc123XYZ',
      profileName: 'Somchai Example',
      creditsUsed: 15,
    });
    await expect(buildService().bindOwnProfile('u1', URL, 'FACULTY_USER')).resolves.toBeDefined();
    expect(mocks.bindScholarProfile).toHaveBeenCalled();
  });

  it('ignores attempts that have aged out of the rolling 24 hours', async () => {
    mocks.bindAttemptFindMany.mockResolvedValue([
      ...attemptsAgo(10, 20, 30, 40),
      { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    ]);
    mocks.bindScholarProfile.mockResolvedValue({
      scholarProfileId: 'abc123XYZ',
      profileName: 'Somchai Example',
      creditsUsed: 15,
    });
    await expect(buildService().bindOwnProfile('u1', URL, 'FACULTY_USER')).resolves.toBeDefined();
  });

  it('honours a lowered SCHOLAR_BIND_MAX_PER_DAY', async () => {
    mocks.bindAttemptFindMany.mockResolvedValue(attemptsAgo(10));
    await expect(
      buildService({ bindMax: 1 }).bindOwnProfile('u1', URL, 'FACULTY_USER'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('exempts SUPER_ADMIN, matching the fetch quota posture', async () => {
    mocks.bindAttemptFindMany.mockResolvedValue(attemptsAgo(1, 2, 3, 4, 5, 6, 7, 8));
    mocks.bindScholarProfile.mockResolvedValue({
      scholarProfileId: 'abc123XYZ',
      profileName: 'Somchai Example',
      creditsUsed: 15,
    });
    await expect(buildService().bindOwnProfile('u1', URL, 'SUPER_ADMIN')).resolves.toBeDefined();
  });

  it('records the no-staff-record refusal too, so the loop is visible', async () => {
    mocks.resolveScholarFacultyMember.mockResolvedValue({
      user: null,
      member: null,
      refusal: 'No user record for this account.',
    });
    await expect(buildService().bindOwnProfile('u1', URL, 'FACULTY_USER')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.bindAttemptCreate.mock.calls[0][0].data).toMatchObject({
      outcome: 'REFUSED',
      creditsUsed: 0,
    });
  });

  it('does not charge the user for OUR misconfiguration, but still records it', async () => {
    delete process.env.SCRAPINGBEE_API_KEY;

    await expect(buildService().bindOwnProfile('u1', URL, 'FACULTY_USER')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });

    // Recorded, so a fresh deploy with no key is not a silently inert button.
    expect(mocks.bindAttemptCreate.mock.calls[0][0].data).toMatchObject({
      outcome: 'FAILED',
      creditsUsed: 0,
    });
    // But excluded from the allowance: five clicks against a broken deploy
    // must not lock someone out of binding for a day after it is fixed.
    const where = mocks.bindAttemptFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ creditsUsed: { gt: 0 } }, { outcome: 'REFUSED' }]);
  });

  it('does not let a failed ledger write replace the real error', async () => {
    mocks.bindAttemptCreate.mockRejectedValue(new Error('database is down'));
    mocks.bindScholarProfile.mockRejectedValue(new Error('That profile is already linked elsewhere.'));

    await expect(buildService().bindOwnProfile('u1', URL, 'FACULTY_USER')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'That profile is already linked elsewhere.',
    });
  });
});

// ── 6. A click must be visible while it waits ──────────────────────────────

describe('ScholarService.selfStatus — fetchQueued', () => {
  it('reports a queued job for THIS person, so the panel is not silent', async () => {
    countRunning.mockResolvedValue(1);
    const status = await buildService().selfStatus('u1', 'FACULTY_USER');
    expect(status.fetchQueued).toBe(true);
    expect(countRunning).toHaveBeenCalledWith('SCHOLAR_FETCH', 'u1');
  });

  it('is false when the queue holds nothing for them', async () => {
    countRunning.mockResolvedValue(0);
    const status = await buildService().selfStatus('u1', 'FACULTY_USER');
    expect(status.fetchQueued).toBe(false);
  });

  it('reports the bind allowance alongside it', async () => {
    mocks.bindAttemptFindMany.mockResolvedValue([{ createdAt: new Date() }, { createdAt: new Date() }]);
    const status = await buildService({ bindMax: 5 }).selfStatus('u1', 'FACULTY_USER');
    expect(status.bind).toMatchObject({ attemptsToday: 2, maxPerDay: 5, retryAt: null });
  });
});

// ── 7. Route declaration order is load-bearing ─────────────────────────────

describe('ScholarController — route order', () => {
  it('declares fetch/bulk before fetch/:userId', () => {
    // Nest's MetadataScanner enumerates handlers with getOwnPropertyNames on
    // the prototype and registers them in that order, so a POST to
    // /scholar/fetch/bulk would otherwise match the parameterised route and
    // be read as a fetch for a user whose id is the string "bulk". Reversing
    // the two methods breaks nothing else in this file.
    const order = Object.getOwnPropertyNames(ScholarController.prototype);
    expect(order.indexOf('fetchBulk')).toBeGreaterThan(-1);
    expect(order.indexOf('fetchBulk')).toBeLessThan(order.indexOf('fetchForUser'));
  });
});

// ── 8. One profile walk per person ─────────────────────────────────────────

describe('buildJobOptions — SCHOLAR_FETCH must not double-spend', () => {
  const scholarJob = {
    kind: 'SCHOLAR_FETCH',
    entityId: 'user-x',
    triggeredByUserId: 'admin-1',
    trigger: 'MANUAL',
    scholarTrigger: 'ADMIN_BULK',
    scholarActorRole: 'SYSTEM_ADMIN',
  } as const;

  it('gives the job a deterministic id keyed on the TARGET user', () => {
    // BullMQ drops an add() whose id matches a job already waiting or active.
    // Two admins bulk-fetching overlapping cohorts otherwise produce two jobs
    // for one person, both walk the profile, and the second success burns
    // that person's 30-day allowance as well as the credits.
    //
    // The separator is a HYPHEN, not a colon. This assertion previously
    // expected `scholar-fetch:user-x` and passed, while every real enqueue
    // threw HTTP 500: BullMQ refuses a custom id containing ':' (it namespaces
    // its own Redis keys that way). A mocked queue accepts any options object,
    // so the test agreed with the bug instead of catching it. See
    // test/ai-jobs-queue-job-id.test.ts, which asserts the constraint rather
    // than the string.
    expect(buildJobOptions(scholarJob).jobId).toBe('scholar-fetch-user-x');
    expect(buildJobOptions(scholarJob).jobId).not.toContain(':');
    expect(buildJobOptions({ ...scholarJob, entityId: 'user-y' }).jobId).toBe('scholar-fetch-user-y');
  });

  it('does not let a finished job hold the id forever', () => {
    // This producer's Queue sets no defaultJobOptions, so without these a
    // completed job is retained and reserves scholar-fetch-<user> for good —
    // the next fetch a month later would be dropped as a duplicate, silently.
    const opts = buildJobOptions(scholarJob);
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toBe(true);
  });

  it('never retries, whatever the job trigger says', () => {
    // Keyed on kind, not on trigger. A future nightly refresh enqueues
    // SCHEDULED and must still get one attempt — each retry re-walks the
    // profile at ~15 credits a page.
    expect(buildJobOptions(scholarJob).attempts).toBe(1);
    expect(buildJobOptions({ ...scholarJob, trigger: 'SCHEDULED' }).attempts).toBe(1);
    expect(buildJobOptions({ ...scholarJob, trigger: 'CHAINED' }).attempts).toBe(1);
  });

  it('leaves other kinds on the existing trigger-based retry policy', () => {
    const digest = { kind: 'RUN_PROGRAM_DIGEST', entityId: 'p1', trigger: 'MANUAL' } as const;
    expect(buildJobOptions(digest)).toEqual({ attempts: 1 });
    expect(buildJobOptions({ ...digest, trigger: 'SCHEDULED' })).toEqual({ attempts: 2 });
    // and no deterministic id — collapsing two digest runs is not wanted.
    expect(buildJobOptions({ ...digest, trigger: 'SCHEDULED' }).jobId).toBeUndefined();
  });
});
