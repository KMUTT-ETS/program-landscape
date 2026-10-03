import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain object-literal mock of @kku/db — no vi.importActual spread, so nothing
// here can reach the live dev database. The pure helpers are imported straight
// from their source files, which have no prisma import.
const mocks = vi.hoisted(() => ({
  programFindMany: vi.fn(),
  aeFindMany: vi.fn(),
  ploFindMany: vi.fn(),
  ploDeleteMany: vi.fn(),
  ploCreateMany: vi.fn(),
  pcFindMany: vi.fn(),
  pcUpdate: vi.fn(),
  mpFindMany: vi.fn(),
  mpUpsert: vi.fn(),
  mpCount: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  writeVector: vi.fn(),
  activeRevisionIdFor: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const text = await import('../../../packages/db/src/program-overlap/text');
  const code = await import('../../../packages/db/src/course-code-normalise');
  return {
    ...text,
    ...code,
    EMBED_DIMENSIONS: 1536,
    IS_CANONICAL_PROGRAM: { sequenceNoFromSheet: { not: null } },
    writeVector: mocks.writeVector,
    activeRevisionIdFor: mocks.activeRevisionIdFor,
    prisma: {
      program: { findMany: mocks.programFindMany, count: vi.fn() },
      aiExtraction: { findMany: mocks.aeFindMany },
      programLearningOutcome: { findMany: mocks.ploFindMany, deleteMany: mocks.ploDeleteMany, createMany: mocks.ploCreateMany },
      programCourse: { findMany: mocks.pcFindMany, update: mocks.pcUpdate },
      programMarketProfile: { findMany: mocks.mpFindMany, upsert: mocks.mpUpsert, count: mocks.mpCount },
      $queryRaw: mocks.queryRaw,
      $executeRaw: mocks.executeRaw,
      $transaction: mocks.transaction,
    },
  };
});

import type { AiService } from '@kku/shared';
import { sha256 } from '../../../packages/db/src/program-overlap/text';
import { embedPending, loadPlos, runOverlapPrep } from '../src/program-overlap/prep';

const WRITES = [
  'ploDeleteMany',
  'ploCreateMany',
  'pcUpdate',
  'mpUpsert',
  'executeRaw',
  'transaction',
  'writeVector',
] as const;

function fakeAi(vectorLength = 1536): { ai: AiService; embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async (req: { texts: string[] }) => ({
    vectors: req.texts.map(() => Array.from({ length: vectorLength }, () => 1)),
    model: 'm',
    tokens: { input: 0, output: 0 },
    latencyMs: 0,
    cost: { usd: 0.001 },
    aiInferenceId: 'inf',
  }));
  return { ai: { embed } as unknown as AiService, embed };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.programFindMany.mockResolvedValue([
    { id: 'p1', nameTh: 'หลักสูตร', nameEn: 'Prog', degreeNameTh: null, degreeNameEn: null, recruitmentSummaryTh: null, careersThJson: ['อาชีพ'] },
    { id: 'p2', nameTh: 'หลักสูตร 2', nameEn: null, degreeNameTh: null, degreeNameEn: null, recruitmentSummaryTh: null, careersThJson: null },
  ]);
  mocks.activeRevisionIdFor.mockResolvedValue('rev1');
  mocks.aeFindMany.mockImplementation(async (args: { where: { extractionKind: string } }) =>
    args.where.extractionKind === 'PROGRAM_SKILLS_DETAILED'
      ? [{ id: 'x1', sourceEntityId: 'p1', payloadJson: { programLearningOutcomes: ['PLO 1 ก'] } }]
      : [{ sourceEntityId: 'p1', payloadJson: { courses: [{ code: 'EN 241 100', descriptionTh: 'ใหม่' }] } }],
  );
  // PLOs: p2 has stale rows (its extraction is gone); used for embedding too.
  mocks.ploFindMany.mockImplementation(async (args: { select: Record<string, boolean> }) =>
    'textNormalised' in args.select
      ? [
          { id: 'l1', textNormalised: 'current', embeddingTextHash: sha256('current') },
          { id: 'l2', textNormalised: 'stale', embeddingTextHash: 'old-hash' },
        ]
      : [{ programId: 'p2', sourceExtractionId: 'gone', programRevisionId: null }],
  );
  mocks.pcFindMany.mockResolvedValue([
    {
      id: 'c1',
      programId: 'p1',
      courseCode: 'EN241100',
      category: 'CORE',
      courseNameTh: 'วิชา',
      courseNameEn: null,
      descriptionTh: null,
      learningOutcomesTh: [],
      embeddingTextHash: null,
      credits: 3,
    },
  ]);
  mocks.mpFindMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([{ program_id: 'p1', text: 'profile' }]);
});

describe('dry run', () => {
  it('makes no model call and no write of any kind', async () => {
    const { ai, embed } = fakeAi();
    const r = await runOverlapPrep(ai, { apply: false });
    expect(embed).not.toHaveBeenCalled();
    for (const w of WRITES) expect(mocks[w], w).not.toHaveBeenCalled();
    // ...while still reporting what an apply would do.
    expect(r.plos.programmesRewritten).toBe(1);
    expect(r.plos.programmesCleared).toBe(1);
    expect(r.courseDescriptions.coursesUpdated).toBe(1);
    expect(r.marketProfiles.created).toBe(2);
    expect(r.embeddings.plos.pending).toBe(1);
  });
});

describe('embedPending', () => {
  it('does not re-embed a text whose stored hash matches', async () => {
    const { ai, embed } = fakeAi();
    const r = await embedPending(ai, { apply: true });
    const plosCall = embed.mock.calls.find((c) => c[0].ctx.kind === 'embedding.plo');
    expect(plosCall?.[0].texts).toEqual(['stale']);
    expect(r.plos).toEqual({ pending: 1, written: 1 });
    expect(mocks.writeVector).toHaveBeenCalledWith('program_learning_outcomes', 'l2', expect.any(Array), sha256('stale'));
    expect(mocks.writeVector).not.toHaveBeenCalledWith('program_learning_outcomes', 'l1', expect.anything(), expect.anything());
  });

  it('fails loudly on a vector of the wrong dimension', async () => {
    const { ai } = fakeAi(768);
    await expect(embedPending(ai, { apply: true })).rejects.toThrow(/1536/);
  });

  it('fails loudly when the provider returns fewer vectors than texts', async () => {
    const embed = vi.fn(async () => ({ vectors: [], model: 'm', tokens: { input: 0, output: 0 }, latencyMs: 0, cost: { usd: 0 }, aiInferenceId: 'i' }));
    await expect(embedPending({ embed } as unknown as AiService, { apply: true })).rejects.toThrow(/0 vectors for 1 texts/);
  });
});

describe('loadPlos', () => {
  it('clears stale PLO rows of a programme that no longer has a PLO source', async () => {
    mocks.transaction.mockResolvedValue([]);
    const r = await loadPlos({ apply: true });
    expect(r.programmesCleared).toBe(1);
    expect(mocks.ploDeleteMany).toHaveBeenCalledWith({ where: { programId: 'p2' } });
  });
});
