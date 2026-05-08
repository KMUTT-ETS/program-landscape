import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AuditLog,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';
import { RisksService } from './risks.service';

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
  async portfolio(@Query(new ZodValidationPipe(PortfolioQuerySchema)) q: PortfolioQuery) {
    return this.risks.portfolio(q);
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
    return this.risks.listIndicators();
  }

  @Get('indicators/:slug/breaches')
  @Authorized('risks:read:all')
  @Provenance({
    sources: [{ id: 'risk-scoring', name: 'risk-scoring.v1 KRI evaluator' }],
    methodologyVersion: 'risk-scoring.v1',
  })
  async indicatorBreaches(@Param('slug') slug: string) {
    return this.risks.indicatorBreaches(slug);
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
  async drivers() {
    return this.risks.drivers();
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
  async programProfile(@Param('id') id: string) {
    return this.risks.programProfile(id);
  }

  @Patch('measures/:id/status')
  @Authorized('risks:measures:edit')
  @AuditLog({ entityType: 'risk_measure', action: 'set_status' })
  async setMeasureStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetMeasureStatusSchema)) body: SetMeasureStatus,
  ) {
    return this.risks.setMeasureStatus(id, body.status, body.decisionId);
  }

  @Post('admin/seed-indicators')
  @Authorized('risks:assess:any')
  @AuditLog({ entityType: 'risk_indicator', action: 'seed_catalog' })
  async seedIndicators() {
    return this.risks.upsertIndicatorCatalog();
  }
}
