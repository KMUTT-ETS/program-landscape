import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RUN_LOG_PAGE_SIZE } from '@kku/shared';
import { PERMISSION_META } from '../src/common/decorators';

// GET /data-sources/runs/:runId/logs feeds the run-log modal. It must be
// read-gated, 404 on an unknown run, page by seq, and read the status BEFORE
// the lines (the runner stores every line before a terminal status, so that
// order is what makes "terminal ⇒ complete" true for the polling client).

const calls: string[] = [];
const mocks = vi.hoisted(() => ({
  runFindUnique: vi.fn(),
  logFindMany: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const actual = await vi.importActual<typeof import('@kku/db')>('@kku/db');
  return {
    Prisma: actual.Prisma,
    prisma: {
      ingestionRun: { findUnique: mocks.runFindUnique },
      ingestionRunLog: { findMany: mocks.logFindMany },
    },
  };
});

import { DataSourcesController } from '../src/data-sources/data-sources.controller';
import type { IngestionQueueService } from '../src/data-sources/ingestion-queue.service';

const controller = new DataSourcesController({} as IngestionQueueService);

function line(seq: number) {
  return {
    seq,
    ts: new Date('2026-11-11T03:00:00Z'),
    level: 'INFO' as const,
    message: `line ${seq}`,
    meta: null,
  };
}

beforeEach(() => {
  calls.length = 0;
  mocks.runFindUnique.mockReset().mockImplementation(async () => {
    calls.push('run');
    return {
      id: 'run-1',
      status: 'RUNNING',
      startedAt: new Date('2026-11-11T03:00:00Z'),
      completedAt: null,
    };
  });
  mocks.logFindMany.mockReset().mockImplementation(async () => {
    calls.push('lines');
    return [line(4), line(5)];
  });
});

describe('DataSourcesController.runLogs', () => {
  it('is gated on data_sources:read', () => {
    expect(Reflect.getMetadata(PERMISSION_META, DataSourcesController.prototype.runLogs)).toBe(
      'data_sources:read',
    );
  });

  it('returns lines after afterSeq, status read first', async () => {
    const res = await controller.runLogs('run-1', { afterSeq: 3 });
    expect(calls).toEqual(['run', 'lines']);
    expect(mocks.logFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ingestionRunId: 'run-1', seq: { gt: 3 } },
        orderBy: { seq: 'asc' },
        take: RUN_LOG_PAGE_SIZE + 1,
      }),
    );
    expect(res).toMatchObject({
      runId: 'run-1',
      status: 'RUNNING',
      completedAt: null,
      hasMore: false,
      lines: [
        { seq: 4, message: 'line 4', ts: '2026-11-11T03:00:00.000Z' },
        { seq: 5, message: 'line 5' },
      ],
    });
  });

  it('flags hasMore and trims to one page', async () => {
    mocks.logFindMany.mockResolvedValueOnce(
      Array.from({ length: RUN_LOG_PAGE_SIZE + 1 }, (_, i) => line(i + 1)),
    );
    const res = await controller.runLogs('run-1', { afterSeq: 0 });
    expect(res.hasMore).toBe(true);
    expect(res.lines).toHaveLength(RUN_LOG_PAGE_SIZE);
  });

  it('404s on an unknown run', async () => {
    mocks.runFindUnique.mockResolvedValueOnce(null);
    await expect(controller.runLogs('nope', { afterSeq: 0 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
