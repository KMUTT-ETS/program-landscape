import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { realDataWhere } from '../src/data-quality';
import { enrollmentDataset } from '../src/import/datasets/enrollment';
import { getImportDataset } from '../src/import/registry';
import type { ImportDataset, ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

const FACULTY_CODE = 'ENR-ENG';
const PROGRAMME_CODE = 'ENR-CIV-BE';
const NON_CANONICAL_CODE = 'ENR-LEGACY';

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.enrollmentMetric.deleteMany({
    where: { program: { code: { in: [PROGRAMME_CODE, NON_CANONICAL_CODE] } } },
  });
  await prisma.program.deleteMany({ where: { code: { in: [PROGRAMME_CODE, NON_CANONICAL_CODE] } } });
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

/** Runs the dataset's own validation over a sheet, as the service does. */
function validate(
  rows: Record<string, unknown>[],
  references = new Map([['programmes', new Set([PROGRAMME_CODE, NON_CANONICAL_CODE])]]),
) {
  const headers = enrollmentDataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: enrollmentDataset.sheetName, headers, rows };
  return validateSheet(enrollmentDataset, parsed, {
    references,
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function sheetRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Programme Code': PROGRAMME_CODE,
    'Academic Year': 2024,
    Applications: null, Admitted: null, Enrolled: null,
    'Retained to Year 2': null, 'Graduated on Time': null,
    'Graduated Late': null, Dropouts: null,
    ...over,
  };
}

function errorsOf(result: ReturnType<typeof validate>) {
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-enrollment-metrics');
  otherRunId = await makeRun('xlsx-enrollment-metrics');

  // Fixtures are written directly rather than through the tier-0 loaders.
  // The programmes loader numbers an insert MAX(sequence_no_from_sheet) + 1,
  // so calling it here would race its own suite running in a sibling worker
  // — both read the same max and the second insert hits the unique index.
  // A negative number is canonical (the predicate is only IS NOT NULL) and
  // can never be that max, so this suite cannot perturb the other.
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
  await prisma.program.create({
    data: {
      code: PROGRAMME_CODE, nameTh: 'โยธา', nameEn: 'Civil',
      facultyId: faculty.id, level: 'BACHELOR', sequenceNoFromSheet: -8201,
    },
  });
  // A programme with no sequence number — created by an older path, and
  // invisible to Council surfaces however good its figures are. Review Focus 4.
  await prisma.program.create({
    data: {
      code: NON_CANONICAL_CODE, nameTh: 'เก่า', nameEn: 'Legacy',
      facultyId: faculty.id, level: 'BACHELOR',
    },
  });
});

afterAll(cleanup);

describe('enrolment dataset', () => {
  it('is registered under the slug the raw view already uses', () => {
    expect(getImportDataset('enrollment-metrics').slug).toBe('enrollment-metrics');
  });

  it('inserts a row, stamping the run and defaulting blanks to zero', async () => {
    const result = await load(enrollmentDataset, [{
      programmeCode: PROGRAMME_CODE, academicYear: 2024,
      applications: 500, admitted: 200, enrolled: 150,
      retainedYear2: null, graduatedOnTime: null, graduatedLate: null, dropouts: null,
    }], runId);

    expect(result.inserted).toBe(1);
    const row = await prisma.enrollmentMetric.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE }, academicYear: 2024 },
      select: {
        applications: true, admitted: true, enrolled: true,
        retainedYear2: true, graduatedOnTime: true, ingestionRunId: true,
      },
    });
    expect(row.enrolled).toBe(150);
    expect(row.retainedYear2).toBe(0);
    expect(row.ingestionRunId).toBe(runId);
  });

  it('is visible through realDataWhere()', async () => {
    // The whole point of the phase: a row the Deep-Dive will actually read.
    const found = await prisma.enrollmentMetric.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { academicYear: true },
    });
    expect(found.map((r) => r.academicYear)).toContain(2024);
  });

  it('updates an existing programme-year without duplicating it', async () => {
    const result = await load(enrollmentDataset, [{
      programmeCode: PROGRAMME_CODE, academicYear: 2024,
      applications: 600, admitted: null, enrolled: null,
      retainedYear2: null, graduatedOnTime: null, graduatedLate: null, dropouts: null,
    }], otherRunId);

    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(await prisma.enrollmentMetric.count({
      where: { program: { code: PROGRAMME_CODE }, academicYear: 2024 },
    })).toBe(1);
  });

  it('leaves a stored value alone when the cell is blank on update', async () => {
    // D4. An adopter with only application counts must not zero the
    // enrolment figures another source supplied.
    const row = await prisma.enrollmentMetric.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE }, academicYear: 2024 },
      select: { applications: true, enrolled: true },
    });
    expect(row.applications).toBe(600);
    expect(row.enrolled).toBe(150);
  });

  it('refuses a Buddhist-era year, naming BE', () => {
    const e = errorsOf(validate([sheetRow({ 'Academic Year': 2568 })]))[0];
    expect(e.column).toBe('Academic Year');
    expect(e.message).toMatch(/Buddhist/i);
  });

  it('refuses admitted above applications, naming both', () => {
    const e = errorsOf(validate([sheetRow({ Applications: 100, Admitted: 200 })]))[0];
    expect(e.message).toMatch(/Admitted/);
    expect(e.message).toMatch(/Applications/);
  });

  it('refuses enrolled above admitted', () => {
    const e = errorsOf(validate([sheetRow({ Admitted: 100, Enrolled: 200 })]))[0];
    expect(e.message).toMatch(/Enrolled/);
  });

  it('accepts a row whose contradicting cell is blank', () => {
    const result = validate([sheetRow({ Applications: null, Admitted: 200 })]);
    expect(result.ok).toBe(true);
  });

  it('refuses a row with a programme and a year but no figures', () => {
    // The template is not pre-filled, so such a row was typed by hand and
    // abandoned. Accepting it would store seven zeros.
    const e = errorsOf(validate([sheetRow()]))[0];
    expect(e.column).toBeNull();
    expect(e.message).toMatch(/no figures/i);
  });

  it('accepts a row whose only figure is a typed zero', () => {
    // A 0 is a figure; only a blank is the absence of one.
    expect(validate([sheetRow({ Dropouts: 0 })]).ok).toBe(true);
  });

  it('accepts a programme that exists but is not canonical', async () => {
    // It loads, and is then invisible on Council surfaces for a reason the
    // operator cannot see from here — so the guide says so.
    const result = await load(enrollmentDataset, [{
      programmeCode: NON_CANONICAL_CODE, academicYear: 2024,
      applications: null, admitted: null, enrolled: 10,
      retainedYear2: null, graduatedOnTime: null, graduatedLate: null, dropouts: null,
    }], runId);
    expect(result.inserted).toBe(1);

    const codeColumn = enrollmentDataset.columns.find((c) => c.key === 'programmeCode');
    expect(codeColumn?.guide).toMatch(/canonical|Council/i);
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => enrollmentDataset.clear(tx, [runId]));
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.enrollmentMetric.count({
      where: { program: { code: NON_CANONICAL_CODE } },
    })).toBe(0);
  });
});
