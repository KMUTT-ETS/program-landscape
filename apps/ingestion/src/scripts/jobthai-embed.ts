// ─────────────────────────────────────────────────────────────────────────────
// jobthai:embed — phase 4.
//
//   pnpm jobthai:embed            # report how many vectors are missing
//   pnpm jobthai:embed --apply    # embed skills + occupations
//   pnpm jobthai:embed --inspect  # show nearest skills for the top occupations
//
// Populates Skill.embedding and JobThaiOccupation.embedding. These have held
// zero rows since prompt 01. Idempotent: rows that already have a vector are
// skipped, so a re-run after the taxonomy grows embeds only the new ones.
//
// --inspect is how you decide whether JOBTHAI_EMBED_MATCH_FLOOR is right
// BEFORE any EMBEDDING_MATCHED row is written.
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

import { loadOrganization, prisma } from '@kku/db';

// createIngestionAiService is the ONLY sanctioned way to build an AiService in
// an ingestion script — it wires the model-override resolver, whose omission
// hid the 2026-08-03 model incident for five weeks.
import { createIngestionAiService } from '../lib/ai-service';
import { embedOccupations, embedSkills, nearestSkillsForOccupation } from '../jobthai/embed';

async function main(): Promise<void> {
  await loadOrganization();
  const apply = process.argv.includes('--apply');
  const inspect = process.argv.includes('--inspect');
  const ai = createIngestionAiService();

  if (inspect) {
    const occs = await prisma.jobThaiOccupation.findMany({
      orderBy: { postingCount: 'desc' },
      take: 5,
      select: { id: true, category: true, subcategory: true, postingCount: true },
    });
    for (const o of occs) {
      console.log(`\n${o.category} / ${o.subcategory} (${o.postingCount} postings)`);
      for (const s of await nearestSkillsForOccupation(o.id, 8)) {
        console.log(`  ${s.cosine.toFixed(3)}  ${s.nameEn}`);
      }
    }
    await prisma.$disconnect();
    return;
  }

  console.log(`=== jobthai:embed (${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  const skills = await embedSkills(ai, apply);
  console.log(`skills      : ${skills.requested} missing vectors, ${skills.written} written, $${skills.costUsd.toFixed(4)}`);
  const occs = await embedOccupations(ai, apply);
  console.log(`occupations : ${occs.requested} missing vectors, ${occs.written} written, $${occs.costUsd.toFixed(4)}`);
  console.log(`total cost  : $${(skills.costUsd + occs.costUsd).toFixed(4)}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
