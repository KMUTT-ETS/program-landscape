import { prisma, realDataWhere, withCanonical } from '@kku/db';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ImportService } from '../src/import/import.service';
import { buildProgramDetailData } from '../src/programs/program-detail-data';

// The whole loop against the dev database: template → fill → upload → rows
// that are visible. Step 5 is the one that matters most — it is the assertion
// that the design's loudest anti-goal, an upload that reports success and
// renders nothing, cannot come back.

const service = new ImportService(undefined, {
  // Only object storage is stubbed; everything else is real.
  putObject: async () => undefined,
});

const FACULTY_CODE = 'E2E-ENG';
const DEPARTMENT_CODE = 'E2E-ENG-CIVIL';
const PROGRAMME_CODE = 'E2E-ENG-CIVIL-BE';

async function cleanup(): Promise<void> {
  await prisma.program.deleteMany({ where: { code: PROGRAMME_CODE } });
  await prisma.department.deleteMany({ where: { code: DEPARTMENT_CODE } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
  await prisma.importBatch.deleteMany({ where: { datasetSlug: { in: DATASETS } } });
  for (const slug of DATASETS.map((d) => `xlsx-${d}`)) {
    await prisma.ingestionRun.deleteMany({ where: { dataSource: { slug } } });
  }
}

const DATASETS = [
  'faculties',
  'departments',
  'programmes',
  'enrollment-metrics',
  'financial-metrics',
  'graduate-outcomes',
];

/** Fills a generated template's data sheet with the given rows. */
async function fillTemplate(
  datasetSlug: string,
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  const { bytes } = await service.getTemplate(datasetSlug, {});
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('template has no sheets');
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('template data sheet missing');

  const headers = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? []) as string[];
  const matrix: unknown[][] = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? null))];

  const filled = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(filled, XLSX.utils.aoa_to_sheet(matrix), sheetName);
  return XLSX.write(filled, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function upload(slug: string, bytes: Buffer, filename: string) {
  return service.uploadFile({
    datasetSlug: slug,
    originalFilename: filename,
    bytes,
    uploadedByUserId: null,
    allowShrink: true, // these fixtures are tiny beside a seeded database
  });
}

beforeAll(cleanup);
afterAll(cleanup);

describe('import, end to end', () => {
  it('loads a faculty from its own generated template', async () => {
    const bytes = await fillTemplate('faculties', [
      {
        'Faculty Code': FACULTY_CODE,
        'Name (Thai)': 'คณะวิศวกรรมศาสตร์ (ทดสอบ)',
        'Name (English)': 'Faculty of Engineering (test)',
        Kind: 'ACADEMIC',
      },
    ]);
    const result = await upload('faculties', bytes, 'faculties.xlsx');
    expect(result.inserted).toBe(1);
  });

  it('loads a department referencing that faculty', async () => {
    const bytes = await fillTemplate('departments', [
      {
        'Department Code': DEPARTMENT_CODE,
        'Name (Thai)': 'สาขาวิชาวิศวกรรมโยธา',
        'Name (English)': 'Civil Engineering',
        'Faculty Code': FACULTY_CODE,
      },
    ]);
    const result = await upload('departments', bytes, 'departments.xlsx');
    expect(result.inserted).toBe(1);
  });

  it('refuses a programme whose faculty code does not exist, naming it', async () => {
    const bytes = await fillTemplate('programmes', [
      {
        'Programme Code': 'E2E-ORPHAN',
        'Name (Thai)': 'x',
        'Name (English)': 'x',
        'Faculty Code': 'E2E-NO-SUCH-FACULTY',
        Level: 'BACHELOR',
      },
    ]);
    await expect(upload('programmes', bytes, 'programmes.xlsx')).rejects.toThrow(/E2E-NO-SUCH-FACULTY/);
  });

  it('loads a programme referencing both', async () => {
    const bytes = await fillTemplate('programmes', [
      {
        'Programme Code': PROGRAMME_CODE,
        'Name (Thai)': 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมโยธา',
        'Name (English)': 'B.Eng. Civil Engineering',
        'Faculty Code': FACULTY_CODE,
        'Department Code': DEPARTMENT_CODE,
        Level: 'BACHELOR',
        'Duration (years)': 4,
      },
    ]);
    const result = await upload('programmes', bytes, 'programmes.xlsx');
    expect(result.inserted).toBe(1);
  });

  it('makes the programme canonical, so Council surfaces list it', async () => {
    const found = await prisma.program.findMany({
      where: withCanonical({ code: PROGRAMME_CODE }),
      select: { code: true },
    });
    expect(found.map((p) => p.code)).toContain(PROGRAMME_CODE);
  });

  it('gives every imported row provenance from a non-mocked source', async () => {
    // The anti-goal: rows that load, report success, and are then discarded
    // by realDataWhere() because their source is missing or mocked.
    const programme = await prisma.program.findUniqueOrThrow({
      where: { code: PROGRAMME_CODE },
      select: { ingestionRun: { select: { status: true, dataSource: { select: { slug: true, mocked: true } } } } },
    });
    expect(programme.ingestionRun).not.toBeNull();
    expect(programme.ingestionRun?.dataSource.mocked).toBe(false);
    expect(programme.ingestionRun?.dataSource.slug).toBe('xlsx-programmes');
    expect(programme.ingestionRun?.status).toBe('SUCCEEDED');
  });

  it('updates rather than duplicates when the same code is re-uploaded', async () => {
    const bytes = await fillTemplate('programmes', [
      {
        'Programme Code': PROGRAMME_CODE,
        'Name (Thai)': 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมโยธา',
        'Name (English)': 'B.Eng. Civil Engineering (revised)',
        'Faculty Code': FACULTY_CODE,
        'Department Code': DEPARTMENT_CODE,
        Level: 'BACHELOR',
        'Duration (years)': 4,
      },
    ]);
    const result = await upload('programmes', bytes, 'programmes-v2.xlsx');

    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(await prisma.program.count({ where: { code: PROGRAMME_CODE } })).toBe(1);
    const row = await prisma.program.findUniqueOrThrow({
      where: { code: PROGRAMME_CODE },
      select: { nameEn: true },
    });
    expect(row.nameEn).toBe('B.Eng. Civil Engineering (revised)');
  });

  it('reports an identical re-upload as a duplicate and changes nothing', async () => {
    const bytes = await fillTemplate('faculties', [
      {
        'Faculty Code': FACULTY_CODE,
        'Name (Thai)': 'คณะวิศวกรรมศาสตร์ (ทดสอบ)',
        'Name (English)': 'Faculty of Engineering (test)',
        Kind: 'ACADEMIC',
      },
    ]);
    const result = await upload('faculties', bytes, 'faculties.xlsx');
    expect(result.deduplicated).toBe(true);
  });

  it('clears the programmes dataset and keeps the batch rows', async () => {
    const result = await service.startOver('programmes', 'Programmes', null);

    expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.program.findUnique({ where: { code: PROGRAMME_CODE } })).toBeNull();

    const batches = await prisma.importBatch.findMany({
      where: { datasetSlug: 'programmes' },
      select: { status: true, filename: true, storageKey: true },
    });
    expect(batches.length).toBeGreaterThan(0);
    // The files must stay nameable — that is what makes start-over recoverable.
    for (const b of batches) {
      expect(b.status).toBe('CLEARED');
      expect(b.filename).toBeTruthy();
      expect(b.storageKey).toBeTruthy();
    }
  });

  it('loads the identical file again after start-over', async () => {
    // Replay: dedupe ignores CLEARED batches, so the same bytes load again.
    const bytes = await fillTemplate('programmes', [
      {
        'Programme Code': PROGRAMME_CODE,
        'Name (Thai)': 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมโยธา',
        'Name (English)': 'B.Eng. Civil Engineering (revised)',
        'Faculty Code': FACULTY_CODE,
        'Department Code': DEPARTMENT_CODE,
        Level: 'BACHELOR',
        'Duration (years)': 4,
      },
    ]);
    const result = await upload('programmes', bytes, 'programmes-v2.xlsx');

    expect(result.deduplicated).toBe(false);
    expect(result.inserted).toBe(1);
    expect(await prisma.program.findUnique({ where: { code: PROGRAMME_CODE } })).not.toBeNull();
  });

  it('refuses to clear faculties while departments still hold rows', async () => {
    await expect(service.startOver('faculties', 'Faculties', null)).rejects.toThrow(/Departments/);
  });
});

// The tier-1 metrics run after the start-over block on purpose: once these
// rows exist, programmes can no longer be cleared, which is itself the last
// assertion here.
describe('the metrics an adopter actually came for', () => {
  it('loads an enrolment row against the imported programme', async () => {
    const bytes = await fillTemplate('enrollment-metrics', [
      {
        'Programme Code': PROGRAMME_CODE,
        'Academic Year': 2024,
        Applications: 480,
        Admitted: 160,
        Enrolled: 120,
        'Graduated on Time': 95,
      },
    ]);
    const result = await upload('enrollment-metrics', bytes, 'enrolment.xlsx');
    expect(result.inserted).toBe(1);

    const rows = await prisma.enrollmentMetric.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { enrolled: true },
    });
    expect(rows.map((r) => r.enrolled)).toEqual([120]);
  });

  it('loads a finance row against the imported programme', async () => {
    const bytes = await fillTemplate('financial-metrics', [
      {
        'Programme Code': PROGRAMME_CODE,
        'Academic Year': 2024,
        'Tuition Revenue (THB)': 4_800_000,
        'Other Revenue (THB)': 200_000,
      },
    ]);
    const result = await upload('financial-metrics', bytes, 'finance.xlsx');
    expect(result.inserted).toBe(1);

    const rows = await prisma.financialMetric.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { tuitionRevenue: true },
    });
    expect(rows.map((r) => Number(r.tuitionRevenue))).toEqual([4_800_000]);
  });

  it('loads a graduate outcomes row against the imported programme', async () => {
    const bytes = await fillTemplate('graduate-outcomes', [
      {
        'Programme Code': PROGRAMME_CODE,
        'Graduation Year': 2022,
        'Survey Year': 2023,
        'Employment Rate': 0.87,
        'Average Salary (THB/month)': 24_000,
        'Job Relevance Score': 0.8,
        'Further Study Rate': 0.1,
        'Sample Size': 40,
      },
    ]);
    const result = await upload('graduate-outcomes', bytes, 'outcomes.xlsx');
    expect(result.inserted).toBe(1);

    const rows = await prisma.graduateOutcome.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { employmentRate: true },
    });
    expect(rows.map((r) => r.employmentRate)).toEqual([0.87]);
  });

  it('refuses a percentage where the sheet asks for a proportion', async () => {
    // The mistake an adopter will actually make, and the one that would
    // otherwise render as 8700 % employment.
    const bytes = await fillTemplate('graduate-outcomes', [
      {
        'Programme Code': PROGRAMME_CODE,
        'Graduation Year': 2022,
        'Survey Year': 2024,
        'Employment Rate': 87,
        'Average Salary (THB/month)': 24_000,
        'Job Relevance Score': 0.8,
        'Further Study Rate': 0.1,
        'Sample Size': 40,
      },
    ]);
    await expect(upload('graduate-outcomes', bytes, 'outcomes-pct.xlsx')).rejects.toThrow(/0 and 1/);
  });

  it('shows the uploaded revenue on the Deep-Dive', async () => {
    // The assertion the whole phase exists for: not that rows landed, but
    // that the page an adopter bought this software for renders them.
    const programme = await prisma.program.findUniqueOrThrow({
      where: { code: PROGRAMME_CODE },
      select: { id: true },
    });
    const detail = await buildProgramDetailData(programme.id, 'full');

    const trend = detail?.financials?.trend ?? [];
    expect(trend.find((t) => t.year === 2024)?.tuition).toBe(4_800_000);
  });

  it('now refuses to clear programmes, naming what would be destroyed', async () => {
    // Every foreign key into programs cascades, so a start-over here would
    // take the three datasets above with it.
    await expect(service.startOver('programmes', 'Programmes', null)).rejects.toThrow(
      /enrolment figures|financial figures|graduate outcomes/,
    );
  });
});
