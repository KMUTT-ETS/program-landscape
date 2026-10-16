#!/usr/bin/env tsx
// Run program-digest.v1 on a single Program. Thin CLI wrapper around
// runProgramDigest() — the same helper used by the bulk runner + the
// ai-jobs RUN_PROGRAM_DIGEST handler.
//
// Usage:
//   pnpm programs:digest <code-or-mhesi-or-sequenceNo>
//   pnpm programs:digest KKU-SEQ-0099
//   pnpm programs:digest 25430031100056
//   pnpm programs:digest 99
//   pnpm programs:digest <id> --force      # overwrite existing digest

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

import { loadOrganization, prisma } from '@kku/db';
import { S3Storage } from '@kku/shared';
import { runProgramDigest } from '../program-digest/run';
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
  console.log(`  ${program.code} ${program.level} ${program.nameTh}`);
  return program.id;
}

async function main(): Promise<void> {
  await loadOrganization();
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const positional = args.find((a) => !a.startsWith('--'));
  if (!positional) {
    console.error('Usage: pnpm programs:digest <code|mhesi|sequenceNo|id> [--force]');
    process.exit(1);
  }

  console.log(`Resolving program for "${positional}"…`);
  const programId = await resolveProgramId(positional);

  const ai = createIngestionAiService();
  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
    region: process.env.MINIO_REGION ?? 'us-east-1',
  });

  console.log('Running digest…');
  const startedAt = Date.now();
  const result = await runProgramDigest({ programId, ai, storage, force });
  const elapsedMs = Date.now() - startedAt;

  console.log(`\nDone in ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Status: ${result.status}`);
  if (result.status === 'SUCCEEDED') {
    console.log(`  AiExtraction id=${result.aiExtractionId}`);
    console.log(`  Confidence: ${result.confidence.toFixed(2)}`);
    console.log(`  Tokens: ${result.tokensInput.toLocaleString()} in / ${result.tokensOutput.toLocaleString()} out`);
    console.log(`  Cost: $${result.costUsd.toFixed(4)}`);
    console.log(`  Skills extracted: ${result.skillsExtracted}`);
    console.log('\nReview at: /admin/extraction-review');
  } else {
    console.log(`  Reason: ${result.reason}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
