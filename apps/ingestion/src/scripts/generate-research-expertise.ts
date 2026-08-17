#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Bulk (re)generate `program-research-expertise` for canonical programs.
//
// Structural template: regenerate-narratives.ts (dotenv load → resolve
// targets → sequential per-program try/catch → JSONL audit log → summary
// with a confidence distribution + clamp telemetry). Same sequential-by-
// design rationale — one Google-provider call in flight at a time, matches
// how programs-pipeline.ts drives every other AI phase.
//
// Differences from regenerate-narratives.ts:
//   - generateProgramResearchExpertise() (packages/db/src/
//     program-research-expertise-run.ts) already returns `confidenceClamped`
//     and `lintRetried` directly on its SUCCEEDED outcome — unlike the
//     narrative runner, there's no need to intercept console.warn to
//     recover that telemetry here.
//   - The outcome is a proper discriminated SKIPPED case (not an error) for
//     two distinct reasons: `readiness: 'no-roster'` (a program with zero
//     curated ProgramFaculty roster members — zero AI calls made) or
//     `readiness: null` (program not found, defensive only — resolveTargets
//     below only ever returns real program ids). Both are surfaced as
//     `skipped`, not folded into the failure count.
//   - The summary additionally buckets by readiness: ok / thin /
//     no-roster-skipped, since a 'thin' generation still SUCCEEDS (with a
//     ceiled confidence) while 'no-roster' never reaches the model at all.
//   - Persistence is INSERT-ONLY (accretes history — see the runner's
//     module comment), so re-running this script against the same program
//     adds another row rather than upserting. That's intentional for
//     iteration during the 3-program gate; the PIPELINE phase (
//     programs-pipeline.ts, phase 'phaseRE') is what enforces
//     skip-if-already-generated for the unattended bulk path.
//
// Usage:
//   pnpm expertise:generate --only KKU-SEQ-0065        # single program
//   pnpm expertise:generate --limit 10                 # smoke-test cap
//   pnpm expertise:generate --all                       # full ~300-program run
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
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

import { prisma, PrismaAiInferenceRecorder, getAiModelOverrideStore, generateProgramResearchExpertise } from '@kku/db';
import { createAiService, type AiProviderId } from '@kku/shared';

// ── CLI args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return argv[i + 1];
}
const ONLY = flag('only') ?? null;
const ALL = argv.includes('--all');
const LIMIT = (() => {
  const v = flag('limit');
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer; got ${v}`);
  return n;
})();

if (!ONLY && !ALL && !LIMIT) {
  console.error(
    'Usage: pnpm expertise:generate --only <code> | --limit N | --all\n' +
      '  Refuses to run against the full canonical set without an explicit --limit or --all.',
  );
  process.exit(1);
}

// ── Logging ──────────────────────────────────────────────────────────────────

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `generate-research-expertise-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
function audit(record: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

// ── Provider-hard-fail detection ────────────────────────────────────────────
// Distinguishes "the model/API rejected this specific call" (counts toward
// the ordinary failure rate) from "the provider is unreachable for every
// call" (quota exhausted / bad key) — the latter should abort the run
// immediately rather than burn through guaranteed-to-fail attempts.
const HARD_FAIL_PATTERN = /quota|rate.?limit|resource_exhausted|429|invalid.*api.?key|api.?key.*invalid|unauthorized|401\b|permission_denied|403\b/i;

// ── Target resolution ────────────────────────────────────────────────────────

interface ProgramTarget {
  id: string;
  code: string;
  nameEn: string;
}

async function resolveTargets(): Promise<ProgramTarget[]> {
  if (ONLY) {
    const seqNo = Number(ONLY);
    const program = await prisma.program.findFirst({
      where: {
        OR: [
          { id: ONLY },
          { code: ONLY },
          { mhesiCode: ONLY },
          ...(Number.isInteger(seqNo) ? [{ sequenceNoFromSheet: seqNo }] : []),
        ],
      },
      select: { id: true, code: true, nameEn: true, nameTh: true },
    });
    if (!program) throw new Error(`Program not found for "${ONLY}"`);
    return [{ id: program.id, code: program.code, nameEn: program.nameEn || program.nameTh }];
  }

  // Canonical set — same predicate as programs-pipeline.ts's
  // resolveProgramIds(): the ~297 programs seeded from the master Google
  // Sheet (sequenceNoFromSheet IS NOT NULL). Excludes legacy mock-seed rows
  // and side-effect Program rows from staff/student ingestion.
  let programs = await prisma.program.findMany({
    where: { sequenceNoFromSheet: { not: null } },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, nameEn: true, nameTh: true },
  });
  if (LIMIT) programs = programs.slice(0, LIMIT);
  return programs.map((p) => ({ id: p.id, code: p.code, nameEn: p.nameEn || p.nameTh }));
}

// ── Per-program result shape ─────────────────────────────────────────────────

interface ProgramRunResult {
  code: string;
  status: 'ok' | 'skipped' | 'failed';
  readiness?: 'ok' | 'thin' | 'no-roster' | null;
  reason?: string;
  confidence?: number;
  confidenceClamped?: boolean;
  lintRetried?: boolean;
  costUsd?: number;
  themeCount?: number;
  totalDistinct?: number;
  durationMs: number;
}

async function processProgram(
  target: ProgramTarget,
  ai: ReturnType<typeof createAiService>,
): Promise<ProgramRunResult> {
  const t0 = Date.now();
  const outcome = await generateProgramResearchExpertise({ programId: target.id, ai });
  const durationMs = Date.now() - t0;

  if (outcome.status === 'SKIPPED') {
    return { code: target.code, status: 'skipped', readiness: outcome.readiness, reason: outcome.reason, durationMs };
  }
  if (outcome.status === 'FAILED') {
    return { code: target.code, status: 'failed', reason: outcome.reason, durationMs };
  }

  return {
    code: target.code,
    status: 'ok',
    readiness: outcome.readiness,
    confidence: outcome.confidence,
    confidenceClamped: outcome.confidenceClamped,
    lintRetried: outcome.lintRetried,
    costUsd: outcome.costUsd,
    themeCount: outcome.themeCount,
    totalDistinct: outcome.totalDistinct,
    durationMs,
  };
}

// ── Summary helpers ──────────────────────────────────────────────────────────

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function confidenceHistogram(values: number[]): string {
  const bands = Array.from({ length: 10 }, () => 0);
  for (const v of values) {
    const bandIdx = Math.min(9, Math.floor(v * 10));
    bands[bandIdx]!++;
  }
  return bands
    .map((count, i) => `  [${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}${i === 9 ? ']' : ')'} ${'█'.repeat(Math.min(count, 60))} ${count}`)
    .join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Log file: ${LOG_PATH}`);
  const targets = await resolveTargets();
  console.log(`━━━ program-research-expertise generation ━━━`);
  console.log(`Targets: ${targets.length}`);
  audit({ event: 'start', targetCount: targets.length, only: ONLY, limit: LIMIT, all: ALL });

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const ai = createAiService({
    recorder: new PrismaAiInferenceRecorder(),
    providerId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
    // Honour per-method model overrides set on the admin AI-settings page —
    // same as programs-pipeline.ts / regenerate-narratives.ts. Without this
    // a bulk run silently ignores any override and always uses
    // DEFAULT_COMPLETION_MODEL.
    modelOverrideResolver: getAiModelOverrideStore(),
  });
  console.log(`Provider: ${providerId}\n`);

  const results: ProgramRunResult[] = [];
  const t0 = Date.now();
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let stopped: string | null = null;
  let blocked: string | null = null;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    let r: ProgramRunResult;
    try {
      r = await processProgram(target, ai);
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      r = { code: target.code, status: 'failed', reason: message, durationMs: 0 };

      // Provider hard-fail (quota / bad key / auth) — every subsequent
      // call is guaranteed to fail the same way. Abort immediately.
      if (HARD_FAIL_PATTERN.test(message)) {
        results.push(r);
        failCount++;
        audit({ event: 'program', index: i + 1, ...r });
        blocked = message;
        break;
      }
    }
    results.push(r);
    if (r.status === 'ok') okCount++;
    else if (r.status === 'skipped') skipCount++;
    else failCount++;

    audit({ event: 'program', index: i + 1, total: targets.length, ...r });

    const flag = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '=' : '✗';
    const detail =
      r.status === 'ok'
        ? `readiness=${r.readiness} conf=${r.confidence!.toFixed(2)}${r.confidenceClamped ? ' (clamped)' : ''}${r.lintRetried ? ' lint-retried' : ''} $${r.costUsd!.toFixed(3)} ${(r.durationMs / 1000).toFixed(1)}s`
        : r.status === 'skipped'
          ? `skipped: ${r.reason} (readiness=${r.readiness ?? 'n/a'})`
          : (r.reason ?? '');
    console.log(`${flag} [${(i + 1).toString().padStart(3)}/${targets.length}] ${target.code}  ${detail}`);

    if ((i + 1) % 25 === 0) {
      console.log(`  — progress: ok=${okCount} skip=${skipCount} fail=${failCount} —`);
    }

    // Bail-out gate: >10% failure rate once we have at least 50 samples.
    const processed = i + 1;
    if (processed >= 50) {
      const failRate = failCount / processed;
      if (failRate > 0.1) {
        stopped = `failure rate ${(failRate * 100).toFixed(1)}% exceeds 10% threshold after ${processed} programs`;
        break;
      }
    }
  }

  const totalDurationMs = Date.now() - t0;
  const okResults = results.filter(
    (r): r is ProgramRunResult & { confidence: number; readiness: 'ok' | 'thin' } =>
      r.status === 'ok' && (r.readiness === 'ok' || r.readiness === 'thin'),
  );
  const confidences = okResults.map((r) => r.confidence).sort((a, b) => a - b);
  const clampedCount = okResults.filter((r) => r.confidenceClamped).length;
  const lintRetriedCount = okResults.filter((r) => r.lintRetried).length;
  const totalCost = okResults.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const failedCodes = results.filter((r) => r.status === 'failed').map((r) => `${r.code} (${r.reason})`);
  const skippedCodes = results.filter((r) => r.status === 'skipped').map((r) => `${r.code} (${r.reason})`);

  // Readiness buckets — the plan's required summary breakdown.
  const readinessOkCount = okResults.filter((r) => r.readiness === 'ok').length;
  const readinessThinCount = okResults.filter((r) => r.readiness === 'thin').length;
  const noRosterSkippedCount = results.filter(
    (r) => r.status === 'skipped' && r.readiness === 'no-roster',
  ).length;
  const otherSkippedCount = skipCount - noRosterSkippedCount;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (blocked) {
    console.log(`STATUS: BLOCKED — provider hard-fail detected`);
    console.log(`  ${blocked}`);
  } else if (stopped) {
    console.log(`STATUS: STOPPED EARLY — ${stopped}`);
  } else {
    console.log(`STATUS: COMPLETE`);
  }
  console.log(`Processed: ${results.length} / ${targets.length}`);
  console.log(`  ok=${okCount}  skipped=${skipCount}  failed=${failCount}`);
  console.log(
    `  readiness: ok=${readinessOkCount}  thin=${readinessThinCount}  no-roster-skipped=${noRosterSkippedCount}${otherSkippedCount > 0 ? `  other-skipped=${otherSkippedCount}` : ''}`,
  );
  console.log(`Wall time: ${(totalDurationMs / 60000).toFixed(1)} min`);
  console.log(`Total cost: $${totalCost.toFixed(3)}`);

  if (confidences.length > 0) {
    const mean = confidences.reduce((s, v) => s + v, 0) / confidences.length;
    console.log(`\nConfidence distribution (n=${confidences.length}):`);
    console.log(
      `  min=${confidences[0]!.toFixed(2)}  median=${percentileSorted(confidences, 0.5).toFixed(2)}  mean=${mean.toFixed(2)}  max=${confidences.at(-1)!.toFixed(2)}`,
    );
    console.log(confidenceHistogram(confidences));
    console.log(`\nClamp engaged: ${clampedCount} / ${confidences.length} (${((clampedCount / confidences.length) * 100).toFixed(1)}%)`);
  }

  console.log(`\nLint retries: ${lintRetriedCount} / ${confidences.length || 0}`);

  if (failedCodes.length > 0) {
    console.log(`\nFailed programs:`);
    for (const f of failedCodes) console.log(`  ${f}`);
  }
  if (skippedCodes.length > 0) {
    console.log(`\nSkipped programs:`);
    for (const s of skippedCodes) console.log(`  ${s}`);
  }

  audit({
    event: 'summary',
    processed: results.length,
    total: targets.length,
    ok: okCount,
    skipped: skipCount,
    failed: failCount,
    readinessOkCount,
    readinessThinCount,
    noRosterSkippedCount,
    otherSkippedCount,
    totalDurationMs,
    totalCostUsd: totalCost,
    clampedCount,
    lintRetriedCount,
    blocked,
    stopped,
    failedCodes,
    skippedCodes,
  });

  if (blocked) process.exitCode = 2;
  else if (stopped) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
