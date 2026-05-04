import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mocks prisma + queryMetricByScope so the test runs without a DB.
// Exercises the two rules we can't afford to regress on:
//   1. Every null underlying metric → score is null, NOT 0.
//   2. dataCompletenessPct is the fraction of non-null drivers.

const mocks = vi.hoisted(() => ({
  facultyFindMany: vi.fn(),
  departmentFindMany: vi.fn(),
  programFindMany: vi.fn(),
  programFindUnique: vi.fn(),
  kmitlDemandFindMany: vi.fn(),
  programSkillFindMany: vi.fn(),
  financialMetricFindMany: vi.fn(),
  enrollmentMetricFindMany: vi.fn(),
  programFacultyFindMany: vi.fn(),
  researchOutputCount: vi.fn(),
  programDemandMatchFindMany: vi.fn(),
  tcasFindFirst: vi.fn(),
  tcasFindMany: vi.fn(),
  demographicFindFirst: vi.fn(),
  kmitlCareerFindMany: vi.fn(),
  queryMetricByScope: vi.fn(),
}));

vi.mock('../src/index', async () => {
  const actual = await vi.importActual<typeof import('../src/index')>('../src/index');
  return {
    ...actual,
    prisma: {
      faculty: { findMany: mocks.facultyFindMany },
      department: { findMany: mocks.departmentFindMany },
      program: {
        findMany: mocks.programFindMany,
        findUnique: mocks.programFindUnique,
      },
      kmitlCareerSkillDemand: { findMany: mocks.kmitlDemandFindMany },
      programSkill: { findMany: mocks.programSkillFindMany },
      financialMetric: { findMany: mocks.financialMetricFindMany },
      enrollmentMetric: { findMany: mocks.enrollmentMetricFindMany },
      programFaculty: { findMany: mocks.programFacultyFindMany },
      researchOutput: { count: mocks.researchOutputCount },
      programDemandMatch: { findMany: mocks.programDemandMatchFindMany },
      tcasAdmissionStat: {
        findFirst: mocks.tcasFindFirst,
        findMany: mocks.tcasFindMany,
      },
      demographicProjection: { findFirst: mocks.demographicFindFirst },
      kmitlCareer: { findMany: mocks.kmitlCareerFindMany },
    },
  };
});

vi.mock('../src/scope', async () => {
  const actual = await vi.importActual<typeof import('../src/scope')>('../src/scope');
  return {
    ...actual,
    queryMetricByScope: mocks.queryMetricByScope,
  };
});

import { computeHealthScores, HEALTH_SCORE_VERSION } from '../src/health-score';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  // Defaults — every data source empty → all drivers null. Per-test
  // overrides drive specific scenarios.
  mocks.kmitlDemandFindMany.mockResolvedValue([]);
  mocks.programSkillFindMany.mockResolvedValue([]);
  mocks.financialMetricFindMany.mockResolvedValue([]);
  mocks.enrollmentMetricFindMany.mockResolvedValue([]);
  mocks.programFacultyFindMany.mockResolvedValue([]);
  mocks.researchOutputCount.mockResolvedValue(0);
  mocks.programDemandMatchFindMany.mockResolvedValue([]);
  mocks.tcasFindFirst.mockResolvedValue(null);
  mocks.tcasFindMany.mockResolvedValue([]);
  mocks.demographicFindFirst.mockResolvedValue(null);
  mocks.kmitlCareerFindMany.mockResolvedValue([]);
  // collectProgramIdsForScope hits prisma.program.findMany at uni
  // scope — empty array means relevance/capability scope-aggregations
  // fall through cleanly.
  mocks.programFindMany.mockResolvedValue([]);
});

describe('computeHealthScores — null handling', () => {
  it('returns overall.score=null when every underlying metric is null', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'f1', nameEn: 'Test', nameTh: 'ทดสอบ' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);

    const rows = await computeHealthScores('university', null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.overall.score).toBe(null);
    expect(rows[0]?.overall.dataCompletenessPct).toBe(0);
    expect(rows[0]?.methodologyVersion).toBe(HEALTH_SCORE_VERSION);
  });

  it('data-completeness reflects the fraction of non-null drivers (attractiveness scope-level)', async () => {
    // v3.0 attractiveness scope-fallback driver set is {admission_yield,
    // retention_year2}. With one of two drivers populated, completeness
    // should be 50% and the score reflects the single resolved driver.
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'f2', nameEn: 'Partial', nameTh: 'บางส่วน' },
    ]);
    mocks.queryMetricByScope
      .mockResolvedValueOnce([
        {
          applicationsTotal: 1000,
          admittedTotal: 400, // yield 40% → above the 30% scale → 100
          enrolledTotal: null,
          retainedYear2Total: null,
          graduatedOnTimeTotal: null,
          graduatedLateTotal: null,
          dropoutsTotal: null,
          programCount: 10,
          latestFreshness: new Date('2026-04-01'),
        },
      ])
      .mockResolvedValue([]);

    const rows = await computeHealthScores('university', null);
    const attractiveness = rows[0]?.dimensions.attractiveness;
    expect(attractiveness?.dataCompletenessPct).toBeCloseTo(50, 0);
    expect(attractiveness?.score).toBe(100);
  });

  it('exposes the v3.0 5-dimension contract on every row', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'f3', nameEn: 'Shape', nameTh: 'รูปร่าง' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    const rows = await computeHealthScores('university', null);
    const dims = rows[0]?.dimensions;
    expect(dims).toBeDefined();
    expect(Object.keys(dims!).sort()).toEqual([
      'attractiveness',
      'capability',
      'financial',
      'outcomes',
      'relevance',
    ]);
  });
});
