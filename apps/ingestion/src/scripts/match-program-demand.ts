#!/usr/bin/env tsx
// Demand-driven curriculum match — for each demanded skill, search the
// program's PLOs + course descriptions + extracted skills.
//
// Usage:
//   pnpm programs:match-demand <code|mhesi|sequenceNo|id> [--model=<name>]

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

import { prisma, PrismaAiInferenceRecorder } from '@kku/db';
import { createAiService, type AiProviderId } from '@kku/shared';
import { runDemandMatch } from '../program-demand-match/run';

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
  const positional = args.find((a) => !a.startsWith('--'));
  if (!positional) {
    console.error('Usage: pnpm programs:match-demand <code|mhesi|sequenceNo|id> [--model=<name>]');
    process.exit(1);
  }
  const modelArg = args.find((a) => a.startsWith('--model='));
  const modelOverride = modelArg ? modelArg.split('=')[1] : undefined;

  const programId = await resolveProgramId(positional);
  const recorder = new PrismaAiInferenceRecorder();
  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const ai = createAiService({
    recorder,
    providerId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
  });

  console.log(
    `Running demand-driven curriculum match…${modelOverride ? ` (model=${modelOverride})` : ''}`,
  );
  const t0 = Date.now();
  const result = await runDemandMatch({ programId, ai, modelOverride });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${elapsed}s`);
  console.log(`Status: ${result.status}`);
  if (result.status === 'SUCCEEDED') {
    console.log(`  Confidence:                  ${result.confidence.toFixed(2)}`);
    console.log(`  Tokens (in/out):             ${result.tokensInput.toLocaleString()} / ${result.tokensOutput.toLocaleString()}`);
    console.log(`  Cost:                        $${result.costUsd.toFixed(4)}`);
    console.log(`  Demanded skills checked:     ${result.demandedSkillsChecked}`);
    console.log(`  Matched (taught):            ${result.matched}`);
    console.log(`  Real gaps (relevant, not taught):    ${result.gapsRelevant}`);
    console.log(`  Suppressed (irrelevant noise):       ${result.irrelevant}`);
    console.log(`  Avg relatedness:             ${result.avgRelatedness.toFixed(2)}`);
    console.log(`  Match-source breakdown:`);
    for (const [src, n] of Object.entries(result.bySource)) {
      console.log(`    ${src.padEnd(20)} ${n}`);
    }
  } else {
    console.log(`  Reason: ${result.reason}`);
    if (result.status === 'FAILED') process.exit(1);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
