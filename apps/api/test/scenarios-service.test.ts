import { describe, expect, it, vi, beforeEach } from 'vitest';

// Tests the service-layer authorisation + workflow rules without a DB.
// Rules that MUST stay correct:
//   1. markCouncilReviewed requires EXECUTIVE or ADMIN.
//   2. decide requires EXECUTIVE, COUNCIL, or ADMIN AND creates a CouncilDecision row.
//   3. assertEditable refuses DECIDED scenarios.

const mocks = vi.hoisted(() => ({
  scenarioFindUnique: vi.fn(),
  scenarioUpdate: vi.fn(),
  scenarioFindFirst: vi.fn(),
  programFindFirst: vi.fn(),
  programFindMany: vi.fn(),
  demographicFindMany: vi.fn(),
  transaction: vi.fn(),
  councilDecisionCreate: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const actual = await vi.importActual<typeof import('@kku/db')>('@kku/db');
  return {
    ...actual,
    prisma: {
      scenario: {
        findUnique: mocks.scenarioFindUnique,
        update: mocks.scenarioUpdate,
        findFirst: mocks.scenarioFindFirst,
      },
      program: {
        findFirst: mocks.programFindFirst,
        findMany: mocks.programFindMany,
      },
      demographicProjection: { findMany: mocks.demographicFindMany },
      councilDecision: { create: mocks.councilDecisionCreate },
      $transaction: mocks.transaction,
    },
  };
});

import { ScenariosService } from '../src/scenarios/scenarios.service';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('ScenariosService.markCouncilReviewed — role gating', () => {
  const svc = new ScenariosService();

  it('rejects COUNCIL / VIEWER / ANALYST', async () => {
    mocks.scenarioFindUnique.mockResolvedValue({ id: 's1', userId: 'u1', collaboratorIds: [], workflowStatus: 'SHARED', isTemplate: false });
    await expect(svc.markCouncilReviewed('s1', 'u2', 'COUNCIL')).rejects.toThrow(/EXECUTIVE or ADMIN/i);
    await expect(svc.markCouncilReviewed('s1', 'u2', 'VIEWER')).rejects.toThrow(/EXECUTIVE or ADMIN/i);
    await expect(svc.markCouncilReviewed('s1', 'u2', 'ANALYST')).rejects.toThrow(/EXECUTIVE or ADMIN/i);
  });

  it('allows EXECUTIVE', async () => {
    mocks.scenarioFindUnique.mockResolvedValue({ id: 's1', userId: 'u1', collaboratorIds: [], workflowStatus: 'SHARED', isTemplate: false });
    mocks.scenarioUpdate.mockResolvedValue({ id: 's1', workflowStatus: 'COUNCIL_REVIEWED' });
    const r = await svc.markCouncilReviewed('s1', 'u2', 'EXECUTIVE');
    expect(r.workflowStatus).toBe('COUNCIL_REVIEWED');
  });

  it('allows ADMIN', async () => {
    mocks.scenarioFindUnique.mockResolvedValue({ id: 's1', userId: 'u1', collaboratorIds: [], workflowStatus: 'SHARED', isTemplate: false });
    mocks.scenarioUpdate.mockResolvedValue({ id: 's1', workflowStatus: 'COUNCIL_REVIEWED' });
    const r = await svc.markCouncilReviewed('s1', 'u2', 'ADMIN');
    expect(r.workflowStatus).toBe('COUNCIL_REVIEWED');
  });
});

describe('ScenariosService.decide — creates CouncilDecision record', () => {
  const svc = new ScenariosService();

  it('creates CouncilDecision when role is COUNCIL', async () => {
    mocks.scenarioFindUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      collaboratorIds: [],
      workflowStatus: 'COUNCIL_REVIEWED',
      isTemplate: false,
      affectedProgramIds: ['p1'],
    });
    // Transaction returns whatever the caller passes (array of promises).
    mocks.transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
    mocks.scenarioUpdate.mockResolvedValue({ id: 's1', workflowStatus: 'DECIDED' });
    mocks.councilDecisionCreate.mockResolvedValue({ id: 'd1', decisionType: 'CLOSE' });

    const r = await svc.decide('s1', 'u2', 'COUNCIL', { decisionType: 'CLOSE', rationaleTh: 'เหตุผล' });
    expect(r.scenario.workflowStatus).toBe('DECIDED');
    expect(r.decision.id).toBe('d1');
    expect(mocks.councilDecisionCreate).toHaveBeenCalledOnce();
    const call = mocks.councilDecisionCreate.mock.calls[0]?.[0] as { data: { scenarioId: string; affectedProgramIds: string[] } };
    expect(call.data.scenarioId).toBe('s1');
    expect(call.data.affectedProgramIds).toEqual(['p1']);
  });

  it('rejects VIEWER / DEAN / ANALYST', async () => {
    mocks.scenarioFindUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      collaboratorIds: [],
      workflowStatus: 'COUNCIL_REVIEWED',
      isTemplate: false,
      affectedProgramIds: [],
    });
    await expect(svc.decide('s1', 'u2', 'VIEWER', { decisionType: 'CLOSE' })).rejects.toThrow();
    await expect(svc.decide('s1', 'u2', 'DEAN', { decisionType: 'CLOSE' })).rejects.toThrow();
    await expect(svc.decide('s1', 'u2', 'ANALYST', { decisionType: 'CLOSE' })).rejects.toThrow();
  });
});

describe('ScenariosService.patch — editability', () => {
  const svc = new ScenariosService();

  it('refuses to patch a DECIDED scenario', async () => {
    mocks.scenarioFindUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      collaboratorIds: [],
      workflowStatus: 'DECIDED',
      isTemplate: false,
      assumptionsJson: {},
    });
    await expect(svc.patch('s1', 'u1', 'ADMIN', { name: 'blocked' })).rejects.toThrow(/DECIDED/i);
  });

  it('refuses to patch a template as non-ADMIN', async () => {
    mocks.scenarioFindUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      collaboratorIds: [],
      workflowStatus: 'DRAFT',
      isTemplate: true,
      assumptionsJson: {},
    });
    await expect(svc.patch('s1', 'u1', 'EXECUTIVE', { name: 'blocked' })).rejects.toThrow(/ADMIN/i);
  });
});
