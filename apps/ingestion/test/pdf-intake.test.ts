import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock Prisma + native extractor + storage. We're testing the PIPELINE
// logic: state transitions, extractor routing, confidence thresholds,
// dedup. Native PDF parsing has its own test.
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  pdfUpdate: vi.fn(),
  pageDeleteMany: vi.fn(),
  pageCreateMany: vi.fn(),
  extractionDeleteMany: vi.fn(),
  extractionCreate: vi.fn(),
  extractNative: vi.fn(),
  signedUrl: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  Prisma: { JsonNull: null, InputJsonValue: null },
  prisma: {
    pdfDocument: { findUnique: mocks.findUnique, update: mocks.pdfUpdate },
    pdfPage: { deleteMany: mocks.pageDeleteMany, createMany: mocks.pageCreateMany },
    pdfExtraction: { deleteMany: mocks.extractionDeleteMany, create: mocks.extractionCreate },
  },
}));

vi.mock('../src/pdf-intake/pipeline/native-text-extractor', () => ({
  extractNativeText: mocks.extractNative,
}));

import { PdfIntakePipeline } from '../src/pdf-intake/pipeline/runner';
import { StubClassifier } from '../src/pdf-intake/extractors';
import type { S3Storage } from '@kku/shared';

function makePipeline(thresholds = { classifier: 0.7, extractor: 0.8 }) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as unknown as typeof global.fetch;

  const fakeStorage: Partial<S3Storage> = {
    getSignedDownloadUrl: mocks.signedUrl.mockResolvedValue('https://minio.test/signed'),
  };

  return new PdfIntakePipeline({
    classifier: new StubClassifier(),
    storage: fakeStorage as S3Storage,
    rawBucket: 'pdf-raw',
    config: {
      classifierAutoApproveThreshold: thresholds.classifier,
      extractorAutoApproveThreshold: thresholds.extractor,
      chunkThresholdPages: 50,
    },
  });
}

const fakeDoc = (overrides: Partial<{
  processingStatus: string;
  sourceCategoryHint: string | null;
  sourceCategory: string;
  storageUrl: string;
  language: string;
  classificationConfidence: number | null;
  sourceOrg: string | null;
}> = {}) => ({
  id: 'pdf-1',
  originalFilename: 'test.pdf',
  storageUrl: 's3://pdf-raw/policy/abc.pdf',
  processingStatus: 'PENDING',
  sourceCategory: 'OTHER',
  sourceCategoryHint: null,
  sourceOrg: null,
  language: 'TH',
  classificationConfidence: null,
  ...overrides,
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.pdfUpdate.mockResolvedValue({});
  mocks.pageDeleteMany.mockResolvedValue({});
  mocks.pageCreateMany.mockResolvedValue({});
  mocks.extractionDeleteMany.mockResolvedValue({});
  mocks.extractionCreate.mockResolvedValue({});
  mocks.signedUrl.mockResolvedValue('https://minio.test/signed');
});

describe('PdfIntakePipeline', () => {
  it('skips processing when document is already PROCESSING (no double-write)', async () => {
    mocks.findUnique.mockResolvedValue(fakeDoc({ processingStatus: 'PROCESSING' }));

    const pipeline = makePipeline();
    const outcome = await pipeline.process('pdf-1');

    expect(outcome.extractionCount).toBe(0);
    expect(mocks.pdfUpdate).not.toHaveBeenCalled(); // didn't flip status
    expect(mocks.extractionCreate).not.toHaveBeenCalled();
  });

  it('routes every extraction to PENDING_REVIEW when stub classifier returns confidence 0', async () => {
    mocks.findUnique.mockResolvedValue(fakeDoc({ sourceCategoryHint: 'POLICY' }));
    mocks.extractNative.mockResolvedValue({
      pages: [{ pageNumber: 1, textContent: 'hello', hasImages: false, hasTables: false }],
      fullText: 'hello',
      isLikelyScanned: false,
      scannedScore: 0,
    });

    const pipeline = makePipeline();
    const outcome = await pipeline.process('pdf-1');

    // POLICY hint → StubClassifier returns confidence 0.5 → below the
    // classifier auto-approve threshold (0.7), so every extraction lands
    // in PENDING_REVIEW regardless of the extractor's own confidence.
    expect(outcome.classification.sourceCategory).toBe('POLICY');
    expect(outcome.autoApproved).toBe(0);
    expect(outcome.pendingReview).toBeGreaterThan(0);
    // PolicyDocExtractor applied; one extraction row created.
    expect(mocks.extractionCreate).toHaveBeenCalled();
    const createCall = mocks.extractionCreate.mock.calls[0]?.[0] as {
      data: { reviewStatus: string; extractionType: string };
    };
    expect(createCall.data.reviewStatus).toBe('PENDING_REVIEW');
    expect(createCall.data.extractionType).toBe('POLICY_DOC');
  });

  it('parks scanned PDFs in PROCESSING with an awaiting-OCR note', async () => {
    mocks.findUnique.mockResolvedValue(fakeDoc());
    mocks.extractNative.mockResolvedValue({
      pages: [{ pageNumber: 1, textContent: undefined, hasImages: true, hasTables: false }],
      fullText: '',
      isLikelyScanned: true,
      scannedScore: 1.0,
    });

    const pipeline = makePipeline();
    const outcome = await pipeline.process('pdf-1');

    expect(outcome.extractionCount).toBe(0);
    // The runner calls pdf.update TWICE: first to flip PENDING→PROCESSING,
    // then again to mark ocrApplied + processingError.
    const allCalls = mocks.pdfUpdate.mock.calls as Array<[{ data: { processingStatus?: string; processingError?: string } }]>;
    const terminal = allCalls[allCalls.length - 1]?.[0];
    expect(terminal?.data.processingStatus).toBe('PROCESSING');
    expect(terminal?.data.processingError).toMatch(/awaiting OCR/);
    expect(mocks.extractionCreate).not.toHaveBeenCalled();
  });

  it('marks COMPLETED and auto-approves when both confidences clear thresholds', async () => {
    mocks.findUnique.mockResolvedValue(fakeDoc({ sourceCategoryHint: 'POLICY' }));
    mocks.extractNative.mockResolvedValue({
      pages: [{ pageNumber: 1, textContent: 'hello world', hasImages: false, hasTables: false }],
      fullText: 'hello world',
      isLikelyScanned: false,
      scannedScore: 0,
    });

    // Tune thresholds so the stub classifier's 0.5 + stub extractor's 0
    // both clear — proves the routing logic respects thresholds as
    // configured.
    const pipeline = makePipeline({ classifier: 0.1, extractor: 0 });
    const outcome = await pipeline.process('pdf-1');

    expect(outcome.autoApproved).toBeGreaterThan(0);
    expect(outcome.pendingReview).toBe(0);

    const lastPdfUpdate = (mocks.pdfUpdate.mock.calls as Array<[{ data: { processingStatus?: string } }]>).at(-1)?.[0];
    expect(lastPdfUpdate?.data.processingStatus).toBe('COMPLETED');
  });
});
