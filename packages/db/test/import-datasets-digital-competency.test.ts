import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import {
  digitalCompetencyCohortsDataset,
  digitalCompetencyModulesDataset,
} from '../src/import/datasets/digital-competency';
import { getImportDataset } from '../src/import/registry';
import type { ImportDataset, ImportLoadContext, ImportRow } from '../src/import/types';
import { validateSheet, type ParsedSheet } from '../src/import/validate';
import { dqCompetencyByScope } from '../src/student-dq';
import { programDigitalCompetency } from '../src/program-deep-dive';
import { SCRATCH_DB, describeScratchDb } from './helpers/scratch-db';

// Digital competency: two programme-scoped datasets over the DQ cubes. The
// replace must touch only this dataset's own earlier uploads.

const FACULTY_CODE = 'DC-ENG';
const P1 = 'DC-PROG-1';
const P2 = 'DC-PROG-2';

let cohortRun = '';
let cohortRunB = '';
let moduleRun = '';
let dqRun = '';
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
  const programIds = progs.map((p) => p.id);
  await prisma.dqStudentCube.deleteMany({ where: { programId: { in: programIds } } });
  await prisma.dqModuleCube.deleteMany({ where: { programId: { in: programIds } } });
  await prisma.program.deleteMany({ where: { code: { in: [P1, P2] } } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

function load(dataset: ImportDataset, rows: readonly ImportRow[], runId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: runId };
    return dataset.load(ctx, rows);
  });
}

function validate(dataset: ImportDataset, rows: Record<string, unknown>[]) {
  const parsed: ParsedSheet = {
    sheetName: dataset.sheetName,
    headers: dataset.columns.map((c) => c.header),
    rows,
  };
  return validateSheet(dataset, parsed, {
    references: new Map([['programmes', new Set([P1, P2])]]),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

const cRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  'Programme Code': P1, 'Entry Year': 2022, 'Students Tested': 20,
  'Students With Scores': 18, 'Students Passing All Modules': 12, ...over,
});
const mRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  'Programme Code': P1, 'Entry Year': 2022, Module: 6, 'Students Taking': 18,
  'Mean Score (0–100)': 70, 'Students In Scope': 18, ...over,
});
const cImp = (programmeCode: string, entryYear: number, tested: number, scored: number, passed: number): ImportRow =>
  ({ programmeCode, entryYear, studentsTested: tested, studentsWithScores: scored, studentsAllPassed: passed }) as ImportRow;
const mImp = (programmeCode: string, entryYear: number, moduleNo: number, taking: number, mean: number, scope: number): ImportRow =>
  ({ programmeCode, entryYear, moduleNo, takenCount: taking, meanScore: mean, studentsInScope: scope }) as ImportRow;

beforeAll(async () => {
  if (!SCRATCH_DB) return;
  await cleanup();
  cohortRun = await makeRun('xlsx-digital-competency-cohorts');
  cohortRunB = await makeRun('xlsx-digital-competency-cohorts');
  moduleRun = await makeRun('xlsx-digital-competency-modules');
  dqRun = await makeRun('kku-dq');
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
    select: { id: true },
  });
  for (const [code, seq] of [[P1, -9401], [P2, -9402]] as const) {
    const p = await prisma.program.create({
      data: {
        code, nameTh: `โปรแกรม ${code}`, nameEn: code, facultyId: faculty.id,
        level: 'BACHELOR', status: 'ACTIVE', sequenceNoFromSheet: seq,
      },
      select: { id: true },
    });
    ids[code] = p.id;
  }
});

afterAll(async () => {
  if (!SCRATCH_DB) return;
  if (SCRATCH_DB) await cleanup();
});

describeScratchDb('digital competency datasets', () => {
  it('are registered', () => {
    expect(getImportDataset('digital-competency-cohorts').slug).toBe('digital-competency-cohorts');
    expect(getImportDataset('digital-competency-modules').slug).toBe('digital-competency-modules');
  });

  it('refuses passing above with-scores, and with-scores above tested', () => {
    expect(validate(digitalCompetencyCohortsDataset, [cRow({ 'Students Passing All Modules': 19 })]).ok).toBe(false);
    expect(validate(digitalCompetencyCohortsDataset, [cRow({ 'Students With Scores': 21 })]).ok).toBe(false);
    expect(validate(digitalCompetencyCohortsDataset, [cRow()]).ok).toBe(true);
  });

  it('refuses fewer than five tested, and a Buddhist-era year', () => {
    expect(validate(digitalCompetencyCohortsDataset, [cRow({ 'Students Tested': 4, 'Students With Scores': 3, 'Students Passing All Modules': 1 })]).ok).toBe(false);
    const r = validate(digitalCompetencyCohortsDataset, [cRow({ 'Entry Year': 2565 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.column).toBe('Entry Year');
  });

  it('refuses module 14 and a mean of 101', () => {
    expect(validate(digitalCompetencyModulesDataset, [mRow({ Module: 14 })]).ok).toBe(false);
    expect(validate(digitalCompetencyModulesDataset, [mRow({ Module: 0 })]).ok).toBe(false);
    const r = validate(digitalCompetencyModulesDataset, [mRow({ 'Mean Score (0–100)': 101 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toMatch(/0 and 100/);
    expect(validate(digitalCompetencyModulesDataset, [mRow()]).ok).toBe(true);
  });

  it('refuses in-scope below taking', () => {
    expect(validate(digitalCompetencyModulesDataset, [mRow({ 'Students In Scope': 10 })]).ok).toBe(false);
  });

  it('cohorts load derives names and converts the year', async () => {
    const result = await load(digitalCompetencyCohortsDataset, [cImp(P1, 2022, 20, 18, 12)], cohortRun);
    expect(result.inserted).toBe(1);
    const stored = await prisma.dqStudentCube.findFirstOrThrow({ where: { programId: ids[P1] } });
    expect(stored.cohortYearBe).toBe(2565);
    expect(stored.facultyName).toBe('วิศวกรรมศาสตร์');
    expect(stored.programName).toBe(`โปรแกรม ${P1}`);
    expect(stored.facultyId).not.toBeNull();
    expect(stored.ingestionRunId).toBe(cohortRun);
  });

  it('modules load stores scoreSum = mean × taking and the module kind', async () => {
    await load(digitalCompetencyModulesDataset, [mImp(P1, 2022, 6, 18, 70, 18)], moduleRun);
    const stored = await prisma.dqModuleCube.findFirstOrThrow({ where: { programId: ids[P1] } });
    expect(stored.moduleKey).toBe('THEORY_MODULE_6');
    expect(stored.moduleKind).toBe('THEORY');
    expect(stored.scoreSum).toBeCloseTo(1260);
    expect(stored.takenCount).toBe(18);
  });

  it('programme-scoped replace leaves other programmes and kku-dq rows alone', async () => {
    // A KKU connector row for P1, and an imported row for P2.
    await prisma.dqStudentCube.create({
      data: {
        facultyName: 'x', programId: ids[P1], studentsTested: 9, studentsWithScores: 9,
        studentsAllPassed: 5, cohortYearBe: 2560, ingestionRunId: dqRun,
      },
    });
    await load(digitalCompetencyCohortsDataset, [cImp(P2, 2022, 20, 18, 12)], cohortRun);

    // Re-upload P1 from a second run: only P1's imported row is replaced.
    const result = await load(digitalCompetencyCohortsDataset, [cImp(P1, 2023, 30, 25, 20)], cohortRunB);
    expect(result.deleted).toBe(1);
    const p1 = await prisma.dqStudentCube.findMany({ where: { programId: ids[P1] }, orderBy: { cohortYearBe: 'asc' } });
    expect(p1.map((r) => r.cohortYearBe)).toEqual([2560, 2566]);
    expect(p1[0]!.ingestionRunId).toBe(dqRun);
    expect(await prisma.dqStudentCube.count({ where: { programId: ids[P2] } })).toBe(1);
  });

  it('clear only removes the given runs', async () => {
    const deleted = await prisma.$transaction((tx) => digitalCompetencyCohortsDataset.clear(tx, [cohortRun]));
    expect(deleted).toBe(1); // P2's row; P1's current row is from run B
    expect(await prisma.dqStudentCube.count({ where: { programId: ids[P1] } })).toBe(2);
  });

  it('latestDqRun sees the import (dashboard refreshedAt)', async () => {
    const { dqOverview } = await import('../src/student-dq');
    const overview = await dqOverview();
    expect(overview.refreshedAt).not.toBeNull();
  });

  it('dq competency reads imported cubes, with the 6-student floor', async () => {
    // P1 now has kku-dq (9) + imported (25) scored; use P2 for a clean read.
    await load(digitalCompetencyCohortsDataset, [cImp(P2, 2022, 5, 5, 3)], cohortRun);
    await prisma.dqStudentCube.deleteMany({ where: { programId: ids[P2], ingestionRunId: { not: cohortRun } } });
    const thin = await dqCompetencyByScope({ scope: 'program', scopeId: ids[P2]! });
    expect(thin.scoredStudents).toBe(5);
    expect(thin.rawMean).toBeNull();

    await load(digitalCompetencyCohortsDataset, [cImp(P2, 2022, 10, 8, 5)], cohortRunB);
    await load(digitalCompetencyModulesDataset, [mImp(P2, 2022, 6, 8, 70, 8)], moduleRun);
    const ok = await dqCompetencyByScope({ scope: 'program', scopeId: ids[P2]! });
    expect(ok.scoredStudents).toBe(8);
    expect(ok.rawMean).toBeCloseTo(70);

    const detail = await programDigitalCompetency(ids[P2]!);
    expect(detail.status).toBe('ok');
    expect(detail.passRatePct).toBeCloseTo(62.5);
  });
});
