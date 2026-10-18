import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { realDataWhere } from '../src/data-quality';
import {
  alumniCohortsDataset,
  studentCohortsDataset,
  toBuddhistEra,
} from '../src/import/datasets/cohorts';
import { getImportDataset } from '../src/import/registry';
import type { ImportDataset, ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'COH-ENG';
const PROGRAMME_CODE = 'COH-CIV-BE';

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
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

function load(dataset: ImportDataset, rows: readonly ImportRow[], withRunId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: withRunId };
    return dataset.load(ctx, rows);
  });
}

function validate(dataset: ImportDataset, rows: Record<string, unknown>[]) {
  const headers = dataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: dataset.sheetName, headers, rows };
  return validateSheet(dataset, parsed, {
    references: new Map([['programmes', new Set([PROGRAMME_CODE])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-student-cohorts');
  otherRunId = await makeRun('xlsx-alumni-cohorts');

  // Written directly with a NEGATIVE sequence number: canonical, but never
  // the max the programmes loader reads. See import-datasets-enrollment.
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
  await prisma.program.create({
    data: {
      code: PROGRAMME_CODE, nameTh: 'โยธา', nameEn: 'Civil',
      facultyId: faculty.id, level: 'BACHELOR', sequenceNoFromSheet: -8601,
    },
  });
});

afterAll(cleanup);

describe('cohort datasets', () => {
  it('are both registered under the slugs the raw views use', () => {
    expect(getImportDataset('student-cohorts').slug).toBe('student-cohorts');
    expect(getImportDataset('alumni-cohorts').slug).toBe('alumni-cohorts');
  });

  it('stores entry year 2567 when the operator writes 2024', async () => {
    // Every template column is Common Era; these two tables store Buddhist
    // era. The operator never sees BE, so the loader converts.
    expect(toBuddhistEra(2024)).toBe(2567);

    const result = await load(studentCohortsDataset, [
      { programmeCode: PROGRAMME_CODE, entryYear: 2024, studentCount: 120 },
    ], runId);
    expect(result.inserted).toBe(1);

    const row = await prisma.studentCohortDistribution.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE } },
      select: { entryYearBE: true, studentCount: true, ingestionRunId: true },
    });
    expect(row.entryYearBE).toBe(2567);
    expect(row.studentCount).toBe(120);
    expect(row.ingestionRunId).toBe(runId);
  });

  it('refuses a Buddhist-era year, naming BE', () => {
    const result = validate(studentCohortsDataset, [
      { 'Programme Code': PROGRAMME_CODE, 'Entry Year': 2567, 'Students Still Enrolled': 10 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.column).toBe('Entry Year');
    expect(result.errors[0]?.message).toMatch(/Buddhist/i);
  });

  it('allows every alumni status the Deep-Dive switch reads', () => {
    // program-deep-dive.ts:365 switches on these literals and sends anything
    // else to `other`. A bucket renamed in one place and not the other is a
    // cohort silently vanishing from the chart.
    const status = alumniCohortsDataset.columns.find((c) => c.key === 'statusBucket');
    expect(status?.enumValues).toEqual([
      'GRADUATED', 'RENOUNCED', 'NO_REPORT', 'DROPPED_FINANCIAL',
      'DROPPED_ACADEMIC', 'DROPPED_VOLUNTARY', 'TRANSFERRED', 'OTHER',
    ]);
  });

  it('refuses a status outside the list', () => {
    const result = validate(alumniCohortsDataset, [
      { 'Programme Code': PROGRAMME_CODE, 'Entry Year': 2024, Status: 'EXPELLED', Count: 3 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.column).toBe('Status');
  });

  it('keeps a second status for one cohort as a separate row', async () => {
    const result = await load(alumniCohortsDataset, [
      { programmeCode: PROGRAMME_CODE, entryYear: 2018, statusBucket: 'GRADUATED', count: 95 },
      { programmeCode: PROGRAMME_CODE, entryYear: 2018, statusBucket: 'TRANSFERRED', count: 4 },
    ], otherRunId);
    expect(result.inserted).toBe(2);

    expect(await prisma.alumniCohortStatus.count({
      where: { program: { code: PROGRAMME_CODE }, entryYearBE: 2561 },
    })).toBe(2);
  });

  it('are both visible through realDataWhere()', async () => {
    const cohorts = await prisma.studentCohortDistribution.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { entryYearBE: true },
    });
    const alumni = await prisma.alumniCohortStatus.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { entryYearBE: true },
    });
    expect(cohorts.map((r) => r.entryYearBE)).toContain(2567);
    expect(alumni.map((r) => r.entryYearBE)).toContain(2561);
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => studentCohortsDataset.clear(tx, [runId]));
    expect(deleted).toBe(1);
    // The alumni rows belong to the other run and survive.
    expect(await prisma.alumniCohortStatus.count({
      where: { program: { code: PROGRAMME_CODE } },
    })).toBe(2);
  });
});
