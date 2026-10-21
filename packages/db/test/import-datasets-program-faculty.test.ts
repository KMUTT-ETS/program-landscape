import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { programFacultyDataset } from '../src/import/datasets/program-faculty';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';

// Who teaches each programme.
//
// The link table the Deep-Dive is built on, and the one thing an adopting
// university had no route to: publications attach to a person, and a person
// reaches a programme only through here. Without it the Capability dimension
// reads null and an imported research roster contributes nothing.
//
// Keyed on (programme, person) because that is the unique index. A
// curriculum revision is an ATTRIBUTE of the link, never part of its
// identity — two revisions of one programme cannot both hold the same
// person twice.

const FACULTY_CODE = 'PF-ENG';
const PROG_CODE = 'PF-PROG-1';
const OTHER_PROG = 'PF-PROG-2';
const EMP_A = 'PF-EMP-A';
const EMP_B = 'PF-EMP-B';

let runId = '';
let otherRunId = '';
let programId = '';
let revisionId = '';

async function cleanup(): Promise<void> {
  await prisma.programFaculty.deleteMany({
    where: { program: { code: { in: [PROG_CODE, OTHER_PROG] } } },
  });
  await prisma.programRevision.deleteMany({
    where: { program: { code: { in: [PROG_CODE, OTHER_PROG] } } },
  });
  await prisma.program.deleteMany({ where: { code: { in: [PROG_CODE, OTHER_PROG] } } });
  await prisma.facultyMember.deleteMany({ where: { employeeCode: { in: [EMP_A, EMP_B] } } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

async function makeRun(): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug: 'xlsx-program-faculty' },
    update: { mocked: false },
    create: {
      slug: 'xlsx-program-faculty', name: 'programme staff test', kind: 'CSV',
      inputFormat: 'XLSX', mocked: false, scheduleEnabled: false, status: 'real',
    },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'SUCCEEDED', attempt: 1 },
    select: { id: true },
  });
  return run.id;
}

function load(rows: readonly ImportRow[], withRunId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: withRunId };
    return programFacultyDataset.load(ctx, rows);
  });
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    programmeCode: PROG_CODE,
    employeeCode: EMP_A,
    role: null,
    curriculumYear: null,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun();
  otherRunId = await makeRun();

  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
    select: { id: true },
  });
  // Negative sequence numbers are canonical but can never be the MAX the
  // programmes loader allocates from, so this suite cannot collide with it.
  const prog = await prisma.program.create({
    data: {
      code: PROG_CODE, nameTh: 'โปรแกรมทดสอบ', nameEn: 'Test Programme',
      facultyId: faculty.id, level: 'BACHELOR', status: 'ACTIVE',
      sequenceNoFromSheet: -9101,
    },
    select: { id: true },
  });
  programId = prog.id;
  await prisma.program.create({
    data: {
      code: OTHER_PROG, nameTh: 'โปรแกรมทดสอบ 2', nameEn: 'Test Programme 2',
      facultyId: faculty.id, level: 'MASTER', status: 'ACTIVE',
      sequenceNoFromSheet: -9102,
    },
  });
  const rev = await prisma.programRevision.create({
    data: { programId, curriculumYearBE: 2567, status: 'DRAFT' },
    select: { id: true },
  });
  revisionId = rev.id;

  for (const code of [EMP_A, EMP_B]) {
    await prisma.facultyMember.create({
      data: {
        employeeCode: code, nameTh: `อาจารย์ ${code}`, nameEn: `Lecturer ${code}`,
        facultyId: faculty.id, rank: 'LECTURER', isActive: true,
      },
    });
  }
});

afterAll(cleanup);

describe('programme teaching staff dataset', () => {
  it('is registered, so the admin screens list it', () => {
    expect(getImportDataset('program-faculty').slug).toBe('program-faculty');
  });

  it('keys on the programme and the person, matching the unique index', () => {
    expect(programFacultyDataset.strategy.match.columns).toEqual([
      'programmeCode',
      'employeeCode',
    ]);
  });

  it('links a staff member to a programme', async () => {
    const result = await load([row()], runId);
    expect(result.inserted).toBe(1);

    const link = await prisma.programFaculty.findFirstOrThrow({
      where: { programId, facultyMember: { employeeCode: EMP_A } },
      select: { role: true, ingestionRunId: true },
    });
    expect(link.role).toBe('CORE');
    expect(link.ingestionRunId).toBe(runId);
  });

  it('updates the role rather than duplicating the person', async () => {
    const result = await load([row({ role: 'COORDINATOR' })], otherRunId);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);

    const links = await prisma.programFaculty.findMany({
      where: { programId, facultyMember: { employeeCode: EMP_A } },
      select: { role: true },
    });
    expect(links).toHaveLength(1);
    expect(links[0]?.role).toBe('COORDINATOR');
  });

  it('lets one person teach on two programmes', async () => {
    const result = await load([row({ programmeCode: OTHER_PROG })], runId);
    expect(result.inserted).toBe(1);

    expect(
      await prisma.programFaculty.count({
        where: { facultyMember: { employeeCode: EMP_A } },
      }),
    ).toBe(2);
  });

  it('resolves the active revision when the year is blank', async () => {
    // Blank is the normal case: an adopter who has never run the curriculum
    // pipeline has no revisions at all, and must still be able to upload.
    await prisma.program.update({
      where: { id: programId },
      data: { activeRevisionId: revisionId },
    });
    await load([row({ employeeCode: EMP_B })], runId);

    const link = await prisma.programFaculty.findFirstOrThrow({
      where: { programId, facultyMember: { employeeCode: EMP_B } },
      select: { programRevisionId: true },
    });
    expect(link.programRevisionId).toBe(revisionId);
  });

  it('accepts a stated curriculum year in Common Era', async () => {
    // The sheet always asks CE; the stored revision is Buddhist era.
    await load([row({ employeeCode: EMP_B, curriculumYear: 2024 })], runId);

    const link = await prisma.programFaculty.findFirstOrThrow({
      where: { programId, facultyMember: { employeeCode: EMP_B } },
      select: { programRevisionId: true },
    });
    expect(link.programRevisionId).toBe(revisionId);
  });

  it('refuses a curriculum year this programme has no revision for', async () => {
    await expect(
      load([row({ employeeCode: EMP_B, curriculumYear: 1999 })], runId),
    ).rejects.toThrow(/1999/);
  });

  it('refuses an unknown programme code, naming it', async () => {
    await expect(load([row({ programmeCode: 'PF-NOPE' })], runId)).rejects.toThrow(
      /PF-NOPE/,
    );
  });

  it('refuses an unknown employee code, naming it', async () => {
    await expect(load([row({ employeeCode: 'PF-GHOST' })], runId)).rejects.toThrow(
      /PF-GHOST/,
    );
  });

  it('counts the rows it holds', async () => {
    expect(await programFacultyDataset.count(prisma)).toBeGreaterThan(0);
  });

  it('clears only rows its own runs created', async () => {
    const before = await prisma.programFaculty.count({ where: { programId } });
    expect(before).toBeGreaterThan(0);

    const deleted = await prisma.$transaction((tx) =>
      programFacultyDataset.clear(tx, [runId, otherRunId]),
    );
    expect(deleted).toBeGreaterThan(0);
    expect(
      await prisma.programFaculty.count({
        where: { program: { code: { in: [PROG_CODE, OTHER_PROG] } } },
      }),
    ).toBe(0);
  });
});
