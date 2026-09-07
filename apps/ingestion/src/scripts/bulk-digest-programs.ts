#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Bulk run program-digest.v1 against every Program that:
//   - has a linked CURRENT_CURRICULUM PDF, AND
//   - does not already have a PROGRAM_DIGEST AiExtraction.
//
// Sequential — Gemini's per-second limits aren't documented for arbitrary
// Workspace plans, and one digest takes ~25-60s; concurrency wouldn't shave
// meaningfully off the total. Per-program try/catch means a single failure
// (PDF unreachable, LLM timeout, schema-validation reject) skips that program
// without killing the run.
//
// Auto-resume: the eligibility query excludes anything with an existing
// PROGRAM_DIGEST row, so a re-run picks up where the last one stopped. To
// re-digest a specific program, delete its existing PROGRAM_DIGEST extraction
// first (or use the per-program script with --force).
//
// Output: streams a JSONL audit log to logs/bulk-digest-<ts>.jsonl so the
// progress is tail-able from another shell while the script runs.
//
// Usage:
//   pnpm programs:digest-bulk                # everything
//   pnpm programs:digest-bulk --limit 5      # smoke-test cap
//   pnpm programs:digest-bulk --level BACHELOR
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

import { prisma, type ProgramLevel } from '@kku/db';
import { S3Storage } from '@kku/shared';
import { runProgramDigest } from '../program-digest/run';
import { createIngestionAiService } from '../lib/ai-service';

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}
const LIMIT = (() => {
  const v = flag('limit');
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer; got ${v}`);
  return n;
})();
const LEVEL_FILTER = flag('level') as ProgramLevel | undefined;

// ── Logging ──────────────────────────────────────────────────────────────────

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `bulk-digest-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

function audit(record: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

const LEVEL_TH_LABEL: Record<string, string> = {
  BACHELOR: 'ป.ตรี',
  MASTER: 'ป.โท',
  DOCTORAL: 'ป.เอก',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
};

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Log file: ${LOG_PATH}`);
  audit({ event: 'start', limit: LIMIT, levelFilter: LEVEL_FILTER });

  // Eligibility: has a CURRENT_CURRICULUM, doesn't have any PROGRAM_DIGEST yet.
  // AiExtraction is polymorphic (sourceEntityType + sourceEntityId), not a
  // true Prisma relation to Program — so we fetch the already-digested program
  // IDs separately and exclude them.
  const alreadyDigested = await prisma.aiExtraction.findMany({
    where: { sourceEntityType: 'program', extractionKind: 'PROGRAM_DIGEST' },
    select: { sourceEntityId: true },
  });
  const excludeIds = alreadyDigested.map((e) => e.sourceEntityId);

  const candidates = await prisma.program.findMany({
    where: {
      // Canonical 297 only — bulk digest is a curriculum-pipeline tool
      // and must not pick up legacy/non-canonical Program rows.
      sequenceNoFromSheet: { not: null },
      ...(LEVEL_FILTER ? { level: LEVEL_FILTER } : {}),
      documents: { some: { role: 'CURRENT_CURRICULUM', isCurrent: true } },
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    select: {
      id: true,
      code: true,
      nameTh: true,
      level: true,
      faculty: { select: { nameTh: true } },
    },
    orderBy: [{ level: 'asc' }, { code: 'asc' }],
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`Eligible programs: ${candidates.length}`);
  audit({ event: 'eligible', count: candidates.length });
  if (candidates.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
    region: process.env.MINIO_REGION ?? 'us-east-1',
  });
  const ai = createIngestionAiService();

  let totalCostUsd = 0;
  let successes = 0;
  let failures = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const prefix = `[${(i + 1).toString().padStart(3)}/${candidates.length}] ${c.code} ${LEVEL_TH_LABEL[c.level]} ${c.faculty.nameTh}`;
    console.log(`${prefix}\n  ${c.nameTh.slice(0, 80)}`);

    const startedAt = Date.now();
    const outcome = await runProgramDigest({ programId: c.id, ai, storage });
    const durationMs = Date.now() - startedAt;

    if (outcome.status === 'SUCCEEDED') {
      successes++;
      totalCostUsd += outcome.costUsd;
      console.log(
        `  ✓ ${(durationMs / 1000).toFixed(1)}s  ` +
          `conf=${outcome.confidence.toFixed(2)}  ` +
          `${outcome.tokensInput.toLocaleString()}→${outcome.tokensOutput.toLocaleString()} tok  ` +
          `$${outcome.costUsd.toFixed(4)}  ` +
          `${outcome.skillsExtracted} skills`,
      );
    } else {
      failures++;
      const reason = outcome.status === 'SKIPPED' ? `SKIPPED: ${outcome.reason}` : outcome.reason;
      console.log(`  ✗ ${(durationMs / 1000).toFixed(1)}s  ${reason}`);
    }
    audit({
      event: 'program',
      index: i + 1,
      total: candidates.length,
      programId: c.id,
      programCode: c.code,
      programNameTh: c.nameTh,
      level: c.level,
      facultyNameTh: c.faculty.nameTh,
      durationMs,
      status: outcome.status === 'SUCCEEDED' ? 'success' : 'failed',
      errorMessage: outcome.status !== 'SUCCEEDED' ? outcome.reason : undefined,
      costUsd: outcome.status === 'SUCCEEDED' ? outcome.costUsd : 0,
      tokensIn: outcome.status === 'SUCCEEDED' ? outcome.tokensInput : 0,
      tokensOut: outcome.status === 'SUCCEEDED' ? outcome.tokensOutput : 0,
      confidence: outcome.status === 'SUCCEEDED' ? outcome.confidence : 0,
      skillsExtracted: outcome.status === 'SUCCEEDED' ? outcome.skillsExtracted : 0,
    });
  }

  const summary = {
    eligible: candidates.length,
    successes,
    failures,
    totalCostUsd,
  };
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Summary: ${successes} ✓ / ${failures} ✗  total cost $${totalCostUsd.toFixed(2)}`);
  audit({ event: 'end', ...summary });
}

main()
  .catch((err) => {
    console.error(err);
    audit({ event: 'fatal', error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
