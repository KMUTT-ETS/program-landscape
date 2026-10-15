import { prisma, activeRevisionIdFor, type ProgramLevel, type PeerTier } from '@kku/db';
import {
  buildProgramPeerSelectionMessages,
  getInstitution,
  ProgramPeerSelectionSchema,
  PROGRAM_PEER_SELECTION_VERSION,
  type AiService,
} from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// AI-driven peer selection — picks 3-5 best-fit peer programs per tier
// (WORLD / ASIA / SOUTHEAST_ASIA / THAILAND_PEER) for one KKU program.
//
// Reads:
//   - Program (level, faculty, name, majors)
//   - RankedUniversity (filtered to the latest ranking_year, grouped by region)
//
// Writes:
//   - ProgramPeerSelection rows — one per (program × tier × ranked_university)
//   - On re-run, deletes prior selections for this program first (clean replace)
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectPeersParams {
  programId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
  /** Override the ranking year (default: latest in `RankedUniversity`). */
  rankingYear?: number;
}

export type SelectPeersOutcome =
  | {
      status: 'SUCCEEDED';
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      tierCounts: Record<PeerTier, number>;
      subjectSignature: string;
      totalSelections: number;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

const TIER_BY_REGION: Record<string, PeerTier> = {
  World: 'WORLD',
  Asia: 'ASIA',
  'Southeast Asia': 'SOUTHEAST_ASIA',
  Thailand: 'THAILAND_PEER',
};

export async function selectProgramPeers(params: SelectPeersParams): Promise<SelectPeersOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    select: {
      id: true,
      code: true,
      nameTh: true,
      nameEn: true,
      level: true,
      majors: true,
      faculty: { select: { nameTh: true, nameEn: true } },
    },
  });
  if (!program) return { status: 'SKIPPED', reason: `program not found: ${params.programId}` };

  // Resolve latest ranking year if not provided.
  let rankingYear = params.rankingYear;
  if (rankingYear === undefined) {
    const latest = await prisma.rankedUniversity.findFirst({
      orderBy: { rankingYear: 'desc' },
      select: { rankingYear: true },
    });
    if (!latest) return { status: 'SKIPPED', reason: 'no RankedUniversity rows seeded — run pnpm peers:seed-universities' };
    rankingYear = latest.rankingYear;
  }

  // Pull candidates, exclude KKU itself.
  const allCandidates = await prisma.rankedUniversity.findMany({
    where: { rankingYear, name: { not: getInstitution().nameEn } },
    orderBy: [{ region: 'asc' }, { qsWorldRank: 'asc' }],
  });
  if (allCandidates.length === 0) {
    return { status: 'SKIPPED', reason: `no RankedUniversity rows for year ${rankingYear}` };
  }

  const messages = buildProgramPeerSelectionMessages({
    programDegree: program.nameEn,
    programNameTh: program.nameTh,
    programNameEn: program.nameEn,
    programLevel: program.level as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
    programFaculty: program.faculty.nameEn,
    subjectHint: program.majors[0] ?? '',
    candidates: allCandidates.map((c) => ({
      rankedUniversityId: c.id,
      name: c.name,
      country: c.country,
      region: c.region as 'World' | 'Asia' | 'Southeast Asia' | 'Thailand',
      qsWorldRank: c.qsWorldRank,
      theWorldRank: c.theWorldRank,
      qsAsiaRank: c.qsAsiaRank,
      subjectRanks: c.subjectRanksJson as Record<string, { qs?: number; the?: number }> | null,
      notes: c.notes,
    })),
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'benchmarking',
        kind: 'program-peer-selection',
        userId: params.triggeredByUserId ?? null,
        traceId: `peer-selection-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_PEER_SELECTION_VERSION,
      // Bumped 8000 → 50000 on 2026-05-13 — see program-digest/run.ts.
      maxOutputTokens: 50000,
    },
    ProgramPeerSelectionSchema,
  );

  // Validate every rankedUniversityId against the candidate set; drop
  // hallucinated ones. Validate tier matches the candidate's region.
  const candidateById = new Map(allCandidates.map((c) => [c.id, c]));
  const validSelections = response.parsed.selections.filter((s) => {
    const c = candidateById.get(s.rankedUniversityId);
    if (!c) return false;
    const expectedTier = TIER_BY_REGION[c.region];
    return expectedTier === s.tier;
  });

  // Provenance: which curriculum revision produced these rows. NULL is the
  // pre-feature baseline. See packages/db/src/program-revision.ts. Resolved
  // once here, outside the row-building map — every row in a single run
  // belongs to the same revision, so a per-row lookup would be N identical
  // queries.
  const programRevisionId = await activeRevisionIdFor(program.id);

  // Idempotent: replace all prior selections for this program in one
  // transaction. Re-runs always reflect the latest AI judgement.
  await prisma.$transaction([
    prisma.programPeerSelection.deleteMany({ where: { programId: program.id } }),
    prisma.programPeerSelection.createMany({
      data: validSelections.map((s) => ({
        programId: program.id,
        programRevisionId,
        tier: s.tier,
        rankedUniversityId: s.rankedUniversityId,
        peerProgramName: s.peerProgramName,
        peerProgramUrl: s.peerProgramUrl || null,
        rationale: s.rationale,
        confidence: s.confidence,
        subjectArea: s.subjectArea || null,
        rankInTier: s.rankInTier,
        selectedByAiInferenceId: response.aiInferenceId,
      })),
    }),
  ]);

  const tierCounts: Record<PeerTier, number> = {
    WORLD: 0,
    ASIA: 0,
    SOUTHEAST_ASIA: 0,
    THAILAND_PEER: 0,
  };
  for (const s of validSelections) tierCounts[s.tier]++;

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    confidence: response.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    tierCounts,
    subjectSignature: response.parsed.subjectSignature,
    totalSelections: validSelections.length,
  };
}
