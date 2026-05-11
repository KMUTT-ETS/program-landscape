// ─────────────────────────────────────────────────────────────────────────────
// ai:gold-pick — nominate AiExtraction rows as gold-set candidates.
//
// Closes part 1 of evaluation-pipeline.md §13 gap #3 (AI extraction accuracy
// unmeasured). Picks N representative samples per extraction kind, flips
// `isGoldSample=true`. An analyst then labels them via `pnpm ai:gold-label`
// (or by editing `goldLabel` directly in the admin UI when that lands).
//
// Sampling policy:
//   • Stratified across extraction_kind so every prompt template gets
//     representation proportional to its volume — minimum 5 samples per kind
//     where volume allows.
//   • Within each kind, sample across the confidence spectrum (a high-conf
//     row + a low-conf row + a few in the middle) so the eval reveals
//     whether the threshold is well-tuned, not just whether the AI is
//     good on its best day.
//   • Skip rows already marked as gold candidates (idempotent re-run).
//
// Usage:
//   pnpm ai:gold-pick                # dry-run, picks default 50 across kinds
//   pnpm ai:gold-pick --total 100    # bigger sample
//   pnpm ai:gold-pick --apply        # commit the is_gold_sample=true flips
//   pnpm ai:gold-pick --kind PROGRAM_DIGEST --apply
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '@kku/db';

interface CliArgs {
  apply: boolean;
  total: number;
  kindFilter: string | null;
  minPerKind: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, total: 50, kindFilter: null, minPerKind: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--total') args.total = Number(argv[++i] ?? args.total);
    else if (a === '--kind') args.kindFilter = String(argv[++i] ?? '');
    else if (a === '--min-per-kind') args.minPerKind = Number(argv[++i] ?? args.minPerKind);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(args.apply ? '═══ APPLY MODE ═══' : '═══ DRY RUN ═══');
  console.log(`Target sample size: ${args.total} (min ${args.minPerKind} per kind)`);
  if (args.kindFilter) console.log(`Filtered to kind: ${args.kindFilter}`);
  console.log('');

  // ── Inventory ────────────────────────────────────────────────────────
  const kindCounts = await prisma.aiExtraction.groupBy({
    by: ['extractionKind'],
    _count: { _all: true },
    where: args.kindFilter ? { extractionKind: args.kindFilter } : undefined,
  });
  const goldCounts = await prisma.aiExtraction.groupBy({
    by: ['extractionKind'],
    _count: { _all: true },
    where: {
      isGoldSample: true,
      ...(args.kindFilter ? { extractionKind: args.kindFilter } : {}),
    },
  });
  const goldByKind = new Map(goldCounts.map((g) => [g.extractionKind, g._count._all]));

  console.log('Inventory:');
  console.log('Kind'.padEnd(36) + 'Total'.padStart(10) + 'Already gold'.padStart(15));
  console.log('─'.repeat(61));
  let totalRows = 0;
  for (const k of kindCounts) {
    totalRows += k._count._all;
    console.log(
      k.extractionKind.padEnd(36) +
        k._count._all.toString().padStart(10) +
        (goldByKind.get(k.extractionKind) ?? 0).toString().padStart(15),
    );
  }
  console.log('─'.repeat(61));
  console.log(`Universe: ${totalRows} extractions across ${kindCounts.length} kinds\n`);

  if (totalRows === 0) {
    console.log('Nothing to sample.');
    await prisma.$disconnect();
    return;
  }

  // ── Stratified pick ──────────────────────────────────────────────────
  // Proportional allocation, with a floor of minPerKind.
  const allocations: Array<{ kind: string; need: number; have: number }> = [];
  for (const k of kindCounts) {
    const have = goldByKind.get(k.extractionKind) ?? 0;
    const share = Math.max(args.minPerKind, Math.round((k._count._all / totalRows) * args.total));
    const need = Math.max(0, Math.min(share, k._count._all) - have);
    allocations.push({ kind: k.extractionKind, need, have });
  }

  // ── Pick per kind ────────────────────────────────────────────────────
  // Within a kind, stratify across confidence: take a high-end sample,
  // a low-end sample, and a uniformly-spaced middle. Implementation:
  // ORDER BY a hash of id so the selection is deterministic per kind +
  // we don't bias toward newest rows. Filter to is_gold_sample = false
  // so re-runs are idempotent.
  let totalToFlip = 0;
  const sampleIds: string[] = [];
  for (const a of allocations) {
    if (a.need <= 0) continue;
    const candidates = await prisma.aiExtraction.findMany({
      where: { extractionKind: a.kind, isGoldSample: false },
      select: { id: true, confidence: true },
      orderBy: { confidence: 'asc' },
    });
    if (candidates.length === 0) continue;
    // Stride sample across the confidence-sorted list.
    const picked: string[] = [];
    const stride = Math.max(1, Math.floor(candidates.length / a.need));
    for (let i = 0; i < candidates.length && picked.length < a.need; i += stride) {
      picked.push(candidates[i]!.id);
    }
    // Pad with the tail if stride sampling under-collected.
    for (let i = candidates.length - 1; i >= 0 && picked.length < a.need; i--) {
      const id = candidates[i]!.id;
      if (!picked.includes(id)) picked.push(id);
    }
    sampleIds.push(...picked);
    totalToFlip += picked.length;
    console.log(`  ${a.kind}: picked ${picked.length} (had ${a.have}, target ${a.need + a.have})`);
  }

  console.log(`\nTotal candidates flipping is_gold_sample=true: ${totalToFlip}`);

  if (args.apply && sampleIds.length > 0) {
    const result = await prisma.aiExtraction.updateMany({
      where: { id: { in: sampleIds } },
      data: { isGoldSample: true },
    });
    console.log(`Updated ${result.count} rows.`);
    console.log('\nNext step: an analyst fills `gold_label` (Json) on each of these');
    console.log('rows with the correct payload. Then run `pnpm ai:eval-accuracy`.');
    console.log('\nQuery to list rows pending label:');
    console.log(`  SELECT id, extraction_kind, source_entity_type, source_entity_id,`);
    console.log(`         confidence, payload_json`);
    console.log(`  FROM ai_extractions`);
    console.log(`  WHERE is_gold_sample = true AND gold_label IS NULL;`);
  } else if (!args.apply) {
    console.log('\nDry run only. Pass --apply to commit.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
