import { describe, expect, it, vi } from 'vitest';

import { KkuDqRealConnector } from '../../src/connectors/sources/kku-dq/connector';
import { emptyAccumulator } from '../../src/connectors/sources/kku-dq/transforms';

describe('kku-dq cube replace', () => {
  it('never deletes rows written by the spreadsheet imports', async () => {
    const studentDelete = vi.fn().mockReturnValue('s');
    const moduleDelete = vi.fn().mockReturnValue('m');
    const db = {
      dqStudentCube: { deleteMany: studentDelete, createMany: vi.fn() },
      dqModuleCube: { deleteMany: moduleDelete, createMany: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const connector = new KkuDqRealConnector(db as never);
    (connector as unknown as { runState: unknown }).runState = {
      fetchTimestamp: new Date(), fetched: 0, parsed: 0, parseFailed: 0,
      withResult: 0, withScores: 0, matchedProgram: 0,
      unmatchedFacultyNames: new Set<string>(), unmatchedFacultyStudents: 0,
      allPassedInconsistent: 0, acc: emptyAccumulator(),
    };
    const ctx = { runId: 'run-1', log: { info: vi.fn(), warn: vi.fn() } };
    await connector.load(ctx as never, []);
    const where = {
      NOT: {
        ingestionRun: {
          dataSource: {
            slug: { in: ['xlsx-digital-competency-cohorts', 'xlsx-digital-competency-modules'] },
          },
        },
      },
    };
    expect(studentDelete).toHaveBeenCalledWith({ where });
    expect(moduleDelete).toHaveBeenCalledWith({ where });
  });
});
