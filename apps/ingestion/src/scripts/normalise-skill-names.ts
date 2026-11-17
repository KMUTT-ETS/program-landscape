#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Skill-name normaliser — one-shot AI backfill + incremental sync handler.
//
// Three operating modes (env-flag-controlled):
//   --source=labour_market       — process unmatched LabourMarketSkillDemand /
//                                  LabourMarketSkillGrowth rows: labour-market skill
//                                  demand from the Career Skill Demand upload
//                                  (or the deprecated kmitl-skill-mapping
//                                  connector). `linkedin` is the old name and
//                                  still works; it is also the internal
//                                  source tag stored on SkillAlias rows.
//   --source=program_digest      — process pending PROPOSED_SKILL extractions
//                                  emitted by the program-digest pipeline
//   --source=all                 — both, in sequence (default)
//
//   --limit=<N>                  — cap names processed this run (default
//                                  unlimited; useful for cost control)
//   --batch-size=<N>             — names per LLM call (default 25, max 50)
//   --dry-run                    — log decisions without writing SkillAlias
//                                  rows or relinking
//   --auto-promote               — when AI emits NEW_PROPOSED with
//                                  confidence ≥ the auto-promote bar,
//                                  automatically create the new Skill and
//                                  link it. Otherwise the alias stays
//                                  NEW_PROPOSED awaiting analyst review.
//   --auto-promote-min-confidence=<0..1>
//                                — the auto-promote bar (default 0.9).
//                                  Only has an effect with --auto-promote.
//
// What it does:
//   1. Collect unique unmatched raw names per source (excluding names
//      already in SkillAlias with status≠PENDING)
//   2. Batch them through the AI normaliser prompt
//   3. Persist decisions to SkillAlias (RESOLVED / NEW_PROPOSED / AMBIGUOUS)
//   4. Re-link existing rows: LabourMarketSkillDemand.skill_id +
//      LabourMarketSkillGrowth.skill_id get filled in for newly-RESOLVED aliases
//
// Idempotency: rows already in SkillAlias with a final status are
// skipped. Re-run is safe — second pass only processes net-new names.
//
// Cost: ~$0.03 per batch of 40 with Gemini. 2,841 unmatched LinkedIn
// names → ~71 batches → ~$2.10 total. PROPOSED_SKILL queue similar.
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

import { loadOrganization, prisma } from '@kku/db';
import { createIngestionAiService } from '../lib/ai-service';
import {
  DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE,
  openNormaliserLog,
  runSkillNormaliser,
  type CliArgs,
} from '../program-skills/skill-normaliser-run';
import { withSkillTaxonomyLock } from '../program-skills/taxonomy-lock';

function parseArgs(argv: string[]): CliArgs {
  const a = {
    source: 'all',
    limit: null,
    batchSize: 25,
    dryRun: false,
    autoPromote: false,
    autoPromoteMinConfidence: DEFAULT_AUTO_PROMOTE_MIN_CONFIDENCE,
  } as CliArgs;
  for (const arg of argv) {
    if (arg === '--dry-run') a.dryRun = true;
    else if (arg === '--auto-promote') a.autoPromote = true;
    else if (arg.startsWith('--source=')) {
      const raw = arg.slice('--source='.length);
      // `labour_market` is the documented name; `linkedin` is the internal
      // source tag it maps to, kept as an alias for existing scripts.
      const v = raw === 'labour_market' ? 'linkedin' : raw;
      if (v !== 'linkedin' && v !== 'program_digest' && v !== 'all') {
        throw new Error(`Invalid --source: ${raw} (use labour_market, program_digest or all)`);
      }
      a.source = v;
    } else if (arg.startsWith('--limit=')) a.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--auto-promote-min-confidence=')) {
      const raw = arg.slice('--auto-promote-min-confidence='.length);
      const v = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`Invalid --auto-promote-min-confidence: ${raw} (use a number from 0 to 1)`);
      }
      a.autoPromoteMinConfidence = v;
    } else if (arg.startsWith('--batch-size=')) {
      a.batchSize = Math.min(50, Math.max(1, Number(arg.slice('--batch-size='.length))));
    }
  }
  return a;
}


async function main(): Promise<void> {
  await loadOrganization();
  const args = parseArgs(process.argv.slice(2));
  console.log('Skill-name normaliser');
  console.log(`  source=${args.source === 'linkedin' ? 'labour_market' : args.source} limit=${args.limit ?? '∞'} batchSize=${args.batchSize} dryRun=${args.dryRun} autoPromote=${args.autoPromote}${args.autoPromote ? ` (min confidence ${args.autoPromoteMinConfidence})` : ''}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const ai = createIngestionAiService();
  const logFile = openNormaliserLog();
  console.log(`  audit log → ${logFile}`);
  // A real run creates skills: take the same lock the pipeline's phase 2 takes.
  const grand = args.dryRun
    ? await runSkillNormaliser(ai, args, logFile)
    : await withSkillTaxonomyLock(() => runSkillNormaliser(ai, args, logFile));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total candidates: ${grand.totalCandidates}`);
  console.log(`  Matched (RESOLVED):  ${grand.matched}`);
  console.log(`  New proposed:        ${grand.newProposed}`);
  console.log(`  Ambiguous:           ${grand.ambiguous}`);
  console.log(`  Failed:              ${grand.failed}`);
  if (grand.rejected > 0) console.log(`  Skipped (REJECTED):  ${grand.rejected}`);
  console.log(`  Batches:             ${grand.batches}`);
  console.log(`  Audit log:           ${logFile}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
