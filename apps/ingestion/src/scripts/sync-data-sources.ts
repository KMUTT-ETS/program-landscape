// ─────────────────────────────────────────────────────────────────────────────
// sync-data-sources — reconcile `data_sources` with the connector catalog.
//
//   pnpm data-sources:sync            # dry run: prints the plan, writes nothing
//   pnpm data-sources:sync --apply    # create what is missing, correct drift
//
// WHY THIS EXISTS. `deploy.sh` runs `prisma migrate deploy` but has never
// seeded, so a connector declared in packages/shared/src/ingestion/catalog.ts
// reached production with NO `data_sources` row, and every script resolving it
// by slug died with "no DataSource with slug=…". job-108 hit it first, during
// the v1.9.8 rollout on 2026-09-30 — three hours into a deploy window, on a
// step the runbook said would work. Nothing about it was job-108-specific:
// any new connector was dead on arrival in production.
//
// deploy.sh now calls this between `migrate deploy` and the symlink swap, so
// the failure cannot recur. It stays runnable by hand for repair.
//
// SAFETY
//   - dry run by default; --apply is required to write
//   - idempotent: the steady state is "0 created, 0 updated"
//   - `status` and `mocked` are always written together. They must never
//     disagree: a connector running real while data_sources reads mocked=true
//     makes every row it writes invisible to realDataWhere(), which is a
//     silent-empty-UI failure this repository has hit three times
//   - rows in data_sources but NOT in the catalog are REPORTED, never deleted:
//     deleting one orphans the ingestion_runs pointing at it, and the correct
//     way to retire a source is the catalog's `deprecated: true` flag
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Inline env-file loader rather than `dotenv/config`: dotenv is not a
// dependency, and this script is esbuild-bundled for the prod ingestion image,
// where the environment comes from the container and this is a no-op.
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { loadOrganization, formatDataSourceSync, prisma, syncDataSourcesFromCatalog } from '@kku/db';

/** A transaction that always rolls back, so the dry run exercises the real
 *  code path — including any constraint the plan would violate — instead of a
 *  parallel "what would happen" branch that can quietly diverge from it. */
async function planOnly(): ReturnType<typeof syncDataSourcesFromCatalog> {
  const ROLLBACK = Symbol('dry-run rollback');
  try {
    return await prisma.$transaction(async (tx) => {
      const result = await syncDataSourcesFromCatalog(tx);
      throw Object.assign(new Error('dry run'), { [ROLLBACK]: result });
    });
  } catch (e) {
    const carried = (e as Record<symbol, unknown>)[ROLLBACK];
    if (carried === undefined) throw e;
    return carried as Awaited<ReturnType<typeof syncDataSourcesFromCatalog>>;
  }
}

async function main(): Promise<void> {
  await loadOrganization();
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--apply');
  if (unknown.length > 0) {
    console.error(`Usage: pnpm data-sources:sync [--apply]   (unrecognised: ${unknown.join(' ')})`);
    process.exit(1);
  }
  const apply = args.includes('--apply');

  console.log(`=== data-sources:sync (${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  const result = apply ? await syncDataSourcesFromCatalog(prisma) : await planOnly();
  for (const line of formatDataSourceSync(result)) console.log(line);

  if (!apply && (result.created.length > 0 || result.updated.length > 0)) {
    console.log('\nDRY RUN — nothing was written. Pass --apply to write.');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
