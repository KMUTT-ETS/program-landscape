import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { employerFeedbackDataset } from '../src/import/datasets/employer-feedback';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';
import { programOutcomes } from '../src/program-deep-dive';

const FACULTY_CODE = 'EF-FAC';
const P1 = 'EF-PROG-1';
const P2 = 'EF-PROG-2';

let runA = '';
let runB = '';
let otherRun = '';
const ids: Record<string, string> = {};

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
  const progs = await prisma.program.findMany({ where: { code: { in: [P1, P2] } }, select: { id: true } });
  await prisma.employerFeedback.deleteMany({ where: { programId: { in: progs.map((p) => p.id) } } });
  await prisma.program.deleteMany({ where: { code: { in: [P1, P2] } } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

function load(rows: readonly ImportRow[], runId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: runId };
    return employerFeedbackDataset.load(ctx, rows);
  });
}

function validate(rows: Record<string, unknown>[]) {
  const parsed: ParsedSheet = {
    sheetName: employerFeedbackDataset.sheetName,
    headers: employerFeedbackDataset.columns.map((c) => c.header),
    rows,
  };
  return validateSheet(employerFeedbackDataset, parsed, {
    references: new Map([['programmes', new Set([P1, P2])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

const sRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  'Programme Code': P1, 'Survey Year': 2024, Employer: 'Acme Co', 'Satisfaction (0–1)': 0.87, Respondents: 12, ...over,
});
const imp = (programmeCode: string, year: number, employer: string | null, score: number, n: number): ImportRow =>
  ({ programmeCode, surveyYear: year, employer, satisfaction: score, respondents: n }) as ImportRow;

beforeAll(async () => {
  await cleanup();
  runA = await makeRun('xlsx-employer-feedback');
  runB = await makeRun('xlsx-employer-feedback');
  otherRun = await makeRun('kku-employer-test');
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'คณะทดสอบ', nameEn: 'Test faculty' },
    select: { id: true },
  });
  for (const [code, seq] of [[P1, -9501], [P2, -9502]] as const) {
    const p = await prisma.program.create({
      data: { code, nameTh: `โปรแกรม ${code}`, nameEn: code, facultyId: faculty.id, level: 'BACHELOR', status: 'ACTIVE', sequenceNoFromSheet: seq },
      select: { id: true },
    });
    ids[code] = p.id;
  }
});

afterAll(cleanup);

describe('employer feedback dataset', () => {
  it('is registered', () => {
    expect(getImportDataset('employer-feedback').slug).toBe('employer-feedback');
  });

  it('refuses 87 with the fraction hint, and fewer than five respondents', () => {
    const r = validate([sRow({ 'Satisfaction (0–1)': 87 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toMatch(/write 87 % as 0\.87|0\.87, not 87/);
    expect(validate([sRow({ Respondents: 4 })]).ok).toBe(false);
    expect(validate([sRow()]).ok).toBe(true);
  });

  it('refuses a Buddhist-era survey year', () => {
    expect(validate([sRow({ 'Survey Year': 2567 })]).ok).toBe(false);
  });

  it('blank employer becomes All employers', async () => {
    await load([imp(P1, 2024, null, 0.8, 10)], runA);
    const stored = await prisma.employerFeedback.findFirstOrThrow({ where: { programId: ids[P1] } });
    expect(stored.employerName).toBe('All employers');
    expect(stored.sampleSize).toBe(10);
    expect(stored.skillGapsJson).toEqual([]);
    expect(stored.ingestionRunId).toBe(runA);
  });

  it('programOutcomes shows an imported row and hides an unstamped one', async () => {
    await prisma.employerFeedback.create({
      data: { programId: ids[P1]!, year: 2020, employerName: 'Unstamped', satisfactionScore: 0.5, skillGapsJson: [], sampleSize: 9, freshnessDate: new Date() },
    });
    const outcomes = await programOutcomes(ids[P1]!);
    const names = outcomes.topEmployers.map((e) => e.name);
    expect(names).toContain('All employers');
    expect(names).not.toContain('Unstamped');
  });

  it('programme-scoped replace leaves other programmes and other runs alone', async () => {
    await prisma.employerFeedback.create({
      data: { programId: ids[P1]!, year: 2019, employerName: 'Other source', satisfactionScore: 0.6, skillGapsJson: [], sampleSize: 9, freshnessDate: new Date(), ingestionRunId: otherRun },
    });
    await load([imp(P2, 2024, 'Beta Ltd', 0.7, 8)], runA);
    const result = await load([imp(P1, 2025, 'Acme Co', 0.9, 15)], runB);
    expect(result.deleted).toBe(1); // P1's earlier imported row only
    const p1 = await prisma.employerFeedback.findMany({ where: { programId: ids[P1], ingestionRunId: { not: null } }, orderBy: { year: 'asc' } });
    expect(p1.map((r) => r.employerName)).toEqual(['Other source', 'Acme Co']);
    expect(await prisma.employerFeedback.count({ where: { programId: ids[P2] } })).toBe(1);
  });

  it('clear only deletes this dataset\'s runs', async () => {
    const deleted = await prisma.$transaction((tx) => employerFeedbackDataset.clear(tx, [runA]));
    expect(deleted).toBe(1); // P2's row; P1's imported row is from run B
    expect(await prisma.employerFeedback.count({ where: { programId: ids[P1] } })).toBe(3);
  });
});
