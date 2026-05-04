import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import { Prisma, prisma } from '@kku/db';
import {
  programDecisions,
  programDemandFunnel,
  programFaculty,
  programFinancials,
  programOutcomes,
  programOverview,
  programPeers,
  programSkills,
  programStudentCohorts,
  programDemographicOutlook,
  programTcasStats,
  programAiPeers,
  programAiReadiness,
  programLifecycleVerdict,
  programStrategicNarrative,
  programTrends,
} from '@kku/db';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';
import { CockpitService } from '../cockpit/cockpit.service';
import { PdfService } from '../pdf/pdf.service';
import { buildProgramDetailData } from './program-detail-data';

// Per-program deep-dive endpoints. Endpoint fan-out is explicit (one
// per section) so the UI can parallelise and prioritise above-the-fold
// sections. Role sensitivity (COUNCIL faculty anonymisation) is
// applied in the service based on the caller's role.

const DisagreementBodySchema = z.object({
  sectionKey: z.string().min(1).max(60),
  aiInferenceId: z.string().optional(),
  bodyEn: z.string().optional(),
  bodyTh: z.string().optional(),
});
type DisagreementBody = z.infer<typeof DisagreementBodySchema>;

const NarrativeBodySchema = z.object({
  style: z
    .enum(['thai-narrative', 'executive-summary', 'full-deep-dive'])
    .default('thai-narrative'),
});
type NarrativeBody = z.infer<typeof NarrativeBodySchema>;

@Controller('/programs/:programId')
export class DeepDiveController {
  constructor(
    @Inject(CockpitService) private readonly cockpit: CockpitService,
    private readonly pdf: PdfService,
  ) {}

  @Get('overview')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'health-score', name: 'Health score v2.1' }],
    methodologyVersion: 'health-score.v2.1',
  })
  async overview(@Param('programId') programId: string) {
    const r = await programOverview(programId);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get('demand-funnel')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'mv_metrics', name: 'Metric rollups' }] })
  async demandFunnel(@Param('programId') programId: string) {
    return programDemandFunnel(programId);
  }

  @Get('student-cohorts')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'kku-registry', name: 'KKU Registrar (Oracle)' }],
  })
  async studentCohorts(@Param('programId') programId: string) {
    return programStudentCohorts(programId);
  }

  @Get('tcas-stats')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'tcas', name: 'TCAS3 Admission (mytcas.com / CUPT)' }],
    methodologyVersion: 'tcas-stat.v1',
  })
  async tcasStats(@Param('programId') programId: string) {
    return programTcasStats(programId);
  }

  @Get('strategic-narrative')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'strategic-narrative', name: 'Strategic narrative v1' }],
    methodologyVersion: 'program-strategic-narrative.v1',
  })
  async strategicNarrative(@Param('programId') programId: string) {
    return programStrategicNarrative(programId);
  }

  @Get('ai-readiness')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'ai-readiness', name: 'AI Readiness scorer v1' }],
    methodologyVersion: 'ai-readiness.v1',
  })
  async aiReadiness(@Param('programId') programId: string) {
    return programAiReadiness(programId);
  }

  @Get('lifecycle')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'health-score', name: 'Health score v3.0' }],
    methodologyVersion: 'lifecycle.v1',
  })
  async lifecycle(@Param('programId') programId: string) {
    return programLifecycleVerdict(programId);
  }

  @Get('ai-peers')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'qs-rankings', name: 'QS World University Rankings 2025' },
      { id: 'the-rankings', name: 'Times Higher Education World Rankings 2025' },
    ],
    methodologyVersion: 'program-peer-selection.v1',
  })
  async aiPeers(@Param('programId') programId: string) {
    return programAiPeers(programId);
  }

  @Get('demographic-outlook')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'thailand-demographics', name: 'NESDC Population Projections (republished by BOI)' },
    ],
  })
  async demographicOutlook(@Param('programId') programId: string) {
    return programDemographicOutlook(programId);
  }

  @Get('financials')
  @Authorized('financials:read:all')
  @Provenance({
    sources: [{ id: 'mv_metrics', name: 'Metric rollups' }],
    methodologyVersion: 'cost-allocation.v1',
  })
  async financials(@Param('programId') programId: string) {
    return programFinancials(programId);
  }

  @Get('skills')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'program-skill', name: 'Curriculum skill extraction' },
      { id: 'job-posting-skill', name: 'Labor market skill extraction' },
    ],
  })
  async skills(@Param('programId') programId: string) {
    return programSkills(programId);
  }

  @Get('outcomes')
  @Authorized('outcomes:read:all')
  @Provenance({ sources: [{ id: 'kku-alumni', name: 'KKU Alumni Outcomes' }] })
  async outcomes(@Param('programId') programId: string) {
    return programOutcomes(programId);
  }

  @Get('faculty')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'kku-hr', name: 'KKU HR' }] })
  async faculty(@Param('programId') programId: string, @AuthSession() user: SessionUser) {
    // COUNCIL role sees aggregates only (no names, no salaries — we
    // don't persist salary on FacultyMember today but the redaction
    // shape is in place for when prompt 14 adds it). ADMIN / ANALYST /
    // DEAN / DEPT_HEAD / EXECUTIVE see full detail.
    const visibility: 'full' | 'aggregates-only' =
      user.role === 'COUNCIL' ? 'aggregates-only' : 'full';
    return programFaculty(programId, visibility);
  }

  @Get('peers')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'peer-programs-scraper', name: 'Peer Programs' }] })
  async peers(@Param('programId') programId: string) {
    return programPeers(programId);
  }

  @Get('trends')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'trend-signals', name: 'Trend Signals' }] })
  async trends(@Param('programId') programId: string) {
    return programTrends(programId);
  }

  @Get('decisions')
  @Authorized('decisions:read:all')
  @Provenance({ sources: [{ id: 'council-decisions', name: 'Council Decisions' }] })
  async decisions(@Param('programId') programId: string) {
    return programDecisions(programId);
  }

  // ──────────────────────────────────────────────────────────────────
  // POST /programs/:id/narrative — regenerate the AI narrative for the
  // program. Reuses CockpitService.generateBrief with a per-program
  // scope; that lives there because it already bundles the AI call +
  // AiInference recorder wiring.
  // ──────────────────────────────────────────────────────────────────
  @Post('narrative')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'program.regenerate_narrative', entityType: 'AiInference' })
  async regenerateNarrative(
    @AuthSession() user: SessionUser,
    @Param('programId') programId: string,
    @Body(new ZodValidationPipe(NarrativeBodySchema)) body: NarrativeBody,
  ) {
    const r = await this.cockpit.generateBrief({
      scope: 'program',
      scopeId: programId,
      style: body.style,
      userId: user.userId,
    });
    return r;
  }

  // ──────────────────────────────────────────────────────────────────
  // POST /programs/:id/export-detail-pdf — generates the comprehensive
  // tabular detail PDF (Gotenberg, TH Sarabun New). Returns a signed
  // MinIO URL the caller can redirect to. This is the analyst working
  // document, NOT a Council-facing brief.
  // ──────────────────────────────────────────────────────────────────
  @Post('export-detail-pdf')
  @Authorized('pdf:generate')
  @AuditLog({ action: 'program.export_detail_pdf', entityType: 'PdfGeneration' })
  async exportDetailPdf(
    @AuthSession() user: SessionUser,
    @Param('programId') programId: string,
  ) {
    const facultyVisibility: 'full' | 'aggregates-only' =
      user.role === 'COUNCIL' ? 'aggregates-only' : 'full';
    const data = await buildProgramDetailData(programId, facultyVisibility);
    if (!data) throw new NotFoundException();
    const result = await this.pdf.generateAndPersist(
      {
        templateName: 'program-detail',
        data,
        scope: { level: 'program', id: programId },
      },
      user.userId,
    );
    return {
      pdfUrl: result.signedUrl,
      expiresAt: result.signedUrlExpiresAt?.toISOString(),
      byteSize: result.byteSize,
      pageCount: result.pageCount,
      templateName: result.templateName,
      templateVersion: result.templateVersion,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // POST /programs/:id/disagreements — expert correction of an AI
  // output. Writes an Annotation row (kind='disagreement') linked to
  // the specific AiInference so model-improvement tooling can find it.
  // ──────────────────────────────────────────────────────────────────
  @Post('disagreements')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'program.disagreement', entityType: 'Annotation' })
  async submitDisagreement(
    @AuthSession() user: SessionUser,
    @Param('programId') programId: string,
    @Body(new ZodValidationPipe(DisagreementBodySchema)) body: DisagreementBody,
  ) {
    const data: Prisma.AnnotationUncheckedCreateInput = {
      userId: user.userId,
      entityType: 'program',
      entityId: programId,
      kind: 'disagreement',
      sectionKey: body.sectionKey,
      aiInferenceId: body.aiInferenceId,
      bodyEn: body.bodyEn,
      bodyTh: body.bodyTh,
    };
    return prisma.annotation.create({ data });
  }
}
