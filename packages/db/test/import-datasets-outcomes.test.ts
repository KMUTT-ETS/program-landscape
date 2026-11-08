import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { realDataWhere } from '../src/data-quality';
import { graduateOutcomesDataset } from '../src/import/datasets/graduate-outcomes';
import { getImportDataset } from '../src/import/registry';
import type { ImportDataset, ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'OUT-ENG';
const PROGRAMME_CODE = 'OUT-CIV-BE';

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.graduateOutcome.deleteMany({ where: { program: { code: PROGRAMME_CODE } } });
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
  const headers = graduateOutcomesDataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: graduateOutcomesDataset.sheetName, headers, rows };
  return validateSheet(graduateOutcomesDataset, parsed, {
    references: new Map([['programmes', new Set([PROGRAMME_CODE])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function sheetRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Programme Code': PROGRAMME_CODE,
    'Graduation Year': 2022,
    'Survey Year': 2023,
    'Employment Rate': 0.87,
    'Average Salary (THB/month)': 24000,
    'Job Relevance Score': 0.8,
    'Further Study Rate': 0.1,
    'Sample Size': 40,
    ...over,
  };
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    programmeCode: PROGRAMME_CODE,
    graduationYear: 2022,
    surveyYear: 2023,
    employmentRate: 0.87,
    averageSalary: 24000,
    jobRelevanceScore: 0.8,
    furtherStudyRate: 0.1,
    sampleSize: 40,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-graduate-outcomes');
  otherRunId = await makeRun('xlsx-graduate-outcomes');

  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
  // Written directly, with a sequence number that can never be the max the
  // programmes loader reads — see import-datasets-enrollment.
  await prisma.program.create({
    data: {
      code: PROGRAMME_CODE, nameTh: 'โยธา', nameEn: 'Civil',
      facultyId: faculty.id, level: 'BACHELOR', sequenceNoFromSheet: -8401,
    },
  });
});

afterAll(cleanup);

describe('graduate outcomes dataset', () => {
  it('is registered under the slug the raw view uses', () => {
    expect(getImportDataset('graduate-outcomes').slug).toBe('graduate-outcomes');
  });

  it('inserts a row keyed on all three parts', async () => {
    const result = await load(graduateOutcomesDataset, [row()], runId);
    expect(result.inserted).toBe(1);

    const stored = await prisma.graduateOutcome.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE }, graduationYear: 2022, surveyYear: 2023 },
    });
    expect(stored.employmentRate).toBe(0.87);
    expect(Number(stored.averageSalary)).toBe(24000);
    expect(stored.sampleSize).toBe(40);
    expect(stored.ingestionRunId).toBe(runId);
  });

  it('is visible through realDataWhere()', async () => {
    const found = await prisma.graduateOutcome.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { surveyYear: true },
    });
    expect(found.map((r) => r.surveyYear)).toContain(2023);
  });

  it('keeps two survey years of one graduating cohort as separate rows', async () => {
    // A cohort surveyed again a year later is a second observation, not a
    // correction of the first — collapsing them would lose the trajectory.
    const result = await load(graduateOutcomesDataset, [
      row({ surveyYear: 2024, employmentRate: 0.93 }),
    ], otherRunId);
    expect(result.inserted).toBe(1);

    expect(await prisma.graduateOutcome.count({
      where: { program: { code: PROGRAMME_CODE }, graduationYear: 2022 },
    })).toBe(2);
  });

  it('updates a row with the same three parts rather than duplicating it', async () => {
    const result = await load(graduateOutcomesDataset, [
      row({ employmentRate: 0.9 }),
    ], otherRunId);
    expect(result.updated).toBe(1);

    const stored = await prisma.graduateOutcome.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE }, graduationYear: 2022, surveyYear: 2023 },
    });
    expect(stored.employmentRate).toBe(0.9);
    // Not re-attributed — the run that created it keeps its name.
    expect(stored.ingestionRunId).toBe(runId);
  });

  it('rejects an employment rate of 87, naming the 0 to 1 convention', () => {
    // 87 and 0.87 are both plausible numbers to a validator that only
    // checks for a number; one of them silently reports 8700% employment.
    const result = validate([sheetRow({ 'Employment Rate': 87 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.column).toBe('Employment Rate');
      expect(result.errors[0]?.message).toMatch(/0 and 1|0.87/);
    }
  });

  it('accepts 0.87', () => {
    expect(validate([sheetRow({ 'Employment Rate': 0.87 })]).ok).toBe(true);
  });

  it('applies the same rule to the other two rates', () => {
    expect(validate([sheetRow({ 'Job Relevance Score': 80 })]).ok).toBe(false);
    expect(validate([sheetRow({ 'Further Study Rate': 10 })]).ok).toBe(false);
  });

  it('rejects a survey year before the graduation year', () => {
    const result = validate([sheetRow({ 'Graduation Year': 2023, 'Survey Year': 2022 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/survey/i);
  });

  it('rejects a Buddhist-era year, naming BE', () => {
    const result = validate([sheetRow({ 'Graduation Year': 2565, 'Survey Year': 2566 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/Buddhist/i);
  });

  it('refuses a sample too small to report', () => {
    // A survey of three graduates describes three people.
    const result = validate([sheetRow({ 'Sample Size': 3 })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.column).toBe('Sample Size');
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => graduateOutcomesDataset.clear(tx, [runId]));
    expect(deleted).toBe(1);
    // The 2024 survey row belongs to the other run and survives.
    expect(await prisma.graduateOutcome.count({
      where: { program: { code: PROGRAMME_CODE } },
    })).toBe(1);
  });
});
