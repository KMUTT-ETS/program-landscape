#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Seed RankedUniversity from the curated starter list
// (packages/db/src/ranked-universities-starter.ts) — the same list the
// "University Rankings" spreadsheet template is pre-filled with. An adopter
// edits the spreadsheet instead; this script remains for first-time setup
// and refreshing the starter values.
//
// Idempotent on (name, rankingYear). Re-run safe.
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

import {
  RANKED_UNIVERSITIES_STARTER,
  RANKED_UNIVERSITIES_STARTER_YEAR,
  loadOrganization,
  prisma,
} from '@kku/db';

const UNIVERSITIES = RANKED_UNIVERSITIES_STARTER;
const RANKING_YEAR = RANKED_UNIVERSITIES_STARTER_YEAR;


async function main(): Promise<void> {
  await loadOrganization();
  let upserted = 0;
  for (const u of UNIVERSITIES) {
    await prisma.rankedUniversity.upsert({
      where: { name_rankingYear: { name: u.name, rankingYear: RANKING_YEAR } },
      create: {
        name: u.name,
        country: u.country,
        region: u.region,
        qsWorldRank: u.qsWorldRank ?? null,
        theWorldRank: u.theWorldRank ?? null,
        qsAsiaRank: u.qsAsiaRank ?? null,
        theAsiaRank: u.theAsiaRank ?? null,
        rankingYear: RANKING_YEAR,
        websiteUrl: u.websiteUrl ?? null,
        notes: u.notes ?? null,
      },
      update: {
        country: u.country,
        region: u.region,
        qsWorldRank: u.qsWorldRank ?? null,
        theWorldRank: u.theWorldRank ?? null,
        qsAsiaRank: u.qsAsiaRank ?? null,
        theAsiaRank: u.theAsiaRank ?? null,
        websiteUrl: u.websiteUrl ?? null,
        notes: u.notes ?? null,
      },
    });
    upserted++;
  }
  console.log(`✓ Upserted ${upserted} ranked universities for ${RANKING_YEAR}`);
  for (const region of ['World', 'Asia', 'Southeast Asia', 'Thailand']) {
    const c = await prisma.rankedUniversity.count({
      where: { region, rankingYear: RANKING_YEAR },
    });
    console.log(`  ${region}: ${c}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
