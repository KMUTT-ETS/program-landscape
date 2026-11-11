import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { IMPORT_DATASETS } from '../src/import/registry';
import { prepareImportRows, type PrepareDeps } from '../src/import/prepare';
import { runImportLoad } from '../src/import/run';
import type { ImportDataset } from '../src/import/types';

// Exercises the shared validate-and-load path against the dev database with
// throwaway datasets of its own (never a shipped declaration).

const FLAT = 'test-run-flat';
const TERM = 'test-run-term';
const FLAT_SOURCE = `xlsx-${FLAT}`;
const TERM_SOURCE = `xlsx-${TERM}`;
const PARENT_SLUG = 'test-run-parent-connector';

const flat: ImportDataset = {
  slug: FLAT,
  title: 'Run fixture',
  description: '',
  tier: 0,
  sheetName: 'Data',
  columns: [{ header: 'Code', key: 'code', type: 'text', required: true, guide: 'the code', example: 'A' }],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } },
  load: async (_ctx, rows) => ({ inserted: rows.length, updated: 0, deleted: 0 }),
  count: async () => 0,
  clear: async () => 0,
};

// Mirrors class-offerings' term columns without touching its table.
const termScoped: ImportDataset = {
  ...flat,
  slug: TERM,
  title: 'Term fixture',
  columns: [
    { header: 'Academic year', key: 'academicYear', type: 'integer', required: true, guide: 'year', example: '2025' },
    { header: 'Semester', key: 'semester', type: 'text', required: true, guide: 'term', example: '1' },
    { header: 'Code', key: 'code', type: 'text', required: true, guide: 'the code', example: 'A' },
  ],
  strategy: {
    kind: 'term-scoped',
    termColumns: ['academicYear', 'semester'],
    match: { kind: 'unique', columns: ['code'] },
  },
};

const registry = IMPORT_DATASETS as ImportDataset[];
const runIds: string[] = [];
let parentRunId = '';

async function ensureSource(slug: string, name: string): Promise<void> {
  await prisma.dataSource.upsert({
    where: { slug },
    update: { mocked: false },
    create: { slug, name, kind: 'CSV', inputFormat: 'XLSX', mocked: false, scheduleEnabled: false, status: 'real' },
  });
}

beforeAll(async () => {
  registry.push(flat, termScoped);
  await ensureSource(FLAT_SOURCE, 'Run fixture (institution import)');
  await ensureSource(TERM_SOURCE, 'Term fixture (institution import)');
  await prisma.dataSource.upsert({
    where: { slug: PARENT_SLUG },
    update: {},
    create: { slug: PARENT_SLUG, name: 'Test connector', kind: 'API', inputFormat: 'JSON', mocked: false, scheduleEnabled: false, status: 'real' },
  });
  const ds = await prisma.dataSource.findUniqueOrThrow({ where: { slug: PARENT_SLUG }, select: { id: true } });
  const parent = await prisma.ingestionRun.create({
    data: { dataSourceId: ds.id, trigger: 'SCHEDULED', status: 'RUNNING', startedAt: new Date(), attempt: 1 },
    select: { id: true },
  });
  parentRunId = parent.id;
  runIds.push(parentRunId);
});

afterAll(async () => {
  await prisma.importBatch.deleteMany({ where: { datasetSlug: { in: [FLAT, TERM] } } });
  await prisma.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.dataSource.deleteMany({ where: { slug: { in: [FLAT_SOURCE, TERM_SOURCE, PARENT_SLUG] } } });
  registry.splice(registry.indexOf(flat), 1);
  registry.splice(registry.indexOf(termScoped), 1);
});

const api = (): { via: 'api'; connectorSlug: string; connectorName: string; parentRunId: string } => ({
  via: 'api',
  connectorSlug: 'api-test',
  connectorName: 'Test connector',
  parentRunId,
});

describe('runImportLoad', () => {
  it('with via upload writes run metadata { via: upload } and a SUCCEEDED batch', async () => {
    const out = await runImportLoad(flat, [{ code: 'A' }], {
      via: 'upload',
      userId: null,
      batch: { filename: 'f.xlsx', contentHash: 'test-run-upload-hash', storageKey: 'k', fileSize: 5 },
    });
    runIds.push(out.runId);
    const run = await prisma.ingestionRun.findUniqueOrThrow({
      where: { id: out.runId },
      select: { metadata: true, trigger: true, status: true },
    });
    expect(run.metadata).toEqual({ via: 'upload' });
    expect(run.trigger).toBe('MANUAL');
    expect(run.status).toBe('SUCCEEDED');
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: out.batchId } });
    expect(batch.status).toBe('SUCCEEDED');
  });

  it('with via api writes an api batch', async () => {
    const out = await runImportLoad(flat, [{ code: 'A' }], api());
    runIds.push(out.runId);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: out.batchId } });
    expect(batch.filename).toBe('API: Test connector');
    expect(batch.contentHash).toBe(`api-run:${out.runId}`);
    expect(batch.storageKey).toBe('');
    expect(batch.fileSize).toBe(0);
    expect(batch.uploadedByUserId).toBeNull();
    const run = await prisma.ingestionRun.findUniqueOrThrow({
      where: { id: out.runId },
      select: { metadata: true, trigger: true },
    });
    expect(run.metadata).toEqual({ via: 'api', connector: 'api-test', parentRunId });
    // The parent connector run was scheduled, so its child inherits that.
    expect(run.trigger).toBe('SCHEDULED');
  });

  it('two identical api loads both succeed', async () => {
    const a = await runImportLoad(flat, [{ code: 'A' }], api());
    const b = await runImportLoad(flat, [{ code: 'A' }], api());
    runIds.push(a.runId, b.runId);
    expect(a.batchId).not.toBe(b.batchId);
    const batches = await prisma.importBatch.findMany({ where: { id: { in: [a.batchId, b.batchId] } } });
    expect(batches.map((x) => x.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
  });

  it('a term-scoped load records the term in run metadata', async () => {
    const out = await runImportLoad(termScoped, [{ academicYear: 1999, semester: '1', code: 'A' }], api(), {
      academicYear: 1999,
      semester: '1',
    });
    runIds.push(out.runId);
    const run = await prisma.ingestionRun.findUniqueOrThrow({ where: { id: out.runId }, select: { metadata: true } });
    expect(run.metadata).toMatchObject({ term: { academicYear: 1999, semester: '1' } });
  });
});

describe('prepareImportRows', () => {
  const sheet = (n: number) => ({
    sheetName: 'Data',
    headers: ['Academic year', 'Semester', 'Code'],
    rows: Array.from({ length: n }, (_, i) => ({ 'Academic year': 1999, Semester: '1', Code: `C${i}` })),
  });
  const deps: PrepareDeps = {
    loadReferences: async () => new Map(),
    heldCount: async () => 10,
    // Only a deleting strategy (term-scoped here) refuses a shrink.
    heldCountForTerm: async () => 10,
    heldCountForScope: async () => undefined,
  };

  it('refuses a shrink unless allowShrink', async () => {
    const refused = await prepareImportRows(termScoped, sheet(2), { allowShrink: false, maxRows: 100 }, deps);
    expect(refused.ok).toBe(false);
    const allowed = await prepareImportRows(termScoped, sheet(2), { allowShrink: true, maxRows: 100 }, deps);
    expect(allowed.ok).toBe(true);
  });
});
