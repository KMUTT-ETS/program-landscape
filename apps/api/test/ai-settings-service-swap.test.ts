import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the @kku/db surface AiSettingsService.swapModel() touches. Follows
// the same vi.hoisted + vi.mock('@kku/db', ...) pattern as
// apps/api/test/ai-quota-guard.test.ts.
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  groupBy: vi.fn(),
  transaction: vi.fn(),
  auditLogCreate: vi.fn(),
  listSelectableModels: vi.fn(),
  findCatalogModel: vi.fn(),
  getModelCatalogStatus: vi.fn(),
  refreshAiModelCatalog: vi.fn(),
  aiModelHealth: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  prisma: {
    aiModelOverride: { findMany: mocks.findMany, upsert: mocks.upsert },
    aiInference: { groupBy: mocks.groupBy },
    auditLog: { create: mocks.auditLogCreate },
    $transaction: mocks.transaction,
  },
  Prisma: { JsonNull: null },
  getAiModelOverrideStore: () => ({ invalidate: mocks.invalidate }),
  listSelectableModels: mocks.listSelectableModels,
  findCatalogModel: mocks.findCatalogModel,
  getModelCatalogStatus: mocks.getModelCatalogStatus,
  refreshAiModelCatalog: mocks.refreshAiModelCatalog,
  aiModelHealth: mocks.aiModelHealth,
}));

import { AiSettingsService } from '../src/admin/ai-settings.service';

// Two real, unlocked method prefixes from AI_METHOD_CATALOG — picked
// because neither carries a lockedModel, so both are eligible to be
// pinned. See packages/shared/src/ai/method-catalog.ts.
const PINNED_PREFIX = 'program-digest';
const OTHER_PINNED_PREFIX = 'program-faculty';
const BROKEN_MODEL = 'broken-model-xyz';
const NEW_MODEL = 'replacement-model-abc';

describe('AiSettingsService.swapModel', () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.upsert.mockReset();
    mocks.groupBy.mockReset();
    mocks.transaction.mockReset();
    mocks.auditLogCreate.mockReset();
    mocks.listSelectableModels.mockReset();
    mocks.findCatalogModel.mockReset();
    mocks.getModelCatalogStatus.mockReset();
    mocks.aiModelHealth.mockReset();
    mocks.invalidate.mockReset();

    // Two methods explicitly pinned to the broken model; nothing else
    // references it (no other real defaultModel happens to equal our
    // synthetic BROKEN_MODEL string).
    mocks.findMany.mockResolvedValue([
      { methodPrefix: PINNED_PREFIX, modelId: BROKEN_MODEL, setByUserId: null, setBy: null, updatedAt: new Date() },
      { methodPrefix: OTHER_PINNED_PREFIX, modelId: BROKEN_MODEL, setByUserId: null, setBy: null, updatedAt: new Date() },
    ]);
    mocks.groupBy.mockResolvedValue([]);
    mocks.listSelectableModels.mockResolvedValue([]);
    mocks.getModelCatalogStatus.mockResolvedValue({ lastFetchedAt: null, openrouterCount: 0, staticCount: 0 });
    mocks.aiModelHealth.mockResolvedValue([]);
    mocks.findCatalogModel.mockResolvedValue({ id: NEW_MODEL, label: NEW_MODEL, provider: 'google', tier: 'flash', description: '', costInputPer1m: 0, costOutputPer1m: 0, legacy: false, source: 'static' });
    mocks.transaction.mockResolvedValue([]);
  });

  it('rejects an unknown target model before touching the DB', async () => {
    mocks.findCatalogModel.mockResolvedValueOnce(null);
    const service = new AiSettingsService();
    await expect(
      service.swapModel(BROKEN_MODEL, 'not-a-real-model', 'user-1', true),
    ).rejects.toThrow(/Unknown model id/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('preview (apply: false) computes the plan but writes nothing', async () => {
    const service = new AiSettingsService();
    const result = await service.swapModel(BROKEN_MODEL, NEW_MODEL, 'user-1', false);

    expect(result.applied).toBe(false);
    expect(result.fromModelId).toBe(BROKEN_MODEL);
    expect(result.toModelId).toBe(NEW_MODEL);
    expect(result.plan.rewrite.map((r) => r.methodPrefix).sort()).toEqual(
      [PINNED_PREFIX, OTHER_PINNED_PREFIX].sort(),
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('apply writes every rewrite+create target plus one audit row in a single $transaction, then invalidates', async () => {
    const service = new AiSettingsService();
    const result = await service.swapModel(BROKEN_MODEL, NEW_MODEL, 'user-1', true, '10.0.0.5');

    expect(result.applied).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);

    // Single-array-arg transaction: assert the call shape rather than the
    // resolved value, since each entry is an opaque mocked PrismaPromise.
    const [txArgs] = mocks.transaction.mock.calls[0] as [unknown[]];
    expect(Array.isArray(txArgs)).toBe(true);
    // 2 upserts (rewrite) + 1 audit row = 3 operations queued together.
    expect(txArgs).toHaveLength(3);

    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
    const auditCall = mocks.auditLogCreate.mock.calls[0][0] as {
      data: { payloadJson: { fromModelId: string; toModelId: string; changed: { methodPrefix: string; previousModel: string }[] } };
    };
    expect(auditCall.data.payloadJson.fromModelId).toBe(BROKEN_MODEL);
    expect(auditCall.data.payloadJson.toModelId).toBe(NEW_MODEL);
    expect(auditCall.data.payloadJson.changed.map((c) => c.methodPrefix).sort()).toEqual(
      [PINNED_PREFIX, OTHER_PINNED_PREFIX].sort(),
    );
    // Every changed entry records what it changed FROM — what a rollback
    // would need.
    for (const c of auditCall.data.payloadJson.changed) {
      expect(c.previousModel).toBe(BROKEN_MODEL);
    }

    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it('apply with nothing matching the source model writes no transaction, no audit row, no invalidate', async () => {
    const service = new AiSettingsService();
    const result = await service.swapModel('some-other-model-nobody-uses', NEW_MODEL, 'user-1', true);

    expect(result.applied).toBe(true);
    expect(result.plan.rewrite).toHaveLength(0);
    expect(result.plan.create).toHaveLength(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
