// ─────────────────────────────────────────────────────────────────────────────
// Data-quality helpers — data-quality.v2  (STRICT mode)
//
// Filters mock-sourced rows out of analytical queries. Backs gap #1 + #2
// from docs/evaluation-pipeline.md §13 ("Mock data contaminates real scores"
// + "Provenance chain has holes").
//
// Policy (data-quality.v2 — STRICT):
//   A metric row is REAL when AND ONLY WHEN
//     its linked IngestionRun's DataSource has mocked = false.
//
//   Rows with ingestion_run_id IS NULL are treated as SUSPECT and excluded.
//
// Why STRICT now:
//   v1 (legacy-real) was a transitional posture — NULL meant "historical
//   data we couldn't trace yet." After the 4-step migration landed on
//   2026-05-11 (Step 1 schema, Step 2 connectors, Step 3 scorers, Step 4
//   backfill in 3 passes including a synthetic-legacy attribution for
//   script-produced + AI-derived rows), every legitimate metric row carries
//   provenance. NULL now reliably means "writer forgot to set ingestionRunId"
//   → treat as suspect.
//
// Migration history:
//   v1 (2026-05-11 morning): allow NULL as legacy-real
//   v2 (2026-05-11 afternoon): drop NULL branch — STRICT mode
//
// If a NEW write path forgets to thread runId: rows show up but get
// filtered. Symptom: cockpit cells go null + dataCompletenessPct drops.
// Diagnostic: `pnpm provenance:backfill` (dry-run) — reports orphan count
// per table.
// ─────────────────────────────────────────────────────────────────────────────

import { Prisma } from '@prisma/client';

export const DATA_QUALITY_VERSION = 'data-quality.v2';

/**
 * Prisma `where` fragment that filters out mock-sourced rows AND rows
 * without provenance (NULL ingestion_run_id). Composable with other
 * where clauses via spread or AND.
 *
 * STRICT semantics (v2): a row passes only if its linked IngestionRun's
 * DataSource has `mocked = false`. Untagged rows (NULL) are suspect and
 * excluded.
 *
 * @example
 * const real = await prisma.enrollmentMetric.findMany({
 *   where: { programId, ...realDataWhere() },
 * });
 */
export function realDataWhere(): {
  ingestionRun: { dataSource: { mocked: false } };
} {
  return { ingestionRun: { dataSource: { mocked: false } } };
}

/**
 * SQL fragment for `$queryRaw` paths. Joins back to ingestion_runs +
 * data_sources and excludes mock + untagged rows. Caller supplies the
 * metric table's SQL alias.
 *
 * STRICT semantics (v2). The expression is a single boolean intended to
 * be `AND`-ed into a larger WHERE clause:
 *
 * @example
 *   const rows = await prisma.$queryRaw`
 *     SELECT ... FROM enrollment_metrics em
 *     WHERE em.program_id = ${programId}
 *       AND ${realDataSql('em')}
 *   `;
 */
export function realDataSql(tableAlias: string): Prisma.Sql {
  // `tableAlias` is a developer-supplied SQL identifier — must be a
  // simple alias, NOT user input. Prisma.raw is the only way to splice
  // an unquoted identifier into a tagged-template SQL string; treating
  // it as a value would emit `'em'.ingestion_run_id` which Postgres
  // rejects.
  const alias = Prisma.raw(tableAlias);
  return Prisma.sql`EXISTS (
    SELECT 1 FROM ingestion_runs ir
    JOIN data_sources ds ON ds.id = ir.data_source_id
    WHERE ir.id = ${alias}.ingestion_run_id
      AND ds.mocked = false
  )`;
}

/**
 * Plain-string variant of {@link realDataSql} for `$queryRawUnsafe`
 * paths. Returns the same boolean expression as a string literal —
 * no parameters, no `Prisma.Sql` machinery.
 *
 * Used by dashboard-overview.ts and currently-enrolled.ts which run
 * raw SQL via `$queryRawUnsafe` deliberately (Next.js HMR creates
 * multiple `@prisma/client` module instances, breaking the
 * `instanceof Prisma.Sql` check inside `$queryRaw`).
 *
 * STRICT semantics (v2).
 *
 * @example
 *   const rows = await prisma.$queryRawUnsafe(`
 *     SELECT ... FROM enrollment_metrics em
 *     WHERE em.program_id = $1
 *       AND ${realDataSqlUnsafe('em')}
 *   `, programId);
 */
export function realDataSqlUnsafe(tableAlias: string): string {
  // tableAlias must be a known SQL identifier — caller's responsibility.
  // No params interpolated, so the result is safe to concatenate.
  return `EXISTS (
    SELECT 1 FROM ingestion_runs ir
    JOIN data_sources ds ON ds.id = ir.data_source_id
    WHERE ir.id = ${tableAlias}.ingestion_run_id
      AND ds.mocked = false
  )`;
}

/**
 * v1 lenient variant — retained for testing / rollback emergencies. Allows
 * NULL ingestion_run_id rows through as "legacy real." Don't use in new
 * code; this exists so a single-line revert is possible if STRICT mode
 * surfaces an unforeseen orphan class.
 *
 * @deprecated Use {@link realDataWhere} (STRICT v2). This helper survives
 *   to enable a fast rollback if needed.
 */
export function realDataWhereLenient(): {
  OR: [
    { ingestionRunId: null },
    { ingestionRun: { dataSource: { mocked: false } } },
  ];
} {
  return {
    OR: [
      { ingestionRunId: null },
      { ingestionRun: { dataSource: { mocked: false } } },
    ],
  };
}

/**
 * v1 lenient SQL variant — see {@link realDataWhereLenient}.
 *
 * @deprecated Use {@link realDataSql} (STRICT v2).
 */
export function realDataSqlLenient(tableAlias: string): Prisma.Sql {
  const alias = Prisma.raw(tableAlias);
  return Prisma.sql`(
    ${alias}.ingestion_run_id IS NULL
    OR EXISTS (
      SELECT 1 FROM ingestion_runs ir
      JOIN data_sources ds ON ds.id = ir.data_source_id
      WHERE ir.id = ${alias}.ingestion_run_id
        AND ds.mocked = false
    )
  )`;
}

/**
 * For surfaces that want to flag mock contamination without filtering
 * it out. Returns the row counts of mock-sourced rows for a given
 * metric table. Surfaced at /admin/data-quality so ops can see the
 * mock-data footprint per table.
 */
export interface MockContaminationCount {
  totalRows: number;
  mockRows: number;
  realRows: number;
  legacyNullRows: number;
}

export async function countMockContamination(
  prisma: { $queryRawUnsafe: <T>(sql: string) => Promise<T> },
  tableName: string,
): Promise<MockContaminationCount> {
  // `tableName` must be a known table identifier — caller's responsibility
  // to validate. Internal-use helper, not exposed to user input.
  const rows = await prisma.$queryRawUnsafe<
    Array<{ total: bigint; mock: bigint; real: bigint; legacy: bigint }>
  >(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE ingestion_run_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ingestion_runs ir
            JOIN data_sources ds ON ds.id = ir.data_source_id
            WHERE ir.id = ${tableName}.ingestion_run_id
              AND ds.mocked = true
          )
      )::bigint AS mock,
      COUNT(*) FILTER (
        WHERE ingestion_run_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ingestion_runs ir
            JOIN data_sources ds ON ds.id = ir.data_source_id
            WHERE ir.id = ${tableName}.ingestion_run_id
              AND ds.mocked = false
          )
      )::bigint AS real,
      COUNT(*) FILTER (WHERE ingestion_run_id IS NULL)::bigint AS legacy
    FROM ${tableName};
  `);
  const r = rows[0];
  return {
    totalRows: Number(r?.total ?? 0n),
    mockRows: Number(r?.mock ?? 0n),
    realRows: Number(r?.real ?? 0n),
    legacyNullRows: Number(r?.legacy ?? 0n),
  };
}

/**
 * The 15 metric tables touched by the provenance migration. Used by
 * `/admin/data-quality` to render a per-table contamination summary.
 *
 * Keep in sync with the migration SQL.
 */
export const PROVENANCE_TRACKED_TABLES = [
  'enrollment_metrics',
  'student_demographics',
  'tcas_admission_stats',
  'alumni_cohort_statuses',
  'student_cohort_distributions',
  'financial_metrics',
  'graduate_outcomes',
  'research_outputs',
  'faculty_compensation',
  'faculty_budgets',
  'kmitl_careers',
  'kmitl_career_skill_demands',
  'kmitl_skill_growths',
  'tcas_admission_funnels',
  'admission_campaign_stats',
  'program_demand_matches',
] as const;

export type ProvenanceTrackedTable = (typeof PROVENANCE_TRACKED_TABLES)[number];
