// ─────────────────────────────────────────────────────────────────────────────
// jobthai:fields — the field-of-study taxonomy and programme assignments.
//
//   pnpm jobthai:fields            # dry run: plans + model calls, writes nothing
//   pnpm jobthai:fields --apply    # write job_field_taxonomy + program_job_fields
//
// Normally you do not run this: the jobthai connector runs it at the end of
// each batch refresh (apps/ingestion/src/jobthai/refresh.ts). Kept for the
// first population on a deployment and for repair. Any flag other than
// --apply is refused.
//
// The dry run makes the SAME model calls as --apply (that is what makes it a
// truthful preview), so it costs the same in Gemini spend — see the
// AiInference rows tagged module 'gap-analysis'.
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

import { prisma, latestDemandRunId } from '@kku/db';

import { createIngestionAiService } from '../lib/ai-service';
import { defaultFieldsDeps, parseFieldsArgs, refreshJobFields } from '../jobthai/fields';

async function main(): Promise<void> {
  const args = parseFieldsArgs(process.argv.slice(2));
  // The taxonomy this script builds draws on every demand source that feeds
  // it (see TAXONOMY_SOURCES in packages/db/src/job-fields.ts), not JobThai
  // alone, so the run it's attributed to is the broadened "any demand
  // source" lookup — the same one the connector's own refreshJobThaiDerived
  // uses for the taxonomy step. Do not swap this for a jobthai-scoped
  // lookup: that would under-attribute a taxonomy that legitimately drew on
  // the other source's postings too.
  const runId = await latestDemandRunId();
  if (!runId) {
    console.error('No SUCCEEDED jobthai ingestion run to attribute the taxonomy to. Upload a JobThai batch first.');
    process.exit(1);
  }
  console.log(`=== jobthai:fields (${args.apply ? 'APPLY' : 'DRY RUN'}) run ${runId} ===`);
  const summary = await refreshJobFields(
    { apply: args.apply, runId, log: (l) => console.log(l) },
    defaultFieldsDeps(createIngestionAiService()),
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!args.apply) console.log('\nDRY RUN — pass --apply to write.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
