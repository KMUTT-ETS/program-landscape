#!/usr/bin/env tsx
// Bulk-load historical PDFs from a manifest through the pdf-intake pipeline.
//
// Usage:
//   pnpm pdf:bulk-load <manifest.jsonl>            # dry-run (no downloads)
//   pnpm pdf:bulk-load <manifest.jsonl> --commit   # actually download + ingest
//
// Manifest format (one JSON object per line):
//   {"sourceSlug": "mhesi-policy", "url": "https://…/file.pdf", "sourceOrg": "MHESI", "category": "POLICY"}
//
// Fields:
//   sourceSlug — matches a SOURCE_CATALOG entry. Used only for reporting.
//   url        — HTTPS URL of the PDF. Must be reachable from the host.
//   sourceOrg  — free-text, attached to PdfDocument.sourceOrg.
//   category   — PdfSourceCategory (POLICY / REPORT / CURRICULUM / …) —
//                populated as sourceCategoryHint so the classifier can
//                override when confident.
//   language   — (optional) TH / EN / MIXED, default TH.
//
// Behaviour:
//   - Respectful rate-limit — 2000 ms between requests by default
//     (overridable via --pacing <ms>).
//   - Content-hash dedup is enforced by the upload pipeline, so
//     re-running the script with the same manifest is safe.
//   - PDFs are never persisted to disk on the host; bytes stream into
//     MinIO via the regular upload path.
//   - On any HTTP error, the script records it and continues — it does
//     not abort. Final report lists succeeded / deduplicated / failed.
//
// Designed to run on the prod server (where MinIO + Postgres live) or
// on a staging box. The API must be reachable at $API_URL.

import { loadOrganization } from '@kku/db';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { outboundUserAgent } from '@kku/shared';

interface ManifestEntry {
  sourceSlug: string;
  url: string;
  sourceOrg?: string;
  category?:
    | 'POLICY' | 'REPORT' | 'CURRICULUM' | 'PEER_PROGRAM'
    | 'SURVEY' | 'COMMITTEE_MINUTES' | 'JOB_POSTINGS_BATCH' | 'OTHER';
  language?: 'TH' | 'EN' | 'MIXED';
}

interface Result {
  url: string;
  sourceSlug: string;
  status: 'uploaded' | 'deduplicated' | 'failed' | 'skipped-dry-run';
  pdfDocumentId?: string;
  error?: string;
}

const args = process.argv.slice(2);
const rawManifestPath = args[0];
const commit = args.includes('--commit');
const pacingMs = pickInt('--pacing', 2000);

if (!rawManifestPath) {
  console.error('Usage: pnpm pdf:bulk-load <manifest.jsonl> [--commit] [--pacing <ms>]');
  process.exit(1);
}
const manifestPath: string = rawManifestPath;
if (!existsSync(manifestPath)) {
  console.error(`[bulk-pdf-load] manifest not found: ${manifestPath}`);
  process.exit(1);
}

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const ADMIN_TOKEN = process.env.PDF_BULK_LOAD_TOKEN;

if (commit && !ADMIN_TOKEN) {
  console.error(
    '[bulk-pdf-load] PDF_BULK_LOAD_TOKEN env var is required to --commit.\n' +
      'Mint a short-lived JWT for an admin user via the api + NEXTAUTH_SECRET,\n' +
      'or run this from inside a machine-to-machine account.',
  );
  process.exit(1);
}

const raw = readFileSync(manifestPath, 'utf8');
const entries: ManifestEntry[] = [];
for (const [i, line] of raw.split('\n').entries()) {
  if (!line.trim()) continue;
  try {
    const parsed = JSON.parse(line) as ManifestEntry;
    if (!parsed.url || !parsed.sourceSlug) {
      console.error(`[bulk-pdf-load] line ${i + 1}: missing url/sourceSlug — skipping`);
      continue;
    }
    entries.push(parsed);
  } catch (err) {
    console.error(`[bulk-pdf-load] line ${i + 1}: invalid JSON — ${(err as Error).message}`);
  }
}

console.log(`[bulk-pdf-load] loaded ${entries.length} entries from ${path.basename(manifestPath)}`);
console.log(`[bulk-pdf-load] mode: ${commit ? 'COMMIT — downloads will happen' : 'dry-run (approve preview, then re-run with --commit)'}`);
console.log(`[bulk-pdf-load] pacing: ${pacingMs} ms between requests`);
console.log(`[bulk-pdf-load] api  : ${API_URL}`);

const bySource = new Map<string, number>();
for (const e of entries) bySource.set(e.sourceSlug, (bySource.get(e.sourceSlug) ?? 0) + 1);
console.log('[bulk-pdf-load] by source:');
for (const [slug, count] of [...bySource.entries()].sort()) {
  console.log(`    ${slug.padEnd(24)} ${count}`);
}

if (!commit) {
  console.log('\n[bulk-pdf-load] preview only — no network calls. Re-run with --commit to actually download.');
  process.exit(0);
}

// ── Commit path ──────────────────────────────────────────────────────
const results: Result[] = [];
let completed = 0;

async function main(): Promise<void> {
  await loadOrganization();
for (const entry of entries) {
  completed++;
  const prefix = `[${completed}/${entries.length}] ${entry.sourceSlug}`;
  try {
    console.log(`${prefix} fetch ${entry.url}`);
    const resp = await fetch(entry.url, {
      headers: {
        'user-agent': outboundUserAgent('bulk-pdf-load'),
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const ct = resp.headers.get('content-type') ?? '';
    if (!/application\/pdf|octet-stream/i.test(ct)) {
      console.warn(`${prefix} WARN unexpected content-type: ${ct}`);
    }
    const bytes = Buffer.from(await resp.arrayBuffer());
    const filename = inferFilename(entry.url);

    const form = new FormData();
    form.append(
      'files',
      new Blob([bytes], { type: 'application/pdf' }),
      filename,
    );
    if (entry.category) form.append('sourceCategoryHint', entry.category);
    if (entry.sourceOrg) form.append('sourceOrg', entry.sourceOrg);
    if (entry.language) form.append('language', entry.language);
    form.append('notes', `bulk-load manifest=${path.basename(manifestPath)} source=${entry.sourceSlug}`);

    const upResp = await fetch(`${API_URL}/api/v1/pdfs/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const upJson = (await upResp.json()) as {
      data?: {
        uploaded: Array<{
          pdfDocumentId: string;
          deduplicated: boolean;
          enqueued: boolean;
        }>;
      };
      error?: { code: string; message?: string };
    };
    if (!upResp.ok || !upJson.data) {
      throw new Error(upJson.error?.message ?? `upload HTTP ${upResp.status}`);
    }
    const first = upJson.data.uploaded[0];
    if (!first) throw new Error('upload response carried no PdfDocument');
    results.push({
      url: entry.url,
      sourceSlug: entry.sourceSlug,
      status: first.deduplicated ? 'deduplicated' : 'uploaded',
      pdfDocumentId: first.pdfDocumentId,
    });
    console.log(`${prefix} OK ${first.pdfDocumentId}${first.deduplicated ? ' (dedup)' : ''}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ url: entry.url, sourceSlug: entry.sourceSlug, status: 'failed', error: msg });
    console.error(`${prefix} FAIL ${msg}`);
  }
  if (completed < entries.length) {
    await sleep(pacingMs);
  }
}

// ── Summary ──────────────────────────────────────────────────────────
const uploaded = results.filter((r) => r.status === 'uploaded').length;
const deduped = results.filter((r) => r.status === 'deduplicated').length;
const failed = results.filter((r) => r.status === 'failed').length;

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`[bulk-pdf-load] summary: uploaded=${uploaded}  deduped=${deduped}  failed=${failed}`);
console.log('═══════════════════════════════════════════════════════════');

// Per-source breakdown.
const bySourceResult = new Map<string, { uploaded: number; deduped: number; failed: number }>();
for (const r of results) {
  const agg = bySourceResult.get(r.sourceSlug) ?? { uploaded: 0, deduped: 0, failed: 0 };
  if (r.status === 'uploaded') agg.uploaded++;
  else if (r.status === 'deduplicated') agg.deduped++;
  else if (r.status === 'failed') agg.failed++;
  bySourceResult.set(r.sourceSlug, agg);
}
console.log('\nPer-source:');
console.log('  SOURCE                    UPLD  DEDUP  FAIL');
for (const [slug, agg] of [...bySourceResult.entries()].sort()) {
  console.log(
    `  ${slug.padEnd(24)} ${String(agg.uploaded).padStart(4)}  ${String(agg.deduped).padStart(5)}  ${String(agg.failed).padStart(4)}`,
  );
}

if (failed > 0) {
  console.log('\nFailed URLs:');
  for (const r of results.filter((r) => r.status === 'failed')) {
    console.log(`  ${r.sourceSlug}  ${r.url}  — ${r.error}`);
  }
  process.exit(1);
}
}

void main().catch((err) => {
  console.error('[bulk-pdf-load] fatal', err);
  process.exit(1);
});

// ── Helpers ──────────────────────────────────────────────────────────

function pickInt(flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  if (idx < 0) return fallback;
  const n = Number(args[idx + 1]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function inferFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? 'document.pdf';
    return decodeURIComponent(last).slice(-200);
  } catch {
    return 'document.pdf';
  }
}
