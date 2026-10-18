import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { realDataWhere } from '../src/data-quality';
import { campaignsDataset } from '../src/import/datasets/campaigns';
import { getImportDataset } from '../src/import/registry';
import type { ImportLoadContext, ImportRow } from '../src/import/types';

const FACULTY_CODE = 'CAM-ENG';
const FACULTY_NAME_TH = 'คณะวิศวกรรมศาสตร์ (ทดสอบ)';
const PROGRAMME_CODE = 'CAM-CIV-BE';

let runId = '';
let otherRunId = '';

async function cleanup(): Promise<void> {
  await prisma.admissionCampaignStat.deleteMany({
    where: { program: { code: PROGRAMME_CODE } },
  });
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

function load(rows: readonly ImportRow[], withRunId: string) {
  return prisma.$transaction(async (tx) => {
    const ctx: ImportLoadContext = { tx, ingestionRunId: withRunId };
    return campaignsDataset.load(ctx, rows);
  });
}

function row(over: Partial<Record<string, unknown>> = {}): ImportRow {
  return {
    programmeCode: PROGRAMME_CODE,
    academicYear: 2024,
    round: 'Round 1 — Portfolio',
    campaignName: 'Civil Engineering, regular programme',
    planPerYear: 60,
    totalApplicants: 480,
    totalPassed: 95,
    confirmClearinghouse: 70,
    regReported: 62,
    ...over,
  } as ImportRow;
}

beforeAll(async () => {
  await cleanup();
  runId = await makeRun('xlsx-admission-campaigns');
  otherRunId = await makeRun('xlsx-admission-campaigns');

  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: FACULTY_NAME_TH, nameEn: 'Engineering' },
  });
  await prisma.program.create({
    data: {
      code: PROGRAMME_CODE, nameTh: 'โยธา', nameEn: 'Civil',
      facultyId: faculty.id, level: 'BACHELOR', sequenceNoFromSheet: -8701,
    },
  });
});

afterAll(cleanup);

describe('admission campaigns dataset', () => {
  it('is registered under the slug the raw view uses', () => {
    expect(getImportDataset('admission-campaigns').slug).toBe('admission-campaigns');
  });

  it('inserts a campaign with no Oracle surrogate id', async () => {
    // wProgramId is the registrar's own key and an adopter has none.
    const result = await load([row()], runId);
    expect(result.inserted).toBe(1);

    const stored = await prisma.admissionCampaignStat.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE } },
      select: {
        wProgramId: true, recruitmentProgramId: true, acadYearBE: true,
        totalApplicants: true, ingestionRunId: true,
      },
    });
    expect(stored.wProgramId).toBeNull();
    expect(stored.recruitmentProgramId).toBeNull();
    expect(stored.acadYearBE).toBe(2567);
    expect(stored.totalApplicants).toBe(480);
    expect(stored.ingestionRunId).toBe(runId);
  });

  it('resolves the faculty name from the programme’s faculty', async () => {
    // facultyNameTh is NOT NULL and the sheet never asks for it.
    const stored = await prisma.admissionCampaignStat.findFirstOrThrow({
      where: { program: { code: PROGRAMME_CODE } },
      select: { facultyNameTh: true, faculty: { select: { code: true } } },
    });
    expect(stored.facultyNameTh).toBe(FACULTY_NAME_TH);
    expect(stored.faculty?.code).toBe(FACULTY_CODE);
  });

  it('updates on (programme, year, round, campaign) rather than duplicating', async () => {
    const result = await load([row({ totalApplicants: 512 })], otherRunId);
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);

    expect(await prisma.admissionCampaignStat.count({
      where: { program: { code: PROGRAMME_CODE } },
    })).toBe(1);
  });

  it('keeps two rounds of one programme-year as separate rows', async () => {
    const result = await load([row({ round: 'Round 3 — Admission' })], runId);
    expect(result.inserted).toBe(1);
    expect(await prisma.admissionCampaignStat.count({
      where: { program: { code: PROGRAMME_CODE } },
    })).toBe(2);
  });

  it('offers no column for an identifier only a Thai registrar has', () => {
    const keys = campaignsDataset.columns.map((c) => c.key);
    for (const kkuOnly of [
      'wProgramId', 'currId', 'recruitmentProgramId', 'sourceFacultyId',
      'enrollSeats', 'sendClearinghouse', 'sendRegReported',
    ]) {
      expect(keys).not.toContain(kkuOnly);
    }
  });

  it('is visible through realDataWhere()', async () => {
    const found = await prisma.admissionCampaignStat.findMany({
      where: { program: { code: PROGRAMME_CODE }, ...realDataWhere() },
      select: { acadYearBE: true },
    });
    expect(found.map((r) => r.acadYearBE)).toContain(2567);
  });

  it('clears only rows the given runs created', async () => {
    const deleted = await prisma.$transaction((tx) => campaignsDataset.clear(tx, [runId]));
    expect(deleted).toBe(2);
    expect(await prisma.admissionCampaignStat.count({
      where: { program: { code: PROGRAMME_CODE } },
    })).toBe(0);
  });
});
