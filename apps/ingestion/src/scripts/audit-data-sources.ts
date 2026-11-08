#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// data-sources:audit — catch `data_sources` flag drift before it silently
// deletes data from every Council-facing surface.
//
// WHY THIS EXISTS
//
// `realDataWhere()` (packages/db/src/data-quality.ts) inner-joins every fact
// table through ingestion_runs → data_sources and requires
// `data_sources.mocked = false`. When that flag is wrong, the rows are still
// in the database, still correctly provenanced — and every query silently
// returns nothing. The UI renders "no data", which reads as *absence of a
// measurement* rather than a bug, so nobody investigates.
//
// On 2026-08-16 this had gone unnoticed for over a month: kku-finance was
// flagged mocked, so 1,332 financial rows vanished, `scoreFinancialProgram`
// returned emptyScore(), and the health radar's Financial dimension read
// "no data" for all 301 programs. kku-registry (4,641 rows) and kku-research
// (166,298 rows) were in the same state.
//
// THE RECURRENCE MECHANISM — why a one-off SQL fix does not hold
//
// `prisma/seed.ts` writes BOTH `status` and `mocked` from `SOURCE_CATALOG`
// on update as well as create. So the catalog is the source of truth, and
// every seed run re-asserts it. A connector flipped real in the
// database but left `mocked: true` in the catalog gets silently re-mocked on
// the next seed. That is exactly how the August regression happened.
//
// This script compares the database against the catalog and reports drift in
// both directions. Run it after any connector flip, any seed, and in CI.
//
// Usage:
//   pnpm data-sources:audit            # report; exit 1 if drift found
//   pnpm data-sources:audit --apply    # fix DB rows to match the catalog
//   pnpm data-sources:audit --quiet    # only print problems (for CI logs)
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { loadOrganization, prisma } from '@kku/db';
import { SOURCE_CATALOG } from '@kku/shared';

interface Finding {
  slug: string;
  issue: string;
  detail: string;
  /** Rows currently discarded by realDataWhere() because of this. */
  rowsHidden?: number;
  fixable: boolean;
}

/** Fact tables whose visibility depends on the flag, for impact reporting. */
const FACT_TABLES = [
  'enrollment_metrics',
  'financial_metrics',
  'graduate_outcomes',
  'research_outputs',
  'student_demographics',
] as const;

async function hiddenRowCountBySlug(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of FACT_TABLES) {
    // Table names are compile-time constants from the list above, never user
    // input — safe to interpolate.
    const rows = await prisma.$queryRawUnsafe<Array<{ slug: string | null; n: bigint }>>(
      `SELECT ds.slug AS slug, COUNT(*)::bigint AS n
         FROM ${table} t
         LEFT JOIN ingestion_runs ir ON ir.id = t.ingestion_run_id
         LEFT JOIN data_sources  ds ON ds.id = ir.data_source_id
        WHERE ds.mocked = true
        GROUP BY ds.slug`,
    );
    for (const r of rows) {
      if (!r.slug) continue;
      counts.set(r.slug, (counts.get(r.slug) ?? 0) + Number(r.n));
    }
  }
  return counts;
}

async function audit(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const dbRows = await prisma.dataSource.findMany({
    select: { slug: true, status: true, mocked: true },
  });
  const bySlug = new Map(dbRows.map((r) => [r.slug, r]));
  const hidden = await hiddenRowCountBySlug();

  for (const entry of SOURCE_CATALOG) {
    const row = bySlug.get(entry.slug);
    if (!row) {
      findings.push({
        slug: entry.slug,
        issue: 'missing-row',
        detail: 'in SOURCE_CATALOG but absent from data_sources — run pnpm data-sources:sync --apply',
        fixable: false,
      });
      continue;
    }

    // 1. The dangerous one: catalog says real, database says mocked.
    //    Everything this source ever loaded is invisible to realDataWhere().
    if (entry.mocked === false && row.mocked === true) {
      findings.push({
        slug: entry.slug,
        issue: 'real-but-flagged-mocked',
        detail: 'catalog mocked=false, db mocked=true — realDataWhere() discards ALL its rows',
        rowsHidden: hidden.get(entry.slug) ?? 0,
        fixable: true,
      });
      continue;
    }

    // 2. The reverse: a genuinely mocked source advertised as real.
    if (entry.mocked === true && row.mocked === false) {
      findings.push({
        slug: entry.slug,
        issue: 'mocked-but-flagged-real',
        detail: 'catalog mocked=true, db mocked=false — mock data is reaching real-data surfaces',
        fixable: true,
      });
      continue;
    }

    // 3. `status` is the human-readable label on /admin/data-sources and
    //    /admin/dashboard-topology. It must agree with `mocked` or the page
    //    advertises a real feed as a stub (or worse, the reverse).
    const expectedStatus = entry.mocked ? 'mocked' : 'active';
    if (row.mocked === false && row.status === 'mocked') {
      findings.push({
        slug: entry.slug,
        issue: 'stale-status-label',
        detail: `mocked=false but status='mocked' — should be '${expectedStatus}'`,
        fixable: true,
      });
    } else if (row.mocked === true && row.status !== 'mocked') {
      findings.push({
        slug: entry.slug,
        issue: 'stale-status-label',
        detail: `mocked=true but status='${row.status}' — should be 'mocked'`,
        fixable: true,
      });
    }
  }
  return findings;
}

async function applyFixes(findings: Finding[]): Promise<number> {
  let fixed = 0;
  for (const f of findings) {
    if (!f.fixable) continue;
    const entry = SOURCE_CATALOG.find((e) => e.slug === f.slug);
    if (!entry) continue;
    await prisma.dataSource.update({
      where: { slug: f.slug },
      // Always write BOTH columns together. They are independent in the
      // schema, and setting one without the other is the original bug.
      data: { mocked: entry.mocked, status: entry.mocked ? 'mocked' : 'active' },
    });
    fixed += 1;
  }
  return fixed;
}

async function main(): Promise<void> {
  await loadOrganization();
  const apply = process.argv.includes('--apply');
  const quiet = process.argv.includes('--quiet');

  const findings = await audit();

  if (findings.length === 0) {
    if (!quiet) {
      console.log(
        `✓ data_sources consistent with SOURCE_CATALOG (${SOURCE_CATALOG.length} sources checked)`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  console.log(`\n✗ ${findings.length} data_sources issue(s):\n`);
  for (const f of findings) {
    const hidden =
      f.rowsHidden !== undefined && f.rowsHidden > 0
        ? `  [${f.rowsHidden.toLocaleString('en-US')} rows currently hidden]`
        : '';
    console.log(`  ${f.slug.padEnd(24)} ${f.issue}`);
    console.log(`  ${' '.repeat(24)} ${f.detail}${hidden}`);
  }

  if (!apply) {
    const fixable = findings.filter((f) => f.fixable).length;
    console.log(
      `\n${fixable} of ${findings.length} fixable — re-run with --apply to write the catalog values.\n`,
    );
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  const fixed = await applyFixes(findings);
  console.log(`\nApplied ${fixed} fix(es). Re-auditing…\n`);
  const remaining = await audit();
  if (remaining.length === 0) {
    console.log('✓ data_sources now consistent with SOURCE_CATALOG\n');
  } else {
    console.log(`✗ ${remaining.length} issue(s) remain (not auto-fixable):`);
    for (const f of remaining) console.log(`  ${f.slug.padEnd(24)} ${f.issue} — ${f.detail}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

void main().catch(async (err: unknown) => {
  console.error('audit failed:', err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});
