import { describe, expect, it, vi, beforeEach } from 'vitest';

// Tests rules a Council-facing reviewer would need to trust:
//   1. Peer suggestion ranks by skill-overlap (Jaccard) when both sides have skills.
//   2. White-space detection: only skills ≥threshold peers offer AND KKU lacks.
//   3. Distinctiveness score: 100 when nothing is shared, drops as overlap grows.
//   4. Subject leadership: trend direction derived from rank delta over years.

const mocks = vi.hoisted(() => ({
  programFindUnique: vi.fn(),
  programFindUniqueOrThrow: vi.fn(),
  peerProgramFindMany: vi.fn(),
  peerSetFindUniqueOrThrow: vi.fn(),
  peerSetFindMany: vi.fn(),
  peerSetMemberFindMany: vi.fn(),
  peerRankingFindMany: vi.fn(),
  programSkillFindMany: vi.fn(),
  queryRawUnsafe: vi.fn(),
  skillFindMany: vi.fn(),
  kkuProgramFindMany: vi.fn(),
}));

vi.mock('../src/index', async () => {
  const actual = await vi.importActual<typeof import('../src/index')>('../src/index');
  return {
    ...actual,
    prisma: {
      peerSet: {
        findUniqueOrThrow: mocks.peerSetFindUniqueOrThrow,
        findMany: mocks.peerSetFindMany,
      },
      peerSetMember: { findMany: mocks.peerSetMemberFindMany },
      peerProgram: { findMany: mocks.peerProgramFindMany },
      peerRanking: { findMany: mocks.peerRankingFindMany },
      program: {
        findUnique: mocks.programFindUnique,
        findUniqueOrThrow: mocks.programFindUniqueOrThrow,
        findMany: mocks.kkuProgramFindMany,
      },
      programSkill: {
        findMany: mocks.programSkillFindMany,
      },
      skill: { findMany: mocks.skillFindMany },
      $queryRawUnsafe: mocks.queryRawUnsafe,
    },
  };
});

import {
  computeDistinctiveness,
  computeProgramPeers,
  computeSubjectLeadership,
  computeWhiteSpaces,
} from '../src/benchmarking';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('computeProgramPeers — ranks by skill overlap', () => {
  it('orders peers by Jaccard similarity when both sides have skills', async () => {
    mocks.programFindUniqueOrThrow.mockResolvedValue({
      id: 'p1',
      level: 'BACHELOR',
      programSkills: [
        { skillId: 'sk-1', weight: 1 },
        { skillId: 'sk-2', weight: 1 },
        { skillId: 'sk-3', weight: 1 },
      ],
      department: { nameEn: 'Computer Science' },
    });
    mocks.peerProgramFindMany.mockResolvedValue([
      {
        id: 'peer-close',
        institution: 'Close match',
        country: 'TH',
        programName: 'CS',
        programLevel: 'BACHELOR',
        subjectArea: 'Computer Science',
        ranking: 50,
        lastScraped: new Date(),
        peerProgramSkills: [
          { skillId: 'sk-1', weight: 1 },
          { skillId: 'sk-2', weight: 1 },
          { skillId: 'sk-4', weight: 1 },
        ],
      },
      {
        id: 'peer-far',
        institution: 'Far match',
        country: 'MY',
        programName: 'CS',
        programLevel: 'BACHELOR',
        subjectArea: 'Computer Science',
        ranking: 200,
        lastScraped: new Date(),
        peerProgramSkills: [
          { skillId: 'sk-9', weight: 1 },
          { skillId: 'sk-10', weight: 1 },
        ],
      },
    ]);
    const r = await computeProgramPeers('p1', null, 5);
    expect(r.scorerUsed).toBe('skill-overlap');
    expect(r.peers[0]?.id).toBe('peer-close');
    expect(r.peers[1]?.id).toBe('peer-far');
    expect(r.peers[0]?.similarityScore).toBeGreaterThan(r.peers[1]?.similarityScore ?? 0);
  });

  it('falls back to subject-and-country heuristic when neither side has skills', async () => {
    mocks.programFindUniqueOrThrow.mockResolvedValue({
      id: 'p1',
      level: 'BACHELOR',
      programSkills: [],
      department: { nameEn: 'Medicine' },
    });
    mocks.peerProgramFindMany.mockResolvedValue([
      {
        id: 'peer-medicine',
        institution: 'Peer A',
        country: 'TH',
        programName: 'Med',
        programLevel: 'BACHELOR',
        subjectArea: 'Medicine',
        ranking: 10,
        lastScraped: new Date(),
        peerProgramSkills: [],
      },
    ]);
    const r = await computeProgramPeers('p1', null, 5);
    expect(r.scorerUsed).toBe('subject-and-country-fallback');
    expect(r.peers.length).toBe(1);
  });
});

describe('computeWhiteSpaces', () => {
  it('returns only skills peer-threshold-or-more peers teach AND KKU lacks', async () => {
    // raw query returns the count-above-threshold + skill_id + institutions.
    mocks.queryRawUnsafe.mockResolvedValue([
      { skill_id: 'sk-100', peer_count: 5, peer_institutions: ['A', 'B', 'C'], total_weight: 5 },
      { skill_id: 'sk-101', peer_count: 4, peer_institutions: ['A', 'B'], total_weight: 4 },
    ]);
    // sk-100 is ALSO taught by KKU; should be excluded.
    mocks.programSkillFindMany.mockResolvedValue([{ skillId: 'sk-100' }]);
    mocks.skillFindMany.mockResolvedValue([
      { id: 'sk-101', code: 'SK-101', nameEn: 'Thing', nameTh: 'สิ่ง' },
    ]);
    const r = await computeWhiteSpaces(3, 30);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.skillId).toBe('sk-101');
    expect(r.peerThreshold).toBe(3);
  });
});

describe('computeDistinctiveness', () => {
  it('scores 100 when no skills are shared with any peer', async () => {
    mocks.programFindUniqueOrThrow.mockResolvedValue({
      id: 'p1',
      programSkills: [
        { skillId: 'sk-unique', skill: { id: 'sk-unique', nameEn: 'Unique', nameTh: 'เอกลักษณ์' } },
      ],
    });
    mocks.peerProgramFindMany.mockResolvedValue([
      { id: 'peer-1', peerProgramSkills: [{ skillId: 'sk-other' }] },
    ]);
    const r = await computeDistinctiveness('p1');
    expect(r.score).toBe(100);
    expect(r.overlapRatio).toBe(0);
  });

  it('scores 0 when all skills are shared', async () => {
    mocks.programFindUniqueOrThrow.mockResolvedValue({
      id: 'p1',
      programSkills: [
        { skillId: 'sk-a', skill: { id: 'sk-a', nameEn: 'A', nameTh: 'เอ' } },
        { skillId: 'sk-b', skill: { id: 'sk-b', nameEn: 'B', nameTh: 'บี' } },
      ],
    });
    mocks.peerProgramFindMany.mockResolvedValue([
      { id: 'peer-1', peerProgramSkills: [{ skillId: 'sk-a' }, { skillId: 'sk-b' }] },
    ]);
    const r = await computeDistinctiveness('p1');
    expect(r.score).toBe(0);
    expect(r.overlapRatio).toBe(1);
    expect(r.distinctiveSkills).toHaveLength(0);
  });
});

describe('computeSubjectLeadership — ranking trend direction', () => {
  it('marks trend "rising" when rank decreased (better) over years', async () => {
    mocks.peerRankingFindMany.mockResolvedValue([
      { institution: 'Inst', source: 'THE', subjectArea: 'CS', year: 2023, rank: 100, percentile: 70 },
      { institution: 'Inst', source: 'THE', subjectArea: 'CS', year: 2024, rank: 80,  percentile: 75 },
      { institution: 'Inst', source: 'THE', subjectArea: 'CS', year: 2025, rank: 60,  percentile: 80 },
    ]);
    const r = await computeSubjectLeadership('CS');
    expect(r.trendsBySource.THE?.[0]?.trend).toBe('rising');
  });

  it('marks "falling" when rank got worse', async () => {
    mocks.peerRankingFindMany.mockResolvedValue([
      { institution: 'Inst', source: 'THE', subjectArea: 'CS', year: 2023, rank: 50, percentile: 80 },
      { institution: 'Inst', source: 'THE', subjectArea: 'CS', year: 2025, rank: 200, percentile: 40 },
    ]);
    const r = await computeSubjectLeadership('CS');
    expect(r.trendsBySource.THE?.[0]?.trend).toBe('falling');
  });

  it('marks "stable" for small deltas', async () => {
    mocks.peerRankingFindMany.mockResolvedValue([
      { institution: 'Inst', source: 'THE', subjectArea: 'CS', year: 2023, rank: 100, percentile: 60 },
      { institution: 'Inst', source: 'THE', subjectArea: 'CS', year: 2025, rank: 102, percentile: 60 },
    ]);
    const r = await computeSubjectLeadership('CS');
    expect(r.trendsBySource.THE?.[0]?.trend).toBe('stable');
  });
});
