import { KKU_REFERENCE_ORGANIZATION, setOrganizationForTest } from '@kku/shared';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

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
  demographicFindMany: vi.fn(),
  kmitlCareerFindMany: vi.fn(),
  queryMetricByScope: vi.fn(),
  systemSettingFindUnique: vi.fn(),
  graduateOutcomeFindFirst: vi.fn(),
  enrollmentMetricFindFirst: vi.fn(),
  facultyFindFirst: vi.fn(),
  programPedagogyAssessmentFindUnique: vi.fn(),
  programJobThaiLinkFindMany: vi.fn(),
  jobThaiOccupationSkillFindMany: vi.fn(),
  jobThaiOccupationCount: vi.fn(),
}));

// NO `vi.importActual('../src/index')` spread here, deliberately.
//
// `index.ts` re-exports this module's whole dependency chain, so importActual
// evaluates the REAL graph — including `academic-year.ts`, which binds the
// REAL `prisma` at import time and is then cached. `health-score.ts` imports
// getAcademicYearContext() from that cached instance, so its
// `prisma.systemSetting.findUnique()` reached the live database and the
// `systemSetting` mock below was never consulted.
//
// It looked green only because a healthy dev DB returns null for that
// setting — the same value the mock returns — so the tests passed for the
// wrong reason, and any attempt to drive the academic-year boundary through
// `mocks.systemSettingFindUnique` silently did nothing. Verified by pointing
// DATABASE_URL at a dead port: with the spread, 5 tests fail; without it,
// all pass. health-score.ts, academic-year.ts and scope.ts each import only
// `prisma` from index, so a bare mock is sufficient.
vi.mock('../src/index', () => {
  return {
    prisma: {
      faculty: { findMany: mocks.facultyFindMany, findFirst: mocks.facultyFindFirst },
      department: { findMany: mocks.departmentFindMany },
      program: {
        findMany: mocks.programFindMany,
        findUnique: mocks.programFindUnique,
      },
      kmitlCareerSkillDemand: { findMany: mocks.kmitlDemandFindMany },
      programSkill: { findMany: mocks.programSkillFindMany },
      financialMetric: { findMany: mocks.financialMetricFindMany },
      enrollmentMetric: {
        findMany: mocks.enrollmentMetricFindMany,
        findFirst: mocks.enrollmentMetricFindFirst,
      },
      programFaculty: { findMany: mocks.programFacultyFindMany },
      researchOutput: { count: mocks.researchOutputCount },
      programDemandMatch: { findMany: mocks.programDemandMatchFindMany },
      tcasAdmissionStat: {
        findFirst: mocks.tcasFindFirst,
        findMany: mocks.tcasFindMany,
      },
      demographicProjection: { findFirst: mocks.demographicFindFirst, findMany: mocks.demographicFindMany },
      kmitlCareer: { findMany: mocks.kmitlCareerFindMany },
      graduateOutcome: { findFirst: mocks.graduateOutcomeFindFirst },
      programPedagogyAssessment: { findUnique: mocks.programPedagogyAssessmentFindUnique },
      programJobThaiLink: { findMany: mocks.programJobThaiLinkFindMany },
      jobThaiOccupationSkill: { findMany: mocks.jobThaiOccupationSkillFindMany },
      jobThaiOccupation: { count: mocks.jobThaiOccupationCount },
      // Backs getAcademicYearContext() (packages/db/src/academic-year.ts),
      // exercised for the first time by the tuition_trend_slope tests
      // below. Default (null → no stored override) below picks the
      // computed June-16 boundary, same as production with no operator
      // override configured.
      systemSetting: { findUnique: mocks.systemSettingFindUnique },
      // health-score.ts uses $queryRaw for the year-window probe + the
      // scope attractiveness funnel aggregate (now admission_campaign_stats
      // via scopeFunnelLatestYear), and $queryRawUnsafe in
      // studentSatisfactionDriver. The tests don't exercise the actual SQL
      // — returning [] is the "no data → null score" baseline that matches
      // the null-handling assertions.
      $queryRaw: vi.fn().mockResolvedValue([]),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      admissionCampaignStat: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };
});

// The award loader reads its own tables and a cached source check; the
// scorers only need to hand it the right staff ids. The pure parts
// (awardPoints, withAward) stay real. Kept outside `mocks` so the beforeEach
// mockReset loop does not strip the default implementation.
const grantAwardMock = vi.hoisted(() => vi.fn());
vi.mock('../src/grant-award', async () => {
  const actual = await vi.importActual<typeof import('../src/grant-award')>('../src/grant-award');
  return { ...actual, grantAward: grantAwardMock };
});
function defaultGrantAward(ids: readonly string[]): Promise<{
  label: 'external_grant_award';
  points: number | null;
  raw: Record<string, unknown>;
}> {
  return Promise.resolve({
    label: 'external_grant_award',
    points: ids.length ? 5 : null,
    raw: ids.length ? { staff: ids.length } : { reason: 'no-active-staff' },
  });
}

vi.mock('../src/scope', async () => {
  const actual = await vi.importActual<typeof import('../src/scope')>('../src/scope');
  return {
    ...actual,
    queryMetricByScope: mocks.queryMetricByScope,
  };
});

import { computeHealthScores, computeRequiredShareAt10Y, DIMENSION_DRIVERS, HEALTH_SCORE_VERSION } from '../src/health-score';
import {
  deriveAcademicYear,
  defaultNextStartDate,
  invalidateAcademicYearCache,
} from '../src/academic-year';

beforeEach(() => {
  invalidateAcademicYearCache();
  for (const fn of Object.values(mocks)) fn.mockReset();
  grantAwardMock.mockReset();
  grantAwardMock.mockImplementation(defaultGrantAward);
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
  mocks.demographicFindMany.mockImplementation(projectionRows(['TH', 'Northeast']));
  mocks.kmitlCareerFindMany.mockResolvedValue([]);
  mocks.systemSettingFindUnique.mockResolvedValue(null);
  mocks.graduateOutcomeFindFirst.mockResolvedValue(null);
  mocks.enrollmentMetricFindFirst.mockResolvedValue(null);
  mocks.facultyFindFirst.mockResolvedValue(null);
  mocks.programPedagogyAssessmentFindUnique.mockResolvedValue(null);
  mocks.programJobThaiLinkFindMany.mockResolvedValue([]);
  mocks.jobThaiOccupationSkillFindMany.mockResolvedValue([]);
  mocks.jobThaiOccupationCount.mockResolvedValue(0);
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

  it('attractiveness scope-level: no TCAS-funnel data → score null + completeness 0', async () => {
    // The three aggregate TCAS drivers are read from
    // `admission_campaign_stats` via scopeFunnelLatestYear ($queryRaw).
    // When the mock returns no funnel rows (default `$queryRaw → []`),
    // every driver resolves to null → completeness 0, score null.
    // This is the canonical "every null → null, never 0" assertion at
    // the attractiveness scope-fallback path.
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'f2', nameEn: 'No funnel', nameTh: 'ไม่มีข้อมูล TCAS' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);

    const rows = await computeHealthScores('university', null);
    const attractiveness = rows[0]?.dimensions.attractiveness;
    expect(attractiveness?.dataCompletenessPct).toBe(0);
    expect(attractiveness?.score).toBe(null);
    // The driver list shape is the contract: all SIX canonical
    // attractiveness drivers, all null.
    //
    // This assertion used to name only the three aggregate TCAS ratios,
    // which is how the scope-scorer driver drift stayed invisible for four
    // minor versions — the test encoded the defect as the contract. From
    // v5.0 `summariseDrivers` pads every canonical label, so a driver a
    // scorer forgot to build shows up here and in dataCompletenessPct
    // instead of vanishing.
    expect(attractiveness?.drivers.map((d) => d.label).sort()).toEqual([
      'enrollment_trend_slope',
      'kku_intake_policy',
      'tcas_competition_ratio',
      'tcas_competition_vs_peers',
      'tcas_fill_rate',
      'tcas_registration_yield',
    ]);
    for (const d of attractiveness?.drivers ?? []) {
      expect(d.value).toBe(null);
    }
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

describe('financial dimension — tuition_trend_slope ignores the in-flight academic year', () => {
  it('excludes the in-progress year even though its ratio to the prior year would pass the 30% guard', async () => {
    // Mirrors the real shape measured in the plan: an in-progress year
    // reading ~47% of the prior complete year — comfortably above the
    // old 30% "obviously truncated" ratio, so the pre-fix code kept it
    // and let it drag the slope toward a manufactured decline.
    const ctx = deriveAcademicYear(defaultNextStartDate());
    const currentYearCE = ctx.currentAcademicYearBE - 543;
    const priorYearCE = currentYearCE - 1;
    const twoYearsAgoCE = currentYearCE - 2;

    mocks.programFindUnique.mockResolvedValue({
      id: 'p1',
      nameEn: 'Test Program',
      nameTh: 'หลักสูตรทดสอบ',
      departmentId: null,
      level: null,
      kmitlCareerIds: [],
    });
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue([
      {
        fiscalYear: twoYearsAgoCE,
        tuitionRevenue: 3_000_000,
        directCost: 0,
        allocatedFacilityCost: 0,
        allocatedOverhead: 0,
        netContribution: 3_000_000,
      },
      {
        fiscalYear: priorYearCE,
        tuitionRevenue: 4_000_000,
        directCost: 0,
        allocatedFacilityCost: 0,
        allocatedOverhead: 0,
        netContribution: 4_000_000,
      },
      {
        // In-flight academic year — one semester billed (~47% of prior,
        // matching the plan's measured median). Must never enter the
        // slope regression, regardless of its ratio to the prior year.
        fiscalYear: currentYearCE,
        tuitionRevenue: 1_880_000,
        directCost: 0,
        allocatedFacilityCost: 0,
        allocatedOverhead: 0,
        netContribution: 1_880_000,
      },
    ]);

    const rows = await computeHealthScores('program', 'p1');
    const financial = rows[0]?.dimensions.financial;
    const slopeDriver = financial?.drivers.find((d) => d.label === 'tuition_trend_slope');

    // Only twoYearsAgoCE → priorYearCE (a rising +1,000,000/yr trend)
    // should feed the slope. If the in-flight year had leaked in, the
    // regression would swing negative (its value sits far below both
    // complete years) and the driver would clamp near 0 instead of 100.
    expect(slopeDriver).toBeDefined();
    expect(slopeDriver?.value).toBe(100);
  });

  it('still applies the ratio guard to the latest COMPLETE year once the in-flight year is excluded', async () => {
    const ctx = deriveAcademicYear(defaultNextStartDate());
    const currentYearCE = ctx.currentAcademicYearBE - 543;
    const priorYearCE = currentYearCE - 1; // latest complete year
    const twoYearsAgoCE = currentYearCE - 2;
    const threeYearsAgoCE = currentYearCE - 3;

    mocks.programFindUnique.mockResolvedValue({
      id: 'p2',
      nameEn: 'Truncated Ingestion Program',
      nameTh: 'หลักสูตรข้อมูลไม่ครบ',
      departmentId: null,
      level: null,
      kmitlCareerIds: [],
    });
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue([
      {
        fiscalYear: threeYearsAgoCE,
        tuitionRevenue: 2_000_000,
        directCost: 0,
        allocatedFacilityCost: 0,
        allocatedOverhead: 0,
        netContribution: 2_000_000,
      },
      {
        fiscalYear: twoYearsAgoCE,
        tuitionRevenue: 3_000_000,
        directCost: 0,
        allocatedFacilityCost: 0,
        allocatedOverhead: 0,
        netContribution: 3_000_000,
      },
      {
        // The latest COMPLETE year, but obviously truncated (< 30% of
        // the year before it) — e.g. a failed/partial ingestion. The
        // secondary ratio guard should still fall back one further,
        // even though this row is not in-flight by the calendar test.
        fiscalYear: priorYearCE,
        tuitionRevenue: 500_000,
        directCost: 0,
        allocatedFacilityCost: 0,
        allocatedOverhead: 0,
        netContribution: 500_000,
      },
      {
        fiscalYear: currentYearCE,
        tuitionRevenue: 1_880_000,
        directCost: 0,
        allocatedFacilityCost: 0,
        allocatedOverhead: 0,
        netContribution: 1_880_000,
      },
    ]);

    const rows = await computeHealthScores('program', 'p2');
    const financial = rows[0]?.dimensions.financial;
    const slopeDriver = financial?.drivers.find((d) => d.label === 'tuition_trend_slope');

    // Series after exclusion: [threeYearsAgo=2M, twoYearsAgo=3M, priorYear=0.5M].
    // The ratio guard drops the truncated priorYear row, leaving only
    // [2M, 3M] → a rising +1,000,000/yr slope → clamp(100).
    expect(slopeDriver?.value).toBe(100);
  });
});

// ── external-grant award on Financial (v5.4) ─────────────────────────────

function staffLink(id: string, isActive = true, rank = 'LECTURER'): {
  programId: string;
  facultyMember: { id: string; rank: string; isActive: boolean; retirementDate: Date | null };
} {
  return { programId: 'p1', facultyMember: { id, rank, isActive, retirementDate: null } };
}

// A complete prior year with positive contribution → a non-null Financial base.
function financialRows(): Array<Record<string, number>> {
  const ctx = deriveAcademicYear(defaultNextStartDate());
  const prior = ctx.currentAcademicYearBE - 543 - 1;
  return [prior - 1, prior].map((fiscalYear) => ({
    fiscalYear,
    tuitionRevenue: 3_000_000,
    directCost: 1_000_000,
    allocatedFacilityCost: 0,
    allocatedOverhead: 0,
    netContribution: 2_000_000,
  }));
}

const programRow = {
  id: 'p1', nameEn: 'P', nameTh: 'ป', departmentId: null, level: 'BACHELOR',
  kmitlCareerIds: [], faculty: { code: null },
};

describe('v5.4 — capability is back to four drivers', () => {
  it('drops external_grant_engagement and stamps v5.5', () => {
    expect(HEALTH_SCORE_VERSION).toBe('health-score.v5.5');
    expect(DIMENSION_DRIVERS.capability).toEqual([
      'senior_rank_share',
      'publications_per_faculty',
      'retirement_horizon_5y',
      'student_faculty_ratio',
    ]);
    expect(Object.values(DIMENSION_DRIVERS).flat()).not.toContain('external_grant_award');
  });

  it('capability completeness is 100% when its four inputs are present', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.enrollmentMetricFindFirst.mockResolvedValue({ enrolled: 60 });
    mocks.researchOutputCount.mockResolvedValue(6);
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1', true, 'PROF'), staffLink('s2'), staffLink('s3')]);
    const cap = (await computeHealthScores('program', 'p1'))[0]!.dimensions.capability;
    expect(cap.drivers).toHaveLength(4);
    expect(cap.dataCompletenessPct).toBe(100);
  });
});

describe('financial — external-grant award', () => {
  it('adds the award on top of the base and leaves completeness alone', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue(financialRows());
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1'), staffLink('s2'), staffLink('s2'), staffLink('s3', false)]);

    grantAwardMock.mockImplementation(() =>
      Promise.resolve({ label: 'external_grant_award', points: null, raw: { reason: 'source-not-synced' } }),
    );
    const base = (await computeHealthScores('program', 'p1'))[0]!.dimensions.financial;
    expect(base.score).not.toBeNull();

    grantAwardMock.mockImplementation(defaultGrantAward);
    const fin = (await computeHealthScores('program', 'p1'))[0]!.dimensions.financial;
    expect(fin.award?.label).toBe('external_grant_award');
    expect(fin.award?.points).toBe(5);
    expect(fin.award?.baseScore).toBeCloseTo(base.score!, 10);
    expect(fin.score).toBeCloseTo(Math.min(100, base.score! + 5), 10);
    expect(fin.dataCompletenessPct).toBe(base.dataCompletenessPct);
    expect(fin.drivers.map((d) => d.label)).not.toContain('external_grant_award');

    // Distinct ACTIVE staff only: s2 once, inactive s3 excluded.
    const ids = grantAwardMock.mock.calls.at(-1)?.[0] as string[];
    expect([...ids].sort()).toEqual(['s1', 's2']);
  });

  it('not synced: score equals the base and the award says why', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue(financialRows());
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1')]);
    grantAwardMock.mockImplementation(() =>
      Promise.resolve({ label: 'external_grant_award', points: null, raw: { reason: 'source-not-synced' } }),
    );
    const fin = (await computeHealthScores('program', 'p1'))[0]!.dimensions.financial;
    expect(fin.award?.points).toBeNull();
    expect(fin.score).toBe(fin.award?.baseScore);
    expect(fin.award?.raw).toEqual({ reason: 'source-not-synced' });
  });

  it('null base: no award, no grant query, score stays null', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue([]);
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1')]);
    const fin = (await computeHealthScores('program', 'p1'))[0]!.dimensions.financial;
    expect(fin.score).toBeNull();
    expect(fin.award).toEqual({
      label: 'external_grant_award',
      points: null,
      baseScore: null,
      raw: { reason: 'no-base-financial-score' },
    });
    expect(grantAwardMock).not.toHaveBeenCalled();
  });

  it('scope path: distinct active staff across the scope programmes, counted once', async () => {
    mocks.facultyFindMany.mockResolvedValue([{ id: 'fac-1', nameEn: 'F', nameTh: 'ค' }]);
    const finRow = {
      scope: 'faculty', scopeId: 'fac-1', year: 2025,
      applicationsTotal: null, admittedTotal: null, enrolledTotal: 400,
      retainedYear2Total: null, graduatedOnTimeTotal: null, graduatedLateTotal: null, dropoutsTotal: null,
      tuitionRevenueTotal: 30_000_000, totalCostTotal: 20_000_000, netContributionTotal: 10_000_000,
      employmentRateWeighted: null, averageSalaryWeighted: null,
      programCount: 2, latestFreshness: null,
    };
    mocks.queryMetricByScope.mockImplementation(({ family }: { family: string }) =>
      Promise.resolve(family === 'financial' || family === 'enrollment' ? [finRow] : []),
    );
    mocks.programFindMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    mocks.programFacultyFindMany.mockResolvedValue([
      { ...staffLink('s1'), programId: 'p1' },
      { ...staffLink('s1'), programId: 'p2' },
      { ...staffLink('s2', false), programId: 'p2' },
    ]);

    grantAwardMock.mockImplementation(() =>
      Promise.resolve({ label: 'external_grant_award', points: null, raw: { reason: 'source-not-synced' } }),
    );
    const base = (await computeHealthScores('university', null))[0]!.dimensions.financial;
    expect(base.score).not.toBeNull();

    grantAwardMock.mockReset();
    grantAwardMock.mockImplementation(defaultGrantAward);
    mocks.programFacultyFindMany.mockClear();
    const fin = (await computeHealthScores('university', null))[0]!.dimensions.financial;

    // Capability no longer calls the award; the scope call is the one with s1.
    const scopeCall = grantAwardMock.mock.calls.find(
      (c) => JSON.stringify([...(c[0] as string[])].sort()) === JSON.stringify(['s1']),
    );
    expect(scopeCall?.[0]).toEqual(['s1']);
    const awardQuery = mocks.programFacultyFindMany.mock.calls.find(
      (c) => (c[0] as { select?: unknown }).select !== undefined,
    )?.[0] as { where: { programId: { in: string[] } } } | undefined;
    expect(awardQuery?.where.programId.in).toEqual(['p1', 'p2']);

    expect(fin.award?.points).toBe(5);
    expect(fin.award?.baseScore).toBeCloseTo(base.score!, 10);
    expect(fin.score).toBeCloseTo(Math.min(100, base.score! + 5), 10);
    expect(fin.dataCompletenessPct).toBe(base.dataCompletenessPct);
  });

  it('does not touch other dimensions', async () => {
    mocks.programFindUnique.mockResolvedValue(programRow);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.financialMetricFindMany.mockResolvedValue(financialRows());
    mocks.programFacultyFindMany.mockResolvedValue([staffLink('s1')]);
    const row = (await computeHealthScores('program', 'p1'))[0]!;
    for (const key of ['attractiveness', 'capability', 'outcomes', 'relevance'] as const) {
      expect(row.dimensions[key].award).toBeUndefined();
    }
  });
});

// One mock serves the picker's eligibility query: every region has the
// current year and +10 under one national source.
const projectionRows = (regions: string[]) => async () => {
  const y = new Date().getUTCFullYear();
  return regions.flatMap((region) =>
    [y, y + 10].map((year) => ({ source: 'NESDC-PopProj-2010-2040', region, year })),
  );
};

describe('demographic region wiring (v5.5)', () => {
  const REGIONS = [{ region: 'TH' }, { region: 'Northeast' }, { region: 'Central' }];
  const withRegion = (regionEn: string | null) =>
    setOrganizationForTest({ ...KKU_REFERENCE_ORGANIZATION, regionEn });
  afterEach(() => setOrganizationForTest(KKU_REFERENCE_ORGANIZATION));

  beforeEach(() => {
    mocks.demographicFindMany.mockImplementation(projectionRows(REGIONS.map((r) => r.region)));
    mocks.demographicFindFirst.mockResolvedValue({ population: 1_000_000 });
    mocks.enrollmentMetricFindMany.mockResolvedValue([{ enrolled: 200 }]);
  });

  it('profile region Central -> projection queried for Central', async () => {
    withRegion('Central');
    const r = await computeRequiredShareAt10Y('p1', 'BACHELOR');
    expect(mocks.demographicFindFirst.mock.calls[0]![0].where.region).toBe('Central');
    expect(r).toEqual({ share: 200 / 1_000_000, region: 'Central', source: 'NESDC-PopProj-2010-2040', reason: null });
  });

  it('KKU profile -> Northeast', async () => {
    const r = await computeRequiredShareAt10Y('p1', 'BACHELOR');
    expect(mocks.demographicFindFirst.mock.calls[0]![0].where.region).toBe('Northeast');
    expect(r.region).toBe('Northeast');
  });

  it('unset region -> null with a reason, no projection query', async () => {
    withRegion(null);
    const r = await computeRequiredShareAt10Y('p1', 'BACHELOR');
    expect(r.share).toBeNull();
    expect(r.reason).toMatch(/^region-not-set/);
    expect(mocks.demographicFindFirst).not.toHaveBeenCalled();
  });

  it('unmatched region -> null with a reason', async () => {
    withRegion('Bangkok');
    expect((await computeRequiredShareAt10Y('p1', 'BACHELOR')).reason).toMatch(/^region-not-set/);
  });
});

// ── tcas_min_score_percentile: subject key fallback ──────────────────────

describe('tcas_min_score_percentile — peer subject key', () => {
  it('falls back to the programme Thai-name signature when its TCAS name over-captures', async () => {
    mocks.programFindUnique.mockResolvedValue({
      ...programRow,
      nameTh: 'หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล',
    });
    mocks.queryMetricByScope.mockResolvedValue([]);
    // The institution's own TCAS name carries trailing words, so its
    // signature is "วิศวกรรมเครื่องกล ปริญญาตรี" and matches no peer.
    mocks.tcasFindFirst.mockResolvedValue({
      entryYearBE: 2568, round: '3.2', minScorePass1: 50,
      programmeName: 'วศ.บ. สาขาวิชาวิศวกรรมเครื่องกล ปริญญาตรี 4 ปี',
    });
    const peers = [30, 40, 60, 70].map((minScorePass1) => ({
      minScorePass1, programmeName: 'วศ.บ. สาขาวิชาวิศวกรรมเครื่องกล',
    }));
    mocks.tcasFindMany.mockImplementation(({ where }: { where: { programmeName?: { contains: string } } }) =>
      Promise.resolve(where.programmeName?.contains === 'วิศวกรรมเครื่องกล' ? peers : []));

    const outcomes = (await computeHealthScores('program', 'p1'))[0]!.dimensions.outcomes;
    const driver = outcomes.drivers.find((d) => d.label === 'tcas_min_score_percentile');
    expect(driver?.value).toBe(50);
  });
});
