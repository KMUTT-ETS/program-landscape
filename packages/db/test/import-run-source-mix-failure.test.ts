import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../src';
import { runImportLoad } from '../src/import/run';
import type { ImportDataset } from '../src/import/types';

// The source-mix read is advice, not a gate: a failure there must not abort
// (or orphan) an otherwise good load. Uses a throwaway dataset of its own.

vi.mock('../src/import/source-mix', async () => {
  const actual = await vi.importActual<typeof import('../src/import/source-mix')>(
    '../src/import/source-mix',
  );
  return {
    ...actual,
    readSourceMix: async (): Promise<never> => {
      throw new Error('source mix unavailable');
    },
  };
});

const SLUG = 'test-run-mixfail';
const SOURCE = `xlsx-${SLUG}`;

const fixture: ImportDataset = {
  slug: SLUG,
  title: 'Mix failure fixture',
  description: '',
  tier: 0,
  sheetName: 'Data',
  columns: [
    { header: 'Code', key: 'code', type: 'text', required: true, guide: 'c', example: 'A' },
  ],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } },
  load: async (_ctx, rows) => ({ inserted: rows.length, updated: 0, deleted: 0 }),
  count: async () => 0,
  clear: async () => 0,
};

let runId: string | undefined;

beforeAll(async () => {
  await prisma.dataSource.upsert({
    where: { slug: SOURCE },
    update: { mocked: false },
    create: {
      slug: SOURCE,
      name: 'Mix failure fixture (institution import)',
      kind: 'CSV',
      inputFormat: 'XLSX',
      mocked: false,
      scheduleEnabled: false,
      status: 'real',
    },
  });
});

afterAll(async () => {
  await prisma.importBatch.deleteMany({ where: { datasetSlug: SLUG } });
  if (runId) await prisma.ingestionRun.deleteMany({ where: { id: runId } });
  await prisma.dataSource.deleteMany({ where: { slug: SOURCE } });
});

describe('runImportLoad when the source-mix read fails', () => {
  it('still loads, with no warnings, and logs only the dataset and error name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = await runImportLoad(fixture, [{ code: 'A' }], {
      via: 'upload',
      userId: null,
      batch: {
        filename: 'x.xlsx',
        contentHash: 'test-run-mixfail-hash',
        storageKey: '',
        fileSize: 1,
      },
    });
    runId = out.runId;
    expect(out.warnings).toEqual([]);
    expect(out.result.inserted).toBe(1);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain(SLUG);
    expect(logged).toContain('Error');
    expect(logged).not.toContain('source mix unavailable');
    warn.mockRestore();
  });
});
