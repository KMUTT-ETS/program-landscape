import { loadOrganization, prisma } from '@kku/db';

// One-shot: delete connector/monitor/seed-origin TrendSignals (all mock while
// the 9 signal connectors still run in mock mode) so the real connector runs
// repopulate the radar with real signals. Keeps real external-AI-source signals
// and document-backed signals. Dry-run by default; pass --apply to delete.
async function main(): Promise<void> {
  await loadOrganization();
  const apply = process.argv.includes('--apply');

  const docSignalIds = (
    await prisma.trendDocument.findMany({
      where: { trendSignalId: { not: null } },
      select: { trendSignalId: true },
    })
  )
    .map((d) => d.trendSignalId)
    .filter((v): v is string => v !== null);

  const where = {
    externalAiSourceId: null as string | null,
    id: { notIn: docSignalIds.length ? docSignalIds : ['__none__'] },
  };

  const victims = await prisma.trendSignal.findMany({
    where,
    select: { id: true, title: true, sourceUrl: true },
  });

  console.log(`Purgeable (no TrendDocument + no externalAiSourceId): ${victims.length}`);
  for (const v of victims.slice(0, 10)) {
    console.log(`  - ${v.title.slice(0, 60)}  [${v.sourceUrl ?? 'no url'}]`);
  }
  if (victims.length > 10) console.log(`  … and ${victims.length - 10} more`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete these signals + their notifications.');
    await prisma.$disconnect();
    return;
  }

  const ids = victims.map((v) => v.id);
  const notif = await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  const del = await prisma.trendSignal.deleteMany({ where: { id: { in: ids } } });
  console.log(`Deleted ${del.count} signals + ${notif.count} notifications.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
