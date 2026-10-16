#!/usr/bin/env tsx
// Maps a program's career list (from PROGRAM_DIGEST) to KMITL career
// IDs so the deep-dive skills section filters demand to relevant careers.
//
// Usage:
//   pnpm programs:map-careers <code|mhesi|sequenceNo|id>
//   pnpm programs:map-careers KKU-SEQ-0062

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
import { mapProgramCareers } from '../program-careers/map';
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
  await loadOrganization();
  const args = process.argv.slice(2);
  const positional = args.find((a) => !a.startsWith('--'));
  if (!positional) {
    console.error('Usage: pnpm programs:map-careers <code|mhesi|sequenceNo|id>');
    process.exit(1);
  }

  const programId = await resolveProgramId(positional);

  const ai = createIngestionAiService();

  console.log('Mapping careers to KMITL taxonomy…');
  const t0 = Date.now();
  const result = await mapProgramCareers({ programId, ai });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${elapsed}s`);
  console.log(`Status: ${result.status}`);
  if (result.status === 'SUCCEEDED') {
    console.log(`  Confidence:                 ${result.confidence.toFixed(2)}`);
    console.log(`  Tokens (in/out):            ${result.tokensInput.toLocaleString()} / ${result.tokensOutput.toLocaleString()}`);
    console.log(`  Cost:                       $${result.costUsd.toFixed(4)}`);
    console.log(`  Careers total:              ${result.careersTotal}`);
    console.log(`  Mapped to KMITL:            ${result.kmitlMatched}`);
    console.log(`  Unmapped (need external):   ${result.kmitlUnmatched}`);
    console.log(`  KMITL career IDs (${result.kmitlCareerIds.length}): ${result.kmitlCareerIds.join(', ')}`);
    if (result.mappingSummary.length > 0) {
      console.log(`\n  Per-career breakdown:`);
      for (const m of result.mappingSummary) {
        const ids = m.kmitlIds.length > 0 ? `→ [${m.kmitlIds.join(', ')}]` : '→ (no KMITL match)';
        console.log(`    • ${m.career}`);
        console.log(`        ${ids} ${m.reasoning ? `— ${m.reasoning}` : ''}`);
      }
    }
    if (result.unmappedCareers.length > 0) {
      console.log(`\n  Unmapped careers (will route to external grounded search):`);
      for (const c of result.unmappedCareers) console.log(`    - ${c}`);
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
