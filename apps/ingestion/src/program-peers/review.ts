import { prisma, programAiReadiness, activeRevisionIdFor } from '@kku/db';
import {
  buildProgramPeerReviewMessages,
  ProgramPeerReviewSchema,
  PROGRAM_PEER_REVIEW_VERSION,
  type AiService,
  type PeerReviewPayload,
} from '@kku/shared';
import { loadProgramPlos } from './plos';

// ─────────────────────────────────────────────────────────────────────────────
// AI peer-review generator. Composes a snapshot of the KKU program's
// quantitative state + the AI-picked peer set, then asks the model
// for a frank comparative review (strengths · weaknesses · per-tier
// verdicts · recommendations).
//
// Persists into ProgramPeerReview (one row per program; idempotent
// upsert — re-running supersedes the prior review).
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewPeersParams {
  programId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
}

export type ReviewPeersOutcome =
  | {
      status: 'SUCCEEDED';
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      peerCount: number;
      strengthsCount: number;
      weaknessesCount: number;
      recommendationsCount: number;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function generateProgramPeerReview(
  params: ReviewPeersParams,
): Promise<ReviewPeersOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    select: {
      id: true,
      code: true,
      nameTh: true,
      nameEn: true,
      level: true,
      majors: true,
      durationYears: true,
      yearEstablished: true,
      faculty: { select: { nameEn: true } },
    },
  });
  if (!program) return { status: 'SKIPPED', reason: `program not found: ${params.programId}` };

  // Pull peer picks first — review needs them as input.
  const peerRows = await prisma.programPeerSelection.findMany({
    where: { programId: program.id },
    include: { rankedUniversity: true },
    orderBy: [{ tier: 'asc' }, { rankInTier: 'asc' }],
  });
  if (peerRows.length === 0) {
    return {
      status: 'SKIPPED',
      reason: 'no peer selections found — run pnpm peers:select <program> first',
    };
  }

  // Snapshot KKU's current state for the AI to compare against. v3:
  // enrolment / financial / TCAS-admission metrics are deliberately NOT
  // fetched — peers expose no comparable data, so comparing them misleads.
  // Retained: staff capability (faculty + research), program relevance
  // (skills + labour-market alignment), and the AI-readiness scorer.
  const [programFaculty, programSkillRows, latestDigest, aiReadiness] = await Promise.all([
    prisma.programFaculty.findMany({
      where: { programId: program.id },
      include: {
        facultyMember: {
          select: { id: true, rank: true, isActive: true },
        },
      },
    }),
    prisma.programSkill.findMany({
      where: { programId: program.id },
      include: { skill: { select: { nameEn: true, nameTh: true } } },
      orderBy: { weight: 'desc' },
    }),
    prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program',
        sourceEntityId: program.id,
        extractionKind: 'PROGRAM_DIGEST',
        reviewStatus: 'APPROVED',
      },
      orderBy: { createdAt: 'desc' },
      select: { payloadJson: true },
    }),
    programAiReadiness(program.id),
  ]);
  const programSkillCount = programSkillRows.length;

  const activeFaculty = programFaculty
    .filter((p) => p.facultyMember.isActive)
    .map((p) => p.facultyMember);
  const seniorCount = activeFaculty.filter(
    (m) => m.rank === 'PROF' || m.rank === 'ASSOC_PROF',
  ).length;
  const seniorRankShare =
    activeFaculty.length > 0 ? seniorCount / activeFaculty.length : 0;

  const memberIds = activeFaculty.map((m) => m.id);
  const currentYear = new Date().getUTCFullYear();
  const publicationsCount = memberIds.length > 0
    ? await prisma.researchOutput.count({
        where: { facultyMemberId: { in: memberIds }, year: { gte: currentYear - 3 } },
      })
    : 0;

  // Labour-market alignment (% of program skills in the LinkedIn-via-MHESI
  // demanded set, fallback chain). Reuses the same approach the health
  // score uses; here we compute it inline to avoid pulling the cached
  // alignment map.
  let labourMarketAlignment: number | null = null;
  const programSkills = await prisma.programSkill.findMany({
    where: { programId: program.id },
    select: { skillId: true },
  });
  if (programSkills.length > 0) {
    const skillIds = new Set(programSkills.map((s) => s.skillId));
    for (const q of [
      { dataScope: 'THAILAND' as const, dataSource: 'JOB_POSTINGS' as const },
      { dataScope: 'GLOBAL'   as const, dataSource: 'JOB_POSTINGS' as const },
      { dataScope: 'THAILAND' as const, dataSource: 'PROFILES'     as const },
      { dataScope: 'GLOBAL'   as const, dataSource: 'PROFILES'     as const },
    ]) {
      const demanded = await prisma.kmitlCareerSkillDemand.findMany({
        where: {
          dataScope: q.dataScope,
          dataSource: q.dataSource,
          percentage: { gte: 5 },
          skillId: { not: null },
        },
        select: { skillId: true },
        distinct: ['skillId'],
      });
      if (demanded.length === 0) continue;
      const dset = new Set(demanded.map((d) => d.skillId!).filter(Boolean));
      let matched = 0;
      for (const s of skillIds) if (dset.has(s)) matched++;
      if (matched > 0) {
        labourMarketAlignment = (matched / skillIds.size) * 100;
        break;
      }
    }
  }

  // Build the program-content block for the v2 contentModernity +
  // contentGaps assessment. Skills come from ProgramSkill (post-
  // approval materialised); courses come from the latest approved
  // program-digest extraction payload. PLOs come from the PLO table — the
  // digest payload has no PLO field, so reading it there (as this did until
  // 2026-10-03) always sent the prompt an empty list.
  const digestPayload = latestDigest?.payloadJson as
    | {
        courses?: Array<{ code: string; nameTh?: string; nameEn?: string }>;
      }
    | null
    | undefined;
  const skillsTaught = programSkillRows.map((ps) => ({
    name: ps.skill.nameEn || ps.skill.nameTh,
    weight: ps.weight,
    pickedFromPlo: ps.pickedFromPlo ?? false,
  }));
  const coursesSample = (digestPayload?.courses ?? []).map((c) => ({
    code: c.code,
    name: c.nameEn || c.nameTh || '',
  }));
  const programLearningOutcomes = await loadProgramPlos(program.id);

  const messages = buildProgramPeerReviewMessages({
    programDegree: program.nameEn,
    programNameTh: program.nameTh,
    programNameEn: program.nameEn,
    programLevel: program.level as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
    programFaculty: program.faculty.nameEn,
    programDurationYears: program.durationYears,
    subjectHint: program.majors[0] ?? '',
    kkuSnapshot: {
      activeFacultyCount: activeFaculty.length,
      seniorRankShareOfFaculty: seniorRankShare,
      publicationsLast3Years: publicationsCount,
      skillsTaughtCount: programSkillCount,
      labourMarketAlignmentPct: labourMarketAlignment,
      yearEstablished: program.yearEstablished,
      aiReadiness: {
        overallScore: aiReadiness.overallScore,
        curriculumIntegration: aiReadiness.subScores.curriculumIntegration,
        skillResilience: aiReadiness.subScores.skillResilience,
        researchPresence: aiReadiness.subScores.researchPresence,
        aiNativeSkills: aiReadiness.skillBreakdown.aiNative,
        aiAugmentedSkills: aiReadiness.skillBreakdown.aiAugmented,
        aiDisplaceableSkills: aiReadiness.skillBreakdown.aiDisplaceable,
        aiPublicationsLast3Years: aiReadiness.aiPublicationsLast3Years,
      },
    },
    kkuContent: {
      skillsTaught,
      coursesSample,
      programLearningOutcomes,
    },
    peers: peerRows.map((p) => ({
      tier: p.tier as 'WORLD' | 'ASIA' | 'SOUTHEAST_ASIA' | 'THAILAND_PEER',
      rankInTier: p.rankInTier,
      institutionName: p.rankedUniversity.name,
      country: p.rankedUniversity.country,
      qsWorldRank: p.rankedUniversity.qsWorldRank,
      theWorldRank: p.rankedUniversity.theWorldRank,
      peerProgramName: p.peerProgramName,
      rationale: p.rationale,
    })),
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'benchmarking',
        kind: 'program-peer-review',
        userId: params.triggeredByUserId ?? null,
        traceId: `peer-review-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_PEER_REVIEW_VERSION,
      // Bumped 8000 → 50000 on 2026-05-13 — see program-digest/run.ts.
      maxOutputTokens: 50000,
    },
    ProgramPeerReviewSchema,
  );

  const payload: PeerReviewPayload = response.parsed.payload;

  // Provenance: which curriculum revision produced this row. NULL is the
  // pre-feature baseline. See packages/db/src/program-revision.ts.
  const programRevisionId = await activeRevisionIdFor(program.id);

  await prisma.programPeerReview.upsert({
    where: { programId: program.id },
    create: {
      programId: program.id,
      programRevisionId,
      methodVersion: PROGRAM_PEER_REVIEW_VERSION,
      payloadJson: payload as unknown as object,
      confidence: response.parsed.confidence,
      peerCountTotal: peerRows.length,
      generatedByAiInferenceId: response.aiInferenceId,
    },
    update: {
      // Re-stamped on update too: an upsert that only stamps on create would
      // leave a re-run carrying the PREVIOUS revision's id — confidently
      // wrong, which is worse than unstamped.
      programRevisionId,
      methodVersion: PROGRAM_PEER_REVIEW_VERSION,
      payloadJson: payload as unknown as object,
      confidence: response.parsed.confidence,
      peerCountTotal: peerRows.length,
      generatedAt: new Date(),
      generatedByAiInferenceId: response.aiInferenceId,
    },
  });

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    confidence: response.parsed.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    peerCount: peerRows.length,
    strengthsCount: payload.strengths.length,
    weaknessesCount: payload.weaknesses.length,
    recommendationsCount: payload.recommendations.length,
  };
}
