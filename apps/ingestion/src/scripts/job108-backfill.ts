#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// job108:backfill — one-off walk of the FULL job-108.com sitemap archive.
//
// The weekly Job108Connector (apps/ingestion/src/connectors/sources/job-108/)
// only ever picks up what changed since the last run, capped at 60 per run —
// that keeps the steady-state cadence cheap, but it means the ~2,000
// announcements already sitting in the sitemap (back to 2024-12-18) never get
// walked unless something does it deliberately, once. This script is that
// something.
//
//   pnpm job108:backfill                       # dry run — reports, spends nothing
//   pnpm job108:backfill --limit=10 --apply     # fetch + extract 10, oldest cap lifted
//   pnpm job108:backfill --retry-failed         # (dry run) also counts FAILED rows due
//   pnpm job108:backfill --retry-failed --apply --limit=50
//
// --apply is required to write, fetch an announcement page, or spend a model
// call. Any flag other than --apply / --limit=N / --retry-failed is refused
// outright — a typo that silently dry-ran would waste an afternoon; a typo
// that silently applied would waste money.
//
// RESUMABLE. `planJob108Fetch` (packages/db/src/job108.ts) skips anything
// already stored at the same sitemap `lastmod`, so an interrupted run is safe
// and cheap to re-launch: it picks up exactly where it left off and spends
// nothing re-doing announcements already written. A run that dies at page
// 1,400 of 2,000 is not a second bill — just run the same command again.
//
// --retry-failed is the ONLY way a FAILED announcement becomes due again.
// heldAnnouncementLastmods() (the function the weekly connector and this
// script both use for its default set) deliberately counts FAILED rows as
// "already handled" — see its doc comment — so a page that failed once would
// otherwise never be attempted again on its own. This flag does not delete
// or reset those rows; it simply excludes them from the "already held" set
// for THIS run, so planJob108Fetch treats them as due again by their stored
// lastmod. A subsequent extraction success overwrites the row via the normal
// upsert path in upsertJob108Announcement.
//
// THE DRY RUN IS FREE, ON PURPOSE, UNLIKE `pnpm jobthai:fields`. That
// script's dry run makes the same model calls as --apply, because its job is
// to preview what the model would say. This script's job is to preview a
// SPEND DECISION before it's made — due-count × wall-clock × dollars — so its
// dry run must stop before any announcement-page fetch and before any model
// call. Do not assume the two scripts' dry runs behave the same way; they
// are deliberately opposite for different reasons.
//
// One IngestionRun for the WHOLE backfill invocation (via withScriptRun),
// not one per announcement — so the admin dashboard shows a single coherent
// run with its totals, the same way the weekly connector's run does.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Inline env-file loader rather than `dotenv/config`: dotenv is not a
// dependency, and this script is esbuild-bundled for the prod ingestion
// image, where the environment comes from the container and this is a no-op.
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

import {
  PUBLIC_DEMAND_SOURCE,
  parseSitemap,
  type SitemapEntry,
} from '@kku/shared';
import {
  prisma,
  hashPage,
  heldAnnouncementLastmods,
  planJob108Fetch,
  recordJob108Failure,
  toPostingRows,
  upsertJob108Announcement,
} from '@kku/db';

import { extractAnnouncement } from '../job108/extract';
import { parseBackfillArgs } from '../job108/backfill-args';
import { fetchJob108Page, fetchJob108PagePolitely, job108SitemapUrl, JOB108_REQUEST_SPACING_MS } from '../job108/fetch';
import { createIngestionAiService } from '../lib/ai-service';
import { withScriptRun } from '../lib/script-run';

// Argument parsing lives in ../job108/backfill-args.ts, not here — that
// module has no side effects and is what the unit tests import. This file
// calls main() at load, so importing IT for a test would run the real thing.

// ─────────────────────────────────────────────────────────────────────────────
// Held-lastmod resolution — the only place --retry-failed takes effect.
// heldAnnouncementLastmods() (packages/db/src/job108.ts) always includes both
// EXTRACTED and FAILED rows by design. To force a retry WITHOUT deleting or
// resetting anything, this queries EXTRACTED only when the flag is set, so
// planJob108Fetch sees every FAILED announcement as if it had never been
// attempted — it becomes due again by its already-stored sitemap lastmod.
// ─────────────────────────────────────────────────────────────────────────────

async function heldLastmodsForRun(retryFailed: boolean): Promise<Map<string, Date>> {
  if (!retryFailed) return heldAnnouncementLastmods();
  const rows = await prisma.job108Announcement.findMany({
    where: { status: 'EXTRACTED' },
    select: { announcementId: true, sourceLastmod: true },
  });
  return new Map(
    rows.flatMap((r) => (r.sourceLastmod === null ? [] : [[r.announcementId, r.sourceLastmod] as const])),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost estimate — due × a measured per-announcement unit cost, not a guess
// presented as a number. Reads the average `costEstimateUsd` recorded for
// past job108-announcement calls (packages/db/prisma schema:
// AiInference.kind = 'job108-announcement'); falls back to a documented
// default when no history exists yet (a fresh database, or before the first
// live run).
// ─────────────────────────────────────────────────────────────────────────────

const JOB108_ANNOUNCEMENT_KIND = 'job108-announcement';
/** Fallback only — used when there is no historical AiInference row to
 *  average yet. Roughly what the first 25-announcement live run measured
 *  (see the commit that introduced the connector). */
const DEFAULT_UNIT_COST_USD = 0.012;

interface UnitCostEstimate {
  usdPerCall: number;
  basis: string;
}

async function estimateUnitCostUsd(): Promise<UnitCostEstimate> {
  const agg = await prisma.aiInference.aggregate({
    where: { kind: JOB108_ANNOUNCEMENT_KIND, costEstimateUsd: { not: null } },
    _avg: { costEstimateUsd: true },
    _count: { _all: true },
  });
  const avg = agg._avg.costEstimateUsd;
  if (avg !== null && avg !== undefined && agg._count._all > 0) {
    return {
      usdPerCall: avg,
      basis: `average of ${agg._count._all} historical job108-announcement model calls`,
    };
  }
  return {
    usdPerCall: DEFAULT_UNIT_COST_USD,
    basis: `no historical job108-announcement calls found — using the documented default of $${DEFAULT_UNIT_COST_USD.toFixed(3)}/call`,
  };
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Per-call unit costs are a few cents at most — toFixed(2) would round
 *  $0.012 to "$0.01" and make the printed `due × unit` arithmetic look
 *  wrong even though the total is computed from the full-precision value. */
function formatUsdPerCall(n: number): string {
  return `$${n.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// The apply path — fetch, extract, write. One at a time, politely spaced,
// with per-announcement failure isolation (mirrors Job108Connector.load()).
// ─────────────────────────────────────────────────────────────────────────────

const PROGRESS_EVERY = 10;

async function applyBackfill(due: SitemapEntry[], runId: string): Promise<{ loaded: number; failed: number; postingsWritten: number }> {
  const ai = createIngestionAiService();
  let loaded = 0;
  let failed = 0;
  let postingsWritten = 0;
  const startedAt = Date.now();

  for (let i = 0; i < due.length; i++) {
    const entry = due[i]!;
    let contentHash = '';
    try {
      const html = await fetchJob108PagePolitely(entry.url);
      contentHash = hashPage(html);
      const extracted = await extractAnnouncement(ai, { announcementId: entry.announcementId, html });
      const rows = toPostingRows(extracted.header, extracted.positions);
      const result = await upsertJob108Announcement({
        announcementId: entry.announcementId,
        url: entry.url,
        contentHash,
        title: extracted.title,
        header: extracted.header,
        applicationOpenDate: extracted.applicationOpenDate,
        sourceLastmod: entry.lastmod,
        rows,
        runId,
      });
      postingsWritten += result.postingsWritten;
      loaded++;
      console.log(`  [${i + 1}/${due.length}] ${entry.announcementId} → ${result.postingsWritten} posting(s)`);
    } catch (err: unknown) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [${i + 1}/${due.length}] ${entry.announcementId} FAILED: ${message}`);
      await recordJob108Failure({
        announcementId: entry.announcementId,
        url: entry.url,
        contentHash: contentHash === '' ? `failed:${entry.announcementId}` : contentHash,
        sourceLastmod: entry.lastmod,
        error: message,
        runId,
      });
    }

    const done = i + 1;
    if (done % PROGRESS_EVERY === 0 || done === due.length) {
      const elapsedMs = Date.now() - startedAt;
      const remaining = due.length - done;
      const avgMsPerItem = elapsedMs / done;
      const etaMs = remaining * avgMsPerItem;
      console.log(
        `── progress: ${done}/${due.length} done · ${loaded} extracted · ${failed} failed · ` +
          `elapsed ${formatDuration(elapsedMs)} · ETA ${formatDuration(etaMs)} ──`,
      );
    }
  }

  return { loaded, failed, postingsWritten };
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseBackfillArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    console.error('Usage: pnpm job108:backfill [--apply] [--limit=N] [--retry-failed]');
    process.exit(1);
  }
  const { apply, limit, retryFailed } = parsed.args;

  console.log(`=== job108:backfill (${apply ? 'APPLY' : 'DRY RUN'}) ===`);
  if (retryFailed) console.log('--retry-failed: FAILED announcements are treated as due again this run.');

  // Discovery: one sitemap.xml request. Not an "announcement page fetch" —
  // it is the same single manifest read Job108Connector.fetch() and
  // healthCheck() already make on every scheduled run, at zero model cost.
  // Everything past this point (announcement page fetches, model calls,
  // writes) is gated on --apply.
  const xml = await fetchJob108Page(job108SitemapUrl());
  const entries: SitemapEntry[] = parseSitemap(xml);
  const held = await heldLastmodsForRun(retryFailed);
  const due = planJob108Fetch(entries, held, limit ?? undefined);

  console.log(`Sitemap entries:     ${entries.length}`);
  console.log(`Already held:        ${held.size}${retryFailed ? ' (FAILED rows excluded — treated as due)' : ' (EXTRACTED + FAILED)'}`);
  console.log(`Due this run:        ${due.length}${limit ? ` (capped at --limit=${limit}, newest first)` : ''}`);

  if (!apply) {
    const { usdPerCall, basis } = await estimateUnitCostUsd();
    const estimatedCost = due.length * usdPerCall;
    const estimatedWallClockMs = due.length * JOB108_REQUEST_SPACING_MS;
    console.log('');
    console.log(`Estimated wall-clock (at ${JOB108_REQUEST_SPACING_MS / 1000}s spacing): ~${formatDuration(estimatedWallClockMs)}`);
    console.log(`  (this is spacing only — add model latency per call on top; the real run will take longer)`);
    console.log(
      `Estimated model spend: ${formatUsd(estimatedCost)}  ` +
        `(${due.length} due × ${formatUsdPerCall(usdPerCall)}/announcement, ${basis})`,
    );
    console.log('');
    console.log('DRY RUN — nothing was fetched (past the one sitemap.xml request above), nothing was written, nothing was spent.');
    console.log('RESUMABLE — planJob108Fetch skips anything already stored at its current sitemap lastmod, so an');
    console.log('interrupted --apply run can simply be re-run: it continues rather than repeating, at no extra cost');
    console.log('for work already done. Pass --apply to run for real.');
    await prisma.$disconnect();
    return;
  }

  if (due.length === 0) {
    console.log('\nNothing due — the archive is fully caught up. Nothing to apply.');
    await prisma.$disconnect();
    return;
  }

  await withScriptRun(PUBLIC_DEMAND_SOURCE, async ({ runId, setRecordsLoaded }) => {
    console.log(`\nIngestionRun ${runId} — applying ${due.length} announcement(s)...\n`);
    const { loaded, failed, postingsWritten } = await applyBackfill(due, runId);
    setRecordsLoaded(loaded);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Extracted:        ${loaded}`);
    console.log(`Failed:           ${failed}`);
    console.log(`Postings written: ${postingsWritten}`);
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
