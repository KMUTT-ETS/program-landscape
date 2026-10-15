#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Seed / refresh ImdEconomy + ImdRanking rows from the analyst-curated
// JSON at apps/ingestion/data/imd-rankings.json.
//
// Idempotent — upsert by natural keys. Run after each annual IMD release
// (June=WCY, Sep=WTR, Nov=WDCR) by appending rows to the JSON.
//
// Usage:
//   pnpm imd:seed                      # apply default JSON
//   pnpm imd:seed --file=path.json     # alternate file
//   pnpm imd:seed --dry-run            # report what would change
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

import { loadOrganization, prisma, type ImdDataset } from '@kku/db';
import { SOURCE_CATALOG } from '@kku/shared';

interface EconomyEntry {
  code: string;
  name: string;
  region?: string;
  isPeer?: boolean;
}

interface RankingEntry {
  year: number;
  dataset: ImdDataset;
  economy: string;
  indicatorKey: string;
  value?: number | null;
  rank?: number | null;
  totalRanked?: number | null;
  rawValue?: string | null;
  notes?: string | null;
}

interface SeedFile {
  economies: EconomyEntry[];
  rankings: RankingEntry[];
}

function parseArgs(argv: string[]): { file: string; dryRun: boolean } {
  const fileArg = argv.find((a) => a.startsWith('--file='));
  const file = fileArg
    ? fileArg.split('=')[1] ?? ''
    : path.resolve(__dirname, '..', '..', 'data', 'imd-rankings.json');
  return { file, dryRun: argv.includes('--dry-run') };
}

async function upsertDataSourceRow(dryRun: boolean): Promise<void> {
  // Make sure the DataSource row for `imd-rankings` exists so the
  // /admin/data-sources (Connector / feeds) page lists it. The
  // catalog drives `pnpm db:seed`, but we want this CLI to be
  // self-sufficient — re-runnable in a live environment without
  // touching the destructive full-DB seed.
  const entry = SOURCE_CATALOG.find((e) => e.slug === 'imd-rankings');
  if (!entry) {
    console.warn('(no SOURCE_CATALOG entry for imd-rankings — skipping DataSource upsert)');
    return;
  }
  const scheduleEnabled = entry.deprecated
    ? false
    : entry.scheduleEnabled ?? true;
  const data = {
    name: entry.name,
    kind: entry.kind,
    inputFormat: entry.inputFormat,
    acceptsPdfUploads: entry.acceptsPdfUploads ?? false,
    baseUrl: entry.baseUrl ?? null,
    cadenceCron: entry.cadenceCron ?? null,
    scheduleEnabled,
    ownerContact: entry.ownerContact ?? null,
    notes: entry.notes ?? null,
    status: entry.mocked ? ('mocked' as const) : ('active' as const),
  };
  if (dryRun) {
    const existing = await prisma.dataSource.findUnique({ where: { slug: entry.slug } });
    console.log(
      `DataSource ${existing ? '(would update)' : '(would create)'} slug=${entry.slug} status=${data.status}`,
    );
    return;
  }
  await prisma.dataSource.upsert({
    where: { slug: entry.slug },
    create: { slug: entry.slug, ...data },
    update: data,
  });
  console.log(`✓ DataSource row upserted: ${entry.slug} (status=${data.status})`);
}

async function main(): Promise<void> {
  await loadOrganization();
  const { file, dryRun } = parseArgs(process.argv.slice(2));
  if (!existsSync(file)) {
    console.error(`Seed file not found: ${file}`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as SeedFile;
  console.log(`━━━ IMD seed ${dryRun ? '(DRY-RUN)' : '(COMMIT)'} ━━━`);
  console.log(`File: ${file}`);
  console.log(`Economies: ${raw.economies.length}, Rankings: ${raw.rankings.length}\n`);

  await upsertDataSourceRow(dryRun);

  const codeToId = new Map<string, string>();
  let economiesUpserted = 0;
  for (const e of raw.economies) {
    if (dryRun) {
      const existing = await prisma.imdEconomy.findUnique({ where: { code: e.code } });
      codeToId.set(e.code, existing?.id ?? `<new:${e.code}>`);
      console.log(`  ${existing ? '~' : '+'} ${e.code.padEnd(4)} ${e.name}`);
      continue;
    }
    const row = await prisma.imdEconomy.upsert({
      where: { code: e.code },
      create: {
        code: e.code,
        name: e.name,
        region: e.region ?? null,
        isPeer: e.isPeer ?? false,
      },
      update: {
        name: e.name,
        region: e.region ?? null,
        isPeer: e.isPeer ?? false,
      },
    });
    codeToId.set(e.code, row.id);
    economiesUpserted++;
  }
  console.log(`\nEconomies ${dryRun ? 'would upsert' : 'upserted'}: ${economiesUpserted}\n`);

  let rankingsUpserted = 0;
  let rankingsSkipped = 0;
  for (const r of raw.rankings) {
    const economyId = codeToId.get(r.economy);
    if (!economyId) {
      console.warn(`  ! ${r.year} ${r.dataset} ${r.economy} ${r.indicatorKey}: unknown economy code`);
      rankingsSkipped++;
      continue;
    }
    if (dryRun) {
      rankingsUpserted++;
      continue;
    }
    if (economyId.startsWith('<new:')) {
      // Shouldn't happen outside dry-run since we upserted economies above.
      rankingsSkipped++;
      continue;
    }
    await prisma.imdRanking.upsert({
      where: {
        year_dataset_economyId_indicatorKey: {
          year: r.year,
          dataset: r.dataset,
          economyId,
          indicatorKey: r.indicatorKey,
        },
      },
      create: {
        year: r.year,
        dataset: r.dataset,
        economyId,
        indicatorKey: r.indicatorKey,
        value: r.value ?? null,
        rank: r.rank ?? null,
        totalRanked: r.totalRanked ?? null,
        rawValue: r.rawValue ?? null,
        notes: r.notes ?? null,
        source: 'manual-seed',
      },
      update: {
        value: r.value ?? null,
        rank: r.rank ?? null,
        totalRanked: r.totalRanked ?? null,
        rawValue: r.rawValue ?? null,
        notes: r.notes ?? null,
      },
    });
    rankingsUpserted++;
  }
  console.log(`Rankings ${dryRun ? 'would upsert' : 'upserted'}: ${rankingsUpserted} (skipped: ${rankingsSkipped})`);

  if (!dryRun) {
    const totalEcon = await prisma.imdEconomy.count();
    const totalRank = await prisma.imdRanking.count();
    console.log(`\nFinal DB state: ${totalEcon} economies · ${totalRank} ranking rows`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
