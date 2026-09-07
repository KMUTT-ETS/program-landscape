#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Bulk (re)generate `program-curriculum-revision` for canonical programs.
//
// Structural template: generate-research-expertise.ts — dotenv load →
// resolve targets → sequential per-program try/catch → JSONL audit log →
// summary bucketed by readiness. Sequential by design: one Google-provider
// call in flight at a time, matching every other AI phase here.
//
// Skips are NOT failures: 'no-research' and 'no-courses' short-circuit
// before any AI call and are reported separately.
//
// Persistence is INSERT-ONLY, so re-running adds rows rather than
// upserting. That is intentional — prior advice stays auditable.
//
// Usage:
//   pnpm curriculum:revision-generate                      # all
//   pnpm curriculum:revision-generate --limit 5            # smoke test
//   pnpm curriculum:revision-generate --program KKU-SEQ-0030
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
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

import { prisma, generateProgramCurriculumRevision } from '@kku/db';
import { createIngestionAiService } from '../lib/ai-service';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
const PROGRAM_CODE = flag('program');
const LIMIT = (() => {
  const v = flag('limit');
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer; got ${v}`);
  return n;
})();

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `curriculum-revision-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
function audit(r: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...r }) + '\n', 'utf8');
}

async function main(): Promise<void> {
  console.log(`Log file: ${LOG_PATH}`);
  audit({ event: 'start', programFilter: PROGRAM_CODE, limit: LIMIT });

  const programs = await prisma.program.findMany({
    where: { sequenceNoFromSheet: { not: null }, ...(PROGRAM_CODE ? { code: PROGRAM_CODE } : {}) },
    select: { id: true, code: true, nameTh: true },
    orderBy: { code: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`Candidate programmes: ${programs.length}`);
  audit({ event: 'eligible', count: programs.length });

  const ai = createIngestionAiService();

  let succeeded = 0,
    failed = 0,
    totalCost = 0,
    clamped = 0,
    lintRetried = 0,
    totalDropped = 0;
  const skips: Record<string, number> = {};

  for (let i = 0; i < programs.length; i++) {
    const p = programs[i]!;
    const prefix = `[${(i + 1).toString().padStart(3)}/${programs.length}] ${p.code}`;
    const startedAt = Date.now();
    let outcome;
    try {
      outcome = await generateProgramCurriculumRevision({ programId: p.id, ai });
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${prefix}  ✗ threw: ${message.slice(0, 150)}`);
      audit({ event: 'program', programCode: p.code, status: 'failed', errorMessage: message });
      continue;
    }
    const ms = Date.now() - startedAt;

    if (outcome.status === 'SUCCEEDED') {
      succeeded++;
      totalCost += outcome.costUsd;
      if (outcome.confidenceClamped) clamped++;
      if (outcome.lintRetried) lintRetried++;
      // Headline "unfounded items dropped" is the ITEM-level count only —
      // enhanceCoursesDropped + newCourseProposalsDropped +
      // promotionCandidatesDropped. The other CurriculumRevisionDrops
      // counters (themeRefsDropped, quotesBlanked, evidenceTitlesDropped,
      // rosterNamesDropped, quotesMissing, proseCourseCodesUnverified,
      // promotionsNotElective, evidenceCheckSkipped) are sub-claim-level or
      // informational — they still ride along in the audit line below via
      // `...outcome` (which nests the full `drops` object), just not
      // summed into this one number.
      const dropped =
        outcome.drops.enhanceCoursesDropped +
        outcome.drops.newCourseProposalsDropped +
        outcome.drops.promotionCandidatesDropped;
      totalDropped += dropped;
      console.log(
        `${prefix}  ✓ ${(ms / 1000).toFixed(1)}s  conf=${outcome.confidence.toFixed(2)}  ` +
          `${outcome.enhanceCount} enhance / ${outcome.newCourseCount} new / ${outcome.promotionCount} promote` +
          (dropped > 0 ? `  (${dropped} dropped)` : ''),
      );
      // No explicit `status: 'success'` here — `...outcome` already carries
      // `status: 'SUCCEEDED'` (TS2783: a literal set before a spread that
      // also sets it is silently overwritten by the spread, so keeping both
      // is a lint-visible mistake, not a stylistic choice).
      audit({ event: 'program', programCode: p.code, durationMs: ms, ...outcome });
    } else if (outcome.status === 'SKIPPED') {
      // 'no-research' / 'no-courses' — a program with nothing to reason
      // from/about. Short-circuited BEFORE any AI call in the runner, so
      // these are correct, expected outcomes, not failures. Bucketed by
      // reason (not folded into `failed`) so the summary can't be misread
      // as a broken run.
      skips[outcome.reason] = (skips[outcome.reason] ?? 0) + 1;
      console.log(`${prefix}  – skipped: ${outcome.reason}`);
      audit({ event: 'program', programCode: p.code, status: 'skipped', reason: outcome.reason });
    } else {
      failed++;
      console.log(`${prefix}  ✗ ${outcome.reason.slice(0, 150)}`);
      audit({ event: 'program', programCode: p.code, status: 'failed', errorMessage: outcome.reason });
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Succeeded:            ${succeeded}`);
  console.log(`Failed:               ${failed}`);
  console.log(`Skipped:              ${JSON.stringify(skips)}`);
  console.log(`Confidence clamped:   ${clamped}`);
  console.log(`Lint retried:         ${lintRetried}`);
  console.log(`Unfounded items dropped: ${totalDropped}`);
  console.log(`Total cost:           $${totalCost.toFixed(2)}`);
  audit({ event: 'end', succeeded, failed, skips, clamped, lintRetried, totalDropped, totalCost });
}

main()
  .catch((err) => {
    console.error(err);
    audit({ event: 'fatal', error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
