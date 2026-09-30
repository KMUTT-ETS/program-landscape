import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  computeRetentionCutoffs,
  DEFAULT_WINDOWS,
  REDACTED_TEXT,
  runRetentionSweep,
  type RetentionPrismaLike,
  type RetentionWindowsDays,
} from '../src/retention';
import { RAW_RETENTION_DAYS } from '../src/usage';

const DAY_MS = 24 * 60 * 60 * 1000;

const NOW = new Date('2026-05-09T00:00:00.000Z');

describe('computeRetentionCutoffs', () => {
  it('uses 7-year window for audit log full retention', () => {
    const c = computeRetentionCutoffs(NOW, DEFAULT_WINDOWS);
    const sevenYearsBefore = new Date('2019-05-11T00:00:00.000Z');
    expect(Math.abs(c.auditLogDeleteBefore.getTime() - sevenYearsBefore.getTime()))
      .toBeLessThan(2 * 24 * 60 * 60 * 1000);
  });

  it('uses 2-year window for AI inference payload redaction', () => {
    const c = computeRetentionCutoffs(NOW, DEFAULT_WINDOWS);
    const twoYearsBefore = new Date('2024-05-09T00:00:00.000Z');
    expect(Math.abs(c.aiInferencePayloadRedactBefore.getTime() - twoYearsBefore.getTime()))
      .toBeLessThan(2 * 24 * 60 * 60 * 1000);
  });

  it('uses 7-year window for AI inference full retention', () => {
    const c = computeRetentionCutoffs(NOW, DEFAULT_WINDOWS);
    expect(c.aiInferenceDeleteBefore.getTime()).toBe(c.auditLogDeleteBefore.getTime());
  });

  it('respects custom windows', () => {
    const c = computeRetentionCutoffs(NOW, {
      ...DEFAULT_WINDOWS,
      auditLogFullRetention: 30,
      aiInferencePayloadRetention: 7,
      aiInferenceFullRetention: 30,
    });
    const expected30d = new Date(NOW.getTime() - 30 * DAY_MS);
    expect(c.auditLogDeleteBefore.toISOString()).toBe(expected30d.toISOString());
  });

  // ── Google Scholar ────────────────────────────────────────────────────
  // The spec pins the Scholar archive at 90 days. These assert the exact
  // instant, not a tolerance: a window that is silently a year long still
  // "deletes old rows", and a test that only checks the direction would pass.

  it('puts the Scholar archive cut-off exactly 90 days before now', () => {
    const c = computeRetentionCutoffs(NOW, DEFAULT_WINDOWS);
    expect(c.scholarArchiveDeleteBefore.toISOString()).toBe(
      new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
    );
  });

  it('puts the bind-attempt redaction cut-off exactly 90 days before now', () => {
    const c = computeRetentionCutoffs(NOW, DEFAULT_WINDOWS);
    expect(c.scholarBindAttemptRedactBefore.toISOString()).toBe(
      new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
    );
  });

  it('declares 90-day defaults for both Scholar windows', () => {
    expect(DEFAULT_WINDOWS.scholarArchiveFullRetention).toBe(90);
    expect(DEFAULT_WINDOWS.scholarBindAttemptTextRetention).toBe(90);
  });

  // ── Page views ────────────────────────────────────────────────────────
  // The default is the READER's constant, not a second 120 written here. A
  // literal would compile, pass, and then drift the day `usage_days` switches
  // from raw rows to roll-ups away from the day this rule rolls up — which
  // reads as a stretch of days with no traffic, not as an error.

  it('takes the page-view window from the reader, not a literal', () => {
    expect(DEFAULT_WINDOWS.pageViewRawRetention).toBe(RAW_RETENTION_DAYS);
  });

  it('derives the page-view cut-off from its own window', () => {
    const base = computeRetentionCutoffs(NOW, DEFAULT_WINDOWS);
    expect(base.pageViewRollupBefore.toISOString()).toBe(
      new Date(NOW.getTime() - RAW_RETENTION_DAYS * DAY_MS).toISOString(),
    );
    const after = computeRetentionCutoffs(NOW, {
      ...DEFAULT_WINDOWS,
      pageViewRawRetention: DEFAULT_WINDOWS.pageViewRawRetention + 1,
    });
    expect(base.pageViewRollupBefore.getTime() - after.pageViewRollupBefore.getTime()).toBe(DAY_MS);
    expect(after.scholarArchiveDeleteBefore.getTime()).toBe(
      base.scholarArchiveDeleteBefore.getTime(),
    );
  });

  // MUTATION CHECK. Every assertion above would still pass if the Scholar
  // cut-off were hard-coded to a constant and ignored its window — which is
  // exactly the copy-paste failure this module invites, since three of its
  // five cut-offs are the same arithmetic on a different field. Perturbing
  // the window by one day has to move the cut-off by one day, and has to
  // move ONLY that cut-off.
  it('derives the Scholar cut-off from its own window, not a constant', () => {
    const base = computeRetentionCutoffs(NOW, DEFAULT_WINDOWS);
    const mutated: RetentionWindowsDays = {
      ...DEFAULT_WINDOWS,
      scholarArchiveFullRetention: DEFAULT_WINDOWS.scholarArchiveFullRetention + 1,
    };
    const after = computeRetentionCutoffs(NOW, mutated);

    expect(
      base.scholarArchiveDeleteBefore.getTime() - after.scholarArchiveDeleteBefore.getTime(),
    ).toBe(DAY_MS);
    // and nothing else moved
    expect(after.scholarBindAttemptRedactBefore.getTime()).toBe(
      base.scholarBindAttemptRedactBefore.getTime(),
    );
    expect(after.auditLogDeleteBefore.getTime()).toBe(base.auditLogDeleteBefore.getTime());
    expect(after.aiInferenceDeleteBefore.getTime()).toBe(base.aiInferenceDeleteBefore.getTime());
  });

  it('derives the bind-attempt cut-off from its own window, not a constant', () => {
    const base = computeRetentionCutoffs(NOW, DEFAULT_WINDOWS);
    const after = computeRetentionCutoffs(NOW, {
      ...DEFAULT_WINDOWS,
      scholarBindAttemptTextRetention: DEFAULT_WINDOWS.scholarBindAttemptTextRetention + 1,
    });
    expect(
      base.scholarBindAttemptRedactBefore.getTime() -
        after.scholarBindAttemptRedactBefore.getTime(),
    ).toBe(DAY_MS);
    expect(after.scholarArchiveDeleteBefore.getTime()).toBe(
      base.scholarArchiveDeleteBefore.getTime(),
    );
  });
});

describe('runRetentionSweep', () => {
  const auditDelete = vi.fn();
  const aiUpdate = vi.fn();
  const aiDelete = vi.fn();
  const archiveDelete = vi.fn();
  const bindUpdate = vi.fn();
  const apiLogDelete = vi.fn();
  // The page-view rule is raw SQL rather than a delegate call. Its own
  // behaviour is covered in usage-retention.test.ts; here it only has to be
  // reachable, and `$queryRaw` returning no candidate days makes it a no-op.
  const queryRaw = vi.fn();
  const executeRaw = vi.fn();
  const transaction = vi.fn();

  const prismaMock: RetentionPrismaLike = {
    auditLog: { deleteMany: auditDelete },
    aiInference: { updateMany: aiUpdate, deleteMany: aiDelete },
    scholarFetchArchive: { deleteMany: archiveDelete },
    scholarBindAttempt: { updateMany: bindUpdate },
    apiRequestLog: { deleteMany: apiLogDelete },
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction: transaction,
  };

  beforeEach(() => {
    auditDelete.mockReset();
    aiUpdate.mockReset();
    aiDelete.mockReset();
    archiveDelete.mockReset().mockResolvedValue({ count: 0 });
    bindUpdate.mockReset().mockResolvedValue({ count: 0 });
    apiLogDelete.mockReset().mockResolvedValue({ count: 7 });
    queryRaw.mockReset().mockResolvedValue([]);
    executeRaw.mockReset().mockResolvedValue(0);
    transaction
      .mockReset()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
  });

  it('runs the three operations in the correct order: ai-delete → ai-redact → audit-delete', async () => {
    auditDelete.mockResolvedValue({ count: 5 });
    aiUpdate.mockResolvedValue({ count: 12 });
    aiDelete.mockResolvedValue({ count: 3 });

    const calls: string[] = [];
    auditDelete.mockImplementation(async () => {
      calls.push('auditLog.deleteMany');
      return { count: 5 };
    });
    aiUpdate.mockImplementation(async () => {
      calls.push('aiInference.updateMany');
      return { count: 12 };
    });
    aiDelete.mockImplementation(async () => {
      calls.push('aiInference.deleteMany');
      return { count: 3 };
    });

    const result = await runRetentionSweep({ prisma: prismaMock, now: NOW });

    expect(calls).toEqual([
      'aiInference.deleteMany',
      'aiInference.updateMany',
      'auditLog.deleteMany',
    ]);
    expect(archiveDelete).toHaveBeenCalledTimes(1);
    expect(bindUpdate).toHaveBeenCalledTimes(1);
    expect(result.auditLogDeleted).toBe(5);
    expect(result.aiInferencePayloadRedacted).toBe(12);
    expect(result.aiInferenceDeleted).toBe(3);
    expect(result.dryRun).toBe(false);
  });

  it('passes the correct cut-off dates to each Prisma call', async () => {
    auditDelete.mockResolvedValue({ count: 0 });
    aiUpdate.mockResolvedValue({ count: 0 });
    aiDelete.mockResolvedValue({ count: 0 });

    await runRetentionSweep({ prisma: prismaMock, now: NOW });
    const expected = computeRetentionCutoffs(NOW);

    const auditArg = auditDelete.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(auditArg.where.createdAt.lt.getTime()).toBe(
      expected.auditLogDeleteBefore.getTime(),
    );

    const aiUpdArg = aiUpdate.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date }; OR: unknown };
      data: Record<string, unknown>;
    };
    expect(aiUpdArg.where.createdAt.lt.getTime()).toBe(
      expected.aiInferencePayloadRedactBefore.getTime(),
    );
    // A sentinel, not null: both columns are NOT NULL in the schema, so the
    // original `data: { prompt: null }` could never have executed.
    expect(aiUpdArg.data).toEqual({
      prompt: REDACTED_TEXT,
      response: REDACTED_TEXT,
    });

    const aiDelArg = aiDelete.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(aiDelArg.where.createdAt.lt.getTime()).toBe(
      expected.aiInferenceDeleteBefore.getTime(),
    );
  });

  // ── Google Scholar ────────────────────────────────────────────────────

  it('hard-deletes Scholar archives at the 90-day cut-off, not another one', async () => {
    auditDelete.mockResolvedValue({ count: 0 });
    aiUpdate.mockResolvedValue({ count: 0 });
    aiDelete.mockResolvedValue({ count: 0 });
    archiveDelete.mockResolvedValue({ count: 4 });

    const result = await runRetentionSweep({ prisma: prismaMock, now: NOW });
    const expected = computeRetentionCutoffs(NOW);

    const arg = archiveDelete.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(arg.where.createdAt.lt.getTime()).toBe(
      expected.scholarArchiveDeleteBefore.getTime(),
    );
    // Guards one half of the copy-paste: the 7-year audit cut-off would also
    // "delete old rows" and every count assertion would still pass. It does
    // NOT guard a swap with the bind-attempt cut-off, which shares this
    // window's default — that is the asymmetric-window test below.
    expect(arg.where.createdAt.lt.getTime()).not.toBe(
      expected.auditLogDeleteBefore.getTime(),
    );
    expect(result.scholarArchiveDeleted).toBe(4);
  });

  it('redacts bind-attempt free text without deleting the credit ledger', async () => {
    auditDelete.mockResolvedValue({ count: 0 });
    aiUpdate.mockResolvedValue({ count: 0 });
    aiDelete.mockResolvedValue({ count: 0 });
    bindUpdate.mockResolvedValue({ count: 9 });

    const result = await runRetentionSweep({ prisma: prismaMock, now: NOW });
    const expected = computeRetentionCutoffs(NOW);

    const arg = bindUpdate.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date }; url: { not: string } };
      data: Record<string, unknown>;
    };
    expect(arg.where.createdAt.lt.getTime()).toBe(
      expected.scholarBindAttemptRedactBefore.getTime(),
    );
    // Only the three identifying free-text fields. `creditsUsed`, `outcome`
    // and the ids are what the table exists for and must survive.
    expect(arg.data).toEqual({
      url: REDACTED_TEXT,
      profileName: null,
      errorText: null,
    });
    // Idempotent: an already-redacted row must not be rewritten every night.
    expect(arg.where.url).toEqual({ not: REDACTED_TEXT });
    expect(result.scholarBindAttemptTextRedacted).toBe(9);
  });

  // The two Scholar rules BOTH default to 90 days, so every assertion above
  // still passes if the sweep hands the archive cut-off to the bind-attempt
  // query and vice versa — mutation-verified: swapping the two in
  // `runRetentionSweep` passes 15/15 without this test. Pulling the windows
  // apart is the only thing that can tell them apart.
  it('gives each Scholar rule its OWN cut-off, not merely a 90-day one', async () => {
    auditDelete.mockResolvedValue({ count: 0 });
    aiUpdate.mockResolvedValue({ count: 0 });
    aiDelete.mockResolvedValue({ count: 0 });

    const windows = {
      ...DEFAULT_WINDOWS,
      scholarArchiveFullRetention: 90,
      scholarBindAttemptTextRetention: 45,
    };
    await runRetentionSweep({ prisma: prismaMock, now: NOW, windows });

    const archiveArg = archiveDelete.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    const bindArg = bindUpdate.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(archiveArg.where.createdAt.lt.toISOString()).toBe(
      new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
    );
    expect(bindArg.where.createdAt.lt.toISOString()).toBe(
      new Date(NOW.getTime() - 45 * DAY_MS).toISOString(),
    );
  });

  it('hard-deletes api request log rows older than 365 days and reports the count', async () => {
    auditDelete.mockResolvedValue({ count: 0 });
    aiUpdate.mockResolvedValue({ count: 0 });
    aiDelete.mockResolvedValue({ count: 0 });
    const now = new Date('2026-09-30T00:00:00Z');
    expect(computeRetentionCutoffs(now).apiRequestLogDeleteBefore.toISOString()).toBe(
      '2025-09-30T00:00:00.000Z',
    );
    const r = await runRetentionSweep({ prisma: prismaMock, now });
    expect(apiLogDelete).toHaveBeenCalledWith({
      where: { createdAt: { lt: r.cutoffs.apiRequestLogDeleteBefore } },
    });
    expect(r.apiRequestLogDeleted).toBe(7);
  });

  it('never touches ScholarFetchRun — it is the quota ledger', () => {
    // Structural, not behavioural: if a future edit adds a `scholarFetchRun`
    // writer to the injectable client, this fails and the reviewer has to
    // justify handing everyone a fresh monthly allowance.
    expect(Object.keys(prismaMock)).not.toContain('scholarFetchRun');
    // The raw trio is the page-view rule's whole surface. It is deliberately
    // NOT a `pageView` delegate: a `deleteMany` there would delete the rows
    // without rolling them up, which is the one thing this rule must not do.
    expect(Object.keys(prismaMock).sort()).toEqual([
      '$executeRaw',
      '$queryRaw',
      '$transaction',
      'aiInference',
      'apiRequestLog',
      'auditLog',
      'scholarBindAttempt',
      'scholarFetchArchive',
    ]);
    expect(Object.keys(prismaMock)).not.toContain('pageView');
  });

  // The page-view rule is the only one that WRITES before it deletes, so the
  // sweep has to reach it with its own cut-off — not the audit or Scholar one,
  // both of which would also "roll up old days" and pass every count assertion.
  it('hands the page-view rule its own cut-off and reports what it moved', async () => {
    auditDelete.mockResolvedValue({ count: 0 });
    aiUpdate.mockResolvedValue({ count: 0 });
    aiDelete.mockResolvedValue({ count: 0 });
    queryRaw.mockResolvedValue([{ day: '2020-01-01', n: 11 }]);
    executeRaw.mockResolvedValue(11);

    const result = await runRetentionSweep({ prisma: prismaMock, now: NOW });
    const expected = computeRetentionCutoffs(NOW);

    expect(result.cutoffs.pageViewRollupBefore.getTime()).toBe(
      expected.pageViewRollupBefore.getTime(),
    );
    expect(result.cutoffs.pageViewRollupBefore.getTime()).not.toBe(
      expected.scholarArchiveDeleteBefore.getTime(),
    );
    // The candidate-day scan is bounded by the page-view cut-off; the bound is
    // a bound SQL parameter, so it is checked through the emitted values.
    expect(queryRaw.mock.calls[0]?.[0].values).toContainEqual(expected.pageViewRollupBefore);
    expect(result.pageViewDaysRolledUp).toBe(1);
    expect(result.pageViewRowsDeleted).toBe(11);
  });

  it('skips DB calls in dry-run mode', async () => {
    const result = await runRetentionSweep({
      prisma: prismaMock,
      now: NOW,
      dryRun: true,
    });
    expect(auditDelete).not.toHaveBeenCalled();
    expect(aiUpdate).not.toHaveBeenCalled();
    expect(aiDelete).not.toHaveBeenCalled();
    expect(archiveDelete).not.toHaveBeenCalled();
    expect(bindUpdate).not.toHaveBeenCalled();
    expect(apiLogDelete).not.toHaveBeenCalled();
    expect(result.apiRequestLogDeleted).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.auditLogDeleted).toBe(0);
    expect(result.scholarArchiveDeleted).toBe(0);
    expect(result.scholarBindAttemptTextRedacted).toBe(0);
    expect(result.pageViewDaysRolledUp).toBe(0);
    expect(result.pageViewRowsDeleted).toBe(0);
  });
});
