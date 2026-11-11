import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { startOverDataset } from '../src/import/batches';
import { IMPORT_DATASETS } from '../src/import/registry';
import { runImportLoad, type ImportRunSource } from '../src/import/run';
import { importSourceMix } from '../src/import/source-mix';
import type { ImportDataset } from '../src/import/types';

// Throwaway fixture datasets of the same strategy kinds as the shipped ones
// (term-scoped like class-offerings, upsert like enrollment-metrics and
// faculties, programme-scoped like programme-courses). Rows are faculties
// with an `SMX-` code, so cleanup touches only what this test created.

const TERM = 'test-smx-term';
const FLAT = 'test-smx-flat';
const PROG = 'test-smx-prog';
const SLUGS = [TERM, FLAT, PROG];
const SOURCES = SLUGS.map((s) => `xlsx-${s}`);
const PARENT_SLUG = 'test-smx-parent-connector';

function fixture(slug: string, strategy: ImportDataset['strategy']): ImportDataset {
  return {
    slug,
    title: `${slug} fixture`,
    description: '',
    tier: 0,
    sheetName: 'Data',
    columns: [
      { header: 'Academic year', key: 'academicYear', type: 'integer', required: true, guide: 'y', example: '1999' },
      { header: 'Semester', key: 'semester', type: 'text', required: true, guide: 's', example: '1' },
      { header: 'Code', key: 'code', type: 'text', required: true, guide: 'c', example: 'A' },
    ],
    strategy,
    load: async ({ tx, ingestionRunId }, rows) => {
      let deleted = 0;
      if (strategy.kind === 'term-scoped') {
        const del = await tx.faculty.deleteMany({ where: { code: { startsWith: `SMX-${slug}-1999-` } } });
        deleted = del.count;
      }
      for (const r of rows) {
        const code = `SMX-${slug}-1999-${String(r.code)}`;
        await tx.faculty.upsert({
          where: { code },
          create: { code, nameTh: 'x', nameEn: 'x', ingestionRunId },
          update: { ingestionRunId },
        });
      }
      return { inserted: rows.length, updated: 0, deleted };
    },
    count: async (p) => p.faculty.count({ where: { code: { startsWith: `SMX-${slug}-` } } }),
    clear: async (tx, runIds) =>
      (await tx.faculty.deleteMany({ where: { code: { startsWith: `SMX-${slug}-` }, ingestionRunId: { in: [...runIds] } } })).count,
  };
}

const term = fixture(TERM, {
  kind: 'term-scoped',
  termColumns: ['academicYear', 'semester'],
  match: { kind: 'unique', columns: ['code'] },
});
const flat = fixture(FLAT, { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } });
const prog = fixture(PROG, {
  kind: 'programme-scoped',
  scopeColumns: ['semester'],
  match: { kind: 'unique', columns: ['code'] },
});

const registry = IMPORT_DATASETS as ImportDataset[];
const runIds: string[] = [];
let parentRunId = '';
let hashN = 0;

beforeAll(async () => {
  registry.push(term, flat, prog);
  for (const slug of SLUGS) {
    await prisma.dataSource.upsert({
      where: { slug: `xlsx-${slug}` },
      update: { mocked: false },
      create: { slug: `xlsx-${slug}`, name: `${slug} (institution import)`, kind: 'CSV', inputFormat: 'XLSX', mocked: false, scheduleEnabled: false, status: 'real' },
    });
  }
  await prisma.dataSource.upsert({
    where: { slug: PARENT_SLUG },
    update: {},
    create: { slug: PARENT_SLUG, name: 'Source mix test connector', kind: 'API', inputFormat: 'JSON', mocked: false, scheduleEnabled: false, status: 'real' },
  });
  const ds = await prisma.dataSource.findUniqueOrThrow({ where: { slug: PARENT_SLUG }, select: { id: true } });
  const parent = await prisma.ingestionRun.create({
    data: { dataSourceId: ds.id, trigger: 'MANUAL', status: 'RUNNING', startedAt: new Date(), attempt: 1 },
    select: { id: true },
  });
  parentRunId = parent.id;
  runIds.push(parentRunId);
});

afterAll(async () => {
  await prisma.faculty.deleteMany({ where: { code: { startsWith: 'SMX-' } } });
  await prisma.importBatch.deleteMany({ where: { datasetSlug: { in: SLUGS } } });
  await prisma.ingestionRun.deleteMany({
    where: { OR: [{ id: { in: runIds } }, { dataSource: { slug: { in: SOURCES } } }] },
  });
  await prisma.dataSource.deleteMany({ where: { slug: { in: [...SOURCES, PARENT_SLUG] } } });
  for (const d of [term, flat, prog]) registry.splice(registry.indexOf(d), 1);
});

const upload = (): ImportRunSource => ({
  via: 'upload',
  userId: null,
  batch: { filename: 'f.xlsx', contentHash: `test-smx-${++hashN}`, storageKey: 'k', fileSize: 5 },
});
const api = (): ImportRunSource => ({
  via: 'api',
  connectorSlug: 'api-test',
  connectorName: 'Test connector',
  parentRunId,
});
const T = { academicYear: 1999, semester: '1' };
const rowsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ academicYear: 1999, semester: '1', code: String(i) }));

describe('runImportLoad warnings and source mix', () => {
  it('term-scoped API load replaces an uploaded term and reports it', async () => {
    const first = await runImportLoad(term, rowsOf(3), upload(), T);
    runIds.push(first.runId);
    expect(first.warnings).toEqual([]);
    const second = await runImportLoad(term, rowsOf(2), api(), T);
    runIds.push(second.runId);
    expect(await term.count(prisma)).toBe(2);
    expect(second.warnings[0]).toMatch(/^Semester 1\/1999 was last loaded by an upload on \d{2} [A-Z][a-z]{2} \d{4}\. This load replaced it\.$/);
    // And back: the upload replaces the API term.
    const third = await runImportLoad(term, rowsOf(1), upload(), T);
    runIds.push(third.runId);
    expect(third.warnings[0]).toContain('Semester 1/1999 was last loaded by the API connector "Test connector" on ');
  });

  it('importSourceMix lists both sources and the newest writer per term', async () => {
    const mix = await importSourceMix(TERM);
    expect([...mix.sources].sort()).toEqual(['api', 'upload']);
    expect(mix.lastBy?.via).toBe('upload');
    expect(mix.perScope).toHaveLength(1);
    expect(mix.perScope[0]).toMatchObject({ label: 'Semester 1/1999', via: 'upload', connector: null });
    expect(mix.perScope[0]?.at).toBeInstanceOf(Date);
    expect((await importSourceMix(FLAT)).perScope).toEqual([]);
  });

  it('programme-scoped loads warn per scope label', async () => {
    const a = await runImportLoad(prog, rowsOf(1), upload(), undefined, [{ semester: '1' }]);
    runIds.push(a.runId);
    const b = await runImportLoad(prog, rowsOf(1), api(), undefined, [{ semester: '1' }]);
    runIds.push(b.runId);
    expect(b.warnings[0]).toMatch(/^1 was last loaded by an upload on /);
    expect((await importSourceMix(PROG)).perScope).toMatchObject([{ label: '1', via: 'api', connector: 'Test connector' }]);
  });

  it('start-over clears rows written by API import runs', async () => {
    await prisma.faculty.deleteMany({ where: { code: { startsWith: `SMX-${FLAT}-` } } });
    const out = await runImportLoad(flat, rowsOf(2), api());
    runIds.push(out.runId);
    expect(out.warnings).toEqual([]);
    const result = await startOverDataset(FLAT);
    expect(result.rowsDeleted).toBe(2);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: out.batchId } });
    expect(batch.status).toBe('CLEARED');
  });

  it('upsert dataset with both sources warns once', async () => {
    const a = await runImportLoad(flat, rowsOf(1), upload());
    runIds.push(a.runId);
    const b = await runImportLoad(flat, rowsOf(1), api());
    runIds.push(b.runId);
    expect(b.warnings).toEqual([
      'Rows in this dataset come from both uploads and the API connector "Test connector". A row may hold values from both.',
    ]);
    const c = await runImportLoad(flat, rowsOf(1), api());
    runIds.push(c.runId);
    expect(c.warnings).toHaveLength(1);
  });
});
