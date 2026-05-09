import { describe, expect, it, vi, beforeEach } from 'vitest';

// Tests the rules a reviewer would use to sanity-check the Gap Analyzer
// without running the whole API:
//   1. Skills gap rows sort by |gap| — biggest first (either direction).
//   2. When the demand side is empty, lowConfidenceReason fires.
//   3. Risks roll up demographic multiplier into projectedSupplyAfterDemographic.
//   4. Forecast accuracy MAPE is computed per horizon.

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  skillFindMany: vi.fn(),
  programFindMany: vi.fn(),
  programSkillCount: vi.fn(),
  enrollmentMetricFindMany: vi.fn(),
  enrollmentMetricAggregate: vi.fn(),
  demographicFindFirst: vi.fn(),
  forecastRunFindMany: vi.fn(),
  occupationFindMany: vi.fn(),
  occupationGroupBy: vi.fn(),
  sectorFindMany: vi.fn(),
  kmitlDemandCount: vi.fn(),
  kmitlDemandFindMany: vi.fn(),
}));

vi.mock('../src/index', async () => {
  const actual = await vi.importActual<typeof import('../src/index')>('../src/index');
  return {
    ...actual,
    prisma: {
      $queryRaw: mocks.queryRaw,
      skill: { findMany: mocks.skillFindMany },
      program: { findMany: mocks.programFindMany },
      programSkill: { count: mocks.programSkillCount },
      enrollmentMetric: {
        findMany: mocks.enrollmentMetricFindMany,
        aggregate: mocks.enrollmentMetricAggregate,
      },
      demographicProjection: { findFirst: mocks.demographicFindFirst },
      forecastRun: { findMany: mocks.forecastRunFindMany },
      occupationDemand: {
        findMany: mocks.occupationFindMany,
        groupBy: mocks.occupationGroupBy,
      },
      sector: { findMany: mocks.sectorFindMany },
      // KMITL demand source (gap-analysis: demandSource='auto' picks
      // 'kmitl' when count > 0, else falls back to 'job_postings'). Default
      // mocks return 0 / [] so existing tests keep their job-postings path.
      kmitlCareerSkillDemand: {
        count: mocks.kmitlDemandCount,
        findMany: mocks.kmitlDemandFindMany,
      },
    },
  };
});

import {
  computeSkillGap,
  computeRisks,
  computeForecastAccuracy,
} from '../src/gap-analysis';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  // Default: KMITL has no rows → 'auto' demand-source falls back to the
  // existing job-postings path. Tests can override per-case.
  mocks.kmitlDemandCount.mockResolvedValue(0);
  mocks.kmitlDemandFindMany.mockResolvedValue([]);
});

describe('computeSkillGap', () => {
  it('sorts rows by |gap| descending', async () => {
    // $queryRaw is called twice — first for demand, second for supply.
    mocks.queryRaw
      .mockResolvedValueOnce([
        { skill_id: 'sk-1', demand: 100, top_employers: ['Employer A'] },
        { skill_id: 'sk-2', demand: 20,  top_employers: ['Employer B'] },
        { skill_id: 'sk-3', demand: 5,   top_employers: ['Employer C'] },
      ])
      .mockResolvedValueOnce([
        { skill_id: 'sk-1', supply: 30, top_programs: ['prog-1'] },
        { skill_id: 'sk-2', supply: 60, top_programs: ['prog-2'] },
        { skill_id: 'sk-3', supply: 5,  top_programs: ['prog-3'] },
      ]);
    mocks.skillFindMany.mockResolvedValue([
      { id: 'sk-1', code: 'SK1', nameEn: 'One',   nameTh: 'หนึ่ง', category: null },
      { id: 'sk-2', code: 'SK2', nameEn: 'Two',   nameTh: 'สอง',   category: null },
      { id: 'sk-3', code: 'SK3', nameEn: 'Three', nameTh: 'สาม',   category: null },
    ]);
    // programIdsForScope('university') needs a non-empty result;
    // exact ids don't matter to the demand/supply sort assertion.
    mocks.programFindMany.mockResolvedValue([{ id: 'prog-1' }]);

    const result = await computeSkillGap({
      scope: 'university', region: 'TH', horizon: 0, comparison: 'absolute', limit: 30,
    });
    // gap = demand - supply → sk-1: 70, sk-2: -40, sk-3: 0
    expect(result.rows[0]?.skillId).toBe('sk-1');
    expect(result.rows[1]?.skillId).toBe('sk-2');
    expect(result.rows[2]?.skillId).toBe('sk-3');
    expect(result.lowConfidenceReason).toBeNull();
  });

  it('flags low confidence when demand side is empty', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([]) // demand
      .mockResolvedValueOnce([
        { skill_id: 'sk-1', supply: 10, top_programs: [] },
      ]);
    mocks.skillFindMany.mockResolvedValue([
      { id: 'sk-1', code: 'SK1', nameEn: 'One', nameTh: 'หนึ่ง', category: null },
    ]);
    mocks.programFindMany.mockResolvedValue([{ id: 'prog-1' }]);

    const result = await computeSkillGap({
      scope: 'university', region: 'TH', horizon: 0, comparison: 'absolute', limit: 30,
    });
    expect(result.lowConfidenceReason).toMatch(/Demand side empty/i);
  });
});

describe('computeRisks — demographic adjustment', () => {
  it('applies demographic multiplier to supply projection', async () => {
    mocks.programFindMany.mockResolvedValue([
      { id: 'prog-1', code: 'P1', nameEn: 'Program 1', nameTh: 'โปร1' },
    ]);
    mocks.enrollmentMetricFindMany.mockResolvedValue([
      { programId: 'prog-1', academicYear: 2020, graduatedOnTime: 40 },
      { programId: 'prog-1', academicYear: 2021, graduatedOnTime: 42 },
      { programId: 'prog-1', academicYear: 2022, graduatedOnTime: 44 },
      { programId: 'prog-1', academicYear: 2023, graduatedOnTime: 46 },
    ]);
    mocks.demographicFindFirst
      .mockResolvedValueOnce({ year: 2020, population: 1_000_000 })  // base
      .mockResolvedValueOnce({ year: 2030, population: 800_000 });   // target (80%)

    const result = await computeRisks({
      scope: 'university', region: 'TH', horizon: 5, comparison: 'absolute', limit: 10,
    });
    const row = result.rows[0]!;
    // Linear projection of +2/year would land ~56 at year+5; demographic
    // multiplier 0.8 should bring the after-adjustment number below the
    // linear number.
    expect(row.projectedSupplyAfterDemographic).toBeLessThan(row.projectedSupply5yr);
  });
});

describe('computeForecastAccuracy', () => {
  it('computes per-horizon MAPE from recorded runs', async () => {
    const thisYear = new Date().getFullYear();
    mocks.forecastRunFindMany.mockResolvedValue([
      {
        id: 'r1', kind: 'DEMAND', subjectType: 'occ', subjectId: 'x',
        region: 'TH', targetYear: thisYear - 1, projectedValue: 100,
        ci50Low: 90, ci50High: 110, ci80Low: 80, ci80High: 120, ci95Low: 70, ci95High: 130,
        actualValue: 90, errorPct: 11.11, methodologyVersion: 'forecasting.v1',
        runAt: new Date(),
      },
      {
        id: 'r2', kind: 'DEMAND', subjectType: 'occ', subjectId: 'y',
        region: 'TH', targetYear: thisYear - 1, projectedValue: 50,
        ci50Low: 40, ci50High: 60, ci80Low: 30, ci80High: 70, ci95Low: 25, ci95High: 75,
        actualValue: 55, errorPct: -9.09, methodologyVersion: 'forecasting.v1',
        runAt: new Date(),
      },
    ]);

    const r = await computeForecastAccuracy();
    expect(r.rows).toHaveLength(2);
    expect(r.mapeByHorizon).toHaveLength(1);
    // horizon = thisYear - 1 - thisYear = -1
    expect(r.mapeByHorizon[0]!.horizonYears).toBe(-1);
    expect(r.mapeByHorizon[0]!.mape).toBeCloseTo((11.11 + 9.09) / 2, 1);
    expect(r.mapeByHorizon[0]!.n).toBe(2);
  });
});
