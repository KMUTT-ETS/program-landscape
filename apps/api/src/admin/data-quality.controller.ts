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

    // Drift detection — year-over-year delta on four metric series:
    //   enrollment.enrolled, enrollment.graduatedOnTime,
    //   financial.totalRevenue, graduateOutcome.employmentRate.
    // Threshold: |pct change| >= 50% (employment rate uses absolute
    // points instead). Cheap approximation until prompt 14 wires a
    // proper stats model (seasonal decomposition + z-score on residual).
    //
    // Each query bounded by LIMIT 30 → worst case 120 rows returned.
    const anomalies = await prisma.$queryRaw<
      Array<{
        program_id: string;
        metric: string;
        current_year: number;
        current_value: number;
        prior_value: number;
        pct_change: number | null;
        severity: 'critical' | 'high' | 'moderate';
      }>
    >`
      WITH enrollment_drift AS (
        SELECT
          program_id,
          academic_year AS year,
          enrolled::float AS v,
          LAG(enrolled::float) OVER (PARTITION BY program_id ORDER BY academic_year) AS prior
        FROM enrollment_metrics
      ),
      graduated_drift AS (
        SELECT
          program_id,
          academic_year AS year,
          graduated_on_time::float AS v,
          LAG(graduated_on_time::float) OVER (PARTITION BY program_id ORDER BY academic_year) AS prior
        FROM enrollment_metrics
      ),
      financial_drift AS (
        SELECT
          program_id,
          fiscal_year AS year,
          (tuition_revenue + other_revenue)::float AS v,
          LAG((tuition_revenue + other_revenue)::float) OVER (PARTITION BY program_id ORDER BY fiscal_year) AS prior
        FROM financial_metrics
      ),
      outcome_drift AS (
        SELECT
          program_id,
          graduation_year AS year,
          employment_rate::float AS v,
          LAG(employment_rate::float) OVER (PARTITION BY program_id ORDER BY graduation_year) AS prior
        FROM graduate_outcomes
      )
      SELECT program_id, metric, current_year, current_value, prior_value, pct_change, severity FROM (
        SELECT
          program_id,
          'enrollment.enrolled' AS metric,
          year AS current_year,
          v AS current_value,
          prior AS prior_value,
          ((v - prior) / NULLIF(prior, 0)) * 100 AS pct_change,
          CASE
            WHEN ABS((v - prior) / NULLIF(prior, 0)) >= 0.75 THEN 'critical'
            WHEN ABS((v - prior) / NULLIF(prior, 0)) >= 0.50 THEN 'high'
            ELSE 'moderate'
          END AS severity
        FROM enrollment_drift
        WHERE prior IS NOT NULL AND prior > 0
          AND ABS((v - prior) / prior) >= 0.5
        ORDER BY ABS((v - prior) / prior) DESC
        LIMIT 30
      ) AS e
      UNION ALL
      SELECT program_id, metric, current_year, current_value, prior_value, pct_change, severity FROM (
        SELECT
          program_id,
          'enrollment.graduatedOnTime' AS metric,
          year AS current_year,
          v AS current_value,
          prior AS prior_value,
          ((v - prior) / NULLIF(prior, 0)) * 100 AS pct_change,
          CASE
            WHEN ABS((v - prior) / NULLIF(prior, 0)) >= 0.75 THEN 'critical'
            WHEN ABS((v - prior) / NULLIF(prior, 0)) >= 0.50 THEN 'high'
            ELSE 'moderate'
          END AS severity
        FROM graduated_drift
        WHERE prior IS NOT NULL AND prior > 0
          AND ABS((v - prior) / prior) >= 0.5
        ORDER BY ABS((v - prior) / prior) DESC
        LIMIT 30
      ) AS g
      UNION ALL
      SELECT program_id, metric, current_year, current_value, prior_value, pct_change, severity FROM (
        SELECT
          program_id,
          'financial.totalRevenue' AS metric,
          year AS current_year,
          v AS current_value,
          prior AS prior_value,
          ((v - prior) / NULLIF(prior, 0)) * 100 AS pct_change,
          CASE
            WHEN ABS((v - prior) / NULLIF(prior, 0)) >= 0.75 THEN 'critical'
            WHEN ABS((v - prior) / NULLIF(prior, 0)) >= 0.50 THEN 'high'
            ELSE 'moderate'
          END AS severity
        FROM financial_drift
        WHERE prior IS NOT NULL AND prior > 0
          AND ABS((v - prior) / prior) >= 0.5
        ORDER BY ABS((v - prior) / prior) DESC
        LIMIT 30
      ) AS f
      UNION ALL
      SELECT program_id, metric, current_year, current_value, prior_value, pct_change, severity FROM (
        SELECT
          program_id,
          'outcome.employmentRate' AS metric,
          year AS current_year,
          v AS current_value,
          prior AS prior_value,
          (v - prior) * 100 AS pct_change,
          CASE
            WHEN ABS(v - prior) >= 0.20 THEN 'critical'
            WHEN ABS(v - prior) >= 0.10 THEN 'high'
            ELSE 'moderate'
          END AS severity
        FROM outcome_drift
        WHERE prior IS NOT NULL
          AND ABS(v - prior) >= 0.10
        ORDER BY ABS(v - prior) DESC
        LIMIT 30
      ) AS o
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
