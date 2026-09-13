import { describe, expect, it, vi } from 'vitest';

import { NonRetryableError } from '../../src/connectors/base/base-connector';
import { JobThaiConnector, JOBTHAI_MAX_REFRESHES_PER_RUN } from '../../src/connectors/sources/jobthai/connector';

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
      refresh: () => Promise.resolve({} as never),
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

// ── End-of-run drain + derived-layer refresh (2026-09-13) ───────────────────
//
// WHY: on prod, 47,631 postings loaded and every Deep-Dive still read "No
// JobThai demand signal" — occupations and programme links were only built by
// operator scripts. And uploading several files at once queued one run per
// file; the worker runs 4 jobs concurrently, the runner's in-flight guard
// SKIPS all but one, and a file that arrived after the surviving run fetched
// would have stayed PENDING forever.

describe('JobThaiConnector — end of run', () => {
  const refreshStub = () => vi.fn(() => Promise.resolve({ derive: {}, linksWritten: 0, linkedProgrammes: 0, clearingFloor: 0, durationMs: 1 } as never));
  const posting = (batchId: string, i = 0) => ({
    target: 'job_postings',
    externalId: `${batchId}:${i}`,
    payload: { title: 'x', jobThaiBatchId: batchId },
    freshnessDate: new Date(),
  });

  it('rebuilds the derived layers once no batch is pending, attributed to this run', async () => {
    const refresh = refreshStub();
    const c = new JobThaiConnector({
      listPendingBatches: () => Promise.resolve([]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
      writePostings: (rows) => Promise.resolve(rows.length),
      markBatch: () => Promise.resolve(),
      refresh,
    });
    const result = await c.load(ctxStub('run-7'), [posting('b1')]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((refresh.mock.calls[0] as unknown as [{ runId: string }])[0].runId).toBe('run-7');
    expect((result.metadata as { refresh?: unknown }).refresh).toBeDefined();
  });

  it('also refreshes on a run with nothing to load — that is how a deleted file is reflected', async () => {
    const refresh = refreshStub();
    const c = new JobThaiConnector({
      listPendingBatches: () => Promise.resolve([]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
      refresh,
    });
    await c.load(ctxStub(), []);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('processes batches that became PENDING while the run was underway, then refreshes once', async () => {
    const refresh = refreshStub();
    let listCalls = 0;
    const written: string[] = [];
    const late = { id: 'b2', contentHash: 'late', storageKey: 'k2', receivedDate: new Date() };
    const c = new JobThaiConnector({
      // First check after loading b1: b2 has arrived. Every later check: drained.
      listPendingBatches: () => Promise.resolve(listCalls++ === 0 ? [late] : []),
      readObject: () => Promise.resolve(Buffer.from('bytes')),
      writePostings: (rows) => {
        written.push(...rows.map((r) => r.jobThaiBatchId as string));
        return Promise.resolve(rows.length);
      },
      markBatch: () => Promise.resolve(),
      refresh,
    });
    vi.spyOn(c, 'transform').mockResolvedValue([posting('b2')] as never);
    const result = await c.load(ctxStub(), [posting('b1')]);
    expect(written).toEqual(['b1', 'b2']);
    expect(result.recordsLoaded).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('caps rebuilds per run, so a stream of uploads cannot outlive the 30-minute run lock', async () => {
    // One rebuild is ~11 minutes at 47k postings. The stale-run reaper and the
    // BullMQ lock are both 30 minutes; a third rebuild would cross both and
    // start a second copy alongside this one.
    const refresh = refreshStub();
    let n = 0;
    const c = new JobThaiConnector({
      // A new batch is waiting after EVERY rebuild.
      listPendingBatches: () => Promise.resolve([{ id: `late${n++}`, contentHash: `h${n}`, storageKey: 'k', receivedDate: new Date() }]),
      readObject: () => Promise.resolve(Buffer.from('bytes')),
      writePostings: (rows) => Promise.resolve(rows.length),
      markBatch: () => Promise.resolve(),
      refresh,
    });
    vi.spyOn(c, 'transform').mockResolvedValue([posting('late')] as never);
    const result = await c.load(ctxStub(), [posting('b1')]);
    expect(refresh).toHaveBeenCalledTimes(JOBTHAI_MAX_REFRESHES_PER_RUN);
    // The batches still load — they are not left PENDING — but the run says the
    // derived layers do not yet include them.
    expect((result.metadata as { refreshStale?: boolean }).refreshStale).toBe(true);
  });

  it('fails the run when the refresh fails, so the operator sees it', async () => {
    const c = new JobThaiConnector({
      listPendingBatches: () => Promise.resolve([]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
      writePostings: (rows) => Promise.resolve(rows.length),
      markBatch: () => Promise.resolve(),
      refresh: () => Promise.reject(new Error('derive blew up')),
    });
    await expect(c.load(ctxStub(), [posting('b1')])).rejects.toThrow(/derive blew up/);
  });
});
