import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  RISK_SCORING_VERSION,
  latestOverlapRunCompletedAt,
  prisma,
  selfCompetitionRows,
  type SelfCompetitionRow,
} from '@kku/db';
import type { ApiMeta, SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
  assertProgramAccessible,
  resolveEffectiveScope,
} from '../common';
import { RisksService } from './risks.service';
import { PROGRAM_OVERLAP_PROVENANCE } from '../education/program-overlap.provenance';

// Risk reads are gated with `risks:read:all` (every role has it). The
// scope clamp here is what stops a FACULTY_USER from seeing other
// faculties' risk profiles. resolveEffectiveScope() unions the user's
// primary session scope with their UserScope grants (so a user whose
// primary role is PROGRAM_USER but who has a UserScope grant of
// UNIVERSITY_USER sees the full portfolio — same multi-scope chain
// `assertProgramAccessible` already honours for per-program endpoints).
const assertProgramAccessibleForRisks = assertProgramAccessible;

const PortfolioQuerySchema = z.object({
  level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']).default('BACHELOR'),
  facultyId: z.string().optional(),
  // NEEDS_DATA was added in v1.1; must be acceptable as a filter value
  // (e.g. /risks?tier=NEEDS_DATA from a clicked tile).
  tier: z.enum(['NEEDS_DATA', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL']).optional(),
});
type PortfolioQuery = z.infer<typeof PortfolioQuerySchema>;

export const SelfCompetitionQuerySchema = z.object({
  // Optional: the panel may list every level at once.
  level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']).optional(),
  facultyId: z.string().optional(),
});
type SelfCompetitionQuery = z.infer<typeof SelfCompetitionQuerySchema>;

const SetMeasureStatusSchema = z.object({
  status: z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED']),
  decisionId: z.string().optional(),
});
type SetMeasureStatus = z.infer<typeof SetMeasureStatusSchema>;

@Controller('/risks')
export class RisksController {
  constructor(private readonly risks: RisksService) {}

  @Get('portfolio')
  @Authorized('risks:read:all')
  @Provenance({
    sources: [
      { id: 'kku-tcas-funnel', name: 'Registrar · POWERBI.ADMISSION_STAT_CURRID' },
      { id: 'kku-finance', name: 'Finance · ERPPowerBI.BudgetData' },
      { id: 'program-skills-detailed', name: 'AI-extracted Program ↔ Skill linkage' },
      { id: 'thailand-cohort', name: 'NESDC Population Projection 2010–2040' },
    ],
    methodologyVersion: 'risk-scoring.v1',
  })
  async portfolio(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(PortfolioQuerySchema)) q: PortfolioQuery,
  ) {
    const scope = await resolveEffectiveScope(user);
    if (scope.mode === 'none') {
      throw new ForbiddenException(
        'Your account has no faculty or program assignment. Contact an admin.',
      );
    }
    const opts: {
      level?: typeof q.level;
      facultyId?: string;
      facultyIds?: string[];
      programId?: string;
      programIds?: string[];
      tier?: typeof q.tier;
    } = { level: q.level, tier: q.tier };
    if (scope.mode === 'scoped') {
      // If a manual ?facultyId= is supplied, it must intersect with the
      // user's granted faculties — else 403 (deliberate cross-scope
      // probe).
      if (q.facultyId && !scope.facultyIds.includes(q.facultyId)) {
        throw new ForbiddenException(
          "You can only view risks for faculties / programs assigned to your account.",
        );
      }
      opts.facultyIds = q.facultyId ? [q.facultyId] : scope.facultyIds;
      opts.programIds = scope.programIds;
    } else if (q.facultyId) {
      // Admin / UNIVERSITY_USER: optional manual ?facultyId= filter.
      opts.facultyId = q.facultyId;
    }
    return this.risks.portfolio(opts);
  }

  // Self-competition panel (program-overlap spec §10.2): the pairs behind a
  // WARN / CRITICAL reading of curriculum_overlap_max or market_confusion_max
  // in the latest breach rows. Authorization mirrors @Get('portfolio').
  @Get('self-competition')
  @Authorized('risks:read:all')
  @Provenance({
    sources: [
      { id: 'risk-scoring', name: `${RISK_SCORING_VERSION} KRI evaluator` },
      ...(PROGRAM_OVERLAP_PROVENANCE.sources ?? []),
      { id: 'kku-tcas-funnel', name: 'Registrar · POWERBI.ADMISSION_STAT_CURRID' },
    ],
    methodologyVersion: RISK_SCORING_VERSION,
    caveats: PROGRAM_OVERLAP_PROVENANCE.caveats,
  })
  async selfCompetition(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(SelfCompetitionQuerySchema)) q: SelfCompetitionQuery,
  ): Promise<{ data: SelfCompetitionRow[]; meta: Partial<ApiMeta> }> {
    const scope = await resolveEffectiveScope(user);
    if (scope.mode === 'none') {
      throw new ForbiddenException(
        'Your account has no faculty or program assignment. Contact an admin.',
      );
    }
    const opts: { level?: SelfCompetitionQuery['level']; facultyIds?: string[]; programIds?: string[] } = {
      level: q.level,
    };
    if (scope.mode === 'scoped') {
      if (q.facultyId && !scope.facultyIds.includes(q.facultyId)) {
        throw new ForbiddenException(
          "You can only view risks for faculties / programs assigned to your account.",
        );
      }
      if (q.facultyId) {
        // An explicit faculty filter means THAT faculty only: programme
        // grants elsewhere are not ORed back in.
        opts.facultyIds = [q.facultyId];
      } else {
        opts.facultyIds = scope.facultyIds;
        opts.programIds = scope.programIds;
      }
    } else if (q.facultyId) {
      opts.facultyIds = [q.facultyId];
    }
    const data = await selfCompetitionRows(opts);
    // Freshness: the newest breach a listed pair rests on; with nothing
    // listed, the overlap run the (empty) answer rests on.
    let freshnessDate: string | null = null;
    for (const r of data) {
      for (const b of r.breaches) if (freshnessDate === null || b.observedAt > freshnessDate) freshnessDate = b.observedAt;
    }
    if (freshnessDate === null) freshnessDate = await latestOverlapRunCompletedAt(q.level);
    return { data, meta: { freshnessDate } };
  }

  @Get('indicators')
  @Authorized('risks:read:all')
  @Provenance({
    sources: [
      { id: 'kku-tcas-funnel', name: 'Registrar · POWERBI.ADMISSION_STAT_CURRID' },
      { id: 'kku-policy', name: 'Council intake-floor policy' },
    ],
    methodologyVersion: 'risk-scoring.v1',
  })
  async indicators() {
    // The indicator catalog itself (the 12 KRI definitions) carries no
    // per-program data — it's static metadata describing what's
    // measured. Visible to every authenticated role; no clamp needed.
    return this.risks.listIndicators();
  }

  @Get('indicators/:slug/breaches')
  @Authorized('risks:read:all')
  @Provenance({
    sources: [{ id: 'risk-scoring', name: 'risk-scoring.v1 KRI evaluator' }],
    methodologyVersion: 'risk-scoring.v1',
  })
  async indicatorBreaches(
    @AuthSession() user: SessionUser,
    @Param('slug') slug: string,
  ) {
    const scope = await resolveEffectiveScope(user);
    if (scope.mode === 'none') {
      throw new ForbiddenException(
        'Your account has no faculty or program assignment. Contact an admin.',
      );
    }
    if (scope.mode === 'all') {
      return this.risks.indicatorBreaches(slug);
    }
    return this.risks.indicatorBreaches(slug, {
      facultyIds: scope.facultyIds,
      programIds: scope.programIds,
    });
  }

  @Get('drivers')
  @Authorized('risks:read:all')
  @Provenance({
    sources: [
      { id: 'thailand-cohort', name: 'NESDC Population Projection 2010–2040' },
      { id: 'frey-osborne', name: 'Frey & Osborne (2017) + WEF Future of Jobs 2023' },
    ],
    methodologyVersion: 'risk-scoring.v1',
  })
  async drivers(@AuthSession() user: SessionUser) {
    const scope = await resolveEffectiveScope(user);
    if (scope.mode === 'none') {
      throw new ForbiddenException(
        'Your account has no faculty or program assignment. Contact an admin.',
      );
    }
    if (scope.mode === 'all') return this.risks.drivers();
    return this.risks.drivers({
      facultyIds: scope.facultyIds,
      programIds: scope.programIds,
    });
  }

  @Get('programs/:id')
  @Authorized('risks:read:all')
  @Provenance({
    sources: [
      { id: 'risk-scoring', name: 'risk-scoring.v1' },
      { id: 'risk-assessment-ai', name: 'AI risk-assessment.v1' },
    ],
    methodologyVersion: 'risk-scoring.v1',
  })
  async programProfile(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
  ) {
    await assertProgramAccessibleForRisks(id, user);
    return this.risks.programProfile(id);
  }

  @Patch('measures/:id/status')
  @Authorized('risks:measures:edit')
  @AuditLog({ entityType: 'risk_measure', action: 'set_status' })
  async setMeasureStatus(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetMeasureStatusSchema)) body: SetMeasureStatus,
  ) {
    // Defense in depth: even if the permission map ever opens
    // `risks:measures:edit` to FACULTY_USER, refuse to mutate a
    // measure on a program the user can't see. assertProgramAccessible
    // already short-circuits for admin-grade + UNIVERSITY_USER (incl.
    // via UserScope rows).
    const measure = await prisma.riskMeasure.findUnique({
      where: { id },
      select: { assessment: { select: { programId: true } } },
    });
    if (!measure) throw new NotFoundException();
    await assertProgramAccessibleForRisks(measure.assessment.programId, user);
    return this.risks.setMeasureStatus(id, body.status, body.decisionId);
  }

  @Post('admin/seed-indicators')
  @Authorized('risks:assess:any')
  @AuditLog({ entityType: 'risk_indicator', action: 'seed_catalog' })
  async seedIndicators() {
    return this.risks.upsertIndicatorCatalog();
  }
}
