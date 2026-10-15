import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadOrganization, prisma } from '@kku/db';
import { S3Storage, MarkitdownClient } from '@kku/shared';
import { runTrendDocumentIngest } from '../trend-signals/ingest-document';
import { createIngestionAiService } from '../lib/ai-service';

// CLI counterpart to the /admin/trend-documents upload UI. Turns a local
// document (PDF/DOCX/XLSX/PPTX/HTML/CSV/TXT/MD) OR a URL into a published
// TrendSignal on the radar (extract → draft → publish → enrich), the same
// path the ANALYZE_TREND_DOCUMENT ai-job runs.
//
//   pnpm trends:ingest-doc /path/to/report.docx [--type=MARKET]
//   pnpm trends:ingest-doc https://example.com/manpower-report [--type=POLICY]

const SIGNAL_TYPES = ['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS'] as const;
// Formats the markitdown sidecar converts (matches the API upload allowlist).
const SUPPORTED_EXTS = ['pdf', 'docx', 'xlsx', 'pptx', 'html', 'htm', 'csv', 'txt', 'md'];
type Hint = (typeof SIGNAL_TYPES)[number];

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

async function main() {
  await loadOrganization();
  const argv = process.argv.slice(2);
  const source = argv.find((a) => !a.startsWith('--'));
  const typeArg = argv.find((a) => a.startsWith('--type='))?.split('=')[1]?.toUpperCase();
  const hint = SIGNAL_TYPES.includes(typeArg as Hint) ? (typeArg as Hint) : undefined;
  if (!source) {
    console.error('Usage: pnpm trends:ingest-doc <pdf-path|url> [--type=POLICY|RESEARCH|MARKET|TECH|NEWS]');
    process.exit(1);
  }

  const ai = createIngestionAiService();
  const storage = new S3Storage({
    endpoint: env('MINIO_ENDPOINT'),
    region: process.env.MINIO_REGION ?? 'us-east-1',
    accessKeyId: env('MINIO_ACCESS_KEY'),
    secretAccessKey: env('MINIO_SECRET_KEY'),
    publicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT || undefined,
  });
  const rawBucket = env('MINIO_BUCKET_PDF_RAW');
  const markitdown = process.env.MARKITDOWN_URL
    ? new MarkitdownClient({
        baseUrl: process.env.MARKITDOWN_URL,
        requestTimeoutMs: Number(process.env.MARKITDOWN_REQUEST_TIMEOUT_MS ?? 60_000),
      })
    : undefined;

  const isUrl = /^https?:\/\//i.test(source);
  let trendDocumentId: string;

  if (isUrl) {
    const doc = await prisma.trendDocument.create({
      data: { sourceType: 'URL', status: 'PENDING', sourceUrl: source, signalTypeHint: hint ?? null },
    });
    trendDocumentId = doc.id;
    console.log(`Created URL trend document ${doc.id} → ${source}`);
  } else {
    const abs = path.resolve(source);
    const bytes = await readFile(abs);
    const ext = (path.extname(abs).slice(1) || 'bin').toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext)) {
      throw new Error(`unsupported file type ".${ext}" — allowed: ${SUPPORTED_EXTS.join(', ')}`);
    }
    if (ext === 'pdf' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error('file is named .pdf but is not a PDF (missing %PDF- header)');
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const key = `trend-documents/${contentHash}.${ext}`;
    await storage.putObject({ bucket: rawBucket, key, body: bytes, contentType: 'application/octet-stream' });
    const doc = await prisma.trendDocument.create({
      data: {
        sourceType: 'FILE',
        status: 'PENDING',
        originalFilename: path.basename(abs),
        storageUrl: `s3://${rawBucket}/${key}`,
        contentHash,
        fileSize: bytes.byteLength,
        signalTypeHint: hint ?? null,
      },
    });
    trendDocumentId = doc.id;
    console.log(`Uploaded ${path.basename(abs)} (${(bytes.byteLength / 1024).toFixed(0)} KB) → trend document ${doc.id}`);
  }

  console.log('Analysing…');
  const outcome = await runTrendDocumentIngest({ trendDocumentId, ai, storage, markitdown });
  if (outcome.status === 'SUCCEEDED') {
    console.log(
      `\n✓ Published signal ${outcome.trendSignalId} — type=${outcome.signalType} ` +
        `impact=${outcome.impactScore} extraction=${outcome.extractionMethod} ` +
        `enrichment=${outcome.analysisOk ? 'ok' : 'skipped'}`,
    );
    console.log(`  View on radar: /trends/${outcome.trendSignalId}`);
  } else {
    console.log(`\n✗ ${outcome.status}: ${'reason' in outcome ? outcome.reason : ''}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
