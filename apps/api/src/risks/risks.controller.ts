import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';
import { RisksService } from './risks.service';

// Risk reads are gated with `risks:read:all` (every role has it). The
// scope clamp here is what stops a FACULTY_USER from seeing other
// faculties' risk profiles, the same way deep-dive + cockpit clamp.
function seesAllRisks(role: SessionUser['role']): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SYSTEM_ADMIN' ||
    role === 'UNIVERSITY_USER'
  );
}

// Refuse access to a per-program risk endpoint when the program lies
// outside the user's faculty / program. Mirrors deep-dive's
// assertProgramAccessible exactly — kept inline here so risks doesn't
// reach into the programs module.
async function assertProgramAccessibleForRisks(
  programId: string,
  user: SessionUser,
): Promise<void> {
  if (seesAllRisks(user.role)) return;
  if (user.role !== 'FACULTY_USER' && user.role !== 'PROGRAM_USER') {
    throw new ForbiddenException('Your role cannot view program risk profiles.');
  }
  if (user.role === 'PROGRAM_USER') {
    if (!user.programId) {
      throw new ForbiddenException(
        'Your account has no program assignment. Contact an admin.',
      );
    }
    if (user.programId !== programId) {
      throw new ForbiddenException(
        "This is not the program assigned to your account.",
      );
    }
    return;
  }
  // FACULTY_USER
  if (!user.facultyId) {
    throw new ForbiddenException(
      'Your account has no faculty assignment. Contact an admin.',
    );
  }
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { facultyId: true },
  });
  if (!program) throw new NotFoundException();
  if (program.facultyId !== user.facultyId) {
    throw new ForbiddenException(
      'This program is outside the faculty assigned to your account.',
    );
  }
}

const PortfolioQuerySchema = z.object({
  level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']).default('BACHELOR'),
  facultyId: z.string().optional(),
  // NEEDS_DATA was added in v1.1; must be acceptable as a filter value
  // (e.g. /risks?tier=NEEDS_DATA from a clicked tile).
  tier: z.enum(['NEEDS_DATA', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL']).optional(),
});
type PortfolioQuery = z.infer<typeof PortfolioQuerySchema>;

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
      { id: 'kku-tcas-funnel', name: 'KKU Registry · POWERBI.ADMISSION_STAT_CURRID' },
      { id: 'kku-finance', name: 'KKU Finance · ERPPowerBI.BudgetData' },
      { id: 'program-skills-detailed', name: 'AI-extracted Program ↔ Skill linkage' },
      { id: 'thailand-cohort', name: 'NESDC Population Projection 2010–2040' },
    ],
    methodologyVersion: 'risk-scoring.v1',
  })
  async portfolio(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(PortfolioQuerySchema)) q: PortfolioQuery,
  ) {
    // Clamp scope for FACULTY_USER + PROGRAM_USER. Cross-scope queries
    // (asking for a different faculty/department than the one you're
    // assigned to) are refused outright — not silently narrowed —
    // because the only way the client passes them is by deliberate
    // override.
    let opts: {
      level?: typeof q.level;
      facultyId?: string;
      programId?: string;
      tier?: typeof q.tier;
    } = { ...q };
    if (!seesAllRisks(user.role)) {
      if (!user.facultyId) {
        throw new ForbiddenException(
          'Your account has no faculty assignment. Contact an admin.',
        );
      }
      if (q.facultyId && q.facultyId !== user.facultyId) {
        throw new ForbiddenException("You can only view your own faculty's risk portfolio.");
      }
      opts.facultyId = user.facultyId;
      // PROGRAM_USER: clamp to a single program (the one they're
      // assigned to). The portfolio table will then have exactly one
      // row — by design.
      if (user.role === 'PROGRAM_USER') {
        if (!user.programId) {
          throw new ForbiddenException(
            'Your account has no program assignment. Contact an admin.',
          );
        }
        opts.programId = user.programId;
      }
    }
    return this.risks.portfolio(opts);
  }

  @Get('indicators')
  @Authorized('risks:read:all')
  @Provenance({
    sources: [
      { id: 'kku-tcas-funnel', name: 'KKU Registry · POWERBI.ADMISSION_STAT_CURRID' },
      { id: 'kku-policy', name: 'KKU Council intake-floor policy' },
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
    const result = await this.risks.indicatorBreaches(slug);
    // Filter the per-program breach list and the histogram to only
    // programs the user can see. Indicator metadata + severity-counts
    // pass through unchanged; the breach rows are scoped.
    if (seesAllRisks(user.role)) return result;
    if (!user.facultyId) {
      throw new ForbiddenException(
        'Your account has no faculty assignment. Contact an admin.',
      );
    }
    if (user.role === 'PROGRAM_USER') {
      // Single-program scope — keep only the row for their own program.
      const breaches = user.programId
        ? result.breaches.filter((b) => b.programId === user.programId)
        : [];
      return { ...result, breaches };
    }
    const filteredBreaches = result.breaches.filter((b) => b.facultyId === user.facultyId);
    return { ...result, breaches: filteredBreaches };
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
    // Drivers view aggregates university-wide risk-driver distributions
    // (recruitment decay × AI disruption × demographic). FACULTY_USER
    // sees only their own faculty's slice; PROGRAM_USER narrows to the
    // single program they're assigned to.
    if (seesAllRisks(user.role)) return this.risks.drivers();
    if (user.role === 'PROGRAM_USER') {
      if (!user.programId) {
        throw new ForbiddenException(
          'Your account has no program assignment. Contact an admin.',
        );
      }
      return this.risks.drivers({ programId: user.programId });
    }
    if (!user.facultyId) {
      throw new ForbiddenException(
        'Your account has no faculty assignment. Contact an admin.',
      );
    }
    return this.risks.drivers({ facultyId: user.facultyId });
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
    // measure on a program the user can't see.
    if (!seesAllRisks(user.role)) {
      const measure = await prisma.riskMeasure.findUnique({
        where: { id },
        select: { assessment: { select: { programId: true } } },
      });
      if (!measure) throw new NotFoundException();
      await assertProgramAccessibleForRisks(measure.assessment.programId, user);
    }
    return this.risks.setMeasureStatus(id, body.status, body.decisionId);
  }

  @Post('admin/seed-indicators')
  @Authorized('risks:assess:any')
  @AuditLog({ entityType: 'risk_indicator', action: 'seed_catalog' })
  async seedIndicators() {
    return this.risks.upsertIndicatorCatalog();
  }
}
