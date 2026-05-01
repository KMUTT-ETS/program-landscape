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
      // KMITL labor-market alignment driver (health-score v2). The default
      // empty-array mock makes the driver return null (no data → null, not
      // zero) which is the existing null-handling contract these tests
      // already exercise. Override per-test if a positive case is needed.
      kmitlCareerSkillDemand: { findMany: mocks.kmitlDemandFindMany },
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
  // Default: KMITL has no demand data → driver returns null. Tests can
  // override per-case for positive paths.
  mocks.kmitlDemandFindMany.mockResolvedValue([]);
});

describe('computeHealthScores — null handling', () => {
  it('returns overall.score=null when every underlying metric is null', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'f1', nameEn: 'Test', nameTh: 'ทดสอบ' },
    ]);
    // Empty metric arrays → scorers see no data.
    mocks.queryMetricByScope.mockResolvedValue([]);

    const rows = await computeHealthScores('university', null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.overall.score).toBe(null);
    expect(rows[0]?.overall.dataCompletenessPct).toBe(0);
    // v1 methodology stamped.
    expect(rows[0]?.methodologyVersion).toBe(HEALTH_SCORE_VERSION);
  });

  it('data-completeness reflects the fraction of non-null drivers (demand)', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'f2', nameEn: 'Partial', nameTh: 'บางส่วน' },
    ]);
    // Return enrollment row where admission yield is resolvable but
    // retention + on-time-grad are null.
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
      .mockResolvedValue([]); // financial + outcomes empty

    const rows = await computeHealthScores('university', null);
    const demand = rows[0]?.dimensions.demand;
    // 1 of 4 demand drivers non-null → completeness 25%. The fourth driver
    // is the KMITL labor-market alignment (health-score v2); empty-mocked
    // → null, contributes to the denominator but not the numerator.
    expect(demand?.dataCompletenessPct).toBeCloseTo(25, 0);
    // That one driver scored 100 (yield 0.4 / 0.3 clamped to 100).
    expect(demand?.score).toBe(100);
  });
});
