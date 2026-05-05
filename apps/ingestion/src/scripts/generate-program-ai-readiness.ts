#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Generate the discipline-aware AI readiness assessment for one program
// or for every program (--all).
//
// Usage:
//   pnpm programs:ai-readiness <code|seq|id>             # one program
//   pnpm programs:ai-readiness --all [--limit=N] [--resume]
//   pnpm programs:ai-readiness <code> --force            # re-run
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { prisma, PrismaAiInferenceRecorder } from '@kku/db';
import { createAiService, type AiProviderId } from '@kku/shared';
import { runProgramAiReadiness } from '../program-ai-readiness/run';

interface CliArgs {
  programArg: string | null;
  all: boolean;
  limit: number | null;
  resume: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.find((a) => !a.startsWith('--')) ?? null;
  const all = argv.includes('--all');
  const resume = argv.includes('--resume');
  const force = argv.includes('--force');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '0', 10) : null;
  if (!positional && !all) {
    console.error('Usage: pnpm programs:ai-readiness <code|seq|id> | --all [--limit=N] [--resume] [--force]');
    process.exit(1);
  }
  return { programArg: positional, all, limit, resume, force };
}

async function resolveTargets(args: CliArgs): Promise<Array<{ id: string; code: string; nameEn: string }>> {
  if (args.all) {
    let programs = await prisma.program.findMany({
      // Canonical 297 only — readiness assessments are part of the
      // curriculum pipeline and must not run on legacy/non-canonical
      // Program rows.
      where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
      select: { id: true, code: true, nameEn: true, nameTh: true },
      orderBy: { code: 'asc' },
    });
    if (args.resume) {
      const done = new Set(
        (await prisma.programAiReadinessAssessment.findMany({ select: { programId: true } })).map((r) => r.programId),
      );
      const before = programs.length;
      programs = programs.filter((p) => !done.has(p.id));
      console.log(`--resume: skipped ${before - programs.length} programs already assessed`);
    }
    if (args.limit) programs = programs.slice(0, args.limit);
    return programs.map((p) => ({ id: p.id, code: p.code, nameEn: p.nameEn || p.nameTh }));
  }
  const arg = args.programArg!;
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
    select: { id: true, code: true, nameEn: true, nameTh: true },
  });
  if (!program) throw new Error(`Program not found for "${arg}"`);
  return [{ id: program.id, code: program.code, nameEn: program.nameEn || program.nameTh }];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = await resolveTargets(args);

  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const ai = createAiService({
    recorder: new PrismaAiInferenceRecorder(),
    providerId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
  });

  console.log(`━━━ AI readiness assessment ━━━`);
  console.log(`Targets: ${targets.length}, provider: ${providerId}\n`);

  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let totalCost = 0;
  for (const t of targets) {
    process.stdout.write(`${t.code} ${t.nameEn.slice(0, 60).padEnd(60)} `);
    try {
      const r = await runProgramAiReadiness({ programId: t.id, ai, force: args.force });
      if (r.status === 'SUCCEEDED') {
        okCount++;
        totalCost += r.costUsd;
        console.log(`✓ score=${r.relevanceScore.toFixed(0)} gaps=${r.gapCount} recs=${r.recommendationCount} $${r.costUsd.toFixed(3)}`);
      } else if (r.status === 'SKIPPED') {
        skipCount++;
        console.log(`= ${r.reason}`);
      } else {
        failCount++;
        console.log(`✗ ${r.reason}`);
      }
    } catch (e) {
      failCount++;
      console.log(`✗ ${(e as Error).message}`);
    }
  }

  console.log(`\nDone: ok=${okCount}  skip=${skipCount}  fail=${failCount}  cost=$${totalCost.toFixed(2)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
