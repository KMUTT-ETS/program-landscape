// ─────────────────────────────────────────────────────────────────────────────
// verdicts:diff — compare two verdict snapshots, produce an analyst worklist.
//
// Closes the comparator half of evaluation-pipeline.md §13 gap #6. Reads
// two VerdictSnapshot rows per program (latest vs prior, or two explicit
// dates) and classifies each program into one of:
//
//   FLIPPED         — lifecycle verdict or risk tier changed
//   HEALTH_BAND     — overall health crossed a band boundary (40 or 65)
//                     without a lifecycle flip — early warning signal
//   BAND_EDGE       — any single Health dimension moved ≥20 pts OR
//                     lifecycle trajectory moved ≥10 pts OR risk
//                     composite moved ≥15 pts, without a tier/verdict
//                     flip — instability around the band boundary
//   STABLE          — no meaningful change
//
// Methodology drift: if the two snapshots used different bundle
// fingerprints, the comparison still runs but a banner notes that
// deltas may reflect methodology changes rather than real movement.
//
// Usage:
//   pnpm verdicts:diff                       # latest vs second-latest snapshot timestamps
//   pnpm verdicts:diff --from <iso> --to <iso>
//   pnpm verdicts:diff --since 90            # latest vs ~90 days ago
//   pnpm verdicts:diff --bucket FLIPPED      # filter output to one bucket
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '@kku/db';

// ── Thresholds — change with care; the bands are calibration choices ──
const HEALTH_BAND_BOUNDARIES = [40, 65] as const;
const BAND_EDGE_HEALTH_DIMENSION_DELTA = 20;     // pts
const BAND_EDGE_LIFECYCLE_TRAJECTORY_DELTA = 10; // pts
const BAND_EDGE_RISK_COMPOSITE_DELTA = 15;       // pts

type Bucket = 'FLIPPED' | 'HEALTH_BAND' | 'BAND_EDGE' | 'STABLE';

interface CliArgs {
  from: string | null;  // ISO timestamp or null = auto
  to: string | null;
  since: number | null; // days ago
  bucket: Bucket | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { from: null, to: null, since: null, bucket: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = String(argv[++i] ?? '');
    else if (a === '--to') args.to = String(argv[++i] ?? '');
    else if (a === '--since') args.since = Number(argv[++i] ?? 0) || null;
    else if (a === '--bucket') {
      const b = String(argv[++i] ?? '').toUpperCase() as Bucket;
      if (['FLIPPED', 'HEALTH_BAND', 'BAND_EDGE', 'STABLE'].includes(b)) {
        args.bucket = b;
      } else {
        console.error(`Invalid --bucket: ${b}. Use FLIPPED | HEALTH_BAND | BAND_EDGE | STABLE.`);
        process.exit(1);
      }
    }
  }
  return args;
}

function healthBand(score: number | null): 'danger' | 'attention' | 'healthy' | 'unknown' {
  if (score === null) return 'unknown';
  if (score < HEALTH_BAND_BOUNDARIES[0]) return 'danger';
  if (score < HEALTH_BAND_BOUNDARIES[1]) return 'attention';
  return 'healthy';
}

interface SnapshotRow {
  id: string;
  programId: string;
  snapshotAt: Date;
  bundleTag: string;
  bundleFingerprint: string;
  healthOverall: number | null;
  healthAttractiveness: number | null;
  healthFinancial: number | null;
  healthCapability: number | null;
  healthOutcomes: number | null;
  healthRelevance: number | null;
  lifecycleVerdict: string | null;
  lifecycleTrajectory: number | null;
  riskTier: string | null;
  riskComposite: number | null;
  riskL1: number | null;
  riskL2: number | null;
  riskL3: number | null;
}

async function resolveSnapshotTimestamps(args: CliArgs): Promise<{ from: Date; to: Date }> {
  if (args.from && args.to) {
    return { from: new Date(args.from), to: new Date(args.to) };
  }
  if (args.since) {
    const cutoff = new Date(Date.now() - args.since * 24 * 60 * 60 * 1000);
    const fromRow = await prisma.verdictSnapshot.findFirst({
      where: { snapshotAt: { lte: cutoff } },
      orderBy: { snapshotAt: 'desc' },
      select: { snapshotAt: true },
    });
    const toRow = await prisma.verdictSnapshot.findFirst({
      orderBy: { snapshotAt: 'desc' },
      select: { snapshotAt: true },
    });
    if (!fromRow || !toRow) throw new Error('Not enough snapshots in the window');
    return { from: fromRow.snapshotAt, to: toRow.snapshotAt };
  }
  // Default: latest distinct timestamp + the one before it.
  const distinct = await prisma.$queryRawUnsafe<Array<{ ts: Date }>>(`
    SELECT DISTINCT snapshot_at AS ts FROM verdict_snapshots
    ORDER BY snapshot_at DESC LIMIT 2
  `);
  if (distinct.length < 2) {
    throw new Error(
      `Need at least 2 distinct snapshot timestamps; have ${distinct.length}. ` +
        `Run \`pnpm verdicts:snapshot\` twice (typically once per quarter).`,
    );
  }
  return { from: distinct[1]!.ts, to: distinct[0]!.ts };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { from, to } = await resolveSnapshotTimestamps(args);

  console.log('═══ Verdict snapshot diff ═══');
  console.log(`From:  ${from.toISOString()}`);
  console.log(`To:    ${to.toISOString()}`);
  console.log('');

  const [fromRows, toRows] = await Promise.all([
    prisma.verdictSnapshot.findMany({
      where: { snapshotAt: from },
      orderBy: { programId: 'asc' },
    }) as Promise<SnapshotRow[]>,
    prisma.verdictSnapshot.findMany({
      where: { snapshotAt: to },
      orderBy: { programId: 'asc' },
    }) as Promise<SnapshotRow[]>,
  ]);
  console.log(`From snapshot: ${fromRows.length} programs`);
  console.log(`To snapshot:   ${toRows.length} programs`);

  // Bundle-drift banner.
  const fromBundles = new Set(fromRows.map((r) => r.bundleFingerprint));
  const toBundles = new Set(toRows.map((r) => r.bundleFingerprint));
  if (fromBundles.size > 1 || toBundles.size > 1) {
    console.log('⚠ snapshots include mixed bundle fingerprints — analyst review needed');
  }
  const fromBundle = [...fromBundles][0];
  const toBundle = [...toBundles][0];
  if (fromBundle && toBundle && fromBundle !== toBundle) {
    console.log('');
    console.log('⚠ METHODOLOGY DRIFT:');
    console.log(`     from bundle fingerprint ${fromBundle}`);
    console.log(`     to bundle fingerprint   ${toBundle}`);
    console.log('     Deltas below may reflect methodology changes, not real movement.');
  }
  console.log('');

  const fromByProg = new Map(fromRows.map((r) => [r.programId, r]));
  const toByProg = new Map(toRows.map((r) => [r.programId, r]));
  const allIds = new Set([...fromByProg.keys(), ...toByProg.keys()]);

  // Pull program metadata once for readable output.
  const progRows = await prisma.program.findMany({
    where: { id: { in: [...allIds] } },
    select: { id: true, code: true, nameEn: true, nameTh: true },
  });
  const progByid = new Map(progRows.map((p) => [p.id, p]));

  interface Diff {
    programId: string;
    code: string;
    name: string;
    bucket: Bucket;
    notes: string[];
  }
  const diffs: Diff[] = [];

  for (const id of allIds) {
    const f = fromByProg.get(id);
    const t = toByProg.get(id);
    const p = progByid.get(id);
    const code = p?.code ?? id.slice(0, 10);
    const name = p?.nameEn || p?.nameTh || '(unknown)';

    // Only-in-one-side cases.
    if (!f || !t) {
      diffs.push({
        programId: id,
        code,
        name,
        bucket: 'BAND_EDGE',
        notes: [f ? 'only in from-snapshot (program added/removed)' : 'only in to-snapshot (new program)'],
      });
      continue;
    }

    const notes: string[] = [];
    let bucket: Bucket = 'STABLE';

    // Lifecycle verdict flip — strongest signal.
    if (f.lifecycleVerdict !== t.lifecycleVerdict) {
      notes.push(`lifecycle: ${f.lifecycleVerdict ?? '—'} → ${t.lifecycleVerdict ?? '—'}`);
      bucket = 'FLIPPED';
    }
    // Risk tier flip.
    if (f.riskTier !== t.riskTier) {
      notes.push(`risk-tier: ${f.riskTier ?? '—'} → ${t.riskTier ?? '—'}`);
      bucket = 'FLIPPED';
    }
    // Health-band crossing (without lifecycle/risk flip → early warning).
    if (bucket !== 'FLIPPED') {
      const fb = healthBand(f.healthOverall);
      const tb = healthBand(t.healthOverall);
      if (fb !== tb && fb !== 'unknown' && tb !== 'unknown') {
        notes.push(`health-band: ${fb} (${f.healthOverall?.toFixed(0)}) → ${tb} (${t.healthOverall?.toFixed(0)})`);
        bucket = 'HEALTH_BAND';
      }
    }
    // Band-edge instability — large driver moves without a flip.
    if (bucket === 'STABLE') {
      const dimChecks: Array<[string, number | null, number | null]> = [
        ['attractiveness', f.healthAttractiveness, t.healthAttractiveness],
        ['financial', f.healthFinancial, t.healthFinancial],
        ['capability', f.healthCapability, t.healthCapability],
        ['outcomes', f.healthOutcomes, t.healthOutcomes],
        ['relevance', f.healthRelevance, t.healthRelevance],
      ];
      for (const [label, a, b] of dimChecks) {
        if (a === null || b === null) continue;
        const d = b - a;
        if (Math.abs(d) >= BAND_EDGE_HEALTH_DIMENSION_DELTA) {
          notes.push(`health.${label}: ${a.toFixed(0)} → ${b.toFixed(0)} (${d >= 0 ? '+' : ''}${d.toFixed(0)})`);
          bucket = 'BAND_EDGE';
        }
      }
      if (
        f.lifecycleTrajectory !== null && t.lifecycleTrajectory !== null
        && Math.abs(t.lifecycleTrajectory - f.lifecycleTrajectory) >= BAND_EDGE_LIFECYCLE_TRAJECTORY_DELTA
      ) {
        const d = t.lifecycleTrajectory - f.lifecycleTrajectory;
        notes.push(`lifecycle.trajectory: ${f.lifecycleTrajectory.toFixed(0)} → ${t.lifecycleTrajectory.toFixed(0)} (${d >= 0 ? '+' : ''}${d.toFixed(0)})`);
        bucket = 'BAND_EDGE';
      }
      if (
        f.riskComposite !== null && t.riskComposite !== null
        && Math.abs(t.riskComposite - f.riskComposite) >= BAND_EDGE_RISK_COMPOSITE_DELTA
      ) {
        const d = t.riskComposite - f.riskComposite;
        notes.push(`risk.composite: ${f.riskComposite.toFixed(0)} → ${t.riskComposite.toFixed(0)} (${d >= 0 ? '+' : ''}${d.toFixed(0)})`);
        bucket = 'BAND_EDGE';
      }
    }

    diffs.push({ programId: id, code, name, bucket, notes });
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const buckets = { FLIPPED: 0, HEALTH_BAND: 0, BAND_EDGE: 0, STABLE: 0 };
  for (const d of diffs) buckets[d.bucket] += 1;
  console.log('Summary:');
  console.log(`  FLIPPED       ${buckets.FLIPPED.toString().padStart(4)}   verdict or tier changed`);
  console.log(`  HEALTH_BAND   ${buckets.HEALTH_BAND.toString().padStart(4)}   overall health crossed 40 or 65 boundary`);
  console.log(`  BAND_EDGE     ${buckets.BAND_EDGE.toString().padStart(4)}   driver moved past threshold without flipping`);
  console.log(`  STABLE        ${buckets.STABLE.toString().padStart(4)}   no meaningful change`);
  console.log('');

  // ── Worklist ────────────────────────────────────────────────────────
  const ORDER: Bucket[] = ['FLIPPED', 'HEALTH_BAND', 'BAND_EDGE', 'STABLE'];
  for (const b of ORDER) {
    if (args.bucket && args.bucket !== b) continue;
    const inBucket = diffs.filter((d) => d.bucket === b);
    if (inBucket.length === 0) continue;
    if (b === 'STABLE' && !args.bucket) continue;  // hide stable by default
    console.log(`── ${b} (${inBucket.length}) ──`);
    for (const d of inBucket) {
      console.log(`  ${d.code.padEnd(14)} ${d.name.slice(0, 50).padEnd(50)}`);
      for (const note of d.notes) {
        console.log(`    · ${note}`);
      }
    }
    console.log('');
  }

  if (buckets.FLIPPED + buckets.HEALTH_BAND + buckets.BAND_EDGE === 0) {
    console.log('No movement detected. All verdicts held over the window.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
