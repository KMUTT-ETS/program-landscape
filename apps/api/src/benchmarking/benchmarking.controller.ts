import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  BENCHMARKING_VERSION,
  computeDistinctiveness,
  computePortfolioComparison,
  computeProgramPeers,
  computeSubjectLeadership,
  computeWhiteSpaces,
  listPeerSets,
  prisma,
  programOutcomes,
  realDataWhere,
} from '@kku/db';
import type { BenchmarkingInsightsInput, KmitlDemandMatchSummary, SessionUser } from '@kku/shared';
import {
  AiCall,
  AuthSession,
  Authorized,
  AuditLog,
  Provenance,
  ZodValidationPipe,
  AiQuota,
  assertProgramAccessible,
} from '../common';
import { BenchmarkingInsightsService } from './benchmarking-insights.service';

// Competitive Benchmarking API (prompt 10). Read-heavy; the only
// mutation surfaces are "create custom peer set" and "AI suggest peers"
// (the latter writes an AiInference row via the recorder).

const PeerSetListQuerySchema = z.object({
  isSystem: z.union([z.literal('true'), z.literal('false')]).transform((v) => v === 'true').optional(),
  region: z.string().optional(),
  subjectArea: z.string().optional(),
});
type PeerSetListQuery = z.infer<typeof PeerSetListQuerySchema>;

const PortfolioQuerySchema = z.object({
  peerSetId: z.string(),
});
type PortfolioQuery = z.infer<typeof PortfolioQuerySchema>;

const SubjectsQuerySchema = z.object({
  subjectArea: z.string().min(1),
});
type SubjectsQuery = z.infer<typeof SubjectsQuerySchema>;

const ProgramPeersQuerySchema = z.object({
  peerSetId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
type ProgramPeersQuery = z.infer<typeof ProgramPeersQuerySchema>;

const WhiteSpacesQuerySchema = z.object({
  peerThreshold: z.coerce.number().int().min(1).max(50).default(3),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
type WhiteSpacesQuery = z.infer<typeof WhiteSpacesQuerySchema>;

const CreatePeerSetBodySchema = z.object({
  name: z.string().min(1),
  descriptionTh: z.string().optional(),
  descriptionEn: z.string().optional(),
  subjectArea: z.string().optional(),
  region: z.string().default('CUSTOM'),
  peerProgramIds: z.array(z.string()).default([]),
});
type CreatePeerSetBody = z.infer<typeof CreatePeerSetBodySchema>;

const SuggestPeersBodySchema = z.object({
  region: z.enum(['TH', 'ASEAN', 'GLOBAL']).default('ASEAN'),
});
type SuggestPeersBody = z.infer<typeof SuggestPeersBodySchema>;

const CurriculumGapBodySchema = z.object({
  peerSetId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
type CurriculumGapBody = z.infer<typeof CurriculumGapBodySchema>;

@Controller('/benchmarking')
export class BenchmarkingController {
  constructor(private readonly insights: BenchmarkingInsightsService) {}

  @Get('peer-sets')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'peer-programs', name: 'Peer programs' },
      { id: 'peer-programs-scraper', name: 'Peer program scraper (mocked)' },
    ],
  })
  async peerSets(@Query(new ZodValidationPipe(PeerSetListQuerySchema)) q: PeerSetListQuery) {
    return listPeerSets(q);
  }

  @Post('peer-sets')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'peer_set.create', entityType: 'PeerSet' })
  async createPeerSet(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(CreatePeerSetBodySchema)) body: CreatePeerSetBody,
  ) {
    const set = await prisma.peerSet.create({
      data: {
        name: body.name,
        descriptionTh: body.descriptionTh,
        descriptionEn: body.descriptionEn,
        subjectArea: body.subjectArea,
        region: body.region,
        isSystem: false,
        createdBy: user.userId,
        members: {
          create: body.peerProgramIds.map((pid) => ({ peerProgramId: pid })),
        },
      },
      include: { _count: { select: { members: true } } },
    });
    return set;
  }

  @Get('portfolio')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'peer-programs', name: 'Peer programs' }] })
  async portfolio(@Query(new ZodValidationPipe(PortfolioQuerySchema)) q: PortfolioQuery) {
    return computePortfolioComparison(q.peerSetId);
  }

  @Get('subjects')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'the-rankings', name: 'THE rankings (mocked)' },
      { id: 'qs-rankings', name: 'QS rankings (mocked)' },
      { id: 'scimago', name: 'SCImago (mocked)' },
    ],
  })
  async subjects(@Query(new ZodValidationPipe(SubjectsQuerySchema)) q: SubjectsQuery) {
    return computeSubjectLeadership(q.subjectArea);
  }

  @Get('programs/:id/peers')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'peer-programs', name: 'Peer programs' }] })
  async programPeers(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ProgramPeersQuerySchema)) q: ProgramPeersQuery,
  ) {
    await assertProgramAccessible(id, user);
    const program = await prisma.program.findUnique({ where: { id }, select: { id: true } });
    if (!program) throw new NotFoundException();
    const result = await computeProgramPeers(id, q.peerSetId ?? null, q.limit);
    const distinctiveness = await computeDistinctiveness(id, q.peerSetId ?? null);
    return { ...result, distinctiveness, methodologyVersion: BENCHMARKING_VERSION };
  }

  @Get('white-spaces')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'peer-program-skills', name: 'Peer program skills' },
      { id: 'program-skills', name: 'KKU program skills' },
    ],
  })
  async whiteSpaces(@Query(new ZodValidationPipe(WhiteSpacesQuerySchema)) q: WhiteSpacesQuery) {
    return computeWhiteSpaces(q.peerThreshold, q.limit);
  }

  @Post('programs/:id/peers/suggest')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 10, ttl: 60_000 }, ai_hourly: { limit: 60, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'benchmarking' })
  @AiCall({ module: 'benchmarking' })
  async suggestPeers(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SuggestPeersBodySchema)) body: SuggestPeersBody,
  ) {
    await assertProgramAccessible(id, user);
    const program = await prisma.program.findUnique({
      where: { id },
      include: { department: { select: { nameEn: true } } },
    });
    if (!program) throw new NotFoundException();

    // Existing peers (union across all peer sets that include this programs's subject area).
    const subjectArea = program.department?.nameEn ?? null;
    const existingPeers = await prisma.peerProgram.findMany({
      where: subjectArea ? { subjectArea } : undefined,
      select: { institution: true },
      distinct: ['institution'],
    });

    return this.insights.generate(
      {
        mode: 'suggest-peers',
        programId: id,
        programName: { en: program.nameEn, th: program.nameTh },
        subjectArea,
        programLevel: program.level,
        existingPeerInstitutions: existingPeers.map((p) => p.institution),
        region: body.region,
      },
      user.userId,
    );
  }

  // NEW endpoint (benchmarking-insights.v2): curriculum-gap had a builder
  // + schema but no controller route before this bump — see the prompt
  // file's header comment. Mirrors suggestPeers' shape; additionally
  // wires GRADUATE OUTCOMES + LABOUR-MARKET DEMAND so the mode that
  // argues curriculum gaps can weigh them against real outcomes/demand
  // rather than skill-coverage counts alone.
  @Post('programs/:id/curriculum-gap')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 10, ttl: 60_000 }, ai_hourly: { limit: 60, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'benchmarking' })
  @AiCall({ module: 'benchmarking' })
  async curriculumGap(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CurriculumGapBodySchema)) body: CurriculumGapBody,
  ) {
    await assertProgramAccessible(id, user);
    const program = await prisma.program.findUnique({
      where: { id },
      include: { programSkills: { include: { skill: { select: { nameEn: true, nameTh: true } } } } },
    });
    if (!program) throw new NotFoundException();

    const peersResult = await computeProgramPeers(id, body.peerSetId ?? null, body.limit);
    const peerIds = peersResult.peers.map((p) => p.id);

    const peerSkillRows =
      peerIds.length > 0
        ? await prisma.peerProgramSkill.findMany({
            where: { peerProgramId: { in: peerIds } },
            include: { skill: { select: { id: true, nameEn: true, nameTh: true } } },
          })
        : [];
    const peerCountBySkillId = new Map<string, number>();
    const skillMetaById = new Map<string, { nameEn: string; nameTh: string }>();
    for (const row of peerSkillRows) {
      peerCountBySkillId.set(row.skillId, (peerCountBySkillId.get(row.skillId) ?? 0) + 1);
      skillMetaById.set(row.skillId, { nameEn: row.skill.nameEn, nameTh: row.skill.nameTh });
    }
    const peerSkillCoverage = [...peerCountBySkillId.entries()]
      .map(([skillId, peerCount]) => ({ ...(skillMetaById.get(skillId) ?? { nameEn: skillId, nameTh: skillId }), peerCount }))
      .sort((a, b) => b.peerCount - a.peerCount)
      .slice(0, 20);

    const [outcomes, demandMatch] = await Promise.all([
      programOutcomes(id),
      fetchDemandMatchSummary(id),
    ]);

    const input: BenchmarkingInsightsInput = {
      mode: 'curriculum-gap',
      programId: id,
      programName: { en: program.nameEn, th: program.nameTh },
      kkuSkills: program.programSkills.map((ps) => ({ nameEn: ps.skill.nameEn, nameTh: ps.skill.nameTh })),
      peerSkillCoverage,
      peerInstitutions: peersResult.peers.map((p) => p.institution),
      graduateOutcomes: outcomes.latest
        ? {
            surveyYear: outcomes.latest.graduationYear,
            employmentRatePct: outcomes.latest.employmentRate * 100,
            averageSalaryThb: outcomes.latest.averageSalary,
            sampleSize: outcomes.latest.sampleSize,
          }
        : null,
      kmitlDemandMatch: demandMatch,
    };

    return this.insights.generate(input, user.userId);
  }
}

// Same source + realDataWhere()-filter as
// program-strategic-narrative-run.ts's LABOUR-MARKET DEMAND channel and
// health-score.ts's scoreRelevanceProgram() driver — kept local (not
// exported there) since duplicating a small query is cheaper than a
// cross-package export for a single caller.
async function fetchDemandMatchSummary(programId: string): Promise<KmitlDemandMatchSummary | null> {
  const rows = await prisma.programDemandMatch.findMany({
    where: { programId, relevant: true, ...realDataWhere() },
    select: { matched: true, skillId: true },
  });
  if (rows.length === 0) return null;

  const matchedDemanded = rows.filter((r) => r.matched).length;
  const unmatchedSkillIds = rows
    .filter((r) => !r.matched)
    .map((r) => r.skillId)
    .slice(0, 5);
  const skills = unmatchedSkillIds.length
    ? await prisma.skill.findMany({
        where: { id: { in: unmatchedSkillIds } },
        select: { id: true, nameEn: true },
      })
    : [];
  const nameById = new Map(skills.map((s) => [s.id, s.nameEn]));
  const topUnmatchedSkills = unmatchedSkillIds.map((id) => nameById.get(id) ?? id);

  return { matchedDemanded, relevantDemanded: rows.length, topUnmatchedSkills };
}
