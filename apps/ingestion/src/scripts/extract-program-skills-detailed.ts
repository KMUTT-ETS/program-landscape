#!/usr/bin/env tsx
// Detailed per-program skills extraction (PLO-aware, compulsory/elective
// weighted). Replaces ProgramSkill rows for the program with the richer set.
//
// Usage:
//   pnpm programs:extract-skills <code|mhesi|sequenceNo|id> [--force]

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
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
import { S3Storage } from '@kku/shared';
import { runProgramSkillsDetailed } from '../program-skills/run';
import { createIngestionAiService } from '../lib/ai-service';

async function resolveProgramId(arg: string): Promise<string> {
  const seqNo = Number(arg);
  const program = await prisma.program.findFirst({
    where: {
      OR: [
        { id: arg },
        { code: arg },
        { mhesiCode: arg },
        ...(Number.isInteger(seqNo) ? [{ sequenceNoFromSheet: seqNo }] : []),
      ],
    },
    select: { id: true, code: true, nameTh: true, level: true },
  });
  if (!program) throw new Error(`Program not found for arg "${arg}"`);
  console.log(`Resolved: ${program.code} ${program.level} ${program.nameTh}`);
  return program.id;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const positional = args.find((a) => !a.startsWith('--'));
  if (!positional) {
    console.error('Usage: pnpm programs:extract-skills <code|mhesi|sequenceNo|id> [--force]');
    process.exit(1);
  }

  const programId = await resolveProgramId(positional);

  const ai = createIngestionAiService();
  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
    region: process.env.MINIO_REGION ?? 'us-east-1',
  });

  console.log('Running detailed skills extraction…');
  const t0 = Date.now();
  const result = await runProgramSkillsDetailed({ programId, ai, storage, force });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${elapsed}s`);
  console.log(`Status: ${result.status}`);
  if (result.status === 'SUCCEEDED') {
    console.log(`  AiExtraction:               ${result.aiExtractionId}`);
    console.log(`  Confidence:                 ${result.confidence.toFixed(2)}`);
    console.log(`  Tokens (in/out):            ${result.tokensInput.toLocaleString()} / ${result.tokensOutput.toLocaleString()}`);
    console.log(`  Cost:                       $${result.costUsd.toFixed(4)}`);
    console.log(`  Skills extracted:           ${result.skillsExtracted}`);
    console.log(`  Resolved to Skill taxonomy: ${result.skillsResolvedToTaxonomy}`);
    console.log(`  Unresolved (no match):      ${result.skillsUnresolved}`);
    console.log(`  PLOs captured:              ${result.ploCount}`);
    console.log(`  Compulsory courses seen:    ${result.compulsoryCourseCount}`);
    console.log(`  Elective courses seen:      ${result.electiveCourseCount}`);
    console.log(`  ProgramSkill rows written:  ${result.programSkillRowsWritten}`);
    if (result.unresolvedNames.length > 0) {
      console.log(`\n  Unresolved skill names (${result.unresolvedNames.length}):`);
      for (const n of result.unresolvedNames.slice(0, 15)) console.log(`    - ${n}`);
      if (result.unresolvedNames.length > 15) console.log(`    … and ${result.unresolvedNames.length - 15} more`);
    }
  } else {
    console.log(`  Reason: ${result.reason}`);
    if (result.status === 'FAILED') process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
