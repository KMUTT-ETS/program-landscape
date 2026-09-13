import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { JOBTHAI_COLUMNS } from '@kku/shared/src/jobthai';

import { JobThaiService, type JobThaiServiceDeps } from '../src/jobthai/jobthai.service';

function sheetBuffer(headers: readonly string[], rows = 1): Buffer {
  const body = Array.from({ length: rows }, (_, i) => headers.map((h) => `${h}-${i}`));
  const ws = XLSX.utils.aoa_to_sheet([[...headers], ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function serviceWith(over: Partial<JobThaiServiceDeps> = {}) {
  const calls = { put: 0, created: [] as Record<string, unknown>[], enqueued: 0 };
  const deps: JobThaiServiceDeps = {
    findByHash: over.findByHash ?? (() => Promise.resolve(null)),
    createBatch:
      over.createBatch ??
      ((d) => {
        calls.created.push(d);
        return Promise.resolve({ id: 'b1' });
      }),
    putObject:
      over.putObject ??
      (() => {
        calls.put += 1;
        return Promise.resolve();
      }),
    enqueue:
      over.enqueue ??
      (() => {
        calls.enqueued += 1;
        return Promise.resolve();
      }),
  };
  return { svc: new JobThaiService(undefined, undefined, deps), calls };
}

describe('JobThaiService.ingestFile', () => {
  it('rejects a non-xlsx file by extension', async () => {
    const { svc } = serviceWith();
    await expect(
      svc.ingestFile({ originalFilename: 'jobs.csv', bytes: Buffer.from('a,b'), uploadedByUserId: null }),
    ).rejects.toThrow(/Unsupported file type/i);
  });

  it('rejects an empty file', async () => {
    const { svc } = serviceWith();
    await expect(
      svc.ingestFile({ originalFilename: 'jobs.xlsx', bytes: Buffer.alloc(1), uploadedByUserId: null }),
    ).rejects.toThrow(/empty/i);
  });

  it('rejects a sheet missing an expected column, naming it', async () => {
    const { svc } = serviceWith();
    const headers = JOBTHAI_COLUMNS.filter((c) => c !== 'Province');
    await expect(
      svc.ingestFile({ originalFilename: 'jobs.xlsx', bytes: sheetBuffer(headers), uploadedByUserId: null }),
    ).rejects.toThrow(/Province/);
  });

  it('validates headers BEFORE storing anything', async () => {
    const { svc, calls } = serviceWith();
    const headers = JOBTHAI_COLUMNS.filter((c) => c !== 'Province');
    await svc
      .ingestFile({ originalFilename: 'jobs.xlsx', bytes: sheetBuffer(headers), uploadedByUserId: null })
      .catch(() => undefined);
    // The operator is standing there; a bad file must not reach MinIO or the DB.
    expect(calls.put).toBe(0);
    expect(calls.created).toHaveLength(0);
    expect(calls.enqueued).toBe(0);
  });

  it('returns deduplicated:true for a byte-identical re-upload without writing', async () => {
    const { svc, calls } = serviceWith({ findByHash: () => Promise.resolve({ id: 'existing' }) });
    const res = await svc.ingestFile({
      originalFilename: 'jobs.xlsx',
      bytes: sheetBuffer(JOBTHAI_COLUMNS),
      uploadedByUserId: null,
    });
    expect(res.batchId).toBe('existing');
    expect(res.deduplicated).toBe(true);
    expect(calls.put).toBe(0);
    expect(calls.enqueued).toBe(0);
  });

  it('creates a PENDING batch, stores the file and enqueues a connector run', async () => {
    const { svc, calls } = serviceWith();
    const res = await svc.ingestFile({
      originalFilename: 'jobs.xlsx',
      bytes: sheetBuffer(JOBTHAI_COLUMNS, 3),
      uploadedByUserId: 'u1',
    });
    expect(res.deduplicated).toBe(false);
    expect(res.rowCount).toBe(3);
    expect(calls.put).toBe(1);
    expect(calls.created[0]).toMatchObject({ status: 'PENDING', uploadedByUserId: 'u1', rowCount: 3 });
    // Parsing is the CONNECTOR's job — one code path reads a sheet into
    // job_postings, and the run shows up in /admin/data-sources history.
    expect(calls.enqueued).toBe(1);
  });

  it('keys storage by content hash so the same bytes never store twice', async () => {
    const puts: string[] = [];
    const { svc } = serviceWith({
      putObject: (a) => {
        puts.push(a.key);
        return Promise.resolve();
      },
    });
    await svc.ingestFile({
      originalFilename: 'a.xlsx',
      bytes: sheetBuffer(JOBTHAI_COLUMNS),
      uploadedByUserId: null,
    });
    expect(puts[0]).toMatch(/^jobthai\/[0-9a-f]{64}\.xlsx$/);
  });
});
