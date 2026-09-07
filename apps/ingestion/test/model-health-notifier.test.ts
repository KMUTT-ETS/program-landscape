import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  aiModelHealth: vi.fn(),
  userFindMany: vi.fn(),
  notifFindFirst: vi.fn(),
  notifCreate: vi.fn(),
  notifUpdateMany: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  aiModelHealth: mocks.aiModelHealth,
  prisma: {
    user: { findMany: mocks.userFindMany },
    notification: {
      findFirst: mocks.notifFindFirst,
      create: mocks.notifCreate,
      updateMany: mocks.notifUpdateMany,
    },
  },
}));

import { runModelHealthNotifier } from '../src/ai-jobs/model-health-notifier';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
  mocks.notifFindFirst.mockResolvedValue(null);
});

describe('runModelHealthNotifier', () => {
  it('raises one notification per SUPER_ADMIN for a failing method', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-courses-extract', effectiveModel: 'gemini-3.6-flash',
        isPinned: true, status: 'failing', detail: 'x' },
    ]);
    await runModelHealthNotifier();
    expect(mocks.notifCreate).toHaveBeenCalledTimes(2);
    expect(mocks.notifCreate.mock.calls[0][0].data).toMatchObject({
      kind: 'ai_model_health',
      severity: 'high',
      entityType: 'ai_model_override',
      entityId: 'program-courses-extract:gemini-3.6-flash',
    });
  });

  it('does not duplicate while an unread notification for the same pin exists', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'bad-model',
        isPinned: true, status: 'off-catalog', detail: 'x' },
    ]);
    mocks.notifFindFirst.mockResolvedValue({ id: 'n1' });
    await runModelHealthNotifier();
    expect(mocks.notifCreate).not.toHaveBeenCalled();
  });

  it('marks outstanding notifications read once a method returns to ok', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'gemini-3.5-flash',
        isPinned: false, status: 'ok', detail: 'x' },
    ]);
    await runModelHealthNotifier();
    expect(mocks.notifUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: 'ai_model_health', readAt: null }),
      }),
    );
    expect(mocks.notifCreate).not.toHaveBeenCalled();
  });

  it('uses medium severity for deprecated and off-catalog', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'old', isPinned: true,
        status: 'deprecated', detail: 'x' },
    ]);
    await runModelHealthNotifier();
    expect(mocks.notifCreate.mock.calls[0][0].data.severity).toBe('medium');
  });

  it('raises a fresh alert when the pin changes to a different bad model', async () => {
    // entityId carries the model, so this must NOT be suppressed by an unread
    // notification about the previous bad model.
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'worse-model',
        isPinned: true, status: 'off-catalog', detail: 'x' },
    ]);
    mocks.notifFindFirst.mockResolvedValue(null);   // no unread row for THIS entityId
    await runModelHealthNotifier();
    expect(mocks.notifCreate).toHaveBeenCalledTimes(2);
    expect(mocks.notifCreate.mock.calls[0][0].data.entityId).toBe('program-digest:worse-model');
  });
});
