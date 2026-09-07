import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  aiModelHealth: vi.fn(),
  userFindMany: vi.fn(),
  notifFindMany: vi.fn(),
  notifCreate: vi.fn(),
  notifUpdateMany: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  aiModelHealth: mocks.aiModelHealth,
  prisma: {
    user: { findMany: mocks.userFindMany },
    notification: {
      findMany: mocks.notifFindMany,
      create: mocks.notifCreate,
      updateMany: mocks.notifUpdateMany,
    },
  },
}));

import { runModelHealthNotifier } from '../src/ai-jobs/model-health-notifier';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
  // Default: no admin has an unread row for any entityId yet.
  mocks.notifFindMany.mockResolvedValue([]);
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

  it('does not duplicate when every admin already holds an unread notification for the same pin', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'bad-model',
        isPinned: true, status: 'off-catalog', detail: 'x' },
    ]);
    mocks.notifFindMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
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
    // No unread row for THIS entityId (the default from beforeEach).
    await runModelHealthNotifier();
    expect(mocks.notifCreate).toHaveBeenCalledTimes(2);
    expect(mocks.notifCreate.mock.calls[0][0].data.entityId).toBe('program-digest:worse-model');
  });

  it('notifies an admin who becomes SUPER_ADMIN after the alert already fired for this pin', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'program-digest', effectiveModel: 'bad-model',
        isPinned: true, status: 'off-catalog', detail: 'x' },
    ]);
    mocks.userFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3-new-admin' }]);
    // u1/u2 already hold an unread row for this entityId (notified yesterday);
    // u3-new-admin does not, because they weren't SUPER_ADMIN yet.
    mocks.notifFindMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    await runModelHealthNotifier();
    expect(mocks.notifCreate).toHaveBeenCalledTimes(1);
    expect(mocks.notifCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u3-new-admin' }) }),
    );
  });

  it('isolates a throwing verdict so a later verdict in the same sweep still notifies', async () => {
    mocks.aiModelHealth.mockResolvedValue([
      { methodPrefix: 'bad-actor', effectiveModel: 'x', isPinned: true, status: 'failing', detail: 'x' },
      { methodPrefix: 'program-digest', effectiveModel: 'y', isPinned: true, status: 'off-catalog', detail: 'y' },
    ]);
    mocks.notifFindMany
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce([]);
    await runModelHealthNotifier();
    expect(mocks.notifCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityId: 'program-digest:y' }) }),
    );
  });
});
