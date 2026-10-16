#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Status snapshot for the long-running programs:pipeline bulk run.
//
// Source of truth: ProgramStrategicNarrative.generatedAt. Phase 6
// (strategic narrative) runs LAST in the pipeline and consumes signals
// from every prior phase, so its presence + upsert timestamp is the
// canonical "this program is fully done" marker.
//
// Usage:
//   pnpm programs:pipeline-status          # one-shot snapshot
//   pnpm programs:pipeline-status --watch  # refresh every 30s
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'node:child_process';
import { loadOrganization, prisma } from '@kku/db';

interface Snapshot {
  total: number;
  done: number;
  remaining: number;
  processRunning: boolean;
  processCount: number;
  last: { code: string; nameEn: string; at: Date } | null;
  completedLast15m: number;
  completedLast1h: number;
  costLast1hUsd: number | null;
  rate1hPerHour: number | null;
  etaHours: number | null;
  inFlightCode: string | null;
}

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();
  const fifteenMinAgo = new Date(now - 15 * 60_000);
  const oneHourAgo = new Date(now - 60 * 60_000);

  // Canonical 297 = curriculum landscape. The pipeline only runs on
  // programs seeded from the master Google Sheet; legacy mock-seed
  // rows are not pipeline targets and would otherwise inflate "total".
  const [total, done, recent, completedLast15m, completedLast1h, recentInferences] = await Promise.all([
    prisma.program.count({ where: { sequenceNoFromSheet: { not: null } } }),
    prisma.programStrategicNarrative.count({
      where: { program: { sequenceNoFromSheet: { not: null } } },
    }),
    prisma.programStrategicNarrative.findFirst({
      orderBy: { generatedAt: 'desc' },
      select: { generatedAt: true, program: { select: { code: true, nameEn: true } } },
    }),
    prisma.programStrategicNarrative.count({
      where: {
        generatedAt: { gte: fifteenMinAgo },
        program: { sequenceNoFromSheet: { not: null } },
      },
    }),
    prisma.programStrategicNarrative.count({
      where: {
        generatedAt: { gte: oneHourAgo },
        program: { sequenceNoFromSheet: { not: null } },
      },
    }),
    prisma.aiInference.aggregate({
      where: { createdAt: { gte: oneHourAgo } },
      _sum: { costEstimateUsd: true },
    }),
  ]);

  // Count actual pipeline processes. pgrep -fa lists each match as a
  // line; we filter out matches whose argv contains a shell wrapper
  // ("/bin/bash -c", "pgrep") so the search command itself doesn't
  // self-match. The previous implementation used `pgrep -fc` and
  // claimed it would "subtract 1", but never actually did, which made
  // the status report show a hung pipeline forever.
  let processCount = 0;
  try {
    const out = execSync('pgrep -fa programs-pipeline.ts', {
      encoding: 'utf8',
    }).trim();
    if (out) {
      processCount = out
        .split('\n')
        .filter((line) => {
          const argv = line.toLowerCase();
          return (
            !argv.includes('pgrep ') &&
            !argv.includes('/bin/bash -c') &&
            !argv.includes('/bin/sh -c')
          );
        }).length;
    }
  } catch {
    processCount = 0;
  }
  const processRunning = processCount > 0;

  // Find currently-in-flight program by tailing the most recent
  // pipeline log (best-effort — log location is conventional).
  let inFlightCode: string | null = null;
  try {
    const latestLog = execSync('ls -t logs/programs-pipeline-*.log 2>/dev/null | head -1', {
      encoding: 'utf8',
    }).trim();
    if (latestLog) {
      const lastStart = execSync(`grep "^▶" "${latestLog}" | tail -1`, { encoding: 'utf8' }).trim();
      const m = lastStart.match(/^▶\s+(\S+)/);
      if (m) inFlightCode = m[1] ?? null;
    }
  } catch {
    /* ignore */
  }

  const remaining = total - done;
  const rate1hPerHour = completedLast1h > 0 ? completedLast1h : null;
  const etaHours = rate1hPerHour && remaining > 0 ? remaining / rate1hPerHour : null;

  return {
    total,
    done,
    remaining,
    processRunning,
    processCount,
    last: recent
      ? { code: recent.program.code, nameEn: recent.program.nameEn, at: recent.generatedAt }
      : null,
    completedLast15m,
    completedLast1h,
    costLast1hUsd: recentInferences._sum.costEstimateUsd ?? null,
    rate1hPerHour,
    etaHours,
    inFlightCode,
  };
}

function fmtAge(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function render(s: Snapshot): void {
  const pct = s.total > 0 ? ((s.done / s.total) * 100).toFixed(1) : '0';
  const bar = (() => {
    const width = 30;
    const filled = Math.round((s.done / s.total) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  })();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Pipeline status   ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Progress:         [${bar}] ${s.done}/${s.total} (${pct}%)`);
  console.log(`Remaining:        ${s.remaining}`);
  console.log(`Process running:  ${s.processRunning ? `YES (${s.processCount} match)` : 'NO'}`);
  if (s.inFlightCode) console.log(`In-flight now:    ${s.inFlightCode}`);
  if (s.last) {
    console.log(`Last completion:  ${s.last.code} · ${fmtAge(s.last.at)}`);
    console.log(`                  ${s.last.at.toISOString()}`);
  }
  console.log(`Last 15m:         ${s.completedLast15m} program(s)`);
  console.log(`Last 1h:          ${s.completedLast1h} program(s)`);
  if (s.costLast1hUsd !== null) console.log(`AI cost last 1h:  $${s.costLast1hUsd.toFixed(2)}`);
  if (s.etaHours !== null) console.log(`ETA at 1h rate:   ${s.etaHours.toFixed(1)}h`);
  if (!s.processRunning && s.remaining > 0) {
    console.log('');
    console.log('⚠ Process not running. To resume:');
    console.log('  pnpm programs:pipeline --all --resume');
  }
}

async function main(): Promise<void> {
  await loadOrganization();
  const watch = process.argv.includes('--watch');
  if (!watch) {
    render(await snapshot());
    return;
  }
  while (true) {
    console.clear();
    render(await snapshot());
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
