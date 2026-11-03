import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { populationProjectionsDataset } from '../src/import/datasets/population-projections';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const SHEET_SOURCE_A = 'xlsx:PP Test Edition A';
const SOURCE_UN = 'UN-WPP2024-pptest';

let runA = '';
let runB = '';
let otherRun = '';

async function makeRun(slug: string): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug },
    update: { mocked: false },
    create: { slug, name: `${slug} test`, kind: 'CSV', inputFormat: 'XLSX', mocked: false, scheduleEnabled: false, status: 'real' },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'SUCCEEDED', attempt: 1 },
    select: { id: true },
  });
  return run.id;
}

async function cleanup(): Promise<void> {
  await prisma.demographicProjection.deleteMany({
    where: { OR: [{ source: { startsWith: 'xlsx:PP Test' } }, { source: SOURCE_UN }] },
  });
}

function load(rows: readonly ImportRow[], runId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: runId };
    return populationProjectionsDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const parsed: ParsedSheet = {
    sheetName: populationProjectionsDataset.sheetName,
    headers: populationProjectionsDataset.columns.map((c) => c.header),
    rows,
  };
  return validateSheet(populationProjectionsDataset, parsed, {
    references: new Map(),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

const sRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  Region: 'TH', Year: 2030, 'Age Group': '18-22', Population: 4_300_000, 'Source Name': 'PP Test Edition A', ...over,
});
const imp = (region: string, year: number, ageGroup: string, population: number, sourceName: string): ImportRow =>
  ({ region, year, ageGroup, population, sourceName }) as ImportRow;

beforeAll(async () => {
  await cleanup();
  runA = await makeRun('xlsx-population-projections');
  runB = await makeRun('xlsx-population-projections');
  otherRun = await makeRun('un-wpp');
});

afterAll(cleanup);

describe('population projections dataset', () => {
  it('is registered', () => {
    expect(getImportDataset('population-projections').slug).toBe('population-projections');
  });

  it('refuses BE year', () => {
    const r = validate([sRow({ Year: 2573 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toMatch(/Buddhist/);
    expect(validate([sRow()]).ok).toBe(true);
  });

  it('normalises national spellings to TH, in the stored row and in the duplicate check', async () => {
    for (const spelling of ['th', ' Thailand ', 'ประเทศไทย']) {
      await load([imp(spelling, 2040, '23-29', 3_000_000, 'PP Test Edition A')], runA);
    }
    const rows = await prisma.demographicProjection.findMany({ where: { source: SHEET_SOURCE_A, year: 2040 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.region).toBe('TH');
    expect(validate([sRow({ Region: 'TH' }), sRow({ Region: 'thailand' })]).ok).toBe(false);
    await prisma.demographicProjection.deleteMany({ where: { source: SHEET_SOURCE_A, year: 2040 } });
  });

  it('refuses unknown age group', () => {
    expect(validate([sRow({ 'Age Group': '30-34' })]).ok).toBe(false);
  });

  it('refuses a zero population and a missing source name', () => {
    expect(validate([sRow({ Population: 0 })]).ok).toBe(false);
    expect(validate([sRow({ 'Source Name': null })]).ok).toBe(false);
  });

  it('stores source as xlsx:<name> and stamps the run', async () => {
    const result = await load([imp('TH', 2030, '18-22', 4_300_000, 'PP Test Edition A')], runA);
    expect(result).toEqual({ inserted: 1, updated: 0, deleted: 0 });
    const stored = await prisma.demographicProjection.findFirstOrThrow({ where: { source: SHEET_SOURCE_A } });
    expect(stored.region).toBe('TH');
    expect(stored.population).toBe(4_300_000);
    expect(stored.ingestionRunId).toBe(runA);
  });

  it('upserts on region, year, age group and source name', async () => {
    const result = await load(
      [imp('TH', 2030, '18-22', 4_100_000, 'PP Test Edition A'), imp('TH', 2031, '18-22', 4_000_000, 'PP Test Edition A')],
      runB,
    );
    expect(result).toEqual({ inserted: 1, updated: 1, deleted: 0 });
    expect(await prisma.demographicProjection.count({ where: { source: SHEET_SOURCE_A } })).toBe(2);
    const row = await prisma.demographicProjection.findFirstOrThrow({ where: { source: SHEET_SOURCE_A, year: 2030 } });
    expect(row.population).toBe(4_100_000);
  });

  it('clear only deletes this dataset’s runs', async () => {
    await prisma.demographicProjection.create({
      data: { region: 'TH', year: 2030, ageCohort: '18-22', source: SOURCE_UN, population: 1, freshnessDate: new Date(), ingestionRunId: otherRun },
    });
    const removed = await prisma.$transaction((tx) => populationProjectionsDataset.clear(tx, [runA, runB]));
    expect(removed).toBe(2);
    expect(await prisma.demographicProjection.count({ where: { source: SOURCE_UN } })).toBe(1);
    expect(await prisma.demographicProjection.count({ where: { source: SHEET_SOURCE_A } })).toBe(0);
  });
});
