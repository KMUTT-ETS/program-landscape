// ─────────────────────────────────────────────────────────────────────────────
// jobthai:derive — occupations + deterministic skill matching.
//
//   pnpm jobthai:derive                # dry run, reports what it would do
//   pnpm jobthai:derive --apply        # writes occupations + skill matches
//   pnpm jobthai:derive --apply --skip-skills
//
// Normally you do not run this: the jobthai connector rebuilds every derived
// layer at the end of each run (apps/ingestion/src/jobthai/refresh.ts), so an
// upload or a delete at /admin/jobthai is enough. Kept for dry runs and repair.
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

import { prisma } from '@kku/db';

import { deriveJobThai } from '../jobthai/refresh';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const skipSkills = process.argv.includes('--skip-skills');
  const t0 = Date.now();
  console.log(`=== jobthai:derive (${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  const s = await deriveJobThai({ apply, skipSkills, log: (line) => console.log(`  ${line}`) });
  console.log(`occupations            : ${s.occupations}${apply ? ` (${s.staleOccupationsRemoved} stale removed)` : ''}`);
  if (!skipSkills) {
    console.log(`posting-skill links    : ${s.postingSkillLinks}`);
    console.log(`postings with >=1 skill: ${s.postingsWithAnySkill} of ${s.postings}`);
    if (apply) console.log(`occupation-skill rows  : ${s.occupationSkillRows}`);
  }
  if (!apply) console.log('\nDRY RUN — pass --apply to write.');
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
