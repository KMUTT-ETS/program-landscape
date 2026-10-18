import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { realDataWhere } from '../src/data-quality';
import { financialsDataset } from '../src/import/datasets/financials';
import { getImportDataset } from '../src/import/registry';
import type { ImportDataset, ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'FIN-ENG';
const PROGRAMME_CODE = 'FIN-CIV-BE';

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.financialMetric.deleteMany({ where: { program: { code: PROGRAMME_CODE } } });
  await prisma.program.deleteMany({ where: { code: PROGRAMME_CODE } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

async function makeRun(slug: string): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug },
    update: {},
    create: {
      slug, name: `${slug} test`, kind: 'CSV', inputFormat: 'XLSX',
      mocked: false, scheduleEnabled: false, status: 'real',
    },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'SUCCEEDED', attempt: 1 },
    select: { id: true },
  });
  return run.id;
}

async function load(
  dataset: ImportDataset,
  rows: readonly ImportRow[],
  withRunId: string,
): Promise<{ inserted: number; updated: number; deleted: number }> {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: withRunId };
    return dataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const headers = financialsDataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: financialsDataset.sheetName, headers, rows };
  return validateSheet(financialsDataset, parsed, {
    references: new Map([['programmes', new Set([PROGRAMME_CODE])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function sheetRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Programme Code': PROGRAMME_CODE,
    'Academic Year': 2024,
    'Tuition Revenue (THB)': 1000,
    'Other Revenue (THB)': null,
    ...over,
  };
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-financial-metrics');
  otherRunId = await makeRun('xlsx-financial-metrics');

  // Written directly, and never with a sequence number that could be the
  // max the programmes loader reads — see import-datasets-enrollment.
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
  await prisma.program.create({
    data: {
      code: PROGRAMME_CODE, nameTh: 'โยธา', nameEn: 'Civil',
      facultyId: faculty.id, level: 'BACHELOR', sequenceNoFromSheet: -8301,
    },
  });
});

afterAll(cleanup);

describe('finance dataset', () => {
  it('is registered under the slug the raw view already uses', () => {
    expect(getImportDataset('financial-metrics').slug).toBe('financial-metrics');
  });

  it('heads the year column "Academic Year", not "Fiscal Year"', () => {
    // D3. The Prisma field is fiscalYear and holds an academic year; the
    // adopter must be asked for the year they actually have.
    const headers = financialsDataset.columns.map((c) => c.header);
    expect(headers).toContain('Academic Year');
    expect(headers.join(' ')).not.toMatch(/Fiscal/i);
  });

  it('warns in the guide that it is not the budget year', () => {
    const year = financialsDataset.columns.find((c) => c.key === 'academicYear');
    expect(year?.guide).toMatch(/budget|fiscal/i);
  });

  it('offers no cost columns', () => {
    // D2. Costs come from the cost-allocation methodology, never an upload.
    const keys = financialsDataset.columns.map((c) => c.key);
    expect(keys.filter((k) => /cost|overhead/i.test(k))).toEqual([]);
    expect(financialsDataset.description).toMatch(/cost/i);
  });

  it('inserts with costs seeded to 0 and net contribution equal to revenue', async () => {
    const result = await load(financialsDataset, [{
      programmeCode: PROGRAMME_CODE, academicYear: 2024,
      tuitionRevenue: 1_000_000, otherRevenue: 250_000,
    }], runId);

    expect(result.inserted).toBe(1);
    const row = await prisma.financialMetric.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE }, fiscalYear: 2024 },
    });
    expect(Number(row.tuitionRevenue)).toBe(1_000_000);
    expect(Number(row.otherRevenue)).toBe(250_000);
    expect(Number(row.directCost)).toBe(0);
    expect(Number(row.allocatedOverhead)).toBe(0);
    expect(Number(row.netContribution)).toBe(1_250_000);
    expect(row.ingestionRunId).toBe(runId);
  });

  it('is visible through realDataWhere()', async () => {
    const found = await prisma.financialMetric.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { fiscalYear: true },
    });
    expect(found.map((r) => r.fiscalYear)).toContain(2024);
  });

  it('leaves an existing cost allocation untouched on update', async () => {
    // The case that protects a KKU installation from an adopter-shaped
    // import: cost figures belong to the methodology, not to this file.
    await prisma.financialMetric.updateMany({
      where: { program: { code: PROGRAMME_CODE }, fiscalYear: 2024 },
      data: { directCost: 900_000, costPerStudent: 42_000 },
    });

    const result = await load(financialsDataset, [{
      programmeCode: PROGRAMME_CODE, academicYear: 2024,
      tuitionRevenue: 1_100_000, otherRevenue: null,
    }], otherRunId);

    expect(result.updated).toBe(1);
    const row = await prisma.financialMetric.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE }, fiscalYear: 2024 },
    });
    expect(Number(row.directCost)).toBe(900_000);
    expect(Number(row.costPerStudent)).toBe(42_000);
    expect(Number(row.tuitionRevenue)).toBe(1_100_000);
    // Not re-attributed: start-over must never reach a row this import
    // did not create.
    expect(row.ingestionRunId).toBe(runId);
    // An allocation exists, so net contribution is the methodology's to
    // compute and this import leaves it alone.
    expect(Number(row.netContribution)).toBe(1_250_000);
    // Blank Other Revenue keeps what was stored, as everywhere else (D4).
    expect(Number(row.otherRevenue)).toBe(250_000);
  });

  it('keeps net contribution following revenue while no allocation exists', async () => {
    // The adopter path: no cost methodology, so every cost column is 0 and
    // net contribution is definitionally the revenue. Freezing it at the
    // first upload would leave a wrong number on the Cockpit forever.
    await load(financialsDataset, [{
      programmeCode: PROGRAMME_CODE, academicYear: 2023,
      tuitionRevenue: 500_000, otherRevenue: null,
    }], runId);
    await load(financialsDataset, [{
      programmeCode: PROGRAMME_CODE, academicYear: 2023,
      tuitionRevenue: 700_000, otherRevenue: 50_000,
    }], runId);

    const row = await prisma.financialMetric.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE }, fiscalYear: 2023 },
    });
    expect(Number(row.netContribution)).toBe(750_000);
  });

  it('claims a row that no live source owns', async () => {
    // A legacy row with null provenance is invisible to realDataWhere().
    // Stamping it is the only thing that makes the uploaded figures show.
    await prisma.financialMetric.create({
      data: {
        programId: (await prisma.program.findUniqueOrThrow({ where: { code: PROGRAMME_CODE } })).id,
        fiscalYear: 2019,
        tuitionRevenue: 1, otherRevenue: 0, directCost: 0,
        allocatedFacultyCost: 0, allocatedFacilityCost: 0, allocatedOverhead: 0,
        netContribution: 1, freshnessDate: new Date(),
      },
    });

    await load(financialsDataset, [{
      programmeCode: PROGRAMME_CODE, academicYear: 2019,
      tuitionRevenue: 123, otherRevenue: null,
    }], runId);

    const row = await prisma.financialMetric.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE }, fiscalYear: 2019 },
    });
    expect(row.ingestionRunId).toBe(runId);
  });

  it('accepts a figure written with thousands separators', () => {
    const result = validate([sheetRow({ 'Tuition Revenue (THB)': '1,250,000.50' })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]?.tuitionRevenue).toBe(1_250_000.5);
  });

  it('refuses a Buddhist-era year, naming BE', () => {
    const result = validate([sheetRow({ 'Academic Year': 2568 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.column).toBe('Academic Year');
      expect(result.errors[0]?.message).toMatch(/Buddhist/i);
    }
  });

  it('refuses a negative revenue figure', () => {
    const result = validate([sheetRow({ 'Tuition Revenue (THB)': -5 })]);
    expect(result.ok).toBe(false);
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => financialsDataset.clear(tx, [runId]));
    expect(deleted).toBe(3);
    expect(await prisma.financialMetric.count({
      where: { program: { code: PROGRAMME_CODE } },
    })).toBe(0);
  });
});
