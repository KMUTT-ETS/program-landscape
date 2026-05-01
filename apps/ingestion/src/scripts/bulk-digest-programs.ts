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
// first.
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

import { prisma, PrismaAiInferenceRecorder, type ProgramLevel } from '@kku/db';
import {
  buildProgramDigestMessages,
  createAiService,
  ProgramDigestSchema,
  PROGRAM_DIGEST_VERSION,
  S3Storage,
  type AiProviderId,
} from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';

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

// ── Per-program digest (mirrors digest-program.ts) ───────────────────────────

const LEVEL_TH_LABEL: Record<string, string> = {
  BACHELOR: 'ป.ตรี',
  MASTER: 'ป.โท',
  DOCTORAL: 'ป.เอก',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
};

interface ProgramRow {
  id: string;
  code: string;
  nameTh: string;
  level: string;
  mhesiCode: string | null;
  sequenceNoFromSheet: number | null;
  curriculumYearBE: number | null;
  majors: string[];
  facultyNameTh: string;
  pdfStorageUrl: string;
  pdfFilename: string;
}

function parseS3Url(storageUrl: string): { bucket: string; key: string } {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(storageUrl);
  if (!m) throw new Error(`unrecognised storageUrl: ${storageUrl}`);
  return { bucket: m[1]!, key: m[2]! };
}

interface DigestOutcome {
  status: 'success' | 'failed';
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  confidence: number;
  durationMs: number;
  skillsExtracted: number;
  errorMessage?: string;
}

async function digestOne(
  program: ProgramRow,
  storage: S3Storage,
  ai: ReturnType<typeof createAiService>,
): Promise<DigestOutcome> {
  const startedAt = Date.now();
  try {
    const { bucket, key } = parseS3Url(program.pdfStorageUrl);
    const url = await storage.getSignedDownloadUrl({ bucket, key, ttlSeconds: 300 });
    const pdfRes = await fetch(url);
    if (!pdfRes.ok) throw new Error(`PDF fetch ${pdfRes.status}`);
    const bytes = Buffer.from(await pdfRes.arrayBuffer());
    const extracted = await extractNativeText(bytes);

    const messages = buildProgramDigestMessages({
      programMetaFromSheet: {
        facultyNameTh: program.facultyNameTh,
        levelTh: LEVEL_TH_LABEL[program.level] ?? program.level,
        degreeNameFromSheet: program.nameTh,
        majorNameFromSheet: program.majors[0] ?? '',
        curriculumYearBe: program.curriculumYearBE,
        mhesiCode: program.mhesiCode,
      },
      pdfText: extracted.fullText,
    });

    const response = await ai.extractStructured(
      {
        ctx: {
          module: 'curriculum',
          kind: 'program-digest',
          userId: null,
          traceId: `bulk-digest-${program.id}`,
        },
        messages,
        methodVersion: PROGRAM_DIGEST_VERSION,
        maxOutputTokens: 16000,
      },
      ProgramDigestSchema,
    );

    await prisma.aiExtraction.create({
      data: {
        sourceEntityType: 'program',
        sourceEntityId: program.id,
        extractionKind: 'PROGRAM_DIGEST',
        payloadJson: response.parsed as object,
        confidence: response.confidence,
        methodVersion: PROGRAM_DIGEST_VERSION,
        aiInferenceId: response.aiInferenceId,
        reviewStatus: 'PENDING_REVIEW',
        reasoning: response.reasoning ?? null,
      },
    });

    return {
      status: 'success',
      costUsd: response.cost.usd,
      tokensIn: response.tokens.input,
      tokensOut: response.tokens.output,
      confidence: response.confidence,
      durationMs: Date.now() - startedAt,
      skillsExtracted: response.parsed.extractedSkills.length,
    };
  } catch (err) {
    return {
      status: 'failed',
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      confidence: 0,
      durationMs: Date.now() - startedAt,
      skillsExtracted: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

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
      ...(LEVEL_FILTER ? { level: LEVEL_FILTER } : {}),
      documents: { some: { role: 'CURRENT_CURRICULUM', isCurrent: true } },
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    include: {
      faculty: { select: { nameTh: true } },
      documents: {
        where: { role: 'CURRENT_CURRICULUM', isCurrent: true },
        include: { pdfDocument: { select: { storageUrl: true, originalFilename: true } } },
        take: 1,
      },
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
  const recorder = new PrismaAiInferenceRecorder();
  const ai = createAiService({
    recorder,
    providerId: (process.env.AI_PROVIDER ?? 'google') as AiProviderId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
  });

  let totalCostUsd = 0;
  let successes = 0;
  let failures = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const doc = c.documents[0];
    if (!doc) continue; // shouldn't happen given the where-clause, but guard anyway.

    const program: ProgramRow = {
      id: c.id,
      code: c.code,
      nameTh: c.nameTh,
      level: c.level,
      mhesiCode: c.mhesiCode,
      sequenceNoFromSheet: c.sequenceNoFromSheet,
      curriculumYearBE: c.curriculumYearBE,
      majors: c.majors,
      facultyNameTh: c.faculty.nameTh,
      pdfStorageUrl: doc.pdfDocument.storageUrl,
      pdfFilename: doc.pdfDocument.originalFilename,
    };

    const prefix = `[${(i + 1).toString().padStart(3)}/${candidates.length}] ${program.code} ${LEVEL_TH_LABEL[program.level]} ${program.facultyNameTh}`;
    console.log(`${prefix}\n  ${program.nameTh.slice(0, 80)}`);
    const outcome = await digestOne(program, storage, ai);

    if (outcome.status === 'success') {
      successes++;
      totalCostUsd += outcome.costUsd;
      console.log(
        `  ✓ ${(outcome.durationMs / 1000).toFixed(1)}s  ` +
          `conf=${outcome.confidence.toFixed(2)}  ` +
          `${outcome.tokensIn.toLocaleString()}→${outcome.tokensOut.toLocaleString()} tok  ` +
          `$${outcome.costUsd.toFixed(4)}  ` +
          `${outcome.skillsExtracted} skills`,
      );
    } else {
      failures++;
      console.log(`  ✗ ${(outcome.durationMs / 1000).toFixed(1)}s  ${outcome.errorMessage}`);
    }
    audit({
      event: 'program',
      index: i + 1,
      total: candidates.length,
      programId: program.id,
      programCode: program.code,
      programNameTh: program.nameTh,
      level: program.level,
      facultyNameTh: program.facultyNameTh,
      ...outcome,
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
