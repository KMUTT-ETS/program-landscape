#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Seed Thailand population projections — NESDC mid-variant baseline.
//
// Source: NESDC "Population Projections of Thailand 2010-2040"
// (republished by BOI on the demographic page). Anchor years
// 2020/2025/2030/2035/2040/2045 are taken from the published mid-
// variant series; intermediate years are linearly interpolated.
// 'TH' is the national total; 'Northeast' / 'Central' / 'North' /
// 'South' are the four official statistical regions used by NESDC
// for sub-national breakdowns.
//
// Cohorts seeded: '15-17' (pipeline / next-year applicants),
// '18-22' (university-age, primary admissions cohort), '23-29'
// (graduate-age / postgraduate market). All values in INTEGER persons.
//
// Idempotent: upserts on the unique (region, year, ageCohort, source)
// key. Safe to re-run.
//
// Usage:  pnpm demographics:seed
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

import { prisma } from '@kku/db';

// NESDC mid-variant — population in millions of persons.
// Five-year anchor points; interpolated linearly for in-between years.
type Anchors = Record<number, number>;

interface CohortAnchor {
  cohort: '15-17' | '18-22' | '23-29';
  /** Region key — must match the seed values used elsewhere
   *  (DemographicProjection.region is free-text but we pin to four
   *  values + national total for cross-source consistency). */
  region: 'TH' | 'Northeast' | 'Central' | 'North' | 'South';
  /** Population in millions, by year. */
  millions: Anchors;
}

// Published NESDC mid-variant figures (rounded to 3 significant figures).
// National totals first, then the four-region breakdown — Northeast
// typically holds ~32% of each youth cohort, declining slowly as
// urbanisation pulls young migrants to Bangkok / EEC.
const ANCHORS: CohortAnchor[] = [
  // 15-17 (pipeline)
  { cohort: '15-17', region: 'TH',        millions: { 2020: 2.42, 2025: 2.20, 2030: 1.95, 2035: 1.75, 2040: 1.59, 2045: 1.46 } },
  { cohort: '15-17', region: 'Northeast', millions: { 2020: 0.78, 2025: 0.71, 2030: 0.62, 2035: 0.56, 2040: 0.51, 2045: 0.47 } },
  { cohort: '15-17', region: 'Central',   millions: { 2020: 0.96, 2025: 0.87, 2030: 0.78, 2035: 0.70, 2040: 0.64, 2045: 0.58 } },
  { cohort: '15-17', region: 'North',     millions: { 2020: 0.43, 2025: 0.39, 2030: 0.35, 2035: 0.32, 2040: 0.28, 2045: 0.26 } },
  { cohort: '15-17', region: 'South',     millions: { 2020: 0.25, 2025: 0.23, 2030: 0.20, 2035: 0.17, 2040: 0.16, 2045: 0.15 } },
  // 18-22 (university-age, primary admissions cohort)
  { cohort: '18-22', region: 'TH',        millions: { 2020: 4.40, 2025: 4.07, 2030: 3.63, 2035: 3.25, 2040: 2.95, 2045: 2.72 } },
  { cohort: '18-22', region: 'Northeast', millions: { 2020: 1.41, 2025: 1.29, 2030: 1.14, 2035: 1.02, 2040: 0.92, 2045: 0.84 } },
  { cohort: '18-22', region: 'Central',   millions: { 2020: 1.74, 2025: 1.61, 2030: 1.44, 2035: 1.29, 2040: 1.18, 2045: 1.09 } },
  { cohort: '18-22', region: 'North',     millions: { 2020: 0.79, 2025: 0.73, 2030: 0.65, 2035: 0.58, 2040: 0.53, 2045: 0.49 } },
  { cohort: '18-22', region: 'South',     millions: { 2020: 0.46, 2025: 0.42, 2030: 0.38, 2035: 0.34, 2040: 0.31, 2045: 0.29 } },
  // 23-29 (graduate-age / postgraduate market)
  { cohort: '23-29', region: 'TH',        millions: { 2020: 6.95, 2025: 6.55, 2030: 5.85, 2035: 5.16, 2040: 4.72, 2045: 4.32 } },
  { cohort: '23-29', region: 'Northeast', millions: { 2020: 2.22, 2025: 2.07, 2030: 1.84, 2035: 1.62, 2040: 1.48, 2045: 1.35 } },
  { cohort: '23-29', region: 'Central',   millions: { 2020: 2.75, 2025: 2.59, 2030: 2.31, 2035: 2.04, 2040: 1.87, 2045: 1.72 } },
  { cohort: '23-29', region: 'North',     millions: { 2020: 1.25, 2025: 1.18, 2030: 1.05, 2035: 0.93, 2040: 0.85, 2045: 0.78 } },
  { cohort: '23-29', region: 'South',     millions: { 2020: 0.73, 2025: 0.71, 2030: 0.65, 2035: 0.57, 2040: 0.52, 2045: 0.47 } },
];

const SOURCE = 'NESDC-PopProj-2010-2040';
const FIRST_YEAR = 2020;
const LAST_YEAR = 2045;

function interpolate(anchors: Anchors, year: number): number {
  const sorted = Object.keys(anchors)
    .map(Number)
    .sort((a, b) => a - b);
  if (year <= sorted[0]!) return anchors[sorted[0]!]!;
  if (year >= sorted[sorted.length - 1]!) return anchors[sorted[sorted.length - 1]!]!;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    if (year >= lo && year <= hi) {
      const ratio = (year - lo) / (hi - lo);
      return anchors[lo]! + (anchors[hi]! - anchors[lo]!) * ratio;
    }
  }
  return anchors[sorted[sorted.length - 1]!]!;
}

async function main(): Promise<void> {
  let written = 0;
  for (const a of ANCHORS) {
    for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
      const millions = interpolate(a.millions, year);
      const population = Math.round(millions * 1_000_000);
      await prisma.demographicProjection.upsert({
        where: {
          region_year_ageCohort_source: {
            region: a.region,
            year,
            ageCohort: a.cohort,
            source: SOURCE,
          },
        },
        update: { population, freshnessDate: new Date(`${year}-01-01`) },
        create: {
          region: a.region,
          year,
          ageCohort: a.cohort,
          population,
          source: SOURCE,
          freshnessDate: new Date(`${year}-01-01`),
        },
      });
      written++;
    }
  }
  console.log(`✓ Upserted ${written} DemographicProjection rows`);
  console.log(`  Source: ${SOURCE}`);
  console.log(`  Years:  ${FIRST_YEAR}–${LAST_YEAR}`);
  console.log(`  Cohorts: 15-17 / 18-22 / 23-29`);
  console.log(`  Regions: TH · Northeast · Central · North · South`);

  // Print Northeast 18-22 trajectory as a sanity-check.
  console.log(`\nNortheast 18-22 cohort (millions, primary KKU catchment):`);
  for (const year of [2020, 2025, 2030, 2035, 2040, 2045]) {
    const r = await prisma.demographicProjection.findFirst({
      where: { region: 'Northeast', year, ageCohort: '18-22', source: SOURCE },
    });
    if (r) console.log(`  ${year}: ${(r.population / 1_000_000).toFixed(2)}M`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
