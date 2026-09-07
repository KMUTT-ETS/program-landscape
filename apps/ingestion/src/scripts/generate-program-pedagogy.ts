#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Generate the discipline-aware pedagogical-readiness assessment for one
// program or for every program (--all).
//
// Reads the curriculum PDF and scores observed teaching/learning/QA
// against discipline-specific best practice (medical→PBL+clinical,
// engineering→project-based+internship, etc.).
//
// Usage:
//   pnpm programs:pedagogy <code|seq|id>             # one program
//   pnpm programs:pedagogy --all [--limit=N] [--resume]
//   pnpm programs:pedagogy <code> --force            # re-run
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

import { prisma } from '@kku/db';
import { S3Storage } from '@kku/shared';
import { runProgramPedagogy } from '../program-pedagogy/run';
import { createIngestionAiService } from '../lib/ai-service';

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
    console.error('Usage: pnpm programs:pedagogy <code|seq|id> | --all [--limit=N] [--resume] [--force]');
    process.exit(1);
  }
  return { programArg: positional, all, limit, resume, force };
}

async function resolveTargets(args: CliArgs): Promise<Array<{ id: string; code: string; nameEn: string }>> {
  if (args.all) {
    let programs = await prisma.program.findMany({
      where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
      select: { id: true, code: true, nameEn: true, nameTh: true },
      orderBy: { code: 'asc' },
    });
    if (args.resume) {
      const done = new Set(
        (await prisma.programPedagogyAssessment.findMany({ select: { programId: true } })).map((r) => r.programId),
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

  const providerId = process.env.AI_PROVIDER ?? 'google';
  const ai = createIngestionAiService();
  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.MINIO_REGION ?? 'us-east-1',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT,
  });

  console.log(`━━━ Pedagogical-readiness assessment ━━━`);
  console.log(`Targets: ${targets.length}, provider: ${providerId}\n`);

  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let totalCost = 0;
  for (const t of targets) {
    process.stdout.write(`${t.code} ${t.nameEn.slice(0, 60).padEnd(60)} `);
    try {
      const r = await runProgramPedagogy({
        programId: t.id,
        ai,
        storage,
        force: args.force,
      });
      if (r.status === 'SUCCEEDED') {
        okCount++;
        totalCost += r.costUsd;
        console.log(
          `✓ fit=${r.disciplineFitScore.toFixed(0)} qa=${r.qaScore.toFixed(0)} overall=${r.overallScore.toFixed(0)} gaps=${r.gapCount} conf=${r.confidence.toFixed(2)} $${r.costUsd.toFixed(3)}`,
        );
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
