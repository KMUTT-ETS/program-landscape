#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Refresh derived data after a metrics-changing ingest.
//
// Run this after any operation that mutates EnrollmentMetric /
// FinancialMetric / GraduateOutcome / Skill / etc. — most often
// after `pnpm outcomes:ingest-xlsx` lands a new survey year.
//
// Pipeline (sequential, ~30s for the full set):
//   1. REFRESH MATERIALIZED VIEW mv_program_metrics
//   2. REFRESH MATERIALIZED VIEW mv_department_metrics
//   3. REFRESH MATERIALIZED VIEW mv_faculty_metrics
//   4. REFRESH MATERIALIZED VIEW mv_university_metrics
//   5. Recompute every ProgramLifecycleSnapshot (write-through cache)
//
// What it does NOT do:
//   - Re-run AI strategic narratives (Phase 6 of programs-pipeline). Those
//     are intentionally frozen at generation time; re-run them via
//     `pnpm programs:pipeline --only=phase6 --force` if you want narrative
//     text to mention freshly-ingested numbers.
//   - Refresh the home-dashboard cache — there isn't one (the page is
//     `force-dynamic` and reads live).
//
// Usage:
//   pnpm outcomes:refresh-derived              # full refresh
//   pnpm outcomes:refresh-derived --skip-mv    # skip MVs (lifecycle only)
//   pnpm outcomes:refresh-derived --skip-snapshots  # skip lifecycle
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { loadOrganization, prisma, programLifecycleVerdict } from '@kku/db';

const MV_NAMES = [
  'mv_program_metrics',
  'mv_department_metrics',
  'mv_faculty_metrics',
  'mv_university_metrics',
] as const;

interface CliArgs {
  skipMv: boolean;
  skipSnapshots: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  return {
    skipMv: argv.includes('--skip-mv'),
    skipSnapshots: argv.includes('--skip-snapshots'),
  };
}

async function refreshMaterializedViews(): Promise<void> {
  console.log('━━ Step 1/2: Refresh materialized views ━━');
  const t0 = Date.now();
  for (const mv of MV_NAMES) {
    const start = Date.now();
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${mv};`);
    console.log(`  ${mv.padEnd(28)} ${Date.now() - start}ms`);
  }
  console.log(`  Total: ${Date.now() - t0}ms\n`);
}

async function recomputeLifecycleSnapshots(): Promise<void> {
  console.log('━━ Step 2/2: Recompute ProgramLifecycleSnapshot rows ━━');
  const programs = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });
  const t0 = Date.now();
  const counts = { FRONTIER: 0, RISING: 0, STABLE: 0, SUNSET: 0 };
  let okCount = 0;
  let failCount = 0;
  for (const p of programs) {
    try {
      const r = await programLifecycleVerdict(p.id);
      counts[r.verdict] += 1;
      okCount++;
    } catch (err) {
      failCount++;
      console.log(`  ✗ ${p.code}: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  const elapsed = Date.now() - t0;
  console.log(
    `  Done: ${okCount}/${programs.length} programs in ${(elapsed / 1000).toFixed(1)}s ` +
      `(${failCount} failed)`,
  );
  console.log(
    `  Distribution: FRONTIER=${counts.FRONTIER} RISING=${counts.RISING} ` +
      `STABLE=${counts.STABLE} SUNSET=${counts.SUNSET}`,
  );
}

async function main(): Promise<void> {
  await loadOrganization();
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  console.log('━━━ Refresh derived data ━━━');
  console.log(
    `Steps: ${args.skipMv ? '~MV' : 'MV'} → ${args.skipSnapshots ? '~snapshots' : 'snapshots'}\n`,
  );

  if (!args.skipMv) await refreshMaterializedViews();
  else console.log('Skipping MV refresh (--skip-mv)\n');

  if (!args.skipSnapshots) await recomputeLifecycleSnapshots();
  else console.log('Skipping lifecycle snapshot recompute (--skip-snapshots)\n');

  console.log(`\n✓ Total wall-clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
