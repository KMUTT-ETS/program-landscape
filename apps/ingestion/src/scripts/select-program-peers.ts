#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// AI-driven peer selection for one (or all) KKU programs across 4 tiers:
//   - WORLD
//   - ASIA
//   - SOUTHEAST_ASIA
//   - THAILAND_PEER
//
// Usage:
//   pnpm peers:select <code|mhesi|seqNo|id>     # one program
//   pnpm peers:select --all [--limit N]         # bulk
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
import { selectProgramPeers } from '../program-peers/select';
import { generateProgramPeerReview } from '../program-peers/review';
import { createIngestionAiService } from '../lib/ai-service';

interface CliArgs {
  programArg: string | null;
  all: boolean;
  limit: number | null;
  /** When true, also runs the AI peer-review after picking. */
  withReview: boolean;
  /** When true, skips the picking step and only runs review (assumes
   *  picks already exist for the program). */
  reviewOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.find((a) => !a.startsWith('--')) ?? null;
  const all = argv.includes('--all');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] ?? '0', 10) : null;
  // Default ON: most callers want pick + review in one shot.
  const withReview = !argv.includes('--no-review');
  const reviewOnly = argv.includes('--review-only');
  if (!positional && !all) {
    console.error('Usage: pnpm peers:select <code|mhesi|seq|id> | --all [--limit=N] [--no-review] [--review-only]');
    process.exit(1);
  }
  return { programArg: positional, all, limit, withReview, reviewOnly };
}

async function resolveProgramIds(args: CliArgs): Promise<string[]> {
  if (args.all) {
    const programs = await prisma.program.findMany({
      // Canonical 297 only.
      where: { sequenceNoFromSheet: { not: null } },
      orderBy: { code: 'asc' },
      select: { id: true },
      ...(args.limit ? { take: args.limit } : {}),
    });
    return programs.map((p) => p.id);
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
    select: { id: true },
  });
  if (!program) throw new Error(`Program not found for "${arg}"`);
  return [program.id];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const programIds = await resolveProgramIds(args);
  console.log(`Programs to process: ${programIds.length}\n`);

  const ai = createIngestionAiService();

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let totalCost = 0;
  let totalSelections = 0;
  let reviewsGenerated = 0;

  for (const programId of programIds) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { code: true, nameEn: true },
    });
    process.stdout.write(`${program?.code} · ${program?.nameEn?.slice(0, 50)}… `);
    try {
      if (!args.reviewOnly) {
        const r = await selectProgramPeers({ programId, ai });
        if (r.status === 'SUCCEEDED') {
          succeeded++;
          totalCost += r.costUsd;
          totalSelections += r.totalSelections;
          process.stdout.write(
            `pick ✓ ${r.totalSelections} (W=${r.tierCounts.WORLD} A=${r.tierCounts.ASIA} SEA=${r.tierCounts.SOUTHEAST_ASIA} TH=${r.tierCounts.THAILAND_PEER}) $${r.costUsd.toFixed(3)}`,
          );
        } else if (r.status === 'SKIPPED') {
          skipped++;
          process.stdout.write(`⚠ skipped — ${r.reason}\n`);
          continue;
        } else {
          failed++;
          process.stdout.write(`✗ failed — ${r.reason}\n`);
          continue;
        }
      }

      if (args.withReview || args.reviewOnly) {
        const review = await generateProgramPeerReview({ programId, ai });
        if (review.status === 'SUCCEEDED') {
          reviewsGenerated++;
          totalCost += review.costUsd;
          process.stdout.write(
            `${args.reviewOnly ? '' : '  · '}review ✓ ${review.strengthsCount}+/${review.weaknessesCount}-/${review.recommendationsCount}rec $${review.costUsd.toFixed(3)} (conf ${review.confidence.toFixed(2)})\n`,
          );
        } else {
          process.stdout.write(`  · review skipped — ${review.status === 'SKIPPED' || review.status === 'FAILED' ? review.reason : ''}\n`);
        }
      } else {
        process.stdout.write('\n');
      }
    } catch (err) {
      failed++;
      process.stdout.write(`✗ error — ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Picks succeeded:     ${succeeded} / ${programIds.length}`);
  console.log(`Reviews generated:   ${reviewsGenerated}`);
  console.log(`Skipped:             ${skipped}`);
  console.log(`Failed:              ${failed}`);
  console.log(`Total picks written: ${totalSelections}`);
  console.log(`Total AI cost:       $${totalCost.toFixed(3)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
