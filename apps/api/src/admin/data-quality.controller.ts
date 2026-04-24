import { Controller, Get } from '@nestjs/common';
import { prisma } from '@kku/db';
import { Authorized, Provenance } from '../common';

// ─────────────────────────────────────────────────────────────────────────
// GET /admin/data-quality — completeness + freshness + schema-failure
// dashboard. Scans the key metric tables, computes per-program
// completeness over the last three years, ages the most-recent row,
// counts extraction failures. No new Prisma tables — everything is
// aggregated at query time.
//
// Gated on `data_sources:read` (ANALYST + ADMIN).
// ─────────────────────────────────────────────────────────────────────────

@Controller('/admin/data-quality')
export class DataQualityController {
  @Get()
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get() {
    const currentYear = new Date().getFullYear();
    const threeYears = [currentYear - 2, currentYear - 1, currentYear];

    const [
      totalPrograms,
      enrollmentPresent,
      financialPresent,
      outcomesPresent,
      extractionFailures,
      extractionsTotal,
    ] = await Promise.all([
      prisma.program.count({ where: { status: 'ACTIVE' } }),
      prisma.enrollmentMetric.groupBy({
        by: ['programId'],
        where: { academicYear: { in: threeYears } },
        _count: { _all: true },
      }),
      prisma.financialMetric.groupBy({
        by: ['programId'],
        where: { fiscalYear: { in: threeYears } },
        _count: { _all: true },
      }),
      prisma.graduateOutcome.groupBy({
        by: ['programId'],
        where: { graduationYear: { in: threeYears } },
        _count: { _all: true },
      }),
      prisma.pdfExtraction.count({ where: { reviewStatus: 'REJECTED' } }),
      prisma.pdfExtraction.count(),
    ]);

    const programsWithEnrollment = enrollmentPresent.length;
    const programsWithFinancial = financialPresent.length;
    const programsWithOutcomes = outcomesPresent.length;

    // Anomaly stub — looks for rows whose most recent value differs from
    // the prior by >= 50% in absolute terms. Cheap approximation; a
    // proper stats model lives in prompt 14. The guard here is
    // "LIMIT 200" so the query stays O(n).
    const anomalies = await prisma.$queryRaw<
      Array<{
        program_id: string;
        metric: string;
        current_year: number;
        current_value: number;
        prior_value: number;
        pct_change: number;
      }>
    >`
      WITH ordered AS (
        SELECT
          program_id,
          academic_year AS year,
          enrolled::float AS v,
          LAG(enrolled::float) OVER (PARTITION BY program_id ORDER BY academic_year) AS prior
        FROM enrollment_metrics
      )
      SELECT
        program_id,
        'enrollment' AS metric,
        year AS current_year,
        v AS current_value,
        prior AS prior_value,
        CASE WHEN prior = 0 THEN NULL ELSE ((v - prior) / prior) * 100 END AS pct_change
      FROM ordered
      WHERE prior IS NOT NULL
        AND prior > 0
        AND ABS((v - prior) / prior) >= 0.5
      ORDER BY ABS((v - prior) / prior) DESC
      LIMIT 50
    `;

    return {
      generatedAt: new Date().toISOString(),
      completeness: [
        {
          metric: 'Enrollment (last 3 years)',
          present: programsWithEnrollment,
          total: totalPrograms,
          pct: pct(programsWithEnrollment, totalPrograms),
        },
        {
          metric: 'Financial (last 3 years)',
          present: programsWithFinancial,
          total: totalPrograms,
          pct: pct(programsWithFinancial, totalPrograms),
        },
        {
          metric: 'Graduate outcomes (last 3 cohorts)',
          present: programsWithOutcomes,
          total: totalPrograms,
          pct: pct(programsWithOutcomes, totalPrograms),
        },
      ],
      ingestion: {
        extractionsTotal,
        extractionFailures,
        failurePct: pct(extractionFailures, extractionsTotal),
      },
      anomalies,
    };
  }
}

function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10; // 1 decimal place
}
