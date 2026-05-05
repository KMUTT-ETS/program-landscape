#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Backfill ProgramLifecycleSnapshot rows by running
// `programLifecycleVerdict()` for every canonical-297 program. The
// function persists the snapshot via a write-through upsert, so this
// script is fire-and-forget — its only job is to drive the compute.
//
// The home dashboard reads the persisted snapshots directly; without
// this backfill the lifecycle distribution viz shows 0 / 297 covered.
//
// Usage:
//   pnpm programs:lifecycle-snapshot                    # all canonical-297, skip done
//   pnpm programs:lifecycle-snapshot --force            # recompute everything
//   pnpm programs:lifecycle-snapshot <code|seq|id>      # single program
//   pnpm programs:lifecycle-snapshot --limit=N
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

import { prisma, programLifecycleVerdict } from '@kku/db';

interface CliArgs {
  programArg: string | null;
  force: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.find((a) => !a.startsWith('--')) ?? null;
  const force = argv.includes('--force');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '0', 10) : null;
  return { programArg: positional, force, limit };
}

async function resolveTargets(args: CliArgs): Promise<Array<{ id: string; code: string; nameEn: string }>> {
  if (args.programArg) {
    const arg = args.programArg;
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

  let programs = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, code: true, nameEn: true, nameTh: true },
    orderBy: { code: 'asc' },
  });
  if (!args.force) {
    const done = new Set(
      (await prisma.programLifecycleSnapshot.findMany({ select: { programId: true } })).map((r) => r.programId),
    );
    const before = programs.length;
    programs = programs.filter((p) => !done.has(p.id));
    if (before !== programs.length) {
      console.log(`Skipping ${before - programs.length} programs that already have a snapshot (use --force to recompute).`);
    }
  }
  if (args.limit) programs = programs.slice(0, args.limit);
  return programs.map((p) => ({ id: p.id, code: p.code, nameEn: p.nameEn || p.nameTh }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = await resolveTargets(args);

  console.log(`━━━ Lifecycle snapshot backfill ━━━`);
  console.log(`Targets: ${targets.length}\n`);

  const counts = { FRONTIER: 0, RISING: 0, STABLE: 0, SUNSET: 0 };
  let okCount = 0;
  let failCount = 0;
  for (const t of targets) {
    process.stdout.write(`${t.code} ${t.nameEn.slice(0, 60).padEnd(60)} `);
    try {
      const r = await programLifecycleVerdict(t.id);
      counts[r.verdict] += 1;
      okCount++;
      console.log(`✓ ${r.verdict.padEnd(8)} traj=${r.trajectoryScore.toFixed(0)}`);
    } catch (e) {
      failCount++;
      console.log(`✗ ${(e as Error).message}`);
    }
  }

  console.log(`\nDone: ok=${okCount}  fail=${failCount}`);
  console.log(`Distribution: FRONTIER=${counts.FRONTIER}  RISING=${counts.RISING}  STABLE=${counts.STABLE}  SUNSET=${counts.SUNSET}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
