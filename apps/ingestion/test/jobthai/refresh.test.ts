import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regression coverage for the 2026-09-21 follow-up to the run-attribution
// defect: refreshJobThaiDerived() used to spend a SINGLE runId on both the
// field taxonomy (which legitimately wants the broadened any-demand-source
// run) and program_jobthai_links (which must be jobthai-scoped only). This
// suite drives refreshJobThaiDerived() through its real implementation with
// every dependency mocked down to a single planned link, so we can inspect
// exactly which runId `programJobThaiLink.createMany` and `refreshJobFields`
// each received.
const mocks = vi.hoisted(() => {
  const program = { id: 'p1', code: 'KKU-SEQ-0001', nameTh: 'ทดสอบ', nameEn: 'Test Programme', level: 'BACHELOR' };
  const occupation = { id: 'occ1', category: 'CAT', subcategory: 'SUB', code: 'CAT|SUB', postingCount: 100, skills: [] };
  return {
    prisma: {
      jobPosting: { findMany: vi.fn().mockResolvedValue([]) },
      jobThaiOccupation: {
        findMany: vi.fn().mockResolvedValue([occupation]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      jobThaiOccupationSkill: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn() },
      jobPostingSkill: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn() },
      skill: { findMany: vi.fn().mockResolvedValue([]) },
      skillAlias: { findMany: vi.fn().mockResolvedValue([]) },
      program: { findMany: vi.fn().mockResolvedValue([program]) },
      programSkill: { findMany: vi.fn().mockResolvedValue([]) },
      programJobThaiLink: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
    loadReviewedFieldVocabulary: vi
      .fn()
      .mockResolvedValue({ vocabulary: { approvedFieldByRawString: new Map() }, cappedFieldIds: [] }),
    refreshJobFields: vi.fn().mockResolvedValue({
      taxonomy: { batches: 0, creates: 0, synonymAdds: 0, dropped: 0 },
      assignments: { rule: 0, ai: 0 },
      applied: true,
    }),
  };
});

vi.mock('@kku/db', () => ({
  prisma: mocks.prisma,
  // combineLinkSources always yields exactly one link per programme x
  // occupation pair — the minimum needed to exercise writeJobThaiLinks'
  // createMany call, so we can inspect the runId it wrote.
  combineLinkSources: vi.fn(() => ({ linkSource: 'field-of-study', score: 0.8 })),
  eligiblePostingLevels: vi.fn(() => ['BACHELOR']),
  matchFieldToProgramme: vi.fn(() => false),
  scoreFieldOfStudyLink: vi.fn(() => 0.8),
  scoreSkillOverlapLink: vi.fn(() => 0),
  distinctiveDemand: vi.fn(() => ({ demandedByOccupation: new Map(), generic: new Set() })),
  skillOverlapCounts: vi.fn(() => ({ sharedSkills: 0, taughtSkills: 0 })),
  matchedPostingCounts: vi.fn(() => ({ matchedPostings: 25, eligiblePostings: 25, matchedFields: [] })),
  fieldMatchesProgramme: vi.fn(() => false),
  loadReviewedFieldVocabulary: mocks.loadReviewedFieldVocabulary,
  JOBTHAI_BRIDGE_VERSION: 'jobthai-bridge.v3',
  JOBTHAI_MIN_POSTINGS_FOR_SIGNAL: 20,
  MAX_PROGRAMMES_PER_FIELD: 10,
  MIN_POSTINGS_PER_LINK: 1,
}));

vi.mock('../../src/jobthai/derive-occupations', () => ({
  deriveOccupations: vi.fn().mockResolvedValue({ occupations: 0, postings: 0 }),
  occupationCode: vi.fn((category: string, subcategory: string) => `${category}|${subcategory}`),
}));

vi.mock('../../src/jobthai/match-skills', () => ({
  loadSkillTerms: vi.fn().mockResolvedValue([]),
  matchSkillTerms: vi.fn(() => []),
  rollUpOccupationSkills: vi.fn(() => []),
}));

vi.mock('../../src/lib/ai-service', () => ({
  createIngestionAiService: vi.fn(() => ({})),
}));

vi.mock('../../src/jobthai/fields', () => ({
  defaultFieldsDeps: vi.fn(() => ({})),
  refreshJobFields: mocks.refreshJobFields,
}));

import { refreshJobThaiDerived } from '../../src/jobthai/refresh';

const TAXONOMY_RUN_ID = 'run-taxonomy-broadened';
const LINKS_RUN_ID = 'run-links-jobthai-scoped';

beforeEach(() => {
  mocks.prisma.programJobThaiLink.createMany.mockClear();
  mocks.refreshJobFields.mockClear();
});

describe('refreshJobThaiDerived — run id attribution', () => {
  it('writes program_jobthai_links with linksRunId and calls refreshJobFields with runId, when both are supplied and differ', async () => {
    await refreshJobThaiDerived({ runId: TAXONOMY_RUN_ID, linksRunId: LINKS_RUN_ID, log: () => undefined });

    expect(mocks.prisma.programJobThaiLink.createMany).toHaveBeenCalledTimes(1);
    const linkCall = mocks.prisma.programJobThaiLink.createMany.mock.calls[0][0];
    expect(linkCall.data).toHaveLength(1);
    expect(linkCall.data[0].ingestionRunId).toBe(LINKS_RUN_ID);
    expect(linkCall.data[0].ingestionRunId).not.toBe(TAXONOMY_RUN_ID);

    expect(mocks.refreshJobFields).toHaveBeenCalledTimes(1);
    expect(mocks.refreshJobFields.mock.calls[0][0].runId).toBe(TAXONOMY_RUN_ID);
  });

  it('uses runId for both links and taxonomy when linksRunId is omitted — the connector\'s own path, unchanged', async () => {
    await refreshJobThaiDerived({ runId: TAXONOMY_RUN_ID, log: () => undefined });

    const linkCall = mocks.prisma.programJobThaiLink.createMany.mock.calls[0][0];
    expect(linkCall.data[0].ingestionRunId).toBe(TAXONOMY_RUN_ID);
    expect(mocks.refreshJobFields.mock.calls[0][0].runId).toBe(TAXONOMY_RUN_ID);
  });
});
