import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Queue } from 'bullmq';
import type { Connector } from '@kku/shared';

const { findMany, disabledSlugs } = vi.hoisted(() => ({
  findMany: vi.fn(),
  disabledSlugs: new Set<string>(),
}));
vi.mock('@kku/db', () => ({
  prisma: {
    dataSource: { findMany },
  },
}));
vi.mock('@kku/shared', async () => {
  const actual = await vi.importActual<typeof import('@kku/shared')>('@kku/shared');
  return {
    ...actual,
    // Decoupled from the live catalog: only the slugs a test names are disabled.
    isSourceEnabled: (slug: string) => !disabledSlugs.has(slug),
  };
});

import { IngestionScheduler } from '../src/queue/scheduler';
import type { IngestionJobData, IngestionJobResult } from '../src/queue/queue';

// Fake BullMQ Queue — just the subset the scheduler touches. BullMQ is
// heavy to spin up for a test and requires a real Redis, so we fake the
// surface. Casting through `unknown` is safe because the scheduler only
// calls these three methods.
function createFakeQueue() {
  const added: Array<{ name: string; data: unknown; opts: unknown }> = [];
  const repeatables: Array<{ key: string }> = [];
  return {
    _added: added,
    _repeatables: repeatables,
    getRepeatableJobs: vi.fn(async () => repeatables),
    removeRepeatableByKey: vi.fn(async (key: string) => {
      const idx = repeatables.findIndex((r) => r.key === key);
      if (idx >= 0) repeatables.splice(idx, 1);
    }),
    add: vi.fn(async (name: string, data: unknown, opts: unknown) => {
      added.push({ name, data, opts });
      return { id: `job-${name}` };
    }),
  };
}

const fakeConnector = (mocked: boolean) => ({ mocked }) as unknown as Connector;
const realRegistry = (...slugs: string[]) =>
  new Map<string, Connector>(slugs.map((s) => [s, fakeConnector(false)]));

type FakeQueue = ReturnType<typeof createFakeQueue>;
const asQueue = (f: FakeQueue) => f as unknown as Queue<IngestionJobData, IngestionJobResult>;

describe('IngestionScheduler', () => {
  beforeEach(() => {
    findMany.mockReset();
    disabledSlugs.clear();
  });

  it('only asks for rows whose status is not disabled', async () => {
    findMany.mockResolvedValue([]);
    await new IngestionScheduler(asQueue(createFakeQueue()), realRegistry(), {}).registerSchedules();
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { status: { not: 'disabled' } } });
  });

  it('skips a source switched off in the catalog even if its row was never synced', async () => {
    disabledSlugs.add('kku-registry');
    findMany.mockResolvedValue([{ slug: 'kku-registry', cadenceCron: '0 2 * * *' }]);
    const fake = createFakeQueue();
    const result = await new IngestionScheduler(
      asQueue(fake),
      realRegistry('kku-registry'),
      {},
    ).registerSchedules();

    expect(fake.add).not.toHaveBeenCalled();
    expect(result.skippedSlugs).toEqual([{ slug: 'kku-registry', reason: 'disabled' }]);
  });

  it('registers a repeatable job for each scheduleEnabled source with cadenceCron', async () => {
    findMany.mockResolvedValue([
      { slug: 'kku-registry', cadenceCron: '0 2 * * *' },
      { slug: 'jobthai', cadenceCron: '0 */6 * * *' },
    ]);

    const fake = createFakeQueue();
    const scheduler = new IngestionScheduler(
      asQueue(fake),
      realRegistry('kku-registry', 'jobthai'),
      {},
    );
    const result = await scheduler.registerSchedules();

    expect(result.registered).toBe(2);
    expect(fake.add).toHaveBeenCalledTimes(2);
    expect(fake.add.mock.calls[0]?.[2]).toMatchObject({
      repeat: { pattern: '0 2 * * *' },
    });
    expect(fake.add.mock.calls[1]?.[2]).toMatchObject({
      repeat: { pattern: '0 */6 * * *' },
    });
  });

  it('removes stale repeatables before re-registering (so cadence edits flow through on restart)', async () => {
    findMany.mockResolvedValue([{ slug: 'kku-registry', cadenceCron: '0 2 * * *' }]);

    const fake = createFakeQueue();
    fake._repeatables.push({ key: 'stale-kku-registry' });

    const scheduler = new IngestionScheduler(asQueue(fake), realRegistry('kku-registry'), {});
    await scheduler.registerSchedules();

    expect(fake.removeRepeatableByKey).toHaveBeenCalledWith('stale-kku-registry');
  });

  it('skips a slug with no registered connector', async () => {
    findMany.mockResolvedValue([{ slug: 'the-rankings', cadenceCron: '0 2 * * *' }]);
    const fake = createFakeQueue();
    const scheduler = new IngestionScheduler(asQueue(fake), realRegistry('kku-registry'), {});
    const result = await scheduler.registerSchedules();

    expect(fake.add).not.toHaveBeenCalled();
    expect(result).toEqual({
      registered: 0,
      skipped: 1,
      skippedSlugs: [{ slug: 'the-rankings', reason: 'unregistered' }],
    });
  });

  it('skips a mock connector unless ALLOW_MOCK_CONNECTOR_RUNS=true', async () => {
    findMany.mockResolvedValue([{ slug: 'jobsdb', cadenceCron: '0 2 * * *' }]);
    const registry = new Map<string, Connector>([['jobsdb', fakeConnector(true)]]);

    const off = createFakeQueue();
    const offResult = await new IngestionScheduler(asQueue(off), registry, {}).registerSchedules();
    expect(off.add).not.toHaveBeenCalled();
    expect(offResult.skippedSlugs).toEqual([{ slug: 'jobsdb', reason: 'mock-only' }]);

    const on = createFakeQueue();
    const onResult = await new IngestionScheduler(asQueue(on), registry, {
      ALLOW_MOCK_CONNECTOR_RUNS: 'true',
    }).registerSchedules();
    expect(on.add).toHaveBeenCalledTimes(1);
    expect(onResult.registered).toBe(1);
  });

  it('enqueueManual fires a one-attempt job with MANUAL trigger', async () => {
    const fake = createFakeQueue();
    const scheduler = new IngestionScheduler(asQueue(fake), realRegistry(), {});

    const jobId = await scheduler.enqueueManual('kku-registry', 'user-99');

    expect(jobId).toBe('job-manual:kku-registry');
    expect(fake.add).toHaveBeenCalledWith(
      'manual:kku-registry',
      { dataSourceSlug: 'kku-registry', trigger: 'MANUAL', triggeredByUserId: 'user-99' },
      { attempts: 1 },
    );
  });
});
