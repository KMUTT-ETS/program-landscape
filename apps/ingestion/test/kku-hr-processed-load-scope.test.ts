import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  compDelete: vi.fn(),
  compCreate: vi.fn(),
  lifeDelete: vi.fn(),
}));

vi.mock('@kku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kku/db')>();
  return {
    ...actual,
    prisma: {
      facultyMember: { findMany: vi.fn().mockResolvedValue([]) },
      faculty: { findMany: vi.fn().mockResolvedValue([]) },
      staffCompensationCube: { deleteMany: mocks.compDelete, createMany: mocks.compCreate },
      staffLifecycleDates: { deleteMany: mocks.lifeDelete, createMany: vi.fn() },
    },
  };
});

import { KkuHrProcessedRealConnector } from '../src/connectors/sources/kku-hr-processed/connector';

describe('kku-hr-processed salary snapshot replace', () => {
  beforeEach(() => {
    mocks.compDelete.mockReset().mockResolvedValue({ count: 0 });
    mocks.compCreate.mockReset().mockResolvedValue({ count: 0 });
    mocks.lifeDelete.mockReset().mockResolvedValue({ count: 0 });
  });

  it('never deletes rows written by the spreadsheet import', async () => {
    const connector = new KkuHrProcessedRealConnector();
    (connector as unknown as { runState: unknown }).runState = {
      fiscalYear: 2569, fetchedAt: new Date(), fetchedCount: 0, lifecycleCount: 0,
    };
    const ctx = { runId: 'run-1', log: { info: vi.fn(), warn: vi.fn() } };
    await connector.load(ctx as never, []);
    expect(mocks.compDelete).toHaveBeenCalledWith({
      where: {
        fiscalYear: 2569,
        OR: [
          { ingestionRunId: null },
          { NOT: { ingestionRun: { dataSource: { slug: 'xlsx-staff-salary-by-funding' } } } },
        ],
      },
    });
  });
});
