#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Run the IMD-rankings AI extractor against a PdfDocument.
//
// Usage:
//   pnpm imd:extract <pdfDocumentId>          # one PDF, default skip-if-exists
//   pnpm imd:extract <pdfDocumentId> --force  # re-run / overwrite
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
import { createAiService, S3Storage, type AiProviderId } from '@kku/shared';
import { runImdRankingsExtract } from '../imd-rankings-extract/run';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pdfId = args.find((a) => !a.startsWith('--')) ?? null;
  const force = args.includes('--force');
  if (!pdfId) {
    console.error('Usage: pnpm imd:extract <pdfDocumentId> [--force]');
    process.exit(1);
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
  });
  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    region: process.env.MINIO_REGION ?? 'us-east-1',
    publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT,
  });

  console.log(`━━━ IMD extract — PDF ${pdfId} ${force ? '(force)' : ''} ━━━`);
  const r = await runImdRankingsExtract({ pdfDocumentId: pdfId, ai, storage, force });

  if (r.status === 'SUCCEEDED') {
    console.log(`✓ extracted ${r.rowsExtracted} rows  conf=${r.confidence.toFixed(2)}  cost=$${r.costUsd.toFixed(3)}`);
    console.log(`  AiExtraction id: ${r.aiExtractionId}`);
    console.log(`  Approve via /admin/extraction-review or POST /ai/extractions/${r.aiExtractionId}/approve`);
  } else if (r.status === 'SKIPPED') {
    console.log(`= skipped — ${r.reason}`);
  } else {
    console.log(`✗ failed — ${r.reason}`);
    process.exit(2);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
