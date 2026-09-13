// ─────────────────────────────────────────────────────────────────────────────
// jobthai:link-programs — the programme ↔ occupation bridge.
//
//   pnpm jobthai:link-programs               # dry run
//   pnpm jobthai:link-programs --apply       # write ProgramJobThaiLink
//   pnpm jobthai:link-programs --inspect 12  # print links for hand-checking
//
// Normally you do not run this: the jobthai connector rebuilds the links at the
// end of each run (apps/ingestion/src/jobthai/refresh.ts). Kept for dry runs,
// hand-inspection and repair.
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

import { prisma, JOBTHAI_MIN_POSTINGS_FOR_SIGNAL } from '@kku/db';

import { planJobThaiLinks, writeJobThaiLinks } from '../jobthai/refresh';

async function resolveRunId(): Promise<string | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: 'jobthai' } },
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const inspectIdx = process.argv.indexOf('--inspect');
  const inspectN = inspectIdx === -1 ? 0 : Number(process.argv[inspectIdx + 1] ?? 12);

  const plan = await planJobThaiLinks();
  console.log(`generic skills excluded from overlap: ${plan.genericSkills}`);
  console.log(`fields rejected as too generic: ${plan.promiscuousFields} of ${plan.totalFields}`);
  console.log(`=== jobthai:link-programs (${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`programmes            : ${plan.programmes}`);
  console.log(`occupations           : ${plan.occupations}`);
  console.log(`links planned         : ${plan.planned.length}  ${JSON.stringify(plan.bySource)}`);
  console.log(`programmes with a link: ${plan.linkedProgrammes}`);
  console.log(`  ...clearing the ${JOBTHAI_MIN_POSTINGS_FOR_SIGNAL}-posting floor: ${plan.clearingFloor}`);
  console.log(`postgraduate programmes: ${plan.postgraduateProgrammes}, of which linked: ${plan.postgraduateLinked}`);
  console.log('  (expect few — postgraduate programmes only count postings that state a postgraduate minimum)');

  if (inspectN > 0) {
    console.log('\n─── sample links for hand-checking ───');
    const sorted = [...plan.planned].sort((a, b) => b.score - a.score);
    const step = Math.max(1, Math.floor(sorted.length / inspectN));
    for (const l of sorted.filter((_, i) => i % step === 0).slice(0, inspectN)) {
      console.log(`  ${l.score.toFixed(2)} ${l.linkSource.padEnd(15)} ${l.postingCount.toString().padStart(5)} postings`);
      console.log(`      ${l.programCode} ${l.programName} [${l.programLevel}]`);
      console.log(`      -> ${l.occupationLabel}`);
      console.log(`      ${l.evidenceTh}`);
    }
  }

  if (!apply) {
    console.log('\nDRY RUN — pass --apply to write.');
    await prisma.$disconnect();
    return;
  }

  const runId = await resolveRunId();
  if (!runId) {
    console.error('No SUCCEEDED jobthai ingestion run to attribute these links to. Run the connector first.');
    process.exit(1);
  }
  const written = await writeJobThaiLinks(plan.planned, runId);
  console.log(`\nwrote ${written} program_jobthai_links (run ${runId})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
