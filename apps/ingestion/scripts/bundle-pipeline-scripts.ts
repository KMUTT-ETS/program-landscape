#!/usr/bin/env node
// Bundle standalone CLI scripts in apps/ingestion/src/scripts/ that
// the BullMQ worker spawns as separate Node processes.
//
// Why this exists:
//   `nest build` (tsc) emits dist/scripts/*.js that still `require()`
//   workspace packages like @kku/db. In dev that's fine because tsx
//   transparently strips TypeScript. In the prod image those .js files
//   blow up — Node refuses to type-strip files under node_modules (the
//   @kku/db package's main points at src/index.ts), and pnpm-deploy
//   doesn't hoist transitive deps like @prisma/client to a path the
//   spawned child can reach.
//
//   esbuild bundles each script into a self-contained .js that has
//   @kku/* + @prisma/client + most JS deps inlined. Native modules
//   (oracledb, mssql, pg-native, .prisma/client engines) stay external
//   and are loaded at runtime via NODE_PATH + a symlinked .prisma/.
//
// What gets bundled:
//   Every .ts file under apps/ingestion/src/scripts/ that's invoked as a
//   standalone process by the BullMQ worker (currently:
//   programs-pipeline.ts). We bundle the whole directory so any future
//   spawn-target script gets the same treatment without further wiring.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SCRIPTS_DIR = path.resolve(__dirname, '..', 'src', 'scripts');
const OUT_DIR = path.resolve(__dirname, '..', 'dist', 'scripts');

// Only the scripts the BullMQ worker spawns as separate Node processes.
// CLI helper scripts (capture-*, seed-*, probe-*, …) are operator-run
// via `pnpm tsx` and don't need bundling. Some import dotenv/config or
// other dev-only modules that would force more externals; bundling them
// is unnecessary and increases breakage surface.
//
// Keep this list in sync with the spawn targets in programs-pipeline.ts:
//   - phase 2: approve-pending-digests
//   - phase 4: link-program-cohorts / link-program-alumni / link-program-financials
//   - phase 8: risks-assess
//
// Plus operator-run scripts that the prod admin invokes via
// `docker compose exec ingestion node /app/dist/scripts/<x>.js` to
// (re)populate v1.2.0+ tables. Same bare-require breakage applies in
// prod, so they need bundling too.
const TARGETS = [
  // Worker-spawned (BullMQ pipeline)
  'programs-pipeline.ts',
  'approve-pending-digests.ts',
  'link-program-cohorts.ts',
  'link-program-alumni.ts',
  'link-program-financials.ts',
  'risks-assess.ts',
  // Operator-run (manual data hydration on prod) — class-offerings cube +
  // PROGRAM_DIGEST course materialisation + HCM email backfill (v1.2.0).
  'link-class-offerings.ts',
  'materialise-program-courses.ts',
  'backfill-faculty-member-emails.ts',
  // Operator-run JobThai + demand-match hydration (v1.9.4). Missing from this
  // list, all four crashed in the prod image — `dotenv/config` not found, or
  // ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING on @kku/db — so the documented
  // post-deploy steps could not run. Verified by loading each in the image.
  'jobthai-derive.ts',
  'jobthai-embed.ts',
  'jobthai-link-programs.ts',
  'match-program-demand.ts',
  // Field-of-study taxonomy for the demand-first Gap Analyzer (v1.9.7). Runs
  // at the end of each batch refresh; the script is the first-population and
  // repair path on prod.
  'jobthai-fields.ts',
  // One-off data fixes run on dev on 2026-09-13 that prod needs too: the
  // 456-row skill-taxonomy merge, and provenance for program_demand_matches.
  'dedupe-skills.ts',
  'backfill-demand-match-provenance.ts',
  // PDPA retention sweep — run nightly on prod by program-landscape-retention.timer
  'retention-sweep.ts',
  // One-off archive walk of the full job-108.com sitemap (Task 8, 2026-09-20).
  // Operator-run on prod via `docker compose exec ingestion node
  // /app/dist/scripts/job108-backfill.js`. Missing from this list means it
  // does not exist inside the production image — dev's tsx run can't catch
  // that, since dev runs the TypeScript source directly.
  'job108-backfill.ts',
  // Reconciles data_sources with the connector catalog. deploy.sh calls this
  // between `migrate deploy` and the symlink swap: without it a newly declared
  // connector reaches production with no row and every script that resolves it
  // by slug dies, which is how the v1.9.8 rollout stalled on 2026-09-30.
  'sync-data-sources.ts',
  // program-overlap.v1 data prep (PLO table, course descriptions, market
  // profiles, embeddings). Operator-run on prod before the first overlap run.
  'programs-overlap-prep.ts',
  // program-overlap.v1 scoring + calibration. Operator-run on prod for the
  // full-portfolio run; the pipeline's phaseOV runs in-process.
  'programs-overlap.ts',
];

// Native modules + workspace artifacts that must stay external.
// .prisma/client is the generated Prisma client (engine binaries inside);
// keeping it external means it's loaded from node_modules at runtime,
// so engine .so files don't have to travel with the bundle.
const EXTERNAL = [
  '.prisma/client',
  '@nestjs/*',
  'oracledb', 'mssql', 'tedious',
  'pg-native', 'better-sqlite3',
  'bcrypt', 'argon2', 'hiredis',
  'tsx', 'tsx/cli',
  'pdfjs-dist', 'esbuild',
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[bundle-scripts] bundling ${TARGETS.length} script(s) → ${OUT_DIR}`);
  for (const file of TARGETS) {
    const input = path.join(SCRIPTS_DIR, file);
    const output = path.join(OUT_DIR, file.replace(/\.ts$/, '.js'));
    const start = Date.now();
    await build({
      entryPoints: [input],
      outfile: output,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      external: EXTERNAL,
      logLevel: 'warning',
      sourcemap: 'linked',
    });
    console.log(`  ✓ ${file} → ${path.basename(output)} (${Date.now() - start}ms)`);
  }
  console.log('[bundle-scripts] done');
}

main().catch((err) => {
  console.error('[bundle-scripts] FAILED', err);
  process.exit(1);
});
