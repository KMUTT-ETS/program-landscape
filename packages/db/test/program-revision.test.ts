import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  programFindUnique: vi.fn(),
  programUpdate: vi.fn(),
  revisionFindFirst: vi.fn(),
  revisionFindUnique: vi.fn(),
  revisionCreate: vi.fn(),
  revisionUpdate: vi.fn(),
  revisionCount: vi.fn(),
  documentFindFirst: vi.fn(),
}));

// NO vi.importActual spread — index.ts re-exports the module under test, so
// importActual loads the real graph bound to the real prisma and the mock is
// bypassed. That exact bug was found in health-score.test.ts on 2026-09-02:
// five tests were silently passing against the live database.
vi.mock('../src/index', () => {
  const client = {
    program: { findUnique: mocks.programFindUnique, update: mocks.programUpdate },
    programRevision: {
      findFirst: mocks.revisionFindFirst,
      findUnique: mocks.revisionFindUnique,
      create: mocks.revisionCreate,
      update: mocks.revisionUpdate,
      count: mocks.revisionCount,
    },
    programDocument: { findFirst: mocks.documentFindFirst },
    // Interactive transaction: hand the callback the same client so the
    // per-call assertions below see the writes made inside it.
    $transaction: (fn: (tx: typeof client) => Promise<unknown>) => fn(client),
  };
  return { prisma: client };
});

import {
  activeRevisionIdFor,
  programRevisionStaleness,
  openDraftRevision,
  adoptPendingRevision,
  markRevisionAnalysed,
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

  it('is NOT stale when the live revision has no source document to compare', async () => {
    // A revision can be opened before its มคอ.2 is attached (the schema makes
    // sourcePdfDocumentId nullable for exactly that). A null source cannot
    // prove supersession, so silence here is deliberate, not incidental — a
    // false positive would train operators to ignore the banner permanently.
    // Driven through the fall-through fetch (no opts) because that is the
    // query branch production takes; the injected-opts path is covered above.
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.revisionFindUnique.mockResolvedValue({ sourcePdfDocumentId: null });
    mocks.documentFindFirst.mockResolvedValue({
      pdfDocumentId: 'pdfNEW',
      attachedAt: new Date('2026-09-01'),
    });
    const r = await programRevisionStaleness('p1');
    expect(mocks.revisionFindUnique).toHaveBeenCalledOnce();
    expect(r.stale).toBe(false);
    expect(r.reason).toBe('none');
  });

  it('is NOT stale when the programme has no current curriculum document', async () => {
    // Nothing to compare against — do not invent staleness from absence.
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.documentFindFirst.mockResolvedValue(null);
    const r = await programRevisionStaleness('p1', { activeRevisionSourcePdfId: 'pdfOLD' });
    expect(r.stale).toBe(false);
  });

  it('is a first analysis when no revision for this programme has ever completed', async () => {
    // A brand-new programme opens a DRAFT revision at create time. There is
    // no previous document, so the banner must not claim one was replaced.
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
    mocks.revisionCount.mockResolvedValue(0);
    const r = await programRevisionStaleness('p1');
    expect(r.reason).toBe('unanalysed-revision');
    expect(r.isFirstAnalysis).toBe(true);
  });

  it('is NOT a first analysis when an earlier revision already completed', async () => {
    mocks.revisionFindFirst.mockResolvedValue({
      id: 'rev3',
      curriculumYearBE: 2568,
      createdAt: new Date('2026-09-02'),
    });
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.documentFindFirst.mockResolvedValue({
      pdfDocumentId: 'pdfNEW',
      attachedAt: new Date('2026-09-02'),
    });
    mocks.revisionCount.mockResolvedValue(1);
    const r = await programRevisionStaleness('p1');
    expect(r.reason).toBe('unanalysed-revision');
    expect(r.isFirstAnalysis).toBe(false);
  });
});

describe('adoptPendingRevision', () => {
  it('adopts the newest pending revision and moves it to ANALYSING', async () => {
    mocks.revisionFindFirst.mockResolvedValue({ id: 'revNEW' });
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: null });

    expect(await adoptPendingRevision('p1')).toBe('revNEW');
    expect(mocks.programUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { activeRevisionId: 'revNEW' },
    });
    // ANALYSING is still inside the pending set, so a run that dies
    // mid-flight leaves the programme visibly stale.
    expect(mocks.revisionUpdate).toHaveBeenCalledWith({
      where: { id: 'revNEW' },
      data: { status: 'ANALYSING' },
    });
  });

  it('supersedes the previously-active revision', async () => {
    mocks.revisionFindFirst.mockResolvedValue({ id: 'revNEW' });
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'revOLD' });

    await adoptPendingRevision('p1');
    expect(mocks.revisionUpdate).toHaveBeenCalledWith({
      where: { id: 'revOLD' },
      data: { status: 'SUPERSEDED' },
    });
  });

  it('does not supersede the already-active revision when it is the pending one', async () => {
    // Re-running against a revision still mid-analysis must not mark it
    // SUPERSEDED by itself.
    mocks.revisionFindFirst.mockResolvedValue({ id: 'revSAME' });
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'revSAME' });

    await adoptPendingRevision('p1');
    expect(mocks.revisionUpdate).not.toHaveBeenCalledWith({
      where: { id: 'revSAME' },
      data: { status: 'SUPERSEDED' },
    });
  });

  it('changes nothing for a programme with no revision at all', async () => {
    // The pre-feature baseline: ~300 programmes stay at NULL and their rows
    // stay unstamped. Deliberate, not a gap to retro-fit.
    mocks.revisionFindFirst.mockResolvedValue(null);

    expect(await adoptPendingRevision('p1')).toBeNull();
    expect(mocks.programUpdate).not.toHaveBeenCalled();
    expect(mocks.revisionUpdate).not.toHaveBeenCalled();
  });

  it('leaves an already-adopted revision live on a second run', async () => {
    // Second pipeline run: the revision is APPROVED so nothing is pending.
    // activeRevisionId MUST survive — clearing it would un-stamp every
    // subsequent write.
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'revLIVE' });

    expect(await adoptPendingRevision('p1')).toBeNull();
    expect(mocks.programUpdate).not.toHaveBeenCalled();
  });
});

describe('markRevisionAnalysed', () => {
  it('advances the revision to APPROVED with no approver', async () => {
    await markRevisionAnalysed('rev1');
    const arg = mocks.revisionUpdate.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; approvedAt: Date; approvedById?: string };
    };
    expect(arg.where).toEqual({ id: 'rev1' });
    expect(arg.data.status).toBe('APPROVED');
    expect(arg.data.approvedAt).toBeInstanceOf(Date);
    // APPROVED here means "live, by the act of analysis". No human signed
    // it off, so approvedById stays unset rather than being attributed.
    expect(arg.data.approvedById).toBeUndefined();
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
