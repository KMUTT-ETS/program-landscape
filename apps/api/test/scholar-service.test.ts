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
  userFindUnique: vi.fn(),
  facultyMemberFindUnique: vi.fn(),
  scholarFetchRunFindMany: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  SCHOLAR_NEEDS_BINDING: 'needs-binding',
  resolveScholarFacultyMember: mocks.resolveScholarFacultyMember,
  bindScholarProfile: mocks.bindScholarProfile,
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    facultyMember: { findUnique: mocks.facultyMemberFindUnique },
    scholarFetchRun: { findMany: mocks.scholarFetchRunFindMany },
  },
}));

import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { GOOGLE_PAGE_CREDIT_COST, ROLE_PERMISSIONS, can } from '@kku/shared';
import type { Role, SessionUser } from '@kku/shared';
import { AccessControlGuard } from '../src/common/access.guard';
import { ScholarController } from '../src/scholar/scholar.controller';
import { ScholarService, estimateScholarBulkCredits } from '../src/scholar/scholar.service';

const enqueue = vi.fn();
const queue = { enqueue } as unknown as import('../src/ai-jobs/ai-jobs-queue.service').AiJobsQueueService;

function buildService(bulkMax?: string | number): ScholarService {
  const config = {
    get: (key: string) => (key === 'SCHOLAR_BULK_MAX_TARGETS' ? bulkMax : undefined),
  } as unknown as import('@nestjs/config').ConfigService;
  return new ScholarService(queue, config);
}

const ADMIN = { userId: 'admin-1', role: 'SYSTEM_ADMIN' as Role };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  enqueue.mockReset();
  enqueue.mockImplementation(async () => 'job-id');
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

// ── 1. Bulk cap ────────────────────────────────────────────────────────────

describe('ScholarService.enqueueBulk — the server enforces the cap', () => {
  const ids = (n: number, prefix = 'u') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it('accepts a request of exactly the cap', async () => {
    const svc = buildService(100);
    const result = await svc.enqueueBulk(ids(100), ADMIN);
    expect(result.targetCount).toBe(100);
    expect(result.enqueued).toHaveLength(100);
    expect(enqueue).toHaveBeenCalledTimes(100);
  });

  it('rejects one over the cap, and enqueues NOTHING', async () => {
    const svc = buildService(100);
    await expect(svc.enqueueBulk(ids(101), ADMIN)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { max: 100, requested: 101 },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('honours a lowered SCHOLAR_BULK_MAX_TARGETS from the environment', async () => {
    const svc = buildService(3);
    await expect(svc.enqueueBulk(ids(4), ADMIN)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { max: 3, requested: 4 },
    });
    await expect(svc.enqueueBulk(ids(3), ADMIN)).resolves.toMatchObject({ targetCount: 3 });
  });

  it('falls back to 100 when the env var is absent or nonsense', async () => {
    expect(buildService(undefined).bulkMaxTargets()).toBe(100);
    expect(buildService('not-a-number').bulkMaxTargets()).toBe(100);
    expect(buildService(0).bulkMaxTargets()).toBe(100);
  });

  it('de-duplicates BEFORE counting: 150 ids naming 40 people is a 40-person run', async () => {
    const distinct = ids(40);
    const withDupes = [...distinct, ...distinct, ...distinct.slice(0, 30)]; // 110
    const padded = [...withDupes, ...distinct.slice(0, 40)]; // 150 entries, 40 distinct
    expect(padded).toHaveLength(150);

    const svc = buildService(100);
    const result = await svc.enqueueBulk(padded, ADMIN);

    expect(result.targetCount).toBe(40);
    expect(result.duplicatesDropped).toBe(110);
    expect(result.enqueued).toHaveLength(40);
    expect(enqueue).toHaveBeenCalledTimes(40);
  });

  it('refuses a request with no usable ids', async () => {
    const svc = buildService(100);
    await expect(svc.enqueueBulk(['  ', ''], ADMIN)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues ADMIN_BULK with the actor role, never the job trigger', async () => {
    const svc = buildService(100);
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
    process.env.SCRAPINGBEE_API_KEY = 'test-key-not-used';

    await expect(buildService().bindOwnProfile('u1', 'https://scholar.google.com/citations?user=x'))
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
    await expect(buildService().bindOwnProfile('u1', 'https://scholar.google.com/citations?user=x'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.bindScholarProfile).not.toHaveBeenCalled();
  });
});

// ── 4. Bulk pricing ────────────────────────────────────────────────────────

describe('estimateScholarBulkCredits', () => {
  it('prices an unbound target one page higher — somebody must pay for the bind', () => {
    const targets = [
      { profileBound: true },
      { profileBound: true },
      { profileBound: true },
      { profileBound: false },
      { profileBound: false },
    ];
    // 3 bound × 1 page + 2 unbound × 2 pages = 7 pages
    expect(estimateScholarBulkCredits(targets)).toBe(7 * GOOGLE_PAGE_CREDIT_COST);
  });

  it('is zero for an empty run and never a literal credit price', () => {
    expect(estimateScholarBulkCredits([])).toBe(0);
    expect(estimateScholarBulkCredits([{ profileBound: true }])).toBe(GOOGLE_PAGE_CREDIT_COST);
  });

  it('the bulk enqueue quotes the same number for a mixed batch', async () => {
    mocks.resolveScholarFacultyMember.mockImplementation(async (userId: string) => ({
      user: { id: userId, name: 'X' },
      member: {
        id: `fm-${userId}`,
        nameEn: 'X',
        nameTh: 'X',
        employeeId: null,
        isActive: true,
        // u0, u1 bound; u2, u3 not.
        scholarProfileId: userId === 'u0' || userId === 'u1' ? `p-${userId}` : null,
      },
      refusal: null,
    }));

    const result = await buildService(100).enqueueBulk(['u0', 'u1', 'u2', 'u3'], ADMIN);

    // 2 bound × 1 + 2 unbound × 2 = 6 pages
    expect(result.estimatedCredits).toBe(6 * GOOGLE_PAGE_CREDIT_COST);
    expect(result.targets.filter((t) => t.profileBound)).toHaveLength(2);
  });

  it('flags targets with no staff record so the console can say why', async () => {
    mocks.resolveScholarFacultyMember.mockResolvedValue({
      user: null,
      member: null,
      refusal: 'No staff record matches.',
    });
    const result = await buildService(100).enqueueBulk(['u0'], ADMIN);
    expect(result.targets[0]).toEqual({
      userId: 'u0',
      profileBound: false,
      resolutionRefusal: 'No staff record matches.',
    });
  });
});
