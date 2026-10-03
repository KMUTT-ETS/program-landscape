// ─────────────────────────────────────────────────────────────────────────────
// programs:overlap-prep — data preparation for program-overlap.v1 (spec §4).
//
//   pnpm programs:overlap-prep            # dry run: counts only, NO model calls
//   pnpm programs:overlap-prep --apply    # write PLOs, descriptions, profiles, embeddings
//
// Idempotent: unchanged PLO sets, descriptions and profiles write nothing, and
// a vector is only re-embedded when the sha256 of its text changes.
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

// createIngestionAiService is the ONLY sanctioned way to build an AiService in
// an ingestion script — it wires the model-override resolver.
import { createIngestionAiService } from '../lib/ai-service';
import { overlapPrepCoverage, runOverlapPrep } from '../program-overlap/prep';

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)} %`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const ai = createIngestionAiService();

  console.log(`=== programs:overlap-prep (${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  const r = await runOverlapPrep(ai, { apply });
  const verb = apply ? 'written' : 'would write';

  console.log('\n1. PLO table');
  console.log(`   programmes with PLOs in source : ${r.plos.programmesWithSource}`);
  console.log(`   programmes rewritten           : ${r.plos.programmesRewritten} (${r.plos.rowsWritten} rows, ${verb})`);
  console.log(`   programmes unchanged           : ${r.plos.programmesUnchanged}`);

  console.log('\n2. Course descriptions + CLOs');
  console.log(`   programmes with approved digest: ${r.courseDescriptions.programmesWithDigest}`);
  console.log(`   courses matched by code        : ${r.courseDescriptions.coursesMatched}`);
  console.log(`   courses changed                : ${r.courseDescriptions.coursesUpdated} (${verb})`);

  console.log('\n3. Market profiles');
  console.log(`   programmes                     : ${r.marketProfiles.programmes}`);
  console.log(
    `   new / changed / unchanged      : ${r.marketProfiles.created} / ${r.marketProfiles.changed} / ${r.marketProfiles.unchanged}`,
  );

  console.log(
    '\n4. Embeddings' + (apply ? '' : ' (pending in the CURRENT data; steps 1–3 not applied, no model call made)'),
  );
  console.log(`   PLOs            : ${r.embeddings.plos.pending} pending, ${r.embeddings.plos.written} written`);
  console.log(`   major courses   : ${r.embeddings.courses.pending} pending, ${r.embeddings.courses.written} written`);
  console.log(`   market profiles : ${r.embeddings.profiles.pending} pending, ${r.embeddings.profiles.written} written`);
  console.log(`   cost            : $${r.embeddings.costUsd.toFixed(4)}`);

  const c = await overlapPrepCoverage();
  console.log(`\nCoverage of stored data${apply ? '' : ' (before this run)'}: ${c.canonicalProgrammes} canonical programmes`);
  console.log(`   with PLOs                      : ${c.withPlos}`);
  console.log(
    `   with described major courses   : ${c.withDescribedMajorCourses} programmes ` +
      `(${c.describedMajorCourses} of ${c.majorCourses} major courses; ` +
      `${c.describedMajorCredits} of ${c.majorCredits} major credits = ${pct(c.describedMajorCredits, c.majorCredits)})`,
  );
  console.log(`   with a market profile          : ${c.withMarketProfile}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
