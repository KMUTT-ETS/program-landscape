#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Bulk (re)generate `program-strategic-narrative` for canonical programs.
//
// Reusable runner — this pattern recurs for other prompt versions bumping
// (health-score, ai-readiness, peer-review, ...). Keep the shape generic:
// dotenv load → resolve targets → sequential per-program try/catch → JSONL
// audit log → summary with a confidence distribution + clamp/lint telemetry.
//
// Sequential by design (matches the rest of the curriculum pipeline —
// programs-pipeline.ts phase 7 runs the identical call one program at a
// time). The Google provider's per-second limits aren't documented for
// arbitrary Workspace plans; concurrency risk isn't worth the wall-clock
// savings on a ~300-call, ~$3 run.
//
// Confidence + lint telemetry: `generateProgramStrategicNarrative()`
// (packages/db/src/program-strategic-narrative-run.ts) clamps the model's
// self-reported confidence to a deterministic ceiling and retries once on a
// banned-tell lint failure — logging via console.warn in both cases. This
// script:
//   - intercepts console.warn during each call to recover the clamp event
//     (reported confidence + ceiling + missing-channel count) — the ONLY
//     place that number is exposed; the persisted row only has the
//     post-clamp value.
//   - independently re-lints the PERSISTED contentMarkdown with the same
//     lintBannedTells() the runner uses, which is the authoritative signal
//     for "still violates after retry" (a persisted violation can only
//     exist if a retry ran and its own output still violated — see the
//     runner: response is only ever the retryResponse when the initial
//     draft had violations).
//   - "lint retried" is therefore a LOWER BOUND: it's true whenever the
//     persisted content still violates (which requires a retry to have
//     happened) OR the runner's own "still failing after retry" warning
//     fired. A retry that ran and successfully fixed the draft leaves no
//     external trace — the runner does not log that case. Flagged in the
//     summary output, not silently presented as exact.
//
// Usage:
//   pnpm narratives:regenerate --only KKU-SEQ-0065        # single program
//   pnpm narratives:regenerate --limit 10                 # smoke-test cap
//   pnpm narratives:regenerate --all                       # full ~300-program run
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

import { prisma, PrismaAiInferenceRecorder, getAiModelOverrideStore, generateProgramStrategicNarrative } from '@kku/db';
import { createAiService, lintBannedTells, type AiProviderId } from '@kku/shared';

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
    'Usage: pnpm narratives:regenerate --only <code> | --limit N | --all\n' +
      '  Refuses to run against the full canonical set without an explicit --limit or --all.',
  );
  process.exit(1);
}

// ── Logging ──────────────────────────────────────────────────────────────────

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `regenerate-narratives-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
function audit(record: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

// ── Provider-hard-fail detection ────────────────────────────────────────────
// Distinguishes "the model/API rejected this specific call" (counts toward
// the ordinary failure rate) from "the provider is unreachable for every
// call" (quota exhausted / bad key) — the latter should abort the run
// immediately rather than burn through 300 guaranteed-to-fail attempts.
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
  // resolveProgramIds(): the 297-ish programs seeded from the master
  // Google Sheet (sequenceNoFromSheet IS NOT NULL). Excludes legacy
  // mock-seed rows and side-effect Program rows from staff/student
  // ingestion. No status filter — matches the pipeline exactly (narrative
  // regeneration is phase 7 of that same pipeline).
  let programs = await prisma.program.findMany({
    where: { sequenceNoFromSheet: { not: null } },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, nameEn: true, nameTh: true },
  });
  if (LIMIT) programs = programs.slice(0, LIMIT);
  return programs.map((p) => ({ id: p.id, code: p.code, nameEn: p.nameEn || p.nameTh }));
}

// ── console.warn interception ───────────────────────────────────────────────

async function captureWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const original = console.warn;
  const captured: string[] = [];
  console.warn = (...args: unknown[]) => {
    captured.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    original(...args);
  };
  try {
    const result = await fn();
    return { result, warnings: captured };
  } finally {
    console.warn = original;
  }
}

const CLAMP_WARN_RE =
  /confidence clamped for program (\S+): reported=([\d.]+) ceiling=([\d.]+) \(missingChannels=(\d+)\)/;
const RETRY_STILL_FAILING_RE = /banned-tell lint still failing after retry for program (\S+): (.+)$/;

// ── Per-program result shape ─────────────────────────────────────────────────

interface ProgramRunResult {
  code: string;
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  confidence?: number;
  reportedConfidence?: number;
  clamped?: boolean;
  clampCeiling?: number;
  missingChannels?: number;
  lintRetriedDetected?: boolean;
  lintStillViolating?: boolean;
  lintViolatingPhrases?: string[];
  costUsd?: number;
  durationMs: number;
}

async function processProgram(
  target: ProgramTarget,
  ai: ReturnType<typeof createAiService>,
): Promise<ProgramRunResult> {
  const t0 = Date.now();
  const { result: outcome, warnings } = await captureWarnings(() =>
    generateProgramStrategicNarrative({ programId: target.id, ai }),
  );
  const durationMs = Date.now() - t0;

  if (outcome.status === 'SKIPPED') {
    return { code: target.code, status: 'skipped', reason: outcome.reason, durationMs };
  }
  if (outcome.status === 'FAILED') {
    return { code: target.code, status: 'failed', reason: outcome.reason, durationMs };
  }

  const clampMatch = warnings.map((w) => w.match(CLAMP_WARN_RE)).find((m): m is RegExpMatchArray => m !== null);
  const retryStillFailing = warnings.some((w) => RETRY_STILL_FAILING_RE.test(w));

  const finalViolations = lintBannedTells(outcome.contentMarkdown);
  const lintStillViolating = finalViolations.length > 0;

  return {
    code: target.code,
    status: 'ok',
    confidence: outcome.confidence,
    reportedConfidence: clampMatch ? Number(clampMatch[2]) : outcome.confidence,
    clamped: !!clampMatch,
    clampCeiling: clampMatch ? Number(clampMatch[3]) : undefined,
    missingChannels: clampMatch ? Number(clampMatch[4]) : undefined,
    // Lower bound — see the module-header note. True whenever we have
    // DIRECT evidence a retry happened (persisted violations can only
    // exist post-retry; or the runner's own warning fired). A retry that
    // ran and silently fixed the draft leaves no trace to detect.
    lintRetriedDetected: lintStillViolating || retryStillFailing,
    lintStillViolating,
    lintViolatingPhrases: finalViolations.map((v) => v.phrase),
    costUsd: outcome.costUsd,
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
  console.log(`━━━ program-strategic-narrative regeneration ━━━`);
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
    // same as programs-pipeline.ts. Without this a bulk run silently
    // ignores any override and always uses DEFAULT_COMPLETION_MODEL.
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
        ? `conf=${r.confidence!.toFixed(2)}${r.clamped ? ` (clamped from ${r.reportedConfidence!.toFixed(2)}, ceiling ${r.clampCeiling!.toFixed(2)})` : ''}${r.lintStillViolating ? ` LINT:${r.lintViolatingPhrases!.join(',')}` : r.lintRetriedDetected ? ' lint-retried-ok' : ''} $${r.costUsd!.toFixed(3)} ${(r.durationMs / 1000).toFixed(1)}s`
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
  const okResults = results.filter((r): r is ProgramRunResult & { confidence: number } => r.status === 'ok');
  const confidences = okResults.map((r) => r.confidence).sort((a, b) => a - b);
  const clampedCount = okResults.filter((r) => r.clamped).length;
  const lintRetriedCount = okResults.filter((r) => r.lintRetriedDetected).length;
  const stillViolatingResults = okResults.filter((r) => r.lintStillViolating);
  const totalCost = okResults.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const failedCodes = results.filter((r) => r.status === 'failed').map((r) => `${r.code} (${r.reason})`);
  const skippedCodes = results.filter((r) => r.status === 'skipped').map((r) => `${r.code} (${r.reason})`);

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

  console.log(
    `\nLint retries detected (lower bound — see script header): ${lintRetriedCount}`,
  );
  console.log(`Still violating after retry: ${stillViolatingResults.length}`);
  if (stillViolatingResults.length > 0) {
    for (const r of stillViolatingResults) {
      console.log(`  ${r.code}: ${r.lintViolatingPhrases!.join(', ')}`);
    }
  }

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
    totalDurationMs,
    totalCostUsd: totalCost,
    clampedCount,
    lintRetriedCount,
    stillViolatingCount: stillViolatingResults.length,
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
