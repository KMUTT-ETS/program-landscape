import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import { Prisma, prisma } from '@kku/db';
import {
  programCourses,
  programDecisions,
  programDemandFunnel,
  programFaculty,
  programFinancials,
  getProgramHealthBenchmarks,
  programOutcomes,
  programOverview,
  programPeers,
  programSkills,
  programStudentCohorts,
  programDemographicOutlook,
  programTcasStats,
  programRecruitment,
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
  assertProgramAccessible,
  seesAllScopes,
} from '../common';
import { CockpitService } from '../cockpit/cockpit.service';
import { PdfService } from '../pdf/pdf.service';
import { buildProgramDetailData } from './program-detail-data';

// Per-program deep-dive endpoints. Endpoint fan-out is explicit (one
// per section) so the UI can parallelise and prioritise above-the-fold
// sections. Faculty PII visibility is decided per-request based on the
// caller's role + scope match against the program's faculty/department.

// `aggregates-only` redacts names + employeeCode + specialisation from
// FacultyMember rows. `full` returns everything. Decision rule:
//   admin-grade (SUPER_ADMIN/SYSTEM_ADMIN)        → full
//   FACULTY_USER + program is in user's faculty   → full
//   PROGRAM_USER + program is the user's program  → full
//   everyone else (incl. UNIVERSITY_USER for any
//   program, FACULTY_USER cross-faculty, etc.)    → aggregates-only
async function resolveFacultyVisibility(
  programId: string,
  user: SessionUser,
): Promise<'full' | 'aggregates-only'> {
  if (user.role === 'SUPER_ADMIN' || user.role === 'SYSTEM_ADMIN') return 'full';
  if (user.role !== 'FACULTY_USER' && user.role !== 'PROGRAM_USER') {
    return 'aggregates-only';
  }
  if (user.role === 'PROGRAM_USER') {
    return user.programId && user.programId === programId ? 'full' : 'aggregates-only';
  }
  // FACULTY_USER — verify the program belongs to user's faculty.
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { facultyId: true },
  });
  if (!program) return 'aggregates-only';
  return user.facultyId === program.facultyId ? 'full' : 'aggregates-only';
}

// Per-program access gate is now in apps/api/src/common/scope-guards.ts
// — assertProgramAccessible() — and shared with /risks, /trends,
// /benchmarking. Imported above.
void seesAllScopes; // re-export usage placeholder

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
  async overview(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    const r = await programOverview(programId);
    if (!r) throw new NotFoundException();
    return r;
  }

  // University + faculty program-level dimension averages, overlaid on the
  // Health radar. Separate from /overview because the all-programs scoring
  // is heavier (memoised 5 min); fetched in parallel with the other
  // sections so it never blocks the page's auth canary.
  @Get('health-benchmarks')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'health-score', name: 'Health score v2.1' }],
    methodologyVersion: 'health-score.v2.1',
  })
  async healthBenchmarks(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    const r = await getProgramHealthBenchmarks(programId);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get('demand-funnel')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'mv_metrics', name: 'Metric rollups' }] })
  async demandFunnel(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programDemandFunnel(programId);
  }

  @Get('student-cohorts')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'kku-registry', name: 'KKU Registrar (Oracle)' }],
  })
  async studentCohorts(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programStudentCohorts(programId);
  }

  @Get('tcas-stats')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'tcas', name: 'TCAS3 Admission (mytcas.com / CUPT)' }],
    methodologyVersion: 'tcas-stat.v1',
  })
  async tcasStats(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programTcasStats(programId);
  }

  @Get('recruitment')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      {
        id: 'kku-tcas-funnel',
        name: 'KKU Registry · POWERBI.ADMISSION_STAT_CURRID',
      },
    ],
    methodologyVersion: 'program-recruitment.v1',
  })
  async recruitment(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programRecruitment(programId);
  }

  @Get('strategic-narrative')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'strategic-narrative', name: 'Strategic narrative v1' }],
    methodologyVersion: 'program-strategic-narrative.v1',
  })
  async strategicNarrative(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programStrategicNarrative(programId);
  }

  @Get('ai-readiness')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'ai-readiness', name: 'AI Readiness scorer v1' }],
    methodologyVersion: 'ai-readiness.v1',
  })
  async aiReadiness(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programAiReadiness(programId);
  }

  @Get('lifecycle')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'health-score', name: 'Health score v3.0' }],
    methodologyVersion: 'lifecycle.v1.4',
  })
  async lifecycle(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
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
  async aiPeers(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programAiPeers(programId);
  }

  @Get('demographic-outlook')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'thailand-demographics', name: 'NESDC Population Projections (republished by BOI)' },
    ],
  })
  async demographicOutlook(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programDemographicOutlook(programId);
  }

  @Get('financials')
  @Authorized('financials:read:all')
  @Provenance({
    sources: [{ id: 'mv_metrics', name: 'Metric rollups' }],
    methodologyVersion: 'cost-allocation.v1',
  })
  async financials(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
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
  async skills(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programSkills(programId);
  }

  @Get('outcomes')
  @Authorized('outcomes:read:all')
  @Provenance({ sources: [{ id: 'kku-alumni', name: 'KKU Alumni Outcomes' }] })
  async outcomes(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programOutcomes(programId);
  }

  @Get('faculty')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'kku-hr', name: 'KKU HR' }] })
  async faculty(@Param('programId') programId: string, @AuthSession() user: SessionUser) {
    await assertProgramAccessible(programId, user);
    const visibility = await resolveFacultyVisibility(programId, user);
    return programFaculty(programId, visibility);
  }

  @Get('courses')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'program-courses-extract', name: 'Program courses extraction (program-courses-extract.v1)' },
      { id: 'kku-tcas-funnel', name: 'KKU class offerings (POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER)' },
    ],
  })
  async courses(
    @Param('programId') programId: string,
    @AuthSession() user: SessionUser,
    @Query('semester') semesterParam?: string | string[],
  ) {
    await assertProgramAccessible(programId, user);
    // `?semester=1&semester=2` arrives as either a string or an array
    // depending on whether the client repeated the key. Normalise to
    // number[] before passing in; the helper applies a 1+2 default
    // when the list is empty.
    const semesters = (Array.isArray(semesterParam) ? semesterParam : semesterParam ? [semesterParam] : [])
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 4);
    return programCourses(programId, semesters.length > 0 ? { semesters } : {});
  }

  @Get('peers')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'peer-programs-scraper', name: 'Peer Programs' }] })
  async peers(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programPeers(programId);
  }

  @Get('trends')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'trend-signals', name: 'Trend Signals' }] })
  async trends(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    return programTrends(programId);
  }

  @Get('decisions')
  @Authorized('decisions:read:all')
  @Provenance({ sources: [{ id: 'council-decisions', name: 'Council Decisions' }] })
  async decisions(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
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
    await assertProgramAccessible(programId, user);
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
    await assertProgramAccessible(programId, user);
    const facultyVisibility = await resolveFacultyVisibility(programId, user);
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
    await assertProgramAccessible(programId, user);
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
