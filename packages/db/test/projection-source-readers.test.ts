import { KKU_REFERENCE_ORGANIZATION, setOrganizationForTest } from '@kku/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { programDemographicOutlook } from '../src/program-deep-dive';

// Scratch-DB wiring test for the Deep-Dive demographic outlook: the national
// block follows the source picker, the regional comparator may come from a
// different source because UN carries national figures only.

const UN = 'UN-WPP2024';
const NESDC = 'NESDC-PopProj-2010-2040';
const CODE = 'PSR-PROG-1';
const FACULTY = 'PSR-FAC';

let programId = '';
const nowYear = new Date().getUTCFullYear();

async function wipe(): Promise<void> {
  await prisma.demographicProjection.deleteMany({
    where: { source: { in: [UN, NESDC] } },
  });
}

beforeAll(async () => {
  await wipe();
  await prisma.program.deleteMany({ where: { code: CODE } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY } });
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY, nameTh: 'คณะทดสอบ', nameEn: 'Test faculty' },
    select: { id: true },
  });
  const program = await prisma.program.create({
    data: { code: CODE, nameTh: 'โปรแกรมทดสอบ', nameEn: CODE, facultyId: faculty.id, level: 'BACHELOR', status: 'ACTIVE', sequenceNoFromSheet: -9601 },
    select: { id: true },
  });
  programId = program.id;
  const rows: { source: string; region: string; year: number; population: number }[] = [];
  for (let h = 0; h <= 15; h++) {
    rows.push({ source: UN, region: 'TH', year: nowYear + h, population: 5_000_000 - h * 1000 });
    rows.push({ source: NESDC, region: 'TH', year: nowYear + h, population: 4_000_000 - h * 1000 });
    rows.push({ source: NESDC, region: 'Northeast', year: nowYear + h, population: 900_000 - h * 100 });
  }
  await prisma.demographicProjection.createMany({
    data: rows.map((r) => ({ ...r, ageCohort: '18-22', freshnessDate: new Date() })),
  });
});

afterEach(() => setOrganizationForTest(KKU_REFERENCE_ORGANIZATION));

afterAll(async () => {
  await wipe();
  await prisma.program.deleteMany({ where: { code: CODE } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY } });
});

describe('programDemographicOutlook source wiring', () => {
  it('outlook national from UN while comparator from NESDC', async () => {
    setOrganizationForTest({ ...KKU_REFERENCE_ORGANIZATION, regionEn: 'Northeast' });
    const outlook = await programDemographicOutlook(programId);
    expect(outlook).not.toBeNull();
    expect(outlook!.source).toBe(UN);
    expect(outlook!.comparatorSource).toBe(NESDC);
    expect(outlook!.comparatorRegion).toBe('Northeast');
    const first = outlook!.projections[0]!;
    expect(first.cohortPopulation).toBe(5_000_000);
    expect(first.cohortPopulationRegional).toBe(900_000);
  });

  it('with no regional source the comparator is dropped and national stays UN', async () => {
    setOrganizationForTest({ ...KKU_REFERENCE_ORGANIZATION, regionEn: null });
    const outlook = await programDemographicOutlook(programId);
    expect(outlook!.source).toBe(UN);
    expect(outlook!.comparatorRegion).toBeNull();
    expect(outlook!.comparatorSource).toBeNull();
  });
});
