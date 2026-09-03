import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @kku/db only — plain object literal, NO vi.importActual spread. That
// spread binds the real prisma and the test would silently hit the live
// development database (see packages/db/test/health-score.test.ts,
// 2026-09-02: five tests had been passing against real data for weeks
// because of exactly this pattern). See also
// test/programs-pipeline-revision-guard.test.ts, which this file mirrors.
const mocks = vi.hoisted(() => ({
  aeFindFirst: vi.fn(),
  aeCreate: vi.fn(),
  activeRevisionIdFor: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  prisma: {
    aiExtraction: { findFirst: mocks.aeFindFirst, create: mocks.aeCreate },
  },
  activeRevisionIdFor: mocks.activeRevisionIdFor,
}));

import { prisma, activeRevisionIdFor } from '@kku/db';

// The three phase-1 writers this guard shape is shared by (program-digest,
// program-faculty, program-skills) — see:
//   apps/ingestion/src/program-digest/run.ts:96-121, 199-213
//   apps/ingestion/src/program-faculty/run.ts:133-145, 340-346
//   apps/ingestion/src/program-skills/run.ts:94-105, 244-250
const EXTRACTION_KINDS = ['PROGRAM_DIGEST', 'PROGRAM_FACULTY_LIST', 'PROGRAM_SKILLS_DETAILED'] as const;

type Outcome =
  | { status: 'SKIPPED'; programRevisionId: string | null }
  | { status: 'SUCCEEDED'; aiExtractionId: string; programRevisionId: string | null };

// Mirrors the shared shape across all three run.ts files: resolve the active
// revision ONCE, use it in the skip-guard's where-clause, then stamp the
// SAME value on the created row. `force` bypasses the guard exactly like
// params.force in the real runners.
async function runPhase1Guard(
  programId: string,
  extractionKind: (typeof EXTRACTION_KINDS)[number],
  force = false,
): Promise<Outcome> {
  const programRevisionId = await activeRevisionIdFor(programId);

  if (!force) {
    const existing = await prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program',
        sourceEntityId: programId,
        extractionKind,
        programRevisionId,
      },
      select: { id: true },
    });
    if (existing) {
      return { status: 'SKIPPED', programRevisionId };
    }
  }

  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: programId,
      extractionKind,
      programRevisionId,
      payloadJson: {},
    },
    select: { id: true },
  });

  return { status: 'SUCCEEDED', aiExtractionId: created.id, programRevisionId };
}

describe('phase-1 revision-aware guard (program-digest / program-faculty / program-skills)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aeCreate.mockResolvedValue({ id: 'default-extraction' });
  });

  describe.each(EXTRACTION_KINDS)('%s', (extractionKind) => {
    it('passes the run revision into the where-clause alongside sourceEntityType/Id + extractionKind', async () => {
      mocks.activeRevisionIdFor.mockResolvedValue('revNEW');
      mocks.aeFindFirst.mockResolvedValue(null);

      await runPhase1Guard('p1', extractionKind);

      expect(mocks.aeFindFirst).toHaveBeenCalledWith({
        where: {
          sourceEntityType: 'program',
          sourceEntityId: 'p1',
          extractionKind,
          programRevisionId: 'revNEW',
        },
        select: { id: true },
      });
    });

    it('filters by an explicit extractionKind, not just sourceEntityType — guards against widening to all program rows', async () => {
      // A future edit that drops extractionKind from the where-clause would
      // sweep in every other AiExtraction row for this program, including
      // the 4,167 PROPOSED_SKILL rows that are a downstream artifact of a
      // digest rather than an extraction of the curriculum itself.
      mocks.activeRevisionIdFor.mockResolvedValue('revNEW');
      mocks.aeFindFirst.mockResolvedValue(null);

      await runPhase1Guard('p1', extractionKind);

      const where = mocks.aeFindFirst.mock.calls[0]![0].where;
      expect(where).toHaveProperty('extractionKind', extractionKind);
    });

    it('queries programRevisionId: null for an unrevised programme, matching its existing null-provenance row (skip, $0 cost)', async () => {
      // 299 of 301 programmes are in this state. Prisma renders
      // `programRevisionId: null` as IS NULL, so the pre-feature NULL row
      // matches and the phase skips — the property that keeps an --all run
      // cost-neutral. If this regressed, a full run would re-digest ~300
      // programmes at ~$0.04 each.
      mocks.activeRevisionIdFor.mockResolvedValue(null);
      mocks.aeFindFirst.mockResolvedValue({ id: 'existing-null-row' });

      const outcome = await runPhase1Guard('p1', extractionKind);

      expect(mocks.aeFindFirst).toHaveBeenCalledWith({
        where: {
          sourceEntityType: 'program',
          sourceEntityId: 'p1',
          extractionKind,
          programRevisionId: null,
        },
        select: { id: true },
      });
      expect(outcome.status).toBe('SKIPPED');
      expect(mocks.aeCreate).not.toHaveBeenCalled();
    });

    it('regenerates when the only existing row belongs to a superseded revision', async () => {
      // findFirst filtered on revNEW finds nothing even though a row exists
      // under revOLD (or NULL) — which is precisely what makes the phase
      // regenerate for a genuinely revised programme.
      mocks.activeRevisionIdFor.mockResolvedValue('revNEW');
      mocks.aeFindFirst.mockResolvedValue(null);
      mocks.aeCreate.mockResolvedValue({ id: 'new-extraction' });

      const outcome = await runPhase1Guard('p1', extractionKind);

      expect(outcome.status).toBe('SUCCEEDED');
      expect(mocks.aeCreate).toHaveBeenCalledTimes(1);
    });

    it('round-trip: the writer stamps the exact revision value the guard compared against', async () => {
      // This is the load-bearing test. Without the stamp, a revised
      // programme mismatches on the guard (correctly regenerates), but the
      // NEW row would also land with programRevisionId out of sync with
      // activeRevisionIdFor's current answer — mismatching again on the
      // very next run, forever, silently, at ~300 digests per full run.
      mocks.activeRevisionIdFor.mockResolvedValue('revNEW');
      mocks.aeFindFirst.mockResolvedValue(null);
      mocks.aeCreate.mockResolvedValue({ id: 'new-extraction' });

      await runPhase1Guard('p1', extractionKind);

      const guardedRevisionId = mocks.aeFindFirst.mock.calls[0]![0].where.programRevisionId;
      const stampedRevisionId = mocks.aeCreate.mock.calls[0]![0].data.programRevisionId;

      expect(stampedRevisionId).toBe('revNEW');
      expect(stampedRevisionId).toBe(guardedRevisionId);
    });

    it('force=true bypasses the guard read entirely but still stamps the current revision on write', async () => {
      mocks.activeRevisionIdFor.mockResolvedValue('revNEW');
      mocks.aeCreate.mockResolvedValue({ id: 'forced-extraction' });

      const outcome = await runPhase1Guard('p1', extractionKind, true);

      expect(mocks.aeFindFirst).not.toHaveBeenCalled();
      expect(outcome.status).toBe('SUCCEEDED');
      expect(mocks.aeCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ programRevisionId: 'revNEW' }) }),
      );
    });
  });
});
