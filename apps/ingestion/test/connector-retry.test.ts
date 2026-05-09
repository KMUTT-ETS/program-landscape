import { describe, expect, it, vi, beforeEach } from 'vitest';

// Verify the ConnectorRunner's retry contract:
//
//   1. NonRetryableError → swallow, mark FAILED, RETURN (no re-throw,
//      so BullMQ does NOT retry).
//   2. Any other error → mark FAILED, RE-THROW (so BullMQ schedules
//      exponential backoff).
//
// If this contract regresses, transient infra blips will mark runs FAILED
// without retrying, OR deterministic errors will burn the retry budget
// against unfixable failures. Both are bad ops experiences.

const mocks = vi.hoisted(() => ({
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  dataSourceFindUnique: vi.fn(),
  dataSourceUpdate: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    pdfDocument: { upsert: vi.fn() },
    ingestionRun: { create: mocks.runCreate, update: mocks.runUpdate },
    dataSource: {
      findUnique: mocks.dataSourceFindUnique,
      update: mocks.dataSourceUpdate,
    },
  },
}));

import { ConnectorRunner } from '../src/connectors/runner';
import { NonRetryableError } from '../src/connectors/base/base-connector';
import type {
  Connector,
  ConnectorContext,
  HealthCheckResult,
  RawRecord,
  NormalizedRecord,
  LoadResult,
} from '@kku/shared';

class StubConnector implements Connector {
  readonly slug = 'stub';
  readonly name = 'Stub';
  readonly mocked = true;
  readonly inputFormat = 'API' as const;

  constructor(
    private readonly fetchImpl: (ctx: ConnectorContext) => Promise<RawRecord[]>,
  ) {}

  async healthCheck(_ctx: ConnectorContext): Promise<HealthCheckResult> {
    return { ok: true };
  }
  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    return this.fetchImpl(ctx);
  }
  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ kind: 'demo', data: raw }];
  }
  async load(_ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    return { recordsLoaded: normalized.length, recordsFailed: 0 };
  }
}

const fakeDataSourceRow = (slug: string) => ({
  id: `ds-${slug}`,
  slug,
  name: `DataSource(${slug})`,
  baseUrl: null,
  lastSyncedAt: null,
});

describe('ConnectorRunner — retry contract (BullMQ interplay)', () => {
  beforeEach(() => {
    mocks.runCreate.mockReset();
    mocks.runUpdate.mockReset();
    mocks.dataSourceFindUnique.mockReset();
    mocks.dataSourceUpdate.mockReset();

    mocks.runCreate.mockResolvedValue({ id: 'run-x' });
    mocks.runUpdate.mockResolvedValue({});
    mocks.dataSourceFindUnique.mockResolvedValue(fakeDataSourceRow('stub'));
    mocks.dataSourceUpdate.mockResolvedValue({});
  });

  it('NonRetryableError: marks FAILED + returns (does NOT re-throw)', async () => {
    const conn = new StubConnector(async () => {
      throw new NonRetryableError('SCHEMA_DRIFT', 'unexpected column', {
        column: 'foo',
      });
    });
    const runner = new ConnectorRunner(new Map([[conn.slug, conn]]));

    const outcome = await runner.run({
      dataSourceSlug: 'stub',
      trigger: 'MANUAL',
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.recordsLoaded).toBe(0);

    // Verify the FAILED row carries the NonRetryable code (NOT 'UNCAUGHT').
    const updateCall = mocks.runUpdate.mock.calls[0]?.[0] as {
      data: { status: string; errorCode: string; errorMessage: string };
    };
    expect(updateCall.data.status).toBe('FAILED');
    expect(updateCall.data.errorCode).toBe('SCHEMA_DRIFT');
    expect(updateCall.data.errorMessage).toContain('unexpected column');

    // dataSource.lastSyncedAt MUST NOT be bumped on failure
    expect(mocks.dataSourceUpdate).not.toHaveBeenCalled();
  });

  it('Generic Error: marks FAILED + RE-THROWS so BullMQ retries', async () => {
    const conn = new StubConnector(async () => {
      throw new Error('connection reset by peer');
    });
    const runner = new ConnectorRunner(new Map([[conn.slug, conn]]));

    await expect(
      runner.run({ dataSourceSlug: 'stub', trigger: 'SCHEDULED' }),
    ).rejects.toThrow('connection reset by peer');

    // The FAILED row landed FIRST (before the re-throw).
    const updateCall = mocks.runUpdate.mock.calls[0]?.[0] as {
      data: { status: string; errorCode: string };
    };
    expect(updateCall.data.status).toBe('FAILED');
    // Generic errors get the UNCAUGHT code so the operator can grep them.
    expect(updateCall.data.errorCode).toBe('UNCAUGHT');
    expect(mocks.dataSourceUpdate).not.toHaveBeenCalled();
  });

  it('healthCheck returns ok=false: marks SKIPPED (not FAILED) — preserves retry budget', async () => {
    class UnhealthyConnector extends StubConnector {
      override async healthCheck(): Promise<HealthCheckResult> {
        return { ok: false, message: 'upstream maintenance window' };
      }
    }
    const conn = new UnhealthyConnector(async () => []);
    const runner = new ConnectorRunner(new Map([[conn.slug, conn]]));

    const outcome = await runner.run({
      dataSourceSlug: 'stub',
      trigger: 'SCHEDULED',
    });

    expect(outcome.status).toBe('SKIPPED');
    expect(outcome.recordsLoaded).toBe(0);

    const updateCall = mocks.runUpdate.mock.calls[0]?.[0] as {
      data: { status: string; errorCode: string };
    };
    expect(updateCall.data.status).toBe('SKIPPED');
    expect(updateCall.data.errorCode).toBe('UNHEALTHY');
    // Skipped runs do NOT bump lastSyncedAt — prevents masking a real
    // healthy fetch's freshness.
    expect(mocks.dataSourceUpdate).not.toHaveBeenCalled();
  });

  it('attempt counter is propagated to the IngestionRun row', async () => {
    const conn = new StubConnector(async () => [{ raw: 'r' }]);
    const runner = new ConnectorRunner(new Map([[conn.slug, conn]]));

    await runner.run({
      dataSourceSlug: 'stub',
      trigger: 'SCHEDULED',
      attempt: 3,
    });

    const createCall = mocks.runCreate.mock.calls[0]?.[0] as {
      data: { attempt: number };
    };
    expect(createCall.data.attempt).toBe(3);
  });

  it('attempt defaults to 1 when not passed', async () => {
    const conn = new StubConnector(async () => []);
    const runner = new ConnectorRunner(new Map([[conn.slug, conn]]));

    await runner.run({ dataSourceSlug: 'stub', trigger: 'MANUAL' });

    const createCall = mocks.runCreate.mock.calls[0]?.[0] as {
      data: { attempt: number };
    };
    expect(createCall.data.attempt).toBe(1);
  });

  it('errorMessage truncated at 2000 chars (DB column safety)', async () => {
    const longMessage = 'x'.repeat(5000);
    const conn = new StubConnector(async () => {
      throw new Error(longMessage);
    });
    const runner = new ConnectorRunner(new Map([[conn.slug, conn]]));

    await expect(
      runner.run({ dataSourceSlug: 'stub', trigger: 'MANUAL' }),
    ).rejects.toThrow();

    const updateCall = mocks.runUpdate.mock.calls[0]?.[0] as {
      data: { errorMessage: string };
    };
    expect(updateCall.data.errorMessage.length).toBeLessThanOrEqual(2000);
  });
});
