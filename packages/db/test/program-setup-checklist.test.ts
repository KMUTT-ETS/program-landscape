import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { CHECKLIST_SOURCES, programSetupChecklist } from '../src/program-setup-checklist';
import { DIMENSION_DRIVERS } from '../src/health-score';
import { IMPORT_DATASETS } from '../src/import/registry';
import { SOURCE_CATALOG } from '@kku/shared';
import { SCRATCH_DB, describeScratchDb } from './helpers/scratch-db';

const FACULTY_CODE = 'SC-FAC';
const CODES = { bach: 'SC-BACH', grad: 'SC-GRAD' } as const;
const ids: Record<string, string> = {};

async function makeRun(slug: string, mocked: boolean): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug },
    update: { mocked },
    create: { slug, name: `${slug} test`, kind: 'CSV', inputFormat: 'XLSX', mocked, scheduleEnabled: false, status: mocked ? 'mocked' : 'real' },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'SUCCEEDED', attempt: 1 },
    select: { id: true },
  });
  return run.id;
}

async function cleanup(): Promise<void> {
  const progs = await prisma.program.findMany({ where: { code: { in: Object.values(CODES) } }, select: { id: true } });
  const pid = progs.map((p) => p.id);
  await prisma.studentCohortDistribution.deleteMany({ where: { programId: { in: pid } } });
  await prisma.financialMetric.deleteMany({ where: { programId: { in: pid } } });
  await prisma.program.deleteMany({ where: { code: { in: Object.values(CODES) } } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

beforeAll(async () => {
  if (!SCRATCH_DB) return;
  await cleanup();
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'คณะทดสอบ', nameEn: 'Test faculty' },
    select: { id: true },
  });
  let seq = -9601;
  for (const [name, code] of Object.entries(CODES)) {
    const p = await prisma.program.create({
      data: {
        code, nameTh: `โปรแกรม ${code}`, nameEn: code, facultyId: faculty.id,
        level: name === 'bach' ? 'BACHELOR' : 'MASTER', status: 'ACTIVE', sequenceNoFromSheet: seq--,
      },
      select: { id: true },
    });
    ids[name] = p.id;
  }
});

afterAll(async () => {
  if (SCRATCH_DB) await cleanup();
});

const byKey = (items: { key: string }[], key: string) => items.find((i) => i.key === key)!;

describeScratchDb('programSetupChecklist', () => {
  it('returns null for an unknown programme', async () => {
    expect(await programSetupChecklist('no-such-programme')).toBeNull();
  });

  it('empty programme: nothing ok, every empty item says what it is waiting on', async () => {
    const c = (await programSetupChecklist(ids.bach!))!;
    expect(c.programCode).toBe(CODES.bach);
    expect(c.summary.ok).toBe(0);
    for (const item of c.items) {
      expect(['empty', 'not-applicable', 'degraded']).toContain(item.status);
      if (item.status === 'empty') expect(item.waitingOn.length).toBeGreaterThan(0);
      for (const w of item.waitingOn) expect(w.href).not.toContain('{programId}');
    }
    expect(c.summary.ok + c.summary.empty + c.summary.notApplicable + c.summary.degraded).toBe(c.items.length);
  });

  it('has an item for every health driver and a source entry for each', async () => {
    const c = (await programSetupChecklist(ids.bach!))!;
    for (const labels of Object.values(DIMENSION_DRIVERS)) {
      for (const label of labels) {
        expect(byKey(c.items, `driver.${label}`)).toBeDefined();
        expect(CHECKLIST_SOURCES[`driver.${label}`]?.length).toBeGreaterThan(0);
      }
    }
  });

  it('postgraduate: TCAS and digital competency are not applicable', async () => {
    const c = (await programSetupChecklist(ids.grad!))!;
    expect(byKey(c.items, 'section.tcas').status).toBe('not-applicable');
    expect(byKey(c.items, 'section.digital-competency').status).toBe('not-applicable');
    expect(byKey(c.items, 'section.tcas').status).not.toBe('empty');
    for (const label of ['tcas_competition_ratio', 'tcas_fill_rate', 'tcas_registration_yield', 'tcas_competition_vs_peers', 'tcas_min_score_percentile']) {
      const item = byKey(c.items, `driver.${label}`);
      expect(item.status).toBe('not-applicable');
      expect(item.note).toBe('TCAS covers bachelor programmes only.');
      expect(item.waitingOn).toEqual([]);
    }
  });

  it('imported rows (xlsx run) turn cohorts and financials ok', async () => {
    const run = await makeRun('xlsx-student-cohorts', false);
    await prisma.studentCohortDistribution.create({
      data: { programId: ids.bach!, entryYearBE: 2566, studentCount: 40, ingestionRunId: run },
    });
    await prisma.financialMetric.create({
      data: {
        programId: ids.bach!, fiscalYear: 2024, tuitionRevenue: 1000, otherRevenue: 0, directCost: 0,
        allocatedFacultyCost: 0, allocatedFacilityCost: 0, allocatedOverhead: 0, netContribution: 1000,
        freshnessDate: new Date('2025-01-01'), ingestionRunId: run,
      },
    });
    const c = (await programSetupChecklist(ids.bach!))!;
    expect(byKey(c.items, 'section.cohorts').status).toBe('ok');
    expect(byKey(c.items, 'section.financials').status).toBe('ok');
  });

  it('a mock-run row does not turn an item ok', async () => {
    const mockRun = await makeRun('mock-checklist-source', true);
    await prisma.studentCohortDistribution.create({
      data: { programId: ids.grad!, entryYearBE: 2566, studentCount: 40, ingestionRunId: mockRun },
    });
    await prisma.financialMetric.create({
      data: {
        programId: ids.grad!, fiscalYear: 2024, tuitionRevenue: 1000, otherRevenue: 0, directCost: 0,
        allocatedFacultyCost: 0, allocatedFacilityCost: 0, allocatedOverhead: 0, netContribution: 1000,
        freshnessDate: new Date('2025-01-01'), ingestionRunId: mockRun,
      },
    });
    const c = (await programSetupChecklist(ids.grad!))!;
    expect(byKey(c.items, 'section.cohorts').status).toBe('empty');
    expect(byKey(c.items, 'section.financials').status).toBe('empty');
  });

  it('a -fallback course row marks the course list degraded; summary.ready counts it', async () => {
    await prisma.programCourse.create({
      data: {
        programId: ids.bach!, courseCode: 'SCX101', courseCodeRaw: 'SCX 101', courseNameTh: 'ทดสอบ', courseNameEn: 'Test',
        credits: 3, methodVersion: 'program-courses-extract.v4-fallback',
      },
    });
    const c = (await programSetupChecklist(ids.bach!))!;
    expect(byKey(c.items, 'section.course-list').status).toBe('degraded');
    expect(byKey(c.items, 'section.course-list').note).toMatch(/regex fallback/);
    expect(c.summary.ready).toBe(c.summary.ok + c.summary.degraded + c.summary.notApplicable);
    await prisma.programCourse.deleteMany({ where: { programId: ids.bach! } });
  });
});

describe('CHECKLIST_SOURCES slugs', () => {
  it('every dataset and connector slug exists', () => {
    const datasets = new Set(IMPORT_DATASETS.map((d) => d.slug));
    const connectors = new Set(SOURCE_CATALOG.map((e) => e.slug));
    for (const list of Object.values(CHECKLIST_SOURCES)) {
      for (const w of list) {
        if (w.kind === 'dataset') expect(datasets.has(w.slug), w.slug).toBe(true);
        if (w.kind === 'connector') expect(connectors.has(w.slug), w.slug).toBe(true);
      }
    }
  });
});
