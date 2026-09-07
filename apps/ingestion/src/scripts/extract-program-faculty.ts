#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Extract program-specific academic-staff list from a curriculum PDF and
// persist as ProgramFaculty links + an AiExtraction audit row.
//
// Single-program runner. Bulk variant: extract-program-faculty-bulk.ts
//
// Usage:
//   pnpm programs:extract-faculty <code-or-mhesi-or-sequenceNo>
//   pnpm programs:extract-faculty KKU-SEQ-0062
//   pnpm programs:extract-faculty 62
//   pnpm programs:extract-faculty <arg> --force      # overwrite existing
// ─────────────────────────────────────────────────────────────────────────────

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
import { runProgramFacultyExtraction } from '../program-faculty/run';
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
    console.error('Usage: pnpm programs:extract-faculty <code|mhesi|sequenceNo|id> [--force]');
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

  console.log('Running staff extraction…');
  const t0 = Date.now();
  const result = await runProgramFacultyExtraction({ programId, ai, storage, force });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${elapsed}s`);
  console.log(`Status: ${result.status}`);
  if (result.status === 'SUCCEEDED') {
    console.log(`  AiExtraction:           ${result.aiExtractionId}`);
    console.log(`  Confidence:             ${result.confidence.toFixed(2)}`);
    console.log(`  Tokens (in/out):        ${result.tokensInput.toLocaleString()} / ${result.tokensOutput.toLocaleString()}`);
    console.log(`  Cost:                   $${result.costUsd.toFixed(4)}`);
    console.log(`  Staff extracted:        ${result.staffExtracted}`);
    console.log(`  Matched to FM:          ${result.staffMatched}`);
    console.log(`  Unmatched:              ${result.staffUnmatched}`);
    console.log(`  ProgramFaculty rows:    ${result.programFacultyRowsWritten}`);
    if (result.unmatchedNames.length > 0) {
      console.log(`\n  Unmatched names (${result.unmatchedNames.length}):`);
      for (const n of result.unmatchedNames.slice(0, 20)) console.log(`    - ${n}`);
      if (result.unmatchedNames.length > 20) console.log(`    … and ${result.unmatchedNames.length - 20} more`);
    }
  } else if (result.status === 'SKIPPED') {
    console.log(`  Reason: ${result.reason}`);
  } else {
    console.log(`  Reason: ${result.reason}`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
