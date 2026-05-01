#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Run program-digest.v1 on a single Program: read its CURRENT_CURRICULUM
// PDF from MinIO, extract text, send to LLM, persist AiExtraction
// (review queue path, status=PENDING_REVIEW).
//
// Usage:
//   pnpm programs:digest <code-or-mhesi-or-sequenceNo>
//   pnpm programs:digest KKU-SEQ-0099
//   pnpm programs:digest 25430031100056
//   pnpm programs:digest 99
//
// Bulk path (queue → review). Direct path (no review) lands in Phase 4
// alongside the admin UI.
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

import { prisma, PrismaAiInferenceRecorder } from '@kku/db';
import {
  buildProgramDigestMessages,
  createAiService,
  ProgramDigestSchema,
  PROGRAM_DIGEST_VERSION,
  S3Storage,
  type AiProviderId,
} from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';

interface ProgramRecord {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  mhesiCode: string | null;
  sequenceNoFromSheet: number | null;
  curriculumYearBE: number | null;
  majors: string[];
  facultyNameTh: string;
  pdfDocumentId: string | null;
  pdfStorageUrl: string | null;
  pdfFilename: string | null;
}

const LEVEL_TH_LABEL: Record<string, string> = {
  BACHELOR: 'ป.ตรี',
  MASTER: 'ป.โท',
  DOCTORAL: 'ป.เอก',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
};

async function resolveProgram(arg: string): Promise<ProgramRecord> {
  const seqNo = Number(arg);
  const program = await prisma.program.findFirst({
    where: {
      OR: [
        { code: arg },
        { mhesiCode: arg },
        ...(Number.isInteger(seqNo) ? [{ sequenceNoFromSheet: seqNo }] : []),
      ],
    },
    include: {
      faculty: { select: { nameTh: true } },
      documents: {
        where: { role: 'CURRENT_CURRICULUM', isCurrent: true },
        include: { pdfDocument: { select: { id: true, storageUrl: true, originalFilename: true } } },
        take: 1,
      },
    },
  });

  if (!program) throw new Error(`Program not found for arg "${arg}"`);

  const doc = program.documents[0];
  return {
    id: program.id,
    code: program.code,
    nameTh: program.nameTh,
    nameEn: program.nameEn,
    level: program.level,
    mhesiCode: program.mhesiCode,
    sequenceNoFromSheet: program.sequenceNoFromSheet,
    curriculumYearBE: program.curriculumYearBE,
    majors: program.majors,
    facultyNameTh: program.faculty.nameTh,
    pdfDocumentId: doc?.pdfDocument.id ?? null,
    pdfStorageUrl: doc?.pdfDocument.storageUrl ?? null,
    pdfFilename: doc?.pdfDocument.originalFilename ?? null,
  };
}

async function readPdfBytes(storageUrl: string): Promise<Buffer> {
  // storageUrl format: s3://<bucket>/<key>
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(storageUrl);
  if (!m) throw new Error(`unrecognised storageUrl: ${storageUrl}`);
  const [, bucket, key] = m;
  const storage = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
    region: process.env.MINIO_REGION ?? 'us-east-1',
  });
  const url = await storage.getSignedDownloadUrl({ bucket: bucket!, key: key!, ttlSeconds: 300 });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF fetch ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: pnpm programs:digest <code|mhesi|sequenceNo>');
    process.exit(1);
  }

  console.log(`[1/5] Resolving program for "${arg}"…`);
  const program = await resolveProgram(arg);
  console.log(`  code=${program.code} seq=${program.sequenceNoFromSheet} mhesi=${program.mhesiCode}`);
  console.log(`  ${program.facultyNameTh} / ${LEVEL_TH_LABEL[program.level]}`);
  console.log(`  ${program.nameTh}`);
  if (!program.pdfDocumentId || !program.pdfStorageUrl) {
    throw new Error(`Program has no linked CURRENT_CURRICULUM PDF — link a PDF first.`);
  }
  console.log(`  PDF: ${program.pdfFilename}`);

  console.log('\n[2/5] Reading PDF from MinIO…');
  const bytes = await readPdfBytes(program.pdfStorageUrl);
  console.log(`  ${(bytes.byteLength / 1024).toFixed(1)} KB`);

  console.log('\n[3/5] Extracting text via pdfjs-dist…');
  const extracted = await extractNativeText(bytes);
  console.log(`  ${extracted.pages.length} pages, ${extracted.fullText.length.toLocaleString()} chars`);
  if (extracted.isLikelyScanned) {
    console.log(`  ⚠ Likely scanned (score ${extracted.scannedScore.toFixed(2)}) — text extraction may be sparse.`);
  }

  console.log('\n[4/5] Calling LLM with program-digest.v1 prompt…');
  const recorder = new PrismaAiInferenceRecorder();
  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const ai = createAiService({
    recorder,
    providerId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
  });

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

  const startedAt = Date.now();
  const response = await ai.extractStructured(
    {
      ctx: {
        module: 'curriculum',
        kind: 'program-digest',
        userId: null,
        traceId: `program-digest-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_DIGEST_VERSION,
      maxOutputTokens: 16000,
    },
    ProgramDigestSchema,
  );
  const elapsedMs = Date.now() - startedAt;
  console.log(`  Done in ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  Model: ${response.model}`);
  console.log(`  Tokens: ${response.tokens.input.toLocaleString()} in / ${response.tokens.output.toLocaleString()} out`);
  console.log(`  Cost: $${response.cost.usd.toFixed(4)}`);
  console.log(`  Confidence: ${response.confidence.toFixed(2)}`);

  const digest = response.parsed;
  console.log(`\n  → courses extracted: ${digest.courses.length}`);
  console.log(`  → skills extracted:  ${digest.extractedSkills.length}`);
  console.log(`  → career paths:      ${digest.careerPathsTh.length}`);
  console.log(`  → recruitment summary: ${digest.recruitmentSummaryTh.length} chars`);
  console.log(`  → caveats: ${digest.caveats.length}`);

  console.log('\n[5/5] Persisting AiExtraction (PENDING_REVIEW)…');
  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_DIGEST',
      payloadJson: digest as object,
      confidence: response.confidence,
      methodVersion: PROGRAM_DIGEST_VERSION,
      aiInferenceId: response.aiInferenceId,
      reviewStatus: 'PENDING_REVIEW',
      reasoning: response.reasoning ?? null,
    },
    select: { id: true },
  });
  console.log(`  AiExtraction id=${created.id}`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Top 5 skills:');
  for (const s of [...digest.extractedSkills].sort((a, b) => b.weight - a.weight).slice(0, 5)) {
    console.log(`  ${s.weight.toFixed(2)}  ${s.nameTh}${s.nameEn ? ` (${s.nameEn})` : ''}  [${s.category}]`);
  }
  if (digest.caveats.length > 0) {
    console.log('Caveats:');
    for (const c of digest.caveats) console.log(`  - ${c}`);
  }
  console.log('\nReview at: /admin/extraction-review');
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
