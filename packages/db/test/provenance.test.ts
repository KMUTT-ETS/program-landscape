import { describe, expect, it, vi, beforeEach } from 'vitest';

// Prisma mocked — provenance queries the DB and we want to assert on
// the shape of what getProvenance returns. vi.mock is hoisted to the
// top of the file, so the mock fns must be declared via vi.hoisted
// (which is also hoisted) to avoid a TDZ error.
const mocks = vi.hoisted(() => ({
  pdfFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  runFindMany: vi.fn(),
  sourceFindUnique: vi.fn(),
}));
const { pdfFindUnique, runFindFirst, runFindMany, sourceFindUnique } = mocks;

vi.mock('../src/index', async () => {
  const actual = await vi.importActual<typeof import('../src/index')>('../src/index');
  return {
    ...actual,
    prisma: {
      pdfDocument: { findUnique: mocks.pdfFindUnique },
      ingestionRun: { findFirst: mocks.runFindFirst, findMany: mocks.runFindMany },
      dataSource: { findUnique: mocks.sourceFindUnique },
    },
  };
});

import { getProvenance } from '../src/provenance';

describe('getProvenance', () => {
  beforeEach(() => {
    pdfFindUnique.mockReset();
    runFindFirst.mockReset();
    runFindMany.mockReset();
    sourceFindUnique.mockReset();
  });

  it('returns the IngestionRun-linked source for a pdf_document', async () => {
    pdfFindUnique.mockResolvedValue({
      id: 'pdf-1',
      sourceOrg: 'NSO',
      uploadedAt: new Date('2026-04-01'),
    });
    runFindFirst.mockResolvedValue({
      completedAt: new Date('2026-04-10'),
      createdAt: new Date('2026-04-10'),
      dataSource: {
        id: 'ds-1',
        slug: 'nso-labor-force',
        name: 'NSO Labor Force Survey',
        lastSyncedAt: new Date('2026-04-10'),
      },
    });

    const chain = await getProvenance('pdf_document', 'pdf-1');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({
      sourceSlug: 'nso-labor-force',
      sourceName: 'NSO Labor Force Survey',
      sourcePdfId: 'pdf-1',
    });
  });

  it('falls back to sourceOrg text when no IngestionRun recorded the PDF', async () => {
    pdfFindUnique.mockResolvedValue({
      id: 'pdf-2',
      sourceOrg: 'Manual upload — analyst team',
      uploadedAt: new Date('2026-03-15'),
    });
    runFindFirst.mockResolvedValue(null);

    const chain = await getProvenance('pdf_document', 'pdf-2');
    expect(chain).toHaveLength(1);
    expect(chain[0]?.sourceSlug).toBe('manual');
    expect(chain[0]?.sourceName).toBe('Manual upload — analyst team');
  });

  it('returns the DataSource itself for entityType=data_source', async () => {
    sourceFindUnique.mockResolvedValue({
      id: 'ds-2',
      slug: 'jobthai',
      name: 'JobThai',
      lastSyncedAt: new Date('2026-04-22'),
    });
    const chain = await getProvenance('data_source', 'ds-2');
    expect(chain[0]?.sourceSlug).toBe('jobthai');
  });

  it('returns empty for a missing pdf_document rather than throwing', async () => {
    pdfFindUnique.mockResolvedValue(null);
    const chain = await getProvenance('pdf_document', 'pdf-missing');
    expect(chain).toEqual([]);
  });
});
