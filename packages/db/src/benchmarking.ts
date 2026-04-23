import { z } from 'zod';
import type { ProgramLevel } from '@prisma/client';
import { prisma } from './index';

// ═══════════════════════════════════════════════════════════════════════
// Competitive Benchmarking (prompt 10)
//
// Pure read-side computation against peer_programs + peer_program_skills
// + peer_rankings + peer_sets. No state changes here — the AI
// suggest-peers endpoint lives in the API layer and writes one
// AiInference row per call via the recorder.
//
// All helpers return explicit result types so packages/db compiles with
// declaration: true.
// ═══════════════════════════════════════════════════════════════════════

export const BENCHMARKING_VERSION = 'benchmarking.v1';

export const PeerSetFilterSchema = z.object({
  isSystem: z.boolean().optional(),
  region: z.string().optional(),
  subjectArea: z.string().optional(),
});
export type PeerSetFilter = z.infer<typeof PeerSetFilterSchema>;

// ── Peer set listing ─────────────────────────────────────────────────
export interface PeerSetDto {
  id: string;
  name: string;
  descriptionTh: string | null;
  descriptionEn: string | null;
  isSystem: boolean;
  subjectArea: string | null;
  region: string;
  memberCount: number;
  createdAt: Date;
}

export async function listPeerSets(filter: PeerSetFilter = {}): Promise<PeerSetDto[]> {
  const f = PeerSetFilterSchema.parse(filter);
  const rows = await prisma.peerSet.findMany({
    where: {
      isSystem: f.isSystem,
      region: f.region,
      subjectArea: f.subjectArea,
    },
    include: { _count: { select: { members: true } } },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    descriptionTh: r.descriptionTh,
    descriptionEn: r.descriptionEn,
    isSystem: r.isSystem,
    subjectArea: r.subjectArea,
    region: r.region,
    memberCount: r._count.members,
    createdAt: r.createdAt,
  }));
}

// ── Portfolio comparison ─────────────────────────────────────────────
export interface PortfolioComparisonPeer {
  institution: string;
  country: string;
  programCount: number;
  subjectDistribution: Record<string, number>;
  levelDistribution: Record<ProgramLevel, number>;
}

export interface PortfolioComparisonResult {
  peerSetId: string;
  peerSetName: string;
  kku: {
    programCount: number;
    subjectDistribution: Record<string, number>;
    levelDistribution: Record<ProgramLevel, number>;
  };
  peers: PortfolioComparisonPeer[];
  // Subjects that ≥X peers offer but KKU doesn't (threshold configurable).
  whatTheyHave: Array<{ subjectArea: string; peerCount: number }>;
  // Subjects KKU offers but no peer in this set does.
  whatWeHave: Array<{ subjectArea: string; kkuProgramCount: number }>;
  methodologyVersion: string;
  asOf: string;
  lowConfidenceReason: string | null;
}

export async function computePortfolioComparison(peerSetId: string): Promise<PortfolioComparisonResult> {
  const peerSet = await prisma.peerSet.findUniqueOrThrow({
    where: { id: peerSetId },
    include: { members: { include: { peerProgram: true } } },
  });

  // KKU portfolio: active programs, grouped by department name as a proxy
  // for subject area (we don't have a dedicated SubjectArea column on
  // KKU Program; department name is a defensible stand-in for v1).
  const kkuPrograms = await prisma.program.findMany({
    where: { status: 'ACTIVE' },
    include: { department: { select: { nameEn: true } } },
  });
  const kkuSubjectDist: Record<string, number> = {};
  const kkuLevelDist: Record<ProgramLevel, number> = { BACHELOR: 0, MASTER: 0, DOCTORAL: 0 };
  for (const p of kkuPrograms) {
    const subject = p.department?.nameEn ?? 'Other';
    kkuSubjectDist[subject] = (kkuSubjectDist[subject] ?? 0) + 1;
    kkuLevelDist[p.level] += 1;
  }

  // Group peer programs by institution.
  const byInstitution = new Map<string, typeof peerSet.members>();
  for (const m of peerSet.members) {
    const key = m.peerProgram.institution;
    if (!byInstitution.has(key)) byInstitution.set(key, []);
    byInstitution.get(key)!.push(m);
  }

  const peers: PortfolioComparisonPeer[] = [];
  const peerSubjectCounter: Record<string, Set<string>> = {};
  for (const [institution, members] of byInstitution) {
    const subjectDist: Record<string, number> = {};
    const levelDist: Record<ProgramLevel, number> = { BACHELOR: 0, MASTER: 0, DOCTORAL: 0 };
    for (const m of members) {
      const subject = m.peerProgram.subjectArea ?? 'Other';
      subjectDist[subject] = (subjectDist[subject] ?? 0) + 1;
      levelDist[m.peerProgram.programLevel] += 1;
      if (!peerSubjectCounter[subject]) peerSubjectCounter[subject] = new Set();
      peerSubjectCounter[subject]!.add(institution);
    }
    peers.push({
      institution,
      country: members[0]!.peerProgram.country,
      programCount: members.length,
      subjectDistribution: subjectDist,
      levelDistribution: levelDist,
    });
  }

  // What they have we don't: subjects ≥3 peers offer AND KKU lacks.
  // KKU "subjects" use department-name proxy; peer subjects use their
  // subjectArea free-text. The comparison is fuzzy by nature — documented
  // as a v1 caveat in the UI "comparable basis" disclosure.
  const whatTheyHave: Array<{ subjectArea: string; peerCount: number }> = [];
  for (const [subject, peers] of Object.entries(peerSubjectCounter)) {
    if (peers.size >= 3 && !(subject in kkuSubjectDist)) {
      whatTheyHave.push({ subjectArea: subject, peerCount: peers.size });
    }
  }
  whatTheyHave.sort((a, b) => b.peerCount - a.peerCount);

  // What we have they don't: KKU subjects with zero peer coverage.
  const whatWeHave: Array<{ subjectArea: string; kkuProgramCount: number }> = [];
  for (const [subject, count] of Object.entries(kkuSubjectDist)) {
    if (!(subject in peerSubjectCounter)) {
      whatWeHave.push({ subjectArea: subject, kkuProgramCount: count });
    }
  }
  whatWeHave.sort((a, b) => b.kkuProgramCount - a.kkuProgramCount);

  return {
    peerSetId,
    peerSetName: peerSet.name,
    kku: {
      programCount: kkuPrograms.length,
      subjectDistribution: kkuSubjectDist,
      levelDistribution: kkuLevelDist,
    },
    peers,
    whatTheyHave,
    whatWeHave,
    methodologyVersion: BENCHMARKING_VERSION,
    asOf: new Date().toISOString(),
    lowConfidenceReason:
      peers.length === 0
        ? 'Peer set has no members — add peer programs or use a system-seeded set.'
        : 'Subject grouping uses free-text — peer subjectArea vs KKU department name is fuzzy. Apples-to-oranges caveats live on each peer via PeerSetMember.noteTh.',
  };
}

// ── Subject leadership ───────────────────────────────────────────────
export interface SubjectLeadershipTrend {
  institution: string;
  source: string;
  years: Array<{ year: number; rank: number; percentile: number | null }>;
  trend: 'rising' | 'falling' | 'stable';
}

export interface SubjectLeadershipResult {
  subjectArea: string;
  kkuPercentileLatest: number | null;
  trendsBySource: Record<string, SubjectLeadershipTrend[]>;
  researchOutputGap: {
    kku: number;
    peerMedian: number;
    gapPct: number;
  } | null;
  methodologyVersion: string;
  asOf: string;
  lowConfidenceReason: string | null;
}

export async function computeSubjectLeadership(subjectArea: string): Promise<SubjectLeadershipResult> {
  const rankings = await prisma.peerRanking.findMany({
    where: { subjectArea },
    orderBy: [{ year: 'asc' }, { rank: 'asc' }],
  });
  if (rankings.length === 0) {
    return {
      subjectArea,
      kkuPercentileLatest: null,
      trendsBySource: {},
      researchOutputGap: null,
      methodologyVersion: BENCHMARKING_VERSION,
      asOf: new Date().toISOString(),
      lowConfidenceReason:
        'No ranking rows for this subject area. THE/QS/SCImago connectors are mocked until prompt 14.',
    };
  }

  // Group by (institution, source) → year series.
  const byInstSource = new Map<string, typeof rankings>();
  for (const r of rankings) {
    const key = `${r.institution}::${r.source}`;
    if (!byInstSource.has(key)) byInstSource.set(key, []);
    byInstSource.get(key)!.push(r);
  }
  const trendsBySource: Record<string, SubjectLeadershipTrend[]> = {};
  for (const [key, rows] of byInstSource) {
    const [institution, source] = key.split('::') as [string, string];
    const years = rows.map((r) => ({ year: r.year, rank: r.rank, percentile: r.percentile }));
    const first = years[0]!;
    const last = years[years.length - 1]!;
    // Lower rank = better, so trend by rank delta.
    let trend: SubjectLeadershipTrend['trend'];
    const delta = last.rank - first.rank;
    if (delta < -3) trend = 'rising';
    else if (delta > 3) trend = 'falling';
    else trend = 'stable';
    if (!trendsBySource[source]) trendsBySource[source] = [];
    trendsBySource[source]!.push({ institution, source, years, trend });
  }

  const kkuLatest = rankings
    .filter((r) => r.institution === 'KKU')
    .sort((a, b) => b.year - a.year)[0];

  return {
    subjectArea,
    kkuPercentileLatest: kkuLatest?.percentile ?? null,
    trendsBySource,
    // Research output gap deferred — needs ResearchOutput join against a
    // comparable peer metric. Prompt 14 wires OpenAlex for peers; today
    // we return null with a low-confidence note.
    researchOutputGap: null,
    methodologyVersion: BENCHMARKING_VERSION,
    asOf: new Date().toISOString(),
    lowConfidenceReason:
      'Research output gap requires peer OpenAlex data (prompt 14). Ranking trends are live.',
  };
}

// ── Program peers ────────────────────────────────────────────────────
export interface PeerProgramDto {
  id: string;
  institution: string;
  country: string;
  programName: string;
  programLevel: ProgramLevel;
  subjectArea: string | null;
  ranking: number | null;
  similarityScore: number;
  skillOverlapCount: number;
  lastScraped: Date;
}

export interface BenchmarkingPeersResult {
  programId: string;
  peers: PeerProgramDto[];
  methodologyVersion: string;
  asOf: string;
  // Which scorer produced these rankings.
  scorerUsed: 'embedding-cosine' | 'skill-overlap' | 'subject-and-country-fallback';
}

export async function computeProgramPeers(
  programId: string,
  peerSetId: string | null = null,
  limit = 5,
): Promise<BenchmarkingPeersResult> {
  const program = await prisma.program.findUniqueOrThrow({
    where: { id: programId },
    include: {
      programSkills: { select: { skillId: true, weight: true } },
      department: { select: { nameEn: true } },
    },
  });

  // Narrow the peer candidate pool to the peer set if provided.
  const whereClause: { id?: { in: string[] } } = {};
  if (peerSetId) {
    const members = await prisma.peerSetMember.findMany({
      where: { peerSetId },
      select: { peerProgramId: true },
    });
    whereClause.id = { in: members.map((m) => m.peerProgramId) };
  }

  const peerCandidates = await prisma.peerProgram.findMany({
    where: whereClause,
    include: { peerProgramSkills: { select: { skillId: true, weight: true } } },
  });

  // v1 scorer: skill overlap. When both sides have skills tagged, use
  // Jaccard-weighted similarity; otherwise fall back to subject + country.
  const kkuSkillIds = new Set(program.programSkills.map((s) => s.skillId));
  const kkuSubject = program.department?.nameEn ?? '';
  const kkuLevel = program.level;

  let scorerUsed: BenchmarkingPeersResult['scorerUsed'] = 'skill-overlap';

  const scored: Array<{ peer: (typeof peerCandidates)[number]; score: number; overlap: number }> = [];
  for (const peer of peerCandidates) {
    const peerSkillIds = new Set(peer.peerProgramSkills.map((s) => s.skillId));
    let overlap = 0;
    for (const sid of peerSkillIds) if (kkuSkillIds.has(sid)) overlap += 1;
    let score: number;
    if (kkuSkillIds.size > 0 && peerSkillIds.size > 0) {
      const union = kkuSkillIds.size + peerSkillIds.size - overlap;
      score = union > 0 ? overlap / union : 0;
    } else {
      // Subject + country + level heuristic fallback.
      scorerUsed = 'subject-and-country-fallback';
      const subjectMatch = peer.subjectArea && kkuSubject.toLowerCase().includes(peer.subjectArea.toLowerCase()) ? 0.5 : 0;
      const levelMatch = peer.programLevel === kkuLevel ? 0.3 : 0;
      const rankingBonus = peer.ranking != null ? Math.max(0, 0.2 - peer.ranking / 1000) : 0;
      score = subjectMatch + levelMatch + rankingBonus;
    }
    scored.push({ peer, score, overlap });
  }
  scored.sort((a, b) => b.score - a.score);

  // Embeddings intentionally NOT used in v1 — PeerProgram.embedding is
  // almost entirely NULL until prompt 14 wires real extraction. When
  // that's live, swap the scorer above to a pgvector `<->` query.

  const peers: PeerProgramDto[] = scored.slice(0, limit).map((s) => ({
    id: s.peer.id,
    institution: s.peer.institution,
    country: s.peer.country,
    programName: s.peer.programName,
    programLevel: s.peer.programLevel,
    subjectArea: s.peer.subjectArea,
    ranking: s.peer.ranking,
    similarityScore: s.score,
    skillOverlapCount: s.overlap,
    lastScraped: s.peer.lastScraped,
  }));

  return {
    programId,
    peers,
    methodologyVersion: BENCHMARKING_VERSION,
    asOf: new Date().toISOString(),
    scorerUsed,
  };
}

// ── White-space detection ────────────────────────────────────────────
export interface WhiteSpaceRow {
  skillId: string;
  skillCode: string;
  nameTh: string;
  nameEn: string;
  peerCount: number;            // distinct peer institutions teaching this skill
  peerInstitutions: string[];   // top 5
  estimatedCohortSize: number;  // proxy: sum of peer-program weights × some factor
  fitNote: string;
}

export interface WhiteSpaceResult {
  rows: WhiteSpaceRow[];
  peerThreshold: number;
  methodologyVersion: string;
  asOf: string;
  lowConfidenceReason: string | null;
}

export async function computeWhiteSpaces(peerThreshold = 3, limit = 30): Promise<WhiteSpaceResult> {
  // Peer-program skills grouped by skill, count of distinct institutions.
  const rows = await prisma.$queryRawUnsafe<
    { skill_id: string; peer_count: number; peer_institutions: string[]; total_weight: number }[]
  >(`
    SELECT
      pps.skill_id,
      COUNT(DISTINCT pp.institution)::int                    AS peer_count,
      (ARRAY_AGG(DISTINCT pp.institution))[1:5]              AS peer_institutions,
      SUM(pps.weight)::float                                 AS total_weight
    FROM peer_program_skills pps
    JOIN peer_programs pp ON pp.id = pps.peer_program_id
    GROUP BY pps.skill_id
    HAVING COUNT(DISTINCT pp.institution) >= ${peerThreshold}
  `);

  // Exclude skills KKU already teaches (via any ProgramSkill row).
  const kkuSkills = await prisma.programSkill.findMany({ select: { skillId: true }, distinct: ['skillId'] });
  const kkuSkillIds = new Set(kkuSkills.map((s) => s.skillId));
  const missing = rows.filter((r) => !kkuSkillIds.has(r.skill_id));

  const skillInfos = await prisma.skill.findMany({
    where: { id: { in: missing.map((r) => r.skill_id) } },
    select: { id: true, code: true, nameEn: true, nameTh: true },
  });
  const skillMap = new Map(skillInfos.map((s) => [s.id, s]));

  const out: WhiteSpaceRow[] = [];
  for (const r of missing) {
    const info = skillMap.get(r.skill_id);
    if (!info) continue;
    out.push({
      skillId: r.skill_id,
      skillCode: info.code,
      nameEn: info.nameEn,
      nameTh: info.nameTh,
      peerCount: r.peer_count,
      peerInstitutions: r.peer_institutions ?? [],
      estimatedCohortSize: Math.round(r.total_weight * 20), // heuristic: weight × 20 ≈ annual capacity
      fitNote: `ต้องสอนที่ ${r.peer_count} มหาวิทยาลัยพันธมิตร แต่ไม่มีหลักสูตร KKU ที่สอนทักษะนี้ปัจจุบัน`,
    });
  }
  out.sort((a, b) => b.peerCount - a.peerCount);
  return {
    rows: out.slice(0, limit),
    peerThreshold,
    methodologyVersion: BENCHMARKING_VERSION,
    asOf: new Date().toISOString(),
    lowConfidenceReason:
      missing.length === 0 && rows.length === 0
        ? 'Peer programs have no skill tags yet — seed data is sparse; real tags land with prompt 14 scraper.'
        : null,
  };
}

// ── Distinctiveness scoring ──────────────────────────────────────────
export interface DistinctivenessResult {
  programId: string;
  // 0–100. 100 = totally unique; 0 = every skill also taught by peers.
  score: number;
  overlapRatio: number;         // 0–1, fraction of KKU program skills also in peers
  distinctiveSkills: Array<{ id: string; nameEn: string; nameTh: string }>;
  sharedWithNPeers: Array<{ skillId: string; nameEn: string; count: number }>;
  methodologyVersion: string;
  asOf: string;
}

export async function computeDistinctiveness(programId: string, peerSetId: string | null = null): Promise<DistinctivenessResult> {
  const program = await prisma.program.findUniqueOrThrow({
    where: { id: programId },
    include: { programSkills: { include: { skill: { select: { id: true, nameEn: true, nameTh: true } } } } },
  });
  const programSkillIds = program.programSkills.map((s) => s.skillId);

  // Which peers to score against.
  const peerWhere: { id?: { in: string[] } } = {};
  if (peerSetId) {
    const members = await prisma.peerSetMember.findMany({
      where: { peerSetId },
      select: { peerProgramId: true },
    });
    peerWhere.id = { in: members.map((m) => m.peerProgramId) };
  }
  const peers = await prisma.peerProgram.findMany({
    where: peerWhere,
    include: { peerProgramSkills: { select: { skillId: true } } },
  });

  const peerCountBySkill = new Map<string, number>();
  for (const peer of peers) {
    const distinctSkills = new Set(peer.peerProgramSkills.map((s) => s.skillId));
    for (const sid of distinctSkills) peerCountBySkill.set(sid, (peerCountBySkill.get(sid) ?? 0) + 1);
  }

  let sharedCount = 0;
  const distinctiveSkills: DistinctivenessResult['distinctiveSkills'] = [];
  const sharedWithNPeers: DistinctivenessResult['sharedWithNPeers'] = [];
  for (const ps of program.programSkills) {
    const peerCount = peerCountBySkill.get(ps.skillId) ?? 0;
    if (peerCount > 0) {
      sharedCount += 1;
      sharedWithNPeers.push({ skillId: ps.skillId, nameEn: ps.skill.nameEn, count: peerCount });
    } else {
      distinctiveSkills.push({ id: ps.skillId, nameEn: ps.skill.nameEn, nameTh: ps.skill.nameTh });
    }
  }
  sharedWithNPeers.sort((a, b) => b.count - a.count);

  const overlapRatio = programSkillIds.length > 0 ? sharedCount / programSkillIds.length : 0;
  const score = Math.round((1 - overlapRatio) * 100);

  return {
    programId,
    score,
    overlapRatio,
    distinctiveSkills,
    sharedWithNPeers: sharedWithNPeers.slice(0, 10),
    methodologyVersion: BENCHMARKING_VERSION,
    asOf: new Date().toISOString(),
  };
}
