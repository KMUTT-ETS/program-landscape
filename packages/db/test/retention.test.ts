import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  computeRetentionCutoffs,
  DEFAULT_WINDOWS,
  runRetentionSweep,
  type RetentionPrismaLike,
} from '../src/retention';

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
      auditLogFullRetention: 30,
      aiInferencePayloadRetention: 7,
      aiInferenceFullRetention: 30,
    });
    const expected30d = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(c.auditLogDeleteBefore.toISOString()).toBe(expected30d.toISOString());
  });
});

describe('runRetentionSweep', () => {
  const auditDelete = vi.fn();
  const aiUpdate = vi.fn();
  const aiDelete = vi.fn();

  const prismaMock: RetentionPrismaLike = {
    auditLog: { deleteMany: auditDelete },
    aiInference: { updateMany: aiUpdate, deleteMany: aiDelete },
  };

  beforeEach(() => {
    auditDelete.mockReset();
    aiUpdate.mockReset();
    aiDelete.mockReset();
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
    expect(aiUpdArg.data).toEqual({ prompt: null, response: null });

    const aiDelArg = aiDelete.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    expect(aiDelArg.where.createdAt.lt.getTime()).toBe(
      expected.aiInferenceDeleteBefore.getTime(),
    );
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
    expect(result.dryRun).toBe(true);
    expect(result.auditLogDeleted).toBe(0);
  });
});
