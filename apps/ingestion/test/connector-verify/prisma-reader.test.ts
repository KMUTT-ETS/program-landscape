import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getImportDataset, prisma } from '@kku/db';

import { createPrismaReader } from '../../src/scripts/connector-verify/prisma-reader';
import { DATASET_VISIBILITY } from '../../src/scripts/connector-verify/visibility';

// Runs against the dev database, like dataset-api-connector.test.ts, with
// test-only slugs and codes (prefix vtest-/VTEST-), and removes exactly what
// it created.

const REAL_SRC = 'vtest-real-source';
const MOCK_SRC = 'vtest-mocked-source';
const CODES = ['VTEST-F1', 'VTEST-F2', 'VTEST-F3'];

const ids = { realRunOld: '', realRun: '', mockRun: '' };

async function source(slug: string, mocked: boolean): Promise<string> {
  const row = await prisma.dataSource.create({
    data: {
      slug,
      name: `${slug} (test)`,
      kind: 'CSV',
      inputFormat: 'XLSX',
      mocked,
      scheduleEnabled: false,
      status: mocked ? 'mocked' : 'real',
    },
  });
  return row.id;
}

describe('createPrismaReader', () => {
  beforeAll(async () => {
    await prisma.faculty.deleteMany({ where: { code: { in: CODES } } });
    await prisma.dataSource.deleteMany({ where: { slug: { in: [REAL_SRC, MOCK_SRC] } } });
    const realId = await source(REAL_SRC, false);
    const mockId = await source(MOCK_SRC, true);
    ids.realRunOld = (
      await prisma.ingestionRun.create({
        data: { dataSourceId: realId, status: 'SUCCEEDED', createdAt: new Date('2026-01-01T00:00:00Z') },
      })
    ).id;
    ids.realRun = (
      await prisma.ingestionRun.create({
        data: { dataSourceId: realId, status: 'SUCCEEDED', metadata: { datasets: {} } },
      })
    ).id;
    ids.mockRun = (await prisma.ingestionRun.create({ data: { dataSourceId: mockId, status: 'SUCCEEDED' } })).id;
    await prisma.faculty.createMany({
      data: [
        { code: CODES[0] as string, nameTh: 'คณะทดสอบหนึ่ง', nameEn: 'Test One', ingestionRunId: ids.realRun },
        { code: CODES[1] as string, nameTh: 'คณะทดสอบสอง', nameEn: 'Test Two', ingestionRunId: ids.realRun },
        { code: CODES[2] as string, nameTh: 'คณะทดสอบสาม', nameEn: 'Test Three', ingestionRunId: ids.mockRun },
      ],
    });
  });

  afterAll(async () => {
    await prisma.faculty.deleteMany({ where: { code: { in: CODES } } });
    await prisma.ingestionRun.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.dataSource.deleteMany({ where: { slug: { in: [REAL_SRC, MOCK_SRC] } } });
  });

  const reader = createPrismaReader(prisma);

  it('dataSources returns slug, mocked and baseUrl for the named slugs only', async () => {
    const rows = await reader.dataSources([REAL_SRC, MOCK_SRC, 'vtest-absent']);
    expect([...rows].sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: MOCK_SRC, mocked: true, baseUrl: null },
      { slug: REAL_SRC, mocked: false, baseUrl: null },
    ]);
  });

  it('latestRun returns the newest run', async () => {
    const run = await reader.latestRun(REAL_SRC);
    expect(run?.id).toBe(ids.realRun);
    expect(run?.metadata).toEqual({ datasets: {} });
  });

  it('latestRun returns null for a source with no runs', async () => {
    expect(await reader.latestRun('vtest-absent')).toBeNull();
  });

  it('rowCounts counts stamped and visible rows', async () => {
    expect(await reader.rowCounts('faculties', ids.realRun)).toEqual({ stamped: 2, visible: 2, linked: null });
  });

  it('rowCounts shows hidden rows for a mocked source', async () => {
    expect(await reader.rowCounts('faculties', ids.mockRun)).toEqual({ stamped: 1, visible: 0, linked: null });
  });

  it('rowCounts returns null for a dataset without an entry', async () => {
    expect(await reader.rowCounts('population-projections', ids.realRun)).toBeNull();
  });
});

describe('DATASET_VISIBILITY', () => {
  it('every key is an import dataset', () => {
    for (const key of Object.keys(DATASET_VISIBILITY)) {
      expect(() => getImportDataset(key)).not.toThrow();
    }
  });

  it('covers the datasets the Deep-Dive reads first', () => {
    expect(Object.keys(DATASET_VISIBILITY).sort()).toEqual(
      [
        'admission-campaigns',
        'class-offerings',
        'departments',
        'enrollment-metrics',
        'faculties',
        'faculty-members',
        'financial-metrics',
        'graduate-outcomes',
        'programmes',
      ].sort(),
    );
  });
});
