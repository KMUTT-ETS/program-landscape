import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';

// Talks to the dev database, as the other packages/db suites do.

const HASH_A = 'schema-test-hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'schema-test-hash-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const created: string[] = [];

async function makeBatch(datasetSlug: string, contentHash: string): Promise<string> {
  const batch = await prisma.importBatch.create({
    data: {
      datasetSlug,
      filename: 'fixture.xlsx',
      contentHash,
      storageKey: `imports/${datasetSlug}/${contentHash}.xlsx`,
      fileSize: 1024,
      rowCount: 3,
      status: 'SUCCEEDED',
    },
    select: { id: true },
  });
  created.push(batch.id);
  return batch.id;
}

afterAll(async () => {
  await prisma.importBatch.deleteMany({ where: { id: { in: created } } });
});

describe('ImportBatch schema', () => {
  it('creates a batch and marks it cleared without deleting it', async () => {
    const id = await makeBatch('faculties', HASH_A);
    const cleared = await prisma.importBatch.update({
      where: { id },
      data: { status: 'CLEARED', clearedAt: new Date() },
      select: { status: true, clearedAt: true, filename: true },
    });
    // The row survives start-over precisely so the stored file stays nameable.
    expect(cleared.status).toBe('CLEARED');
    expect(cleared.clearedAt).toBeInstanceOf(Date);
    expect(cleared.filename).toBe('fixture.xlsx');
  });

  it('rejects a duplicate content hash within one dataset', async () => {
    await expect(makeBatch('faculties', HASH_A)).rejects.toThrow();
  });

  it('allows the same content hash under a different dataset', async () => {
    const id = await makeBatch('departments', HASH_A);
    expect(id).toBeTruthy();
  });

  it('defaults a new batch to PENDING with no rows', async () => {
    const batch = await prisma.importBatch.create({
      data: {
        datasetSlug: 'programmes',
        filename: 'pending.xlsx',
        contentHash: HASH_B,
        storageKey: 'imports/programmes/pending.xlsx',
        fileSize: 10,
      },
      select: { id: true, status: true, rowCount: true, clearedAt: true },
    });
    created.push(batch.id);
    expect(batch.status).toBe('PENDING');
    expect(batch.rowCount).toBe(0);
    expect(batch.clearedAt).toBeNull();
  });
});

describe('provenance columns', () => {
  it('exposes a nullable ingestionRunId on the four org-backbone tables', async () => {
    // Selecting the column is the assertion: a missing column throws.
    const faculty = await prisma.faculty.findFirst({ select: { id: true, ingestionRunId: true } });
    const department = await prisma.department.findFirst({ select: { id: true, ingestionRunId: true } });
    const program = await prisma.program.findFirst({ select: { id: true, ingestionRunId: true } });
    const member = await prisma.facultyMember.findFirst({ select: { id: true, ingestionRunId: true } });

    for (const row of [faculty, department, program, member]) {
      if (row) expect(row.ingestionRunId === null || typeof row.ingestionRunId === 'string').toBe(true);
    }
  });

  it('keeps the column optional, so connectors and seeds need no change', async () => {
    // The property the migration must preserve is that a row can still be
    // written with no provenance at all. Counting stamped rows globally
    // would be a claim about the whole database that any other suite
    // creating an imported row legitimately invalidates.
    const row = await prisma.faculty.create({
      data: { code: 'SCHEMA-TEST-UNSTAMPED', nameTh: 'x', nameEn: 'x' },
      select: { id: true, ingestionRunId: true },
    });
    expect(row.ingestionRunId).toBeNull();
    await prisma.faculty.delete({ where: { id: row.id } });
  });
});
