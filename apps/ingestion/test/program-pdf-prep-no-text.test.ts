import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../src/pdf-intake/pipeline/native-text-extractor', () => ({
  extractNativeText: mocks.extract,
}));
vi.mock('@kku/db', () => ({
  prisma: { program: { findUnique: mocks.findUnique } },
}));

import { loadProgramPdfPrep, pdfNoTextReason } from '../src/program-pdf-prep/load';

const NO_TEXT_REASON =
  'The curriculum PDF has no extractable text (scanned or image-only). OCR is not supported; upload a text PDF or load the course list spreadsheet.';

const storage = { getSignedDownloadUrl: vi.fn(async () => 'http://example.test/x.pdf') };

function prep(fullText: string, isLikelyScanned: boolean, pageCount = 0) {
  return { pages: Array.from({ length: pageCount }, () => ({})), fullText, isLikelyScanned, scannedScore: isLikelyScanned ? 1 : 0 };
}

describe('loadProgramPdfPrep NO_TEXT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: 'p1',
      documents: [{ pdfDocument: { id: 'd1', storageUrl: 's3://bucket/key.pdf' } }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );
  });

  it('returns NO_TEXT when the extractor flags the PDF as scanned and chars per page are low', async () => {
    mocks.extract.mockResolvedValue(prep('x'.repeat(5000), true, 50));
    const out = await loadProgramPdfPrep({ programId: 'p1', storage: storage as never });
    expect(out).toEqual({ status: 'NO_TEXT', reason: NO_TEXT_REASON });
  });

  it('returns NO_TEXT when the text is shorter than 2000 characters', async () => {
    mocks.extract.mockResolvedValue(prep('x'.repeat(1999), false));
    const out = await loadProgramPdfPrep({ programId: 'p1', storage: storage as never });
    expect(out).toEqual({ status: 'NO_TEXT', reason: NO_TEXT_REASON });
  });

  it('returns SUCCEEDED for a normal text PDF', async () => {
    mocks.extract.mockResolvedValue(prep('x'.repeat(2000), false));
    const out = await loadProgramPdfPrep({ programId: 'p1', storage: storage as never });
    expect(out.status).toBe('SUCCEEDED');
  });
});

describe('pdfNoTextReason', () => {
  it('is null for readable text and the reason otherwise', () => {
    expect(pdfNoTextReason(prep('x'.repeat(3000), false))).toBeNull();
    expect(pdfNoTextReason(prep('   ', false))).toBe(NO_TEXT_REASON);
  });
  it('gates on volume: 2000 chars boundary', () => {
    expect(pdfNoTextReason(prep('x'.repeat(1999), false))).toBe(NO_TEXT_REASON);
    expect(pdfNoTextReason(prep('x'.repeat(2000), false))).toBeNull();
    expect(pdfNoTextReason(prep('x'.repeat(1999), true, 1))).toBe(NO_TEXT_REASON);
  });
  it('scanned-flagged: 200 chars per page boundary', () => {
    // 10 pages: 2000 chars = 200/page passes, 1990 chars fails on volume
    expect(pdfNoTextReason(prep('x'.repeat(2000), true, 10))).toBeNull();
    // 20 pages: 3980 chars = 199/page fails
    expect(pdfNoTextReason(prep('x'.repeat(3980), true, 20))).toBe(NO_TEXT_REASON);
    expect(pdfNoTextReason(prep('x'.repeat(4000), true, 20))).toBeNull();
  });
  it('a mostly-scanned document with ample text is processed', () => {
    expect(pdfNoTextReason(prep('x'.repeat(30000), true, 100))).toBeNull();
  });
});
