import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  memberDelete: vi.fn(),
  projectDelete: vi.fn(),
}));

vi.mock('@kku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kku/db')>();
  const tx = {
    researchServiceProjectMember: { deleteMany: mocks.memberDelete, createMany: vi.fn() },
    researchServiceProject: { deleteMany: mocks.projectDelete, createMany: vi.fn() },
  };
  return {
    ...actual,
    prisma: {
      researchServiceProject: { count: mocks.count },
      facultyMember: { findMany: vi.fn().mockResolvedValue([]) },
      faculty: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
  };
});

import { KkuResearchServicesRealConnector } from '../../src/connectors/sources/kku-research-services';

describe('kku-research-services snapshot replace', () => {
  beforeEach(() => {
    mocks.count.mockReset().mockResolvedValue(0);
    mocks.memberDelete.mockReset().mockResolvedValue({ count: 0 });
    mocks.projectDelete.mockReset().mockResolvedValue({ count: 0 });
  });

  it('counts and deletes only its own rows, never spreadsheet-imported ones', async () => {
    const connector = new KkuResearchServicesRealConnector();
    (connector as unknown as { fetched: unknown }).fetched = {
      projects: [], cos: [], projectRowsFetched: 0, coRowsFetched: 0,
      invalidProjects: 0, invalidCoRows: 0, invalidProjectSamples: [], invalidCoSamples: [],
    };
    const ctx = { runId: 'run-1', log: { info: vi.fn(), warn: vi.fn() } };
    await connector.load(ctx as never, []);

    const own = { sourceProposalKey: { not: { startsWith: 'xlsx:' } } };
    expect(mocks.count).toHaveBeenCalledWith({ where: own });
    expect(mocks.projectDelete).toHaveBeenCalledWith({ where: own });
    expect(mocks.memberDelete).toHaveBeenCalledWith({ where: { project: own } });
  });
});
