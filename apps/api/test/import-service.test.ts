import { getImportDataset, type ImportDataset, type ImportRow } from '@kku/db';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportService, type ImportServiceDeps } from '../src/import/import.service';

// A programme-scoped fixture: no shipped dataset uses the strategy yet, so
// the lookup is widened for one slug only.
const SCOPED_SLUG = 'fixture-scoped';
vi.mock('@kku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kku/db')>();
  return {
    ...actual,
    getImportDataset: (slug: string) =>
      slug === 'fixture-scoped'
        ? ({
            slug,
            title: 'Fixture',
            description: '',
            tier: 1,
            sheetName: 'Scoped',
            columns: [
              { header: 'Programme Code', key: 'programmeCode', type: 'text', required: true, guide: 'g', example: 'P1' },
              { header: 'Course Code', key: 'courseCode', type: 'text', required: true, guide: 'g', example: 'C1' },
            ],
            strategy: {
              kind: 'programme-scoped',
              scopeColumns: ['programmeCode'],
              match: { kind: 'manual', columns: ['programmeCode', 'courseCode'] },
            },
            load: async () => ({ inserted: 0, updated: 0, deleted: 0 }),
            count: async () => 0,
            clear: async () => 0,
          } satisfies ImportDataset)
        : actual.getImportDataset(slug),
  };
});

// No database and no MinIO: every collaborator is injected.

const faculties = getImportDataset('faculties');

function workbook(rows: unknown[][], sheetName = faculties.sheetName): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const HEADERS = faculties.columns.map((c) => c.header);
const VALID_ROWS = [HEADERS, ['ENG', 'วิศวกรรมศาสตร์', 'Engineering', 'ACADEMIC']];

interface Harness {
  service: ImportService;
  calls: string[];
  deps: { [K in keyof ImportServiceDeps]: ReturnType<typeof vi.fn> };
}

function harness(overrides: Partial<ImportServiceDeps> = {}): Harness {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) => vi.fn((...args: unknown[]) => {
    calls.push(name);
    const override = (overrides as Record<string, unknown>)[name];
    if (typeof override === 'function') return (override as (...a: unknown[]) => unknown)(...args);
    return value;
  });

  const deps = {
    findLiveBatchByHash: track('findLiveBatchByHash', Promise.resolve(null)),
    putObject: track('putObject', Promise.resolve(undefined)),
    loadReferences: track('loadReferences', Promise.resolve(new Map())),
    heldCount: track('heldCount', Promise.resolve(0)),
    heldCountForTerm: track('heldCountForTerm', Promise.resolve(undefined)),
    heldCountForScope: track('heldCountForScope', Promise.resolve(undefined)),
    runLoad: track('runLoad', Promise.resolve({ batchId: 'batch-1', result: { inserted: 1, updated: 0, deleted: 0 } })),
    startOver: track('startOver', Promise.resolve({ rowsDeleted: 3, batchesCleared: 1 })),
    prefill: track('prefill', Promise.resolve([] as ImportRow[])),
  };

  const service = new ImportService(undefined, deps as unknown as Partial<ImportServiceDeps>);
  return { service, calls, deps };
}

function upload(h: Harness, bytes: Buffer, filename = 'faculties.xlsx', allowShrink = false) {
  return h.service.uploadFile({
    datasetSlug: 'faculties',
    originalFilename: filename,
    bytes,
    uploadedByUserId: 'user-1',
    allowShrink,
  });
}

describe('ImportService.uploadFile — refusals', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('rejects a non-xlsx extension, naming it', async () => {
    await expect(upload(h, workbook(VALID_ROWS), 'data.csv')).rejects.toThrow(/\.csv/);
  });

  it('rejects an empty file', async () => {
    await expect(upload(h, Buffer.alloc(0))).rejects.toThrow(/empty/i);
  });

  it('rejects a file over the size limit', async () => {
    await expect(upload(h, Buffer.alloc(26 * 1024 * 1024))).rejects.toThrow(/MB limit/);
  });

  it('rejects a workbook with no matching sheet, naming what it found', async () => {
    await expect(upload(h, workbook(VALID_ROWS, 'Sheet1'))).rejects.toThrow(/Faculties/);
  });

  it('stores nothing when validation fails', async () => {
    const bad = workbook([HEADERS, [null, 'x', 'y', null]]);
    await expect(upload(h, bad)).rejects.toThrow();
    expect(h.deps.putObject).not.toHaveBeenCalled();
    expect(h.deps.runLoad).not.toHaveBeenCalled();
  });

  it('carries the structured error list on the thrown error', async () => {
    const bad = workbook([HEADERS, [null, 'x', 'y', null]]);
    try {
      await upload(h, bad);
      expect.unreachable('should have thrown');
    } catch (e) {
      const details = (e as { details?: { errors?: unknown[]; totalErrors?: number } }).details;
      expect(details?.errors?.length).toBeGreaterThan(0);
      expect(details?.totalErrors).toBeGreaterThan(0);
    }
  });

  it('refuses an unknown dataset slug', async () => {
    await expect(
      h.service.uploadFile({
        datasetSlug: 'not-a-dataset', originalFilename: 'x.xlsx',
        bytes: workbook(VALID_ROWS), uploadedByUserId: null, allowShrink: false,
      }),
    ).rejects.toThrow(/not-a-dataset/);
  });
});

describe('ImportService.uploadFile — success path', () => {
  it('puts the object, then loads, in that order', async () => {
    const h = harness();
    const result = await upload(h, workbook(VALID_ROWS));

    expect(result.deduplicated).toBe(false);
    expect(result.rowCount).toBe(1);
    expect(result.inserted).toBe(1);
    expect(h.calls.indexOf('putObject')).toBeLessThan(h.calls.indexOf('runLoad'));
  });

  it('keys the stored object by dataset and content hash', async () => {
    const h = harness();
    await upload(h, workbook(VALID_ROWS));
    const arg = h.deps.putObject.mock.calls[0]?.[0] as { key: string };
    expect(arg.key).toMatch(/^imports\/faculties\/[0-9a-f]{64}\.xlsx$/);
  });

  it('returns the existing batch for a duplicate live hash without loading', async () => {
    const h = harness({
      findLiveBatchByHash: () => Promise.resolve({ id: 'existing-batch', rowCount: 9 }),
    });
    const result = await upload(h, workbook(VALID_ROWS));

    expect(result).toMatchObject({ batchId: 'existing-batch', deduplicated: true, rowCount: 9 });
    expect(h.deps.runLoad).not.toHaveBeenCalled();
    expect(h.deps.putObject).not.toHaveBeenCalled();
  });

  it('loads normally when the hash matches only a cleared batch', async () => {
    // findLiveBatchByHash returns null for CLEARED rows, so this is the
    // replay path after a start-over.
    const h = harness({ findLiveBatchByHash: () => Promise.resolve(null) });
    const result = await upload(h, workbook(VALID_ROWS));
    expect(result.deduplicated).toBe(false);
    expect(h.deps.runLoad).toHaveBeenCalled();
  });

  it('refuses a shrinking file, and accepts it when shrinking is allowed', async () => {
    const shrinking = harness({ heldCount: () => Promise.resolve(100) });
    await expect(upload(shrinking, workbook(VALID_ROWS))).rejects.toThrow(/100/);

    const allowed = harness({ heldCount: () => Promise.resolve(100) });
    await expect(upload(allowed, workbook(VALID_ROWS), 'faculties.xlsx', true)).resolves.toBeDefined();
  });

  it('propagates a load failure', async () => {
    const h = harness({ runLoad: () => Promise.reject(new Error('constraint violated')) });
    await expect(upload(h, workbook(VALID_ROWS))).rejects.toThrow(/constraint violated/);
  });
});

describe('ImportService.getTemplate', () => {
  it('returns the declared filename and bytes that parse back', async () => {
    const h = harness();
    const { filename, bytes } = await h.service.getTemplate('faculties', {});
    expect(filename).toMatch(/^faculties-template-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(XLSX.read(bytes, { type: 'buffer' }).SheetNames).toEqual([faculties.sheetName, 'Guide']);
  });

  it('passes the year window through to prefill', async () => {
    const h = harness();
    await h.service.getTemplate('faculties', { fromYear: 2020, toYear: 2025 });
    expect(h.deps.prefill).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'faculties' }) as ImportDataset,
      { fromYear: 2020, toYear: 2025 },
    );
  });
});

describe('ImportService.startOver', () => {
  it('refuses a confirmation name that does not match', async () => {
    const h = harness();
    await expect(h.service.startOver('faculties', 'faculties', 'user-1')).rejects.toThrow(/Faculties/);
    expect(h.deps.startOver).not.toHaveBeenCalled();
  });

  it('proceeds when the name matches exactly, ignoring surrounding spaces', async () => {
    const h = harness();
    const result = await h.service.startOver('faculties', '  Faculties  ', 'user-1');
    expect(result).toEqual({ rowsDeleted: 3, batchesCleared: 1 });
    expect(h.deps.startOver).toHaveBeenCalledWith('faculties');
  });
});

describe('a term-scoped upload', () => {
  // The term is established by validation — it refuses a file whose rows
  // disagree, and one that states no term at all — and the loader DELETES
  // that term before inserting. So it has to reach the loader; without it
  // the only destructive write in the importer has nothing to go on.
  const classes = getImportDataset('class-offerings');
  const CLASS_HEADERS = classes.columns.map((c) => c.header);

  function classRow(semester: number, section: number): unknown[] {
    return CLASS_HEADERS.map((h) => {
      if (h === 'Academic Year') return 2024;
      if (h === 'Semester') return semester;
      if (h === 'Faculty Code') return 'ENG';
      if (h === 'Course Code') return 'EN101';
      if (h === 'Section') return section;
      if (h === 'Enrolled') return 40;
      if (h === 'Total Seats') return 50;
      return null;
    });
  }

  const withFaculty = {
    loadReferences: () => Promise.resolve(new Map([['faculties', new Set(['ENG'])]])),
  };

  it('hands the loader the term the file declares', async () => {
    const h = harness(withFaculty);
    await h.service.uploadFile({
      datasetSlug: 'class-offerings',
      originalFilename: 'classes.xlsx',
      bytes: workbook([CLASS_HEADERS, classRow(2, 1)], classes.sheetName),
      uploadedByUserId: null,
      allowShrink: true,
    });

    expect(h.deps.runLoad).toHaveBeenCalled();
    const term = h.deps.runLoad.mock.calls[0]?.[4];
    expect(term).toEqual({ academicYear: 2024, semester: 2 });
  });

  it('refuses a file whose rows disagree about the term', async () => {
    const h = harness(withFaculty);
    await expect(h.service.uploadFile({
      datasetSlug: 'class-offerings',
      originalFilename: 'classes.xlsx',
      bytes: workbook([CLASS_HEADERS, classRow(1, 1), classRow(2, 2)], classes.sheetName),
      uploadedByUserId: null,
      allowShrink: true,
    })).rejects.toThrow();
    expect(h.deps.runLoad).not.toHaveBeenCalled();
  });
});

describe('a programme-scoped upload', () => {
  it('passes the scope count to validation for a programme-scoped dataset', async () => {
    const h = harness({
      heldCount: () => Promise.resolve(11_000),
      heldCountForScope: () => Promise.resolve(4),
    });
    await h.service.uploadFile({
      datasetSlug: SCOPED_SLUG,
      originalFilename: 'courses.xlsx',
      bytes: workbook(
        [['Programme Code', 'Course Code'], ['P1', 'C1'], ['P1', 'C2'], ['P2', 'C1']],
        'Scoped',
      ),
      uploadedByUserId: null,
      allowShrink: false,
    });
    expect(h.deps.heldCountForScope).toHaveBeenCalledWith(
      expect.objectContaining({ slug: SCOPED_SLUG }),
      [{ programmeCode: 'P1' }, { programmeCode: 'P2' }],
    );
    expect(h.deps.runLoad).toHaveBeenCalled();
  });
});
