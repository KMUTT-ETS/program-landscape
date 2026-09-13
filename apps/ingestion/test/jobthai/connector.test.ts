import { describe, expect, it, vi } from 'vitest';

import { NonRetryableError } from '../../src/connectors/base/base-connector';
import { JobThaiConnector } from '../../src/connectors/sources/jobthai/connector';

function ctxStub(runId = 'run-1') {
  return {
    runId,
    dataSource: { id: 'ds', slug: 'jobthai', name: 'JobThai', baseUrl: null, lastSyncedAt: null },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never;
}

describe('JobThaiConnector', () => {
  it('declares itself a real XLSX file connector', () => {
    const c = new JobThaiConnector();
    expect(c.slug).toBe('jobthai');
    expect(c.mocked).toBe(false);
    expect(c.inputFormat).toBe('XLSX');
  });

  it('fetches nothing when no batch is PENDING', async () => {
    const c = new JobThaiConnector({
      listPendingBatches: () => Promise.resolve([]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
    });
    expect(await c.fetch(ctxStub())).toHaveLength(0);
  });

  it('returns one raw record per pending batch, keyed by content hash', async () => {
    const c = new JobThaiConnector({
      listPendingBatches: () =>
        Promise.resolve([
          { id: 'b1', contentHash: 'ab12cd34ef', storageKey: 'k1', receivedDate: new Date('2026-09-13') },
        ]),
      readObject: () => Promise.resolve(Buffer.from('bytes')),
    });
    const raw = await c.fetch(ctxStub());
    expect(raw).toHaveLength(1);
    expect(raw[0]!.externalId).toBe('ab12cd34ef');
  });

  it('stamps ingestionRunId from the context onto every loaded posting', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const c = new JobThaiConnector({
      listPendingBatches: () => Promise.resolve([]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
      writePostings: (rows) => {
        writes.push(...rows);
        return Promise.resolve(rows.length);
      },
      markBatch: () => Promise.resolve(),
    });
    await c.load(ctxStub('run-42'), [
      {
        target: 'job_postings',
        externalId: 'ab12cd34:0',
        payload: { title: 'x', jobThaiBatchId: 'b1' },
        freshnessDate: new Date(),
      },
    ]);
    // Without this the row fails realDataWhere() and is invisible.
    expect(writes[0]!.ingestionRunId).toBe('run-42');
  });

  it('throws NonRetryable on a malformed sheet — it will never parse on a retry', async () => {
    const marked: Array<{ id: string; status: string }> = [];
    const c = new JobThaiConnector({
      listPendingBatches: () => Promise.resolve([]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
      markBatch: (id, status) => {
        marked.push({ id, status });
        return Promise.resolve();
      },
    });
    // Assert the CONTRACT, not the prose. XLSX.read does not throw on
    // arbitrary bytes — it parses them into a one-cell sheet — so which
    // validation message comes back depends on the garbage supplied. What
    // must hold is that the failure is classified non-retryable.
    const err = await c
      .transform(ctxStub(), {
        externalId: 'h1',
        sourceTimestamp: new Date(),
        data: { batchId: 'b1', receivedDate: new Date(), bytes: Buffer.from('not a spreadsheet') },
      })
      .then(() => null)
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect((err as NonRetryableError).code).toBe('JOBTHAI_SHEET_INVALID');
    // The operator must be able to see WHY, not watch BullMQ retry 3 times.
    expect(marked.some((m) => m.status === 'FAILED')).toBe(true);
  });

  it('reports pending-batch count as its health signal', async () => {
    const c = new JobThaiConnector({
      listPendingBatches: () =>
        Promise.resolve([{ id: 'b1', contentHash: 'h', storageKey: 'k', receivedDate: new Date() }]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
    });
    const h = await c.healthCheck(ctxStub());
    expect(h.ok).toBe(true);
    expect(h.message).toMatch(/1/);
  });
});
