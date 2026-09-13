// ─────────────────────────────────────────────────────────────────────────────
// backfill-demand-match-provenance — one-shot hygiene.
//
// All 6,224 program_demand_matches rows were written with
// ingestion_run_id = NULL, so none passed realDataWhere() and the
// `demand_match_filled` relevance driver read null on all 301 programmes
// despite 285 having real AI match analysis behind them.
//
// Every existing row is demand-match.v2 or .v3, both of which predate any
// demand source other than kmitl-skill-mapping, so all of them came from
// there. We anchor them to that connector's most recent SUCCEEDED run.
//
// The anchor is APPROXIMATE — these rows did not literally come from that
// run — but the source family is correct, which is the same compromise
// accepted for the v1.1.3 provenance backfill. The next successful
// demand-match run overwrites each row it touches with accurate
// provenance, because runDemandMatch now stamps on write.
//
// Usage:
//   pnpm demand:backfill-provenance            # dry run
//   pnpm demand:backfill-provenance --apply    # write
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '@kku/db';

const DEMAND_SOURCE_SLUG = 'kmitl-skill-mapping';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const [untagged, total, byVersion] = await Promise.all([
    prisma.programDemandMatch.count({ where: { ingestionRunId: null } }),
    prisma.programDemandMatch.count(),
    prisma.programDemandMatch.groupBy({ by: ['methodVersion'], _count: true }),
  ]);

  console.log('=== program_demand_matches provenance backfill ===');
  console.log(`total rows      : ${total}`);
  console.log(`untagged rows   : ${untagged}`);
  console.log(`by methodVersion: ${byVersion.map((v) => `${v.methodVersion}=${v._count}`).join(' ')}`);

  if (untagged === 0) {
    console.log('\nNothing to do — every row already carries a provenance run.');
    await prisma.$disconnect();
    return;
  }

  // NOTE: the column is completed_at, not finished_at.
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: DEMAND_SOURCE_SLUG } },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true, recordsLoaded: true },
  });

  if (!run) {
    console.error(
      `\nNo SUCCEEDED ${DEMAND_SOURCE_SLUG} run exists, so there is nothing honest to ` +
        'anchor these rows to. Run that connector first; do NOT invent a run id.',
    );
    process.exit(1);
  }

  console.log(
    `\nanchor run      : ${run.id}\n` +
      `  completed at  : ${run.completedAt?.toISOString() ?? '(null)'}\n` +
      `  recordsLoaded : ${run.recordsLoaded ?? '-'}`,
  );

  if (!apply) {
    console.log(`\nDRY RUN — would tag ${untagged} rows. Pass --apply to write.`);
    await prisma.$disconnect();
    return;
  }

  const res = await prisma.programDemandMatch.updateMany({
    where: { ingestionRunId: null },
    data: { ingestionRunId: run.id },
  });
  console.log(`\ntagged ${res.count} rows with run ${run.id}`);

  const remaining = await prisma.programDemandMatch.count({ where: { ingestionRunId: null } });
  console.log(`untagged remaining: ${remaining}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
