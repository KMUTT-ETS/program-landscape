import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/oracle-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/oracle-client')>();
  return { ...actual, withConnection: vi.fn().mockRejectedValue(new Error('stop after watermark')) };
});

import { KkuEvaluationsRealConnector } from '../../src/connectors/sources/kku-evaluations/connector';

describe('kku-evaluations incremental watermark', () => {
  it('ignores rows written by the spreadsheet import', async () => {
    const aggregate = vi.fn().mockResolvedValue({ _max: { lastUpdateAt: null } });
    const db = { evaluationResponseSummary: { aggregate } };
    const connector = new KkuEvaluationsRealConnector((() => ({})) as never, db as never);
    const ctx = { runId: 'run-1', log: { info: vi.fn(), warn: vi.fn() } };
    await expect(connector.fetch(ctx as never)).rejects.toThrow();
    expect(aggregate).toHaveBeenCalledWith({
      _max: { lastUpdateAt: true },
      where: { NOT: { ingestionRun: { dataSource: { slug: 'xlsx-course-evaluations' } } } },
    });
  });
});
