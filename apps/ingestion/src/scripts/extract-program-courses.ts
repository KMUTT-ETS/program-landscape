#!/usr/bin/env tsx
// Run program-courses-extract.v1 on a single Program. Focused
// course-code extractor — distinct from program-digest.v1 which under-
// extracts courses (typical 8 vs the 40-60 a real curriculum carries).
//
// Usage:
//   pnpm programs:extract-courses <code-or-mhesi-or-sequenceNo>
//   pnpm programs:extract-courses KKU-SEQ-0062

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
import { runProgramCoursesExtract } from '../program-courses-extract/run';
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
  const args = process.argv.slice(2);
  const positional = args.find((a) => !a.startsWith('--'));
  if (!positional) {
    console.error('Usage: pnpm programs:extract-courses <code|mhesi|sequenceNo|id>');
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

  console.log('Running course extraction…');
  const startedAt = Date.now();
  const result = await runProgramCoursesExtract({ programId, ai, storage });
  const elapsedMs = Date.now() - startedAt;

  console.log(`\nDone in ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Status: ${result.status}`);
  if (result.status === 'SUCCEEDED') {
    console.log(`  AiExtraction id=${result.aiExtractionId}`);
    console.log(`  Confidence: ${result.confidence.toFixed(2)}`);
    console.log(`  Tokens: ${result.tokensInput.toLocaleString()} in / ${result.tokensOutput.toLocaleString()} out`);
    console.log(`  Cost: $${result.costUsd.toFixed(4)}`);
    console.log(`  Courses extracted: ${result.extractedCount}`);
    console.log(`  Materialised into program_courses: ${result.previousCount} → ${result.materialisedCount}`);
    // GUARD 2, operator-facing half. A SUCCEEDED whose LLM call failed, or
    // whose write the materialisation guard refused, must not read as a clean
    // pass here either — this script is how an operator re-runs a single
    // programme after exactly that failure.
    if (result.llmFailureReason) {
      console.log(`  DEGRADED: LLM call failed, courses came from the regex fallback only`);
      console.log(`    ${result.llmFailureReason}`);
    }
    if (result.materialisationRefusedReason) {
      console.log(`  WRITE REFUSED: ${result.materialisationRefusedReason}`);
      console.log(`    Existing rows were left untouched. Fix the extraction, then re-run.`);
    }
    if (result.llmFailureReason || result.materialisationRefusedReason) {
      process.exitCode = 1;
    }
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
