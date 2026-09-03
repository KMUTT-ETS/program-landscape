import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  programFindUnique: vi.fn(),
  revisionFindFirst: vi.fn(),
  revisionFindUnique: vi.fn(),
  revisionCreate: vi.fn(),
  documentFindFirst: vi.fn(),
}));

// NO vi.importActual spread — index.ts re-exports the module under test, so
// importActual loads the real graph bound to the real prisma and the mock is
// bypassed. That exact bug was found in health-score.test.ts on 2026-09-02:
// five tests were silently passing against the live database.
vi.mock('../src/index', () => ({
  prisma: {
    program: { findUnique: mocks.programFindUnique },
    programRevision: {
      findFirst: mocks.revisionFindFirst,
      findUnique: mocks.revisionFindUnique,
      create: mocks.revisionCreate,
    },
    programDocument: { findFirst: mocks.documentFindFirst },
  },
}));

import {
  activeRevisionIdFor,
  programRevisionStaleness,
  openDraftRevision,
} from '../src/program-revision';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('activeRevisionIdFor', () => {
  it('returns the programme active revision id', async () => {
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    expect(await activeRevisionIdFor('p1')).toBe('rev1');
  });

  it('returns null for a pre-feature programme', async () => {
    // NULL is meaningful — it is the baseline, not an error.
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: null });
    expect(await activeRevisionIdFor('p1')).toBeNull();
  });

  it('returns null rather than throwing when the programme is missing', async () => {
    // Every caller is a write path mid-pipeline. A run referencing a
    // nonexistent programme will fail on its own FK with a better message
    // than anything this helper could raise.
    mocks.programFindUnique.mockResolvedValue(null);
    expect(await activeRevisionIdFor('nope')).toBeNull();
  });
});

describe('programRevisionStaleness', () => {
  it('is stale when an un-analysed revision is pending', async () => {
    mocks.revisionFindFirst.mockResolvedValue({
      id: 'rev2',
      curriculumYearBE: 2567,
      createdAt: new Date('2026-09-01'),
    });
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: null });
    mocks.documentFindFirst.mockResolvedValue({
      pdfDocumentId: 'pdfNEW',
      attachedAt: new Date('2026-09-01'),
    });
    const r = await programRevisionStaleness('p1');
    expect(r.stale).toBe(true);
    expect(r.reason).toBe('unanalysed-revision');
    expect(r.pendingRevisionId).toBe('rev2');
    expect(r.pendingCurriculumYearBE).toBe(2567);
  });

  it('is stale when the live analyses came from a superseded document', async () => {
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.documentFindFirst.mockResolvedValue({
      pdfDocumentId: 'pdfNEW',
      attachedAt: new Date('2026-09-01'),
    });
    const r = await programRevisionStaleness('p1', { activeRevisionSourcePdfId: 'pdfOLD' });
    expect(r.stale).toBe(true);
    expect(r.reason).toBe('superseded-document');
  });

  it('is NOT stale for a pre-feature programme with no revision at all', async () => {
    // Flagging all ~300 programmes on day one would train operators to
    // ignore the banner. Un-revisioned is not the same as stale.
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: null });
    mocks.documentFindFirst.mockResolvedValue({
      pdfDocumentId: 'pdfONLY',
      attachedAt: new Date('2026-01-01'),
    });
    const r = await programRevisionStaleness('p1');
    expect(r.stale).toBe(false);
    expect(r.reason).toBe('none');
  });

  it('is NOT stale when the live revision matches the current document', async () => {
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.documentFindFirst.mockResolvedValue({
      pdfDocumentId: 'pdfSAME',
      attachedAt: new Date('2026-01-01'),
    });
    const r = await programRevisionStaleness('p1', { activeRevisionSourcePdfId: 'pdfSAME' });
    expect(r.stale).toBe(false);
  });

  it('is NOT stale when the programme has no current curriculum document', async () => {
    // Nothing to compare against — do not invent staleness from absence.
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.documentFindFirst.mockResolvedValue(null);
    const r = await programRevisionStaleness('p1', { activeRevisionSourcePdfId: 'pdfOLD' });
    expect(r.stale).toBe(false);
  });
});

describe('openDraftRevision', () => {
  it('creates a draft when none is open for that document', async () => {
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.revisionCreate.mockResolvedValue({ id: 'revNEW' });
    const r = await openDraftRevision({
      programId: 'p1',
      sourcePdfDocumentId: 'pdf1',
      curriculumYearBE: 2567,
    });
    expect(r).toEqual({ id: 'revNEW', created: true });
    expect(mocks.revisionCreate).toHaveBeenCalledOnce();
  });

  it('is idempotent — re-attaching the same document opens no second draft', async () => {
    mocks.revisionFindFirst.mockResolvedValue({ id: 'revEXISTING' });
    const r = await openDraftRevision({ programId: 'p1', sourcePdfDocumentId: 'pdf1' });
    expect(r).toEqual({ id: 'revEXISTING', created: false });
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });
});
