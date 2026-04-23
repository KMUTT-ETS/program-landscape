import { describe, expect, it, vi, beforeEach } from 'vitest';

// Tests for the notification fan-out logic. We don't exercise the
// monitor bodies themselves (they're mocked stubs today) — what MUST
// stay correct is: given a new TrendSignal and existing subscriptions,
// the right users receive notifications with the right severity.

const mocks = vi.hoisted(() => ({
  trendSignalFindUnique: vi.fn(),
  trendSignalCreate: vi.fn(),
  subsFindMany: vi.fn(),
  notifFindFirst: vi.fn(),
  notifCreate: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  prisma: {
    trendSignal: {
      findUnique: mocks.trendSignalFindUnique,
      create: mocks.trendSignalCreate,
    },
    signalSubscription: { findMany: mocks.subsFindMany },
    notification: {
      findFirst: mocks.notifFindFirst,
      create: mocks.notifCreate,
    },
  },
  Prisma: {},
}));

import { createSignal, fanoutSignalToSubscribers } from '../src/trend-monitors/monitors';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('fanoutSignalToSubscribers', () => {
  it('writes a notification per active subscriber whose rule matches and impact ≥ min', async () => {
    mocks.trendSignalFindUnique.mockResolvedValue({
      id: 'sig-1',
      signalType: 'POLICY',
      title: 'Test',
      summaryEn: 'en',
      summaryTh: 'th',
      impactScore: 0.8,
      affectedProgramIds: ['prog-1'],
      affectedSkillIds: [],
    });
    mocks.subsFindMany.mockResolvedValue([
      { id: 'sub-1', userId: 'u-a', filterType: 'signal_type', filterValue: 'POLICY' },
      { id: 'sub-2', userId: 'u-b', filterType: 'program', filterValue: 'prog-1' },
    ]);
    mocks.notifFindFirst.mockResolvedValue(null);

    const sent = await fanoutSignalToSubscribers('sig-1');
    expect(sent).toBe(2);
    expect(mocks.notifCreate).toHaveBeenCalledTimes(2);
    const first = mocks.notifCreate.mock.calls[0]?.[0] as {
      data: { severity: string; userId: string };
    };
    // 0.8 impact → 'high' severity
    expect(first.data.severity).toBe('high');
    expect(first.data.userId).toBe('u-a');
  });

  it('is idempotent: existing notification for the same (user, signal) is skipped', async () => {
    mocks.trendSignalFindUnique.mockResolvedValue({
      id: 'sig-1',
      signalType: 'POLICY',
      title: 'Test',
      summaryEn: null,
      summaryTh: null,
      impactScore: 0.5,
      affectedProgramIds: [],
      affectedSkillIds: [],
    });
    mocks.subsFindMany.mockResolvedValue([
      { id: 'sub-1', userId: 'u-a', filterType: 'signal_type', filterValue: 'POLICY' },
    ]);
    mocks.notifFindFirst.mockResolvedValue({ id: 'n-existing' });

    const sent = await fanoutSignalToSubscribers('sig-1');
    expect(sent).toBe(0);
    expect(mocks.notifCreate).not.toHaveBeenCalled();
  });

  it('createSignal creates the row then fans out', async () => {
    mocks.trendSignalCreate.mockResolvedValue({ id: 'new-sig' });
    mocks.trendSignalFindUnique.mockResolvedValue({
      id: 'new-sig',
      signalType: 'MARKET',
      title: 't',
      summaryTh: null,
      summaryEn: null,
      impactScore: 0.9,
      affectedProgramIds: [],
      affectedSkillIds: [],
    });
    mocks.subsFindMany.mockResolvedValue([]);

    const result = await createSignal({
      signalType: 'MARKET',
      title: 't',
      impactScore: 0.9,
    });
    expect(result.id).toBe('new-sig');
    expect(result.notificationsSent).toBe(0);
    expect(mocks.trendSignalCreate).toHaveBeenCalledOnce();
  });
});
