import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { getAcademicYearContext } from '../src/academic-year';
import { alumniCohortsDataset, studentCohortsDataset } from '../src/import/datasets/cohorts';
import { enrollmentDataset } from '../src/import/datasets/enrollment';
import { financialsDataset } from '../src/import/datasets/financials';
import { graduateOutcomesDataset } from '../src/import/datasets/graduate-outcomes';
import { programmeYearPrefill } from '../src/import/datasets/prefill';

const FACULTY_CODE = 'PRE-ENG';
const ACTIVE = 'PRE-ACTIVE-BE';
const SUNSET = 'PRE-SUNSET-BE';
const NON_CANONICAL = 'PRE-LEGACY-BE';
const ALL = [ACTIVE, SUNSET, NON_CANONICAL];

async function cleanup(): Promise<void> {
  await prisma.program.deleteMany({ where: { code: { in: ALL } } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY_CODE } });
}

/** Only this suite's fixtures — the dev database holds other programmes. */
function mine(rows: readonly { readonly [k: string]: unknown }[]) {
  return rows.filter((r) => ALL.includes(String(r.programmeCode)));
}

beforeAll(async () => {
  await cleanup();
  const faculty = await prisma.faculty.create({
    data: { code: FACULTY_CODE, nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering' },
  });
  const base = { facultyId: faculty.id, nameTh: 'ทดสอบ', nameEn: 'Test', level: 'BACHELOR' } as const;
  // Negative sequence numbers: canonical, but never the max the programmes
  // loader reads. See import-datasets-enrollment.
  await prisma.program.create({
    data: { ...base, code: ACTIVE, status: 'ACTIVE', sequenceNoFromSheet: -8501 },
  });
  await prisma.program.create({
    data: { ...base, code: SUNSET, status: 'SUNSET', sequenceNoFromSheet: -8502 },
  });
  await prisma.program.create({ data: { ...base, code: NON_CANONICAL, status: 'ACTIVE' } });
});

afterAll(cleanup);

describe('programmeYearPrefill', () => {
  const prefill = programmeYearPrefill({ yearKey: 'academicYear' });

  it('emits one row per canonical active programme per year', async () => {
    const rows = mine(await prefill(prisma, { fromYear: 2020, toYear: 2022 }));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.programmeCode))).toEqual(new Set([ACTIVE]));
    expect(rows.map((r) => r.academicYear).sort()).toEqual([2020, 2021, 2022]);
  });

  it('excludes a programme that is not canonical', async () => {
    // It would be invisible on every Council surface, so pre-filling it
    // would ask the adopter to supply figures nothing will ever show.
    const rows = mine(await prefill(prisma, { fromYear: 2022, toYear: 2022 }));
    expect(rows.map((r) => r.programmeCode)).not.toContain(NON_CANONICAL);
  });

  it('excludes a programme that is no longer running', async () => {
    const rows = mine(await prefill(prisma, { fromYear: 2022, toYear: 2022 }));
    expect(rows.map((r) => r.programmeCode)).not.toContain(SUNSET);
  });

  it('defaults to five academic years ending at the current one', async () => {
    const { currentAcademicYearBE } = await getAcademicYearContext();
    const current = currentAcademicYearBE - 543;

    const years = mine(await prefill(prisma, {})).map((r) => r.academicYear);
    expect(years).toHaveLength(5);
    expect(years.sort()).toEqual([current - 4, current - 3, current - 2, current - 1, current]);
  });

  it('fills only the key columns, leaving every value blank', async () => {
    const [row] = mine(await prefill(prisma, { fromYear: 2022, toYear: 2022 }));
    expect(Object.keys(row ?? {}).sort()).toEqual(['academicYear', 'programmeCode']);
  });

  it('leaves an extra key present but blank', async () => {
    // A survey year cannot be guessed, and a guessed one is worse than an
    // empty cell: it looks like an answer.
    const withSurvey = programmeYearPrefill({
      yearKey: 'graduationYear',
      extraKeys: ['surveyYear'],
    });
    const [row] = mine(await withSurvey(prisma, { fromYear: 2022, toYear: 2022 }));
    expect(row).toHaveProperty('surveyYear', null);
  });

  it('returns nothing when the installation has no programme yet', async () => {
    // A fresh install downloads this template before it has uploaded
    // anything, so the empty case is the FIRST thing an adopter hits. The
    // dev database always holds programmes, so this stubs the only query
    // the function makes rather than asserting around them.
    const empty = { program: { findMany: async () => [] } } as unknown as PrismaClient;
    expect(await prefill(empty, { fromYear: 2020, toYear: 2024 })).toHaveLength(0);
  });
});

describe('which declarations pre-fill', () => {
  it('leaves the core-metric templates empty', () => {
    // An adopter rarely holds every figure for every programme and year, so
    // these templates ship with headers only and they type the rows they
    // have (owner decision, 2026-10-21).
    expect(enrollmentDataset.prefill).toBeUndefined();
    expect(financialsDataset.prefill).toBeUndefined();
    expect(graduateOutcomesDataset.prefill).toBeUndefined();
  });

  it('still pre-fills the cohort templates', () => {
    expect(studentCohortsDataset.prefill).toBeTypeOf('function');
    expect(alumniCohortsDataset.prefill).toBeTypeOf('function');
  });
});
