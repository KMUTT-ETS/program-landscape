import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './index';

// ──────────────────────────────────────────────────────────────────────────
// Scope-aware metric queries
//
// Every module in the app is required to go through this helper for any
// cross-program rollup. The materialized views (see migrations) are the
// single source of truth for aggregated metric shapes; this module is the
// only place that queries them.
//
// Adding a new metric family:
//  1. Add the MV columns (or a new MV) in a migration.
//  2. Extend MetricFamily + the corresponding Zod row schema below.
//  3. Extend `queryMetricByScope` to route to the right MV.
// ──────────────────────────────────────────────────────────────────────────

export const ScopeLevelSchema = z.enum([
  'university',
  'faculty',
  'department',
  'program',
]);
export type ScopeLevel = z.infer<typeof ScopeLevelSchema>;

export const MetricFamilySchema = z.enum(['enrollment', 'financial', 'outcomes']);
export type MetricFamily = z.infer<typeof MetricFamilySchema>;

export const YearRangeSchema = z
  .object({
    from: z.number().int().min(1900).max(2200),
    to: z.number().int().min(1900).max(2200),
  })
  .refine((r: { from: number; to: number }) => r.from <= r.to, {
    message: 'from must be ≤ to',
  });
export type YearRange = z.infer<typeof YearRangeSchema>;

export interface ScopeQuery {
  scope: ScopeLevel;
  scopeId?: string;
  family: MetricFamily;
  years?: YearRange;
}

// MV row shape — the three MVs share this schema by design (see migrations).
// Columns not relevant to a given metric family come back as null.
export const MetricRowSchema = z.object({
  scope: ScopeLevelSchema,
  scopeId: z.string(),
  year: z.number().int(),

  // Enrollment
  applicationsTotal: z.number().int().nullable(),
  admittedTotal: z.number().int().nullable(),
  enrolledTotal: z.number().int().nullable(),
  retainedYear2Total: z.number().int().nullable(),
  graduatedOnTimeTotal: z.number().int().nullable(),
  graduatedLateTotal: z.number().int().nullable(),
  dropoutsTotal: z.number().int().nullable(),

  // Financial (Decimal comes back as string from Postgres; we parse to number)
  tuitionRevenueTotal: z.coerce.number().nullable(),
  totalCostTotal: z.coerce.number().nullable(),
  netContributionTotal: z.coerce.number().nullable(),

  // Outcomes (weighted averages)
  employmentRateWeighted: z.coerce.number().nullable(),
  averageSalaryWeighted: z.coerce.number().nullable(),

  // Meta
  programCount: z.number().int(),
  latestFreshness: z.coerce.date().nullable(),
});
export type MetricRow = z.infer<typeof MetricRowSchema>;

export const MetricRowsSchema = z.array(MetricRowSchema);

function viewNameFor(level: ScopeLevel): string {
  switch (level) {
    case 'university':
      return 'mv_university_metrics';
    case 'faculty':
      return 'mv_faculty_metrics';
    case 'department':
      return 'mv_department_metrics';
    case 'program':
      return 'mv_program_metrics';
    default: {
      const _never: never = level;
      throw new Error(`unknown scope ${String(_never)}`);
    }
  }
}

function scopeIdColumnFor(level: ScopeLevel): string {
  switch (level) {
    case 'university':
      return 'university_id';
    case 'faculty':
      return 'faculty_id';
    case 'department':
      return 'department_id';
    case 'program':
      return 'program_id';
    default: {
      const _never: never = level;
      throw new Error(`unknown scope ${String(_never)}`);
    }
  }
}

/**
 * Query rolled-up metrics at any of the four scopes.
 *
 * This is the ONLY public entry point modules should use for scope rollups.
 * Raw metric tables (`enrollment_metrics`, `financial_metrics`,
 * `graduate_outcomes`) are accessed directly only by the ingestion jobs
 * that write them and by the MV refresh.
 *
 * @returns rows validated through {@link MetricRowSchema}. Never throws on
 *   shape mismatch — throws on DB error. Callers get typed rows.
 */
export async function queryMetricByScope(q: ScopeQuery): Promise<MetricRow[]> {
  const level = ScopeLevelSchema.parse(q.scope);
  MetricFamilySchema.parse(q.family);
  const years = q.years ? YearRangeSchema.parse(q.years) : undefined;

  const view = viewNameFor(level);
  const idCol = scopeIdColumnFor(level);
  const scopeId = q.scopeId;

  // NOTE: `view` and `idCol` are constants in this file — not user input — so
  // they are safe to interpolate with Prisma.raw. `scopeId` and year bounds
  // are parameterised via ${...}.
  const whereClauses: Prisma.Sql[] = [];
  if (scopeId !== undefined) {
    if (level === 'university') {
      // scopeId is ignored at university level; the single row key is 'kku'.
    } else {
      whereClauses.push(Prisma.sql`${Prisma.raw(idCol)} = ${scopeId}`);
    }
  }
  if (years) {
    whereClauses.push(Prisma.sql`year BETWEEN ${years.from} AND ${years.to}`);
  }
  const whereSql =
    whereClauses.length > 0
      ? Prisma.sql` WHERE ${Prisma.join(whereClauses, ' AND ')}`
      : Prisma.empty;

  const sql = Prisma.sql`
    SELECT
      ${Prisma.raw(`'${level}'::text`)} AS scope,
      ${Prisma.raw(idCol)}              AS "scopeId",
      year                              AS year,
      applications_total                AS "applicationsTotal",
      admitted_total                    AS "admittedTotal",
      enrolled_total                    AS "enrolledTotal",
      retained_year2_total              AS "retainedYear2Total",
      graduated_on_time_total           AS "graduatedOnTimeTotal",
      graduated_late_total              AS "graduatedLateTotal",
      dropouts_total                    AS "dropoutsTotal",
      tuition_revenue_total             AS "tuitionRevenueTotal",
      total_cost_total                  AS "totalCostTotal",
      net_contribution_total            AS "netContributionTotal",
      employment_rate_weighted          AS "employmentRateWeighted",
      average_salary_weighted           AS "averageSalaryWeighted",
      program_count                     AS "programCount",
      latest_freshness                  AS "latestFreshness"
    FROM ${Prisma.raw(view)}
    ${whereSql}
    ORDER BY year ASC
  `;

  const rows = await prisma.$queryRaw<unknown[]>(sql);
  return MetricRowsSchema.parse(rows);
}

/**
 * Concurrently refresh all four rollup MVs. Call after ingestion commits new
 * metric rows. Safe to call from a BullMQ worker; Postgres serialises
 * concurrent REFRESH CONCURRENTLY calls against the same view.
 */
export async function refreshMetricViews(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_program_metrics',
  );
  await prisma.$executeRawUnsafe(
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_department_metrics',
  );
  await prisma.$executeRawUnsafe(
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_faculty_metrics',
  );
  await prisma.$executeRawUnsafe(
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_university_metrics',
  );
}
