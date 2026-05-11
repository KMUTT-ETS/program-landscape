// ─────────────────────────────────────────────────────────────────────────────
// Step 4 of the data-quality + provenance migration (gap #1 + #2 in
// docs/evaluation-pipeline.md §13). One-shot attribution script.
//
// For each of the 15 metric/fact tables that gained an `ingestion_run_id`
// FK in migration 20260511120000_data_quality_provenance, walk the rows
// where `ingestion_run_id IS NULL` and set them to the most-recent
// SUCCEEDED IngestionRun on the table's canonical DataSource(s) whose
// active window [startedAt, completedAt] contains the row's natural
// timestamp.
//
// Why "active window contains row.createdAt" instead of the simpler
// "completedAt <= row.createdAt": connectors write rows DURING `load()`,
// before the run is marked complete. So `row.createdAt < run.completedAt`
// almost always — the simpler test would miss every row written by its
// own run. The right semantic is "the run that was running when the row
// landed", which is `run.startedAt <= row.createdAt AND row.createdAt <=
// run.completedAt`.
//
// Rows we can't attribute (no run's window contains the timestamp) stay
// NULL. Under the upcoming `data-quality.v2` STRICT mode flip, NULL →
// treated as suspect (mock). That's the right semantics — if we can't
// trace a row to a real ingestion, it shouldn't anchor a Council score.
//
// Special cases:
//   - program_demand_matches: AI sub-pipeline writes these, not a
//     connector. There is no canonical DataSource. Skipped — stays NULL.
//   - alumni_cohort_statuses / student_cohort_distributions use
//     `refreshed_at` not `created_at` (no createdAt column on the model).
//
// Usage:
//   pnpm provenance:backfill            # dry run, prints attribution stats
//   pnpm provenance:backfill --apply    # commit the UPDATEs
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@kku/db';

interface TableConfig {
  /** DataSource slugs that this table's rows could plausibly have come from.
   *  Empty array → no canonical source; rows stay NULL. */
  slugs: string[];
  /** Column on the table that holds the row's natural insertion time.
   *  Used to find the most-recent run completed at-or-before this. */
  timestampCol: string;
}

// Fallback source per table for Pass 3 (synthetic-legacy attribution). After
// Pass 1 (SUCCEEDED runs) + Pass 2 (FAILED runs) have done their attribution,
// any rows still NULL get a find-or-create synthetic `trigger='BACKFILL'`
// IngestionRun on the canonical DataSource. This closes the script-produced
// orphan gap (link-program-* + ingest-employment-surveys) without requiring
// us to re-run the scripts. The synthetic run is marked SUCCEEDED with
// errorCode='SYNTHETIC_LEGACY' so analysts can audit it.
const PASS3_FALLBACK_SLUGS: Record<string, string> = {
  enrollment_metrics:           'kku-registry',
  student_demographics:         'kku-registry',
  tcas_admission_stats:         'tcas',
  alumni_cohort_statuses:       'kku-registry',
  student_cohort_distributions: 'kku-registry',
  financial_metrics:            'kku-finance',
  graduate_outcomes:            'kku-alumni',
  research_outputs:             'kku-research',
  faculty_compensation:         'kku-hr',
  faculty_budgets:              'kku-finance',
  kmitl_careers:                'kmitl-skill-mapping',
  kmitl_career_skill_demands:   'kmitl-skill-mapping',
  kmitl_skill_growths:          'kmitl-skill-mapping',
  tcas_admission_funnels:       'kku-tcas-funnel',
  // program_demand_matches is the AI sub-pipeline output; no obvious canonical
  // connector but the data IS real (AI-derived from real inputs). Attribute to
  // kku-registry as the umbrella "real KKU operational data" source so the
  // rows don't drop out under STRICT mode.
  program_demand_matches:       'kku-registry',
};

// 15 tracked tables. Mirror of PROVENANCE_TRACKED_TABLES in
// packages/db/src/data-quality.ts. Keep in sync.
const TABLE_SOURCES: Record<string, TableConfig> = {
  enrollment_metrics:            { slugs: ['kku-registry'],        timestampCol: 'created_at' },
  student_demographics:          { slugs: ['kku-registry'],        timestampCol: 'created_at' },
  tcas_admission_stats:          { slugs: ['tcas'],                timestampCol: 'created_at' },
  alumni_cohort_statuses:        { slugs: ['kku-registry'],        timestampCol: 'refreshed_at' },
  student_cohort_distributions:  { slugs: ['kku-registry'],        timestampCol: 'refreshed_at' },
  financial_metrics:             { slugs: ['kku-finance'],         timestampCol: 'created_at' },
  graduate_outcomes:             { slugs: ['kku-alumni'],          timestampCol: 'created_at' },
  research_outputs:              { slugs: ['kku-research'],        timestampCol: 'created_at' },
  faculty_compensation:          { slugs: ['kku-hr'],              timestampCol: 'created_at' },
  faculty_budgets:               { slugs: ['kku-finance'],         timestampCol: 'created_at' },
  kmitl_careers:                 { slugs: ['kmitl-skill-mapping'], timestampCol: 'created_at' },
  kmitl_career_skill_demands:    { slugs: ['kmitl-skill-mapping'], timestampCol: 'created_at' },
  kmitl_skill_growths:           { slugs: ['kmitl-skill-mapping'], timestampCol: 'created_at' },
  tcas_admission_funnels:        { slugs: ['kku-tcas-funnel'],     timestampCol: 'created_at' },
  // No canonical connector — written by apps/ingestion/src/program-demand-match/.
  // Stays NULL; under STRICT mode these rows become suspect (correct posture
  // until the AI sub-pipeline starts creating synthetic IngestionRuns).
  program_demand_matches:        { slugs: [],                      timestampCol: 'computed_at' },
};

/**
 * Find or create the synthetic legacy IngestionRun on `slug` and return its
 * id. Idempotent — looks for an existing `trigger='BACKFILL'` + matching
 * source first; only inserts if none exists.
 */
async function findOrCreateSyntheticLegacyRun(
  prisma: PrismaClient,
  slug: string,
): Promise<string | null> {
  const source = await prisma.dataSource.findUnique({ where: { slug } });
  if (!source) return null;
  // Reuse an existing synthetic-legacy run for this source if one was already
  // created on a previous backfill run.
  const existing = await prisma.ingestionRun.findFirst({
    where: {
      dataSourceId: source.id,
      trigger: 'BACKFILL',
      errorCode: 'SYNTHETIC_LEGACY',
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const now = new Date();
  const created = await prisma.ingestionRun.create({
    data: {
      dataSourceId: source.id,
      trigger: 'BACKFILL',
      status: 'SUCCEEDED',
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      errorCode: 'SYNTHETIC_LEGACY',
      errorMessage:
        'Synthetic IngestionRun created by pnpm provenance:backfill (Step 4 + Step 2b fallback). ' +
        'Attributes historical rows that pre-date the ingestion_run_id FK so they survive ' +
        'the v2 STRICT-mode flip. NOT a real ingestion — analyst-readable audit trace only.',
    },
    select: { id: true },
  });
  return created.id;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();

  console.log(apply ? '═══ APPLY MODE ═══' : '═══ DRY RUN ═══ (pass --apply to commit)');
  console.log('');
  console.log('Table'.padEnd(34) + 'NULL'.padStart(8) + 'Pass1'.padStart(8) + 'Pass2'.padStart(7) + 'Pass3'.padStart(7) + 'Orph'.padStart(7));
  console.log('  Pass1 = SUCCEEDED-run window  ·  Pass2 = FAILED-run window  ·  Pass3 = synthetic legacy');
  console.log('─'.repeat(80));

  let grandStart = 0;
  let grandPass1 = 0;
  let grandPass2 = 0;
  let grandPass3 = 0;
  let grandOrphan = 0;

  // Build the union of all PASS3 source slugs across all tables — we need
  // these DataSource rows to exist (already seeded for the live sources).
  // Pre-resolve to surface "missing source" errors up front rather than
  // mid-loop.
  const allSlugs = [...new Set(Object.values(PASS3_FALLBACK_SLUGS))];
  const knownSources = await prisma.dataSource.findMany({
    where: { slug: { in: allSlugs } },
    select: { slug: true },
  });
  const knownSlugSet = new Set(knownSources.map((s) => s.slug));
  const missingSlugs = allSlugs.filter((s) => !knownSlugSet.has(s));
  if (missingSlugs.length > 0) {
    console.warn(`WARNING: Pass-3 fallback slugs missing from data_sources: ${missingSlugs.join(', ')}`);
    console.warn('         Rows that would attribute to these slugs will stay NULL.');
  }

  for (const [table, cfg] of Object.entries(TABLE_SOURCES)) {
    // Always count NULL rows (the current state)
    const nullRows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*)::bigint AS c FROM ${table} WHERE ingestion_run_id IS NULL`,
    );
    const start = Number(nullRows[0]?.c ?? 0n);

    let pass1Applied = 0;
    let pass2Applied = 0;
    let pass3Applied = 0;

    // ── Pass 1: SUCCEEDED runs whose window contains row.createdAt ──────
    if (cfg.slugs.length > 0) {
      const stats1 = await prisma.$queryRawUnsafe<Array<{ a: bigint }>>(
        `
        SELECT COUNT(*)::bigint AS a FROM ${table} t
        WHERE t.ingestion_run_id IS NULL AND EXISTS (
          SELECT 1 FROM ingestion_runs ir JOIN data_sources ds ON ds.id = ir.data_source_id
          WHERE ds.slug = ANY($1::text[]) AND ir.status = 'SUCCEEDED'
            AND ir.started_at <= t.${cfg.timestampCol}
            AND ir.completed_at >= t.${cfg.timestampCol}
        )
      `,
        cfg.slugs,
      );
      pass1Applied = Number(stats1[0]?.a ?? 0n);
      if (apply && pass1Applied > 0) {
        await prisma.$executeRawUnsafe(
          `
          UPDATE ${table} t SET ingestion_run_id = (
            SELECT ir.id FROM ingestion_runs ir JOIN data_sources ds ON ds.id = ir.data_source_id
            WHERE ds.slug = ANY($1::text[]) AND ir.status = 'SUCCEEDED'
              AND ir.started_at <= t.${cfg.timestampCol}
              AND ir.completed_at >= t.${cfg.timestampCol}
            ORDER BY ir.started_at DESC LIMIT 1
          )
          WHERE t.ingestion_run_id IS NULL AND EXISTS (
            SELECT 1 FROM ingestion_runs ir JOIN data_sources ds ON ds.id = ir.data_source_id
            WHERE ds.slug = ANY($1::text[]) AND ir.status = 'SUCCEEDED'
              AND ir.started_at <= t.${cfg.timestampCol}
              AND ir.completed_at >= t.${cfg.timestampCol}
          )
        `,
          cfg.slugs,
        );
      }
    }

    // ── Pass 2: FAILED runs whose window contains row.createdAt (Phase 4b) ─
    // Connectors that failed mid-run still wrote rows up to the failure
    // point; those rows are real-source data, just in a run that didn't
    // mark SUCCEEDED. Attribute them so they survive STRICT.
    if (cfg.slugs.length > 0) {
      const stats2 = await prisma.$queryRawUnsafe<Array<{ a: bigint }>>(
        `
        SELECT COUNT(*)::bigint AS a FROM ${table} t
        WHERE t.ingestion_run_id IS NULL AND EXISTS (
          SELECT 1 FROM ingestion_runs ir JOIN data_sources ds ON ds.id = ir.data_source_id
          WHERE ds.slug = ANY($1::text[]) AND ir.status = 'FAILED'
            AND ir.started_at <= t.${cfg.timestampCol}
            AND ir.completed_at >= t.${cfg.timestampCol}
        )
      `,
        cfg.slugs,
      );
      pass2Applied = Number(stats2[0]?.a ?? 0n);
      if (apply && pass2Applied > 0) {
        await prisma.$executeRawUnsafe(
          `
          UPDATE ${table} t SET ingestion_run_id = (
            SELECT ir.id FROM ingestion_runs ir JOIN data_sources ds ON ds.id = ir.data_source_id
            WHERE ds.slug = ANY($1::text[]) AND ir.status = 'FAILED'
              AND ir.started_at <= t.${cfg.timestampCol}
              AND ir.completed_at >= t.${cfg.timestampCol}
            ORDER BY ir.started_at DESC LIMIT 1
          )
          WHERE t.ingestion_run_id IS NULL AND EXISTS (
            SELECT 1 FROM ingestion_runs ir JOIN data_sources ds ON ds.id = ir.data_source_id
            WHERE ds.slug = ANY($1::text[]) AND ir.status = 'FAILED'
              AND ir.started_at <= t.${cfg.timestampCol}
              AND ir.completed_at >= t.${cfg.timestampCol}
          )
        `,
          cfg.slugs,
        );
      }
    }

    // ── Pass 3: synthetic legacy run on canonical source (Phase 2b fallback) ─
    // Anything still NULL is attributed to a single synthetic IngestionRun on
    // the table's canonical fallback DataSource. Closes the script-produced
    // orphan gap without needing the scripts to have created their own runs.
    const pass3Slug = PASS3_FALLBACK_SLUGS[table];
    if (pass3Slug && knownSlugSet.has(pass3Slug)) {
      const remaining = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
        `SELECT COUNT(*)::bigint AS c FROM ${table} WHERE ingestion_run_id IS NULL`,
      );
      pass3Applied = Number(remaining[0]?.c ?? 0n);
      if (apply && pass3Applied > 0) {
        const syntheticRunId = await findOrCreateSyntheticLegacyRun(prisma, pass3Slug);
        if (syntheticRunId) {
          await prisma.$executeRawUnsafe(
            `UPDATE ${table} SET ingestion_run_id = $1 WHERE ingestion_run_id IS NULL`,
            syntheticRunId,
          );
        }
      }
    }

    // What remained at the start of Pass 3 — if apply ran, the table now has
    // 0 NULL rows; if dry-run, the same `pass3Applied` count is what WOULD be
    // updated. Orphans only happen when there's no PASS3 mapping at all (no
    // table left in this state after the addition above).
    const orphan = start - pass1Applied - pass2Applied - pass3Applied;

    console.log(
      table.padEnd(34) +
        start.toString().padStart(8) +
        pass1Applied.toString().padStart(8) +
        pass2Applied.toString().padStart(7) +
        pass3Applied.toString().padStart(7) +
        orphan.toString().padStart(7),
    );
    grandStart += start;
    grandPass1 += pass1Applied;
    grandPass2 += pass2Applied;
    grandPass3 += pass3Applied;
    grandOrphan += orphan;
  }

  console.log('─'.repeat(80));
  console.log(
    'TOTAL'.padEnd(34) +
      grandStart.toString().padStart(8) +
      grandPass1.toString().padStart(8) +
      grandPass2.toString().padStart(7) +
      grandPass3.toString().padStart(7) +
      grandOrphan.toString().padStart(7),
  );
  console.log('');

  if (apply) {
    const verify = await prisma.$queryRawUnsafe<Array<{ table_name: string; c: bigint }>>(`
      SELECT 'enrollment_metrics' AS table_name, COUNT(*)::bigint AS c FROM enrollment_metrics WHERE ingestion_run_id IS NULL
      UNION ALL SELECT 'financial_metrics', COUNT(*)::bigint FROM financial_metrics WHERE ingestion_run_id IS NULL
      UNION ALL SELECT 'tcas_admission_funnels', COUNT(*)::bigint FROM tcas_admission_funnels WHERE ingestion_run_id IS NULL
      UNION ALL SELECT 'research_outputs', COUNT(*)::bigint FROM research_outputs WHERE ingestion_run_id IS NULL
    `);
    console.log('Verification — remaining NULL rows on key tables:');
    verify.forEach((r) => console.log(`  ${r.table_name.padEnd(34)} ${r.c}`));
    console.log('');
    console.log('Next step: review the orphan rows, then flip `realDataWhere()` to STRICT mode');
    console.log('  by changing the body of packages/db/src/data-quality.ts to drop the NULL branch.');
    console.log('  Bump DATA_QUALITY_VERSION to "data-quality.v2".');
  } else {
    console.log('No changes written. Re-run with --apply to commit.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
