import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { rankedUniversitiesDataset } from '../src/import/datasets/ranked-universities';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';
import { peerCandidateWhere } from '../src/peer-candidates';
import { RANKED_UNIVERSITIES_STARTER } from '../src/ranked-universities-starter';
import { describeScratchDb } from './helpers/scratch-db';

const PREFIX = 'RU Test ';
const SLUG = 'xlsx-ranked-universities';
let runA = '';
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

function load(rows: readonly ImportRow[], runId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: runId };
    return rankedUniversitiesDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const parsed: ParsedSheet = {
    sheetName: rankedUniversitiesDataset.sheetName,
    headers: rankedUniversitiesDataset.columns.map((c) => c.header),
    rows,
  };
  return validateSheet(rankedUniversitiesDataset, parsed, {
    references: new Map(),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

const sRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  University: `${PREFIX}Alpha University`,
  Country: 'Thailand',
  Region: 'Thailand',
  'Ranking Year': 2025,
  'QS World Rank': 801,
  ...over,
});

async function cleanup(): Promise<void> {
  await prisma.rankedUniversity.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

describeScratchDb('ranked-universities dataset', () => {
  beforeAll(async () => {
    await cleanup();
    runA = await makeRun(SLUG);
    otherRun = await makeRun('xlsx-other-test-ru');
  });
  afterAll(async () => {
    await cleanup();
  });

  it('is registered', () => {
    expect(getImportDataset('ranked-universities')).toBe(rankedUniversitiesDataset);
  });

  it('refuses an unknown region naming allowed values', () => {
    const result = validate([sRow({ Region: 'Europe' })]);
    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.errors.map((e) => e.message).join(' ');
    for (const region of ['World', 'Asia', 'Southeast Asia', 'Thailand']) {
      expect(message).toContain(region);
    }
  });

  it('refuses a non-positive rank', () => {
    expect(validate([sRow({ 'QS World Rank': 0 })]).ok).toBe(false);
  });

  it('accepts a valid row', () => {
    expect(validate([sRow()]).ok).toBe(true);
  });

  it('prefill returns the starter list', async () => {
    const rows = await rankedUniversitiesDataset.prefill!(prisma, {});
    expect(rows).toHaveLength(RANKED_UNIVERSITIES_STARTER.length);
    expect(rows.length).toBeGreaterThan(50);
    const mit = rows.find((r) => r.university === 'Massachusetts Institute of Technology');
    expect(mit).toMatchObject({ region: 'World', qsWorldRank: 1, rankingYear: 2025 });
    for (const row of rows) {
      expect(validate([toSheetRow(row)]).ok).toBe(true);
    }
  });

  it('starter list contains no KKU-relative text', () => {
    for (const u of RANKED_UNIVERSITIES_STARTER) {
      expect(u.notes ?? '').not.toMatch(/KKU|at or above|self-reference/i);
    }
  });

  it('upserts on (University, Ranking Year) and counts inserts and updates', async () => {
    const row: ImportRow = { university: `${PREFIX}Beta`, country: 'Thailand', region: 'Thailand', rankingYear: 2025, qsWorldRank: 900 };
    const first = await load([row], runA);
    expect(first).toMatchObject({ inserted: 1, updated: 0 });
    const second = await load([{ ...row, qsWorldRank: 850 }], runA);
    expect(second).toMatchObject({ inserted: 0, updated: 1 });
    const stored = await prisma.rankedUniversity.findFirstOrThrow({ where: { name: `${PREFIX}Beta`, rankingYear: 2025 } });
    expect(stored.qsWorldRank).toBe(850);
    expect(stored.ingestionRunId).toBe(runA);
  });

  it('peer selection excludes the own institution by profile nameEn', () => {
    const where = peerCandidateWhere(2025, 'Example Technical University');
    expect(where).toEqual({ rankingYear: 2025, name: { not: 'Example Technical University' } });
  });

  it('clear only deletes this dataset’s runs', async () => {
    await prisma.rankedUniversity.createMany({
      data: [
        { name: `${PREFIX}Mine`, country: 'X', region: 'Asia', rankingYear: 2025, ingestionRunId: runA },
        { name: `${PREFIX}Theirs`, country: 'X', region: 'Asia', rankingYear: 2025, ingestionRunId: otherRun },
        { name: `${PREFIX}Seeded`, country: 'X', region: 'Asia', rankingYear: 2025 },
      ],
    });
    const deleted = await prisma.$transaction((tx) => rankedUniversitiesDataset.clear(tx, [runA]));
    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = await prisma.rankedUniversity.findMany({ where: { name: { startsWith: PREFIX } }, select: { name: true } });
    const names = left.map((r) => r.name);
    expect(names).toContain(`${PREFIX}Theirs`);
    expect(names).toContain(`${PREFIX}Seeded`);
    expect(names).not.toContain(`${PREFIX}Mine`);
  });
});

/** Maps a loader-keyed prefill row back to sheet headers, as the template download does. */
function toSheetRow(row: ImportRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of rankedUniversitiesDataset.columns) out[col.header] = row[col.key] ?? null;
  return out;
}
