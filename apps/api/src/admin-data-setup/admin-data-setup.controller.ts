import { Controller, Get } from '@nestjs/common';
import { prisma } from '@kku/db';
import { Authorized, Provenance } from '../common';

// Cross-cutting stats for the admin /admin/data-setup hub. Aggregates
// counts across the input categories the analyst feeds — external
// documents, curriculum, staff, students, financial, data feeds —
// so the hub can surface "what's loaded vs missing" at a glance.
//
// Single read-mostly endpoint; doesn't drive any mutation. Each
// category links from the hub to its dedicated detail page where
// the admin actually uploads / edits.

@Controller('/admin/data-setup')
export class AdminDataSetupController {
  @Get('stats')
  @Authorized('programs:manage:all')
  @Provenance({ sources: [{ id: 'kku-data', name: 'KKU Data' }] })
  async stats() {
    const [
      programsTotal,
      programsWithCurrentCurriculum,
      pdfsByCategory,
      facultyMemberTotal,
      facultyMemberWithProgram,
      enrollmentMetricRows,
      enrollmentMetricPrograms,
      financialMetricRows,
      financialMetricPrograms,
      facultyBudgetRows,
      dataSourcesTotal,
      dataSourcesActive,
      dataSourcesMocked,
      dataSourcesDeprecated,
      kmitlCareers,
      kmitlSkillDemandRows,
      kmitlSkillGrowthRows,
      researchOutputsTotal,
      researchOutputsMatched,
      facultyMembersWithExternalIds,
    ] = await Promise.all([
      prisma.program.count(),
      prisma.program.count({
        where: { documents: { some: { role: 'CURRENT_CURRICULUM', isCurrent: true } } },
      }),
      prisma.pdfDocument.groupBy({
        by: ['sourceCategory'],
        _count: { id: true },
      }),
      prisma.facultyMember.count(),
      prisma.facultyMember.count({ where: { isActive: true } }),
      prisma.enrollmentMetric.count(),
      prisma.enrollmentMetric
        .findMany({ select: { programId: true }, distinct: ['programId'] })
        .then((r) => r.length),
      prisma.financialMetric.count(),
      prisma.financialMetric
        .findMany({ select: { programId: true }, distinct: ['programId'] })
        .then((r) => r.length),
      prisma.facultyBudget.count(),
      prisma.dataSource.count(),
      prisma.dataSource.count({ where: { status: 'active' } }),
      prisma.dataSource.count({ where: { status: 'mocked' } }),
      // Superseded sources are neither live nor mocked. Counted separately so
      // live + mocked + deprecated still reconciles to the total — otherwise
      // retiring a source looks like it vanished from the console.
      prisma.dataSource.count({ where: { status: 'deprecated' } }),
      // Demand-side labour-market skills (KMITL skill-mapping connector)
      prisma.kmitlCareer.count(),
      prisma.kmitlCareerSkillDemand.count(),
      prisma.kmitlSkillGrowth.count(),
      // Research outputs (kku-research / OpenAlex connector)
      prisma.researchOutput.count(),
      prisma.researchOutput.count({ where: { facultyMemberId: { not: null } } }),
      prisma.facultyMember.count({
        where: {
          OR: [
            { orcid: { not: null } },
            { openalexAuthorId: { not: null } },
          ],
        },
      }),
    ]);

    const pdfByCat = new Map(pdfsByCategory.map((r) => [r.sourceCategory, r._count.id]));

    return {
      programs: {
        total: programsTotal,
        withCurriculumPdf: programsWithCurrentCurriculum,
        missingCurriculumPdf: programsTotal - programsWithCurrentCurriculum,
      },
      curriculumDocs: {
        // PdfDocument rows tagged CURRICULUM, regardless of programDocument
        // link state — counts orphan curriculum PDFs too.
        total: pdfByCat.get('CURRICULUM') ?? 0,
      },
      externalDocs: {
        policy: pdfByCat.get('POLICY') ?? 0,
        report: pdfByCat.get('REPORT') ?? 0,
        survey: pdfByCat.get('SURVEY') ?? 0,
        peerProgram: pdfByCat.get('PEER_PROGRAM') ?? 0,
        committeeMinutes: pdfByCat.get('COMMITTEE_MINUTES') ?? 0,
        jobPostingsBatch: pdfByCat.get('JOB_POSTINGS_BATCH') ?? 0,
        other: pdfByCat.get('OTHER') ?? 0,
        total:
          (pdfByCat.get('POLICY') ?? 0) +
          (pdfByCat.get('REPORT') ?? 0) +
          (pdfByCat.get('SURVEY') ?? 0) +
          (pdfByCat.get('PEER_PROGRAM') ?? 0) +
          (pdfByCat.get('COMMITTEE_MINUTES') ?? 0) +
          (pdfByCat.get('JOB_POSTINGS_BATCH') ?? 0) +
          (pdfByCat.get('OTHER') ?? 0),
      },
      facultyStaff: {
        total: facultyMemberTotal,
        active: facultyMemberWithProgram,
      },
      studentInfo: {
        enrollmentMetricRows,
        programsWithEnrollment: enrollmentMetricPrograms,
        programsWithoutEnrollment: programsTotal - enrollmentMetricPrograms,
      },
      financial: {
        programMetrics: financialMetricRows,
        programsWithFinancial: financialMetricPrograms,
        programsWithoutFinancial: programsTotal - financialMetricPrograms,
        facultyBudgetRows,
      },
      dataFeeds: {
        total: dataSourcesTotal,
        live: dataSourcesActive,
        mocked: dataSourcesMocked,
        deprecated: dataSourcesDeprecated,
      },
      laborMarketSkills: {
        // Demand-side skills aggregates from LinkedIn (subscribed by
        // MHESI; API operated by KMITL at https://skill.kmitl.ac.th). The
        // table-prefix `kmitl*` and the metric keys `kmitlCareers / …`
        // match the technical API endpoint name; the underlying source is
        // LinkedIn profile + Thai job-posting + university grad data
        // already aggregated by the API (no per-person rows). Drives the
        // gap-analyzer's labour-market demand source + the health-score's
        // labour-market-alignment driver.
        kmitlCareers,
        kmitlSkillDemandRows,
        kmitlSkillGrowthRows,
      },
      researchOutputs: {
        // Publications via OpenAlex (kku-research connector). Used by the
        // deep-dive's research section + benchmarking subject leadership.
        total: researchOutputsTotal,
        matchedToFaculty: researchOutputsMatched,
        unmatched: researchOutputsTotal - researchOutputsMatched,
        facultyMembersWithExternalIds,
      },
    };
  }
}
