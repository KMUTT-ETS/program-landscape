import { describe, expect, it, vi, beforeEach } from 'vitest';

// Prisma is mocked so the test doesn't hit a real DB. We only exercise
// tables this particular run touches — ingestion_runs, data_sources,
// pdf_documents. Mock fns live inside vi.hoisted() because vi.mock()
// is itself hoisted to the top of the file and cannot reference outer
// `let`/`const` without a TDZ error.
const mocks = vi.hoisted(() => ({
  pdfUpsert: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  dataSourceFindUnique: vi.fn(),
  dataSourceUpdate: vi.fn(),
}));
const { pdfUpsert, runCreate, runUpdate, dataSourceFindUnique, dataSourceUpdate } = mocks;

vi.mock('@kku/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    pdfDocument: { upsert: mocks.pdfUpsert },
    ingestionRun: { create: mocks.runCreate, update: mocks.runUpdate },
    dataSource: { findUnique: mocks.dataSourceFindUnique, update: mocks.dataSourceUpdate },
  },
}));

import { ConnectorRunner } from '../src/connectors/runner';
import { KkuRegistryConnector } from '../src/connectors/sources/kku-connectors';
import { NsoConnector } from '../src/connectors/sources/pdf-connectors';

const fakeDataSourceRow = (slug: string) => ({
  id: `ds-${slug}`,
  slug,
  name: `DataSource(${slug})`,
  baseUrl: null,
  lastSyncedAt: null,
});

describe('ConnectorRunner — end-to-end (mocked prisma)', () => {
  beforeEach(() => {
    pdfUpsert.mockReset();
    runCreate.mockReset();
    runUpdate.mockReset();
    dataSourceFindUnique.mockReset();
    dataSourceUpdate.mockReset();

    runCreate.mockResolvedValue({ id: 'run-123' });
    runUpdate.mockResolvedValue({});
    dataSourceUpdate.mockResolvedValue({});
    pdfUpsert.mockResolvedValue({ id: 'pdf-999' });
  });

  it('threads an API connector through healthCheck → fetch → transform → load, and writes SUCCEEDED', async () => {
    dataSourceFindUnique.mockResolvedValue(fakeDataSourceRow('kku-registry'));

    const connector = new KkuRegistryConnector();
    const registry = new Map([[connector.slug, connector]]);
    const runner = new ConnectorRunner(registry);

    const outcome = await runner.run({
      dataSourceSlug: 'kku-registry',
      trigger: 'MANUAL',
      triggeredByUserId: 'user-test',
    });

    expect(outcome.status).toBe('SUCCEEDED');
    // Mock connector returns 2 records, load() echoes recordsLoaded=2.
    expect(outcome.recordsLoaded).toBe(2);
    expect(runCreate).toHaveBeenCalledOnce();
    expect(runUpdate).toHaveBeenCalledOnce();
    const updateCall = runUpdate.mock.calls[0]?.[0] as {
      data: { status: string; recordsLoaded: number };
    };
    expect(updateCall.data.status).toBe('SUCCEEDED');
    expect(updateCall.data.recordsLoaded).toBe(2);
    // DataSource.lastSyncedAt bumped after success.
    expect(dataSourceUpdate).toHaveBeenCalledOnce();
  });

  it('PDF-flagged connector routes through PdfDocument.upsert instead of extracting', async () => {
    dataSourceFindUnique.mockResolvedValue(fakeDataSourceRow('nso-labor-force'));

    const connector = new NsoConnector();
    const registry = new Map([[connector.slug, connector]]);
    const runner = new ConnectorRunner(registry);

    const outcome = await runner.run({
      dataSourceSlug: 'nso-labor-force',
      trigger: 'SCHEDULED',
    });

    // The critical claim: a PDF connector must produce PdfDocument rows,
    // NOT call any domain-table upsert. If someone rewrites the base
    // class and breaks this, the test fails.
    expect(pdfUpsert).toHaveBeenCalled();
    const upsertCall = pdfUpsert.mock.calls[0]?.[0] as {
      create: { sourceCategory: string; processingStatus: string; language: string };
    };
    expect(upsertCall.create.sourceCategory).toBe('SURVEY');
    expect(upsertCall.create.processingStatus).toBe('PENDING');

    // Run row carries the PdfDocument id forward so the 03b pipeline
    // can correlate.
    const updateCall = runUpdate.mock.calls[0]?.[0] as {
      data: { status: string; pdfDocumentId: string | null };
    };
    expect(updateCall.data.pdfDocumentId).toBe('pdf-999');
    expect(outcome.status).toBe('SUCCEEDED');
  });
});
