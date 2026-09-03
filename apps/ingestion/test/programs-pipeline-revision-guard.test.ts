import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma only — plain object literal, NO vi.importActual spread. That
// spread binds the real prisma and the test would silently hit the live
// database (see packages/db/test/health-score.test.ts, 2026-09-02: five
// tests had been passing against real data for weeks because of exactly
// this pattern).
const mocks = vi.hoisted(() => ({ reFindFirst: vi.fn(), crFindFirst: vi.fn() }));

vi.mock('@kku/db', () => ({
  prisma: {
    programResearchExpertise: { findFirst: mocks.reFindFirst },
    programCurriculumRevision: { findFirst: mocks.crFindFirst },
  },
}));

import { prisma } from '@kku/db';

// The guard, matching programs-pipeline.ts:613-616 in shape. runRevisionId
// is `string | null`, resolved via activeRevisionIdFor(program.id) at
// pipeline line 334, AFTER the revision is adopted at line 321.
async function hasCurrentExpertiseRow(programId: string, runRevisionId: string | null) {
  const existing = await prisma.programResearchExpertise.findFirst({
    where: { programId, programRevisionId: runRevisionId },
    select: { id: true },
  });
  return existing !== null;
}

describe('phaseRE revision-aware guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the run revision into the where-clause so a stale row cannot match', async () => {
    mocks.reFindFirst.mockResolvedValue(null);
    await hasCurrentExpertiseRow('p1', 'revNEW');
    expect(mocks.reFindFirst).toHaveBeenCalledWith({
      where: { programId: 'p1', programRevisionId: 'revNEW' },
      select: { id: true },
    });
  });

  it('queries for null on an unrevised programme, matching its null-provenance row', async () => {
    // 299 of 301 programmes are in this state. Prisma renders
    // `programRevisionId: null` as IS NULL, so the existing row matches and
    // the phase skips at $0 — the property that keeps an --all run's cost
    // unchanged by this feature.
    mocks.reFindFirst.mockResolvedValue({ id: 'existing' });
    const found = await hasCurrentExpertiseRow('p1', null);
    expect(mocks.reFindFirst).toHaveBeenCalledWith({
      where: { programId: 'p1', programRevisionId: null },
      select: { id: true },
    });
    expect(found).toBe(true);
  });

  it('reports absent when the only row belongs to a superseded revision', async () => {
    // findFirst filtered on revNEW returns nothing even though a row exists
    // under revOLD — which is precisely what makes the phase regenerate.
    mocks.reFindFirst.mockResolvedValue(null);
    expect(await hasCurrentExpertiseRow('p1', 'revNEW')).toBe(false);
  });
});
