// Driver parity between the program-scope and faculty/department/
// university-scope health scorers, plus honest dataCompletenessPct.
//
// WHY THIS SUITE EXISTS: the scope scorers were written at v3.0 and never
// kept up as drivers were added through v3.6/v3.7/v4.0, so they silently
// scored on 2-4 of the 5-7 drivers the program scorers use. Measured
// 2026-09-12, all 24 faculties scored BELOW their program mean — mean gap
// 11.6 pts, worst 28.5 — with relevance alone accounting for -56.4.
// Nothing surfaced it because completeness was computed over the drivers
// a scorer happened to CONSTRUCT, so a scorer missing half its inputs
// still reported 100% complete.
//
// The mock harness mirrors health-score.test.ts. Note the deliberate
// absence of `vi.importActual('../src/index')` — see the long comment in
// that file for why the spread silently reaches the live database.

import { describe, expect, it, vi, beforeEach } from 'vitest';

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
  systemSettingFindUnique: vi.fn(),
  graduateOutcomeFindFirst: vi.fn(),
  enrollmentMetricFindFirst: vi.fn(),
  facultyFindFirst: vi.fn(),
  programPedagogyAssessmentFindUnique: vi.fn(),
  programJobThaiLinkFindMany: vi.fn(),
  jobThaiOccupationSkillFindMany: vi.fn(),
  jobThaiOccupationCount: vi.fn(),
}));

vi.mock('../src/index', () => {
  return {
    prisma: {
      faculty: { findMany: mocks.facultyFindMany, findFirst: mocks.facultyFindFirst },
      department: { findMany: mocks.departmentFindMany },
      program: { findMany: mocks.programFindMany, findUnique: mocks.programFindUnique },
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
      tcasAdmissionStat: { findFirst: mocks.tcasFindFirst, findMany: mocks.tcasFindMany },
      demographicProjection: { findFirst: mocks.demographicFindFirst, findMany: async () => { const y = new Date().getUTCFullYear(); return ['TH', 'Northeast'].flatMap((region) => [y, y + 10].map((year) => ({ source: 'NESDC-PopProj-2010-2040', region, year }))); } },
      kmitlCareer: { findMany: mocks.kmitlCareerFindMany },
      graduateOutcome: { findFirst: mocks.graduateOutcomeFindFirst },
      programPedagogyAssessment: { findUnique: mocks.programPedagogyAssessmentFindUnique },
      programJobThaiLink: { findMany: mocks.programJobThaiLinkFindMany },
      jobThaiOccupationSkill: { findMany: mocks.jobThaiOccupationSkillFindMany },
      jobThaiOccupation: { count: mocks.jobThaiOccupationCount },
      systemSetting: { findUnique: mocks.systemSettingFindUnique },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      admissionCampaignStat: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };
});

// The award loader reads its own tables; here it only has to return something.
const grantAwardMock = vi.hoisted(() =>
  vi.fn(async (ids: readonly string[]) => ({
    label: 'external_grant_award' as const,
    points: ids.length ? 5 : null,
    raw: { staff: ids.length },
  })),
);
vi.mock('../src/grant-award', async () => {
  const actual = await vi.importActual<typeof import('../src/grant-award')>('../src/grant-award');
  return { ...actual, grantAward: grantAwardMock };
});

vi.mock('../src/scope', async () => {
  const actual = await vi.importActual<typeof import('../src/scope')>('../src/scope');
  return { ...actual, queryMetricByScope: mocks.queryMetricByScope };
});

import { JOBTHAI_MIN_POSTINGS_FOR_SIGNAL, JOBTHAI_MIN_RELEVANT_SKILLS } from '../src/jobthai-bridge';
import {
  computeHealthScores,
  DIMENSION_DRIVERS,
  DRIVER_NOT_COMPUTED,
  HEALTH_DIMENSIONS,
  invalidateProgramScoreIndexCache,
  rolledUpDriverForTest,
  summariseDriversForTest,
  LABOUR_MARKET_DEMAND_WEIGHTS,
  type HealthScore,
  type ProgramScoreIndex,
} from '../src/health-score';
import { invalidateAcademicYearCache } from '../src/academic-year';
import { invalidateJobThaiGenericSkillsCache } from '../src/jobthai';

beforeEach(() => {
  invalidateAcademicYearCache();
  // The program-score index memo is per-process. Without this a later
  // test reads the program set an earlier test mocked, and the failure
  // looks like a scorer bug.
  invalidateProgramScoreIndexCache();
  invalidateJobThaiGenericSkillsCache();
  for (const fn of Object.values(mocks)) fn.mockReset();
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
  mocks.systemSettingFindUnique.mockResolvedValue(null);
  mocks.graduateOutcomeFindFirst.mockResolvedValue(null);
  mocks.enrollmentMetricFindFirst.mockResolvedValue(null);
  mocks.facultyFindFirst.mockResolvedValue(null);
  mocks.programPedagogyAssessmentFindUnique.mockResolvedValue(null);
  mocks.programJobThaiLinkFindMany.mockResolvedValue([]);
  mocks.jobThaiOccupationSkillFindMany.mockResolvedValue([]);
  mocks.jobThaiOccupationCount.mockResolvedValue(0);
  mocks.programFindMany.mockResolvedValue([]);
  mocks.programFindUnique.mockResolvedValue(null);
  mocks.queryMetricByScope.mockResolvedValue([]);
});

describe('summariseDrivers — absent drivers count against completeness', () => {
  it('pads a canonical driver that the scorer never constructed', () => {
    const result = summariseDriversForTest('relevance', [
      { label: 'labour_market_alignment', value: 8.3, raw: null },
    ]);
    expect(result.score).toBe(8.3);
    // 1 of SIX canonical relevance drivers, not 1 of 1. The count moved from
    // five to six when jobthai_demand_alignment landed in v5.1 — the point of
    // the assertion is the denominator being canonical, not its exact value.
    expect(result.dataCompletenessPct).toBeCloseTo((1 / DIMENSION_DRIVERS.relevance.length) * 100, 5);
    expect(result.drivers.map((d) => d.label)).toEqual([...DIMENSION_DRIVERS.relevance]);
    const padded = result.drivers.find((d) => d.label === 'pedagogical_fit');
    expect(padded).toBeDefined();
    expect(padded!.value).toBeNull();
    // Marked, so "the scorer never built this" stays distinguishable from
    // "computed, found no data".
    expect(padded!.raw).toEqual(DRIVER_NOT_COMPUTED);
  });

  it('an explicitly omitted driver shrinks the denominator, not the score', () => {
    // dq_digital_competency is deliberately omitted for non-bachelor
    // programs (v4.0) — completeness must not be penalised for an
    // instrument that cannot apply.
    const result = summariseDriversForTest(
      'outcomes',
      [
        { label: 'employment_rate', value: 90, raw: null },
        { label: 'average_salary', value: 60, raw: null },
        { label: 'student_satisfaction', value: 50, raw: null },
        { label: 'job_relevance', value: 80, raw: null },
        { label: 'further_study_rate', value: 70, raw: null },
        { label: 'tcas_min_score_percentile', value: 40, raw: null },
      ],
      ['dq_digital_competency'],
    );
    expect(result.dataCompletenessPct).toBeCloseTo(100, 5);
    expect(result.drivers.some((d) => d.label === 'dq_digital_competency')).toBe(false);
  });

  it('returns a null score but honest completeness when every driver is null', () => {
    const result = summariseDriversForTest('capability', []);
    expect(result.score).toBeNull();
    expect(result.dataCompletenessPct).toBe(0);
    expect(result.drivers).toHaveLength(DIMENSION_DRIVERS.capability.length);
  });

  it('keeps a non-canonical driver visible rather than swallowing it', () => {
    const result = summariseDriversForTest('capability', [
      { label: 'senior_rank_share', value: 50, raw: null },
      { label: 'not_a_real_driver', value: 100, raw: null },
    ]);
    expect(result.drivers.map((d) => d.label)).toContain('not_a_real_driver');
  });
});

// ── rolledUpDriver ────────────────────────────────────────────────────

/** Minimal 5-dimension shape with one driver planted on `relevance`. */
function entryWithPedagogyFit(programId: string, value: number | null): {
  programId: string;
  facultyId: string | null;
  dimensions: Record<'attractiveness' | 'financial' | 'capability' | 'outcomes' | 'relevance', HealthScore>;
} {
  const empty: HealthScore = { score: null, dataCompletenessPct: 0, drivers: [] };
  return {
    programId,
    facultyId: 'fac-1',
    dimensions: {
      attractiveness: empty,
      financial: empty,
      capability: empty,
      outcomes: empty,
      relevance: {
        score: value,
        dataCompletenessPct: value === null ? 0 : 100,
        drivers: [{ label: 'pedagogical_fit', value, raw: null }],
      },
    },
  };
}

describe('rolledUpDriver', () => {
  const index: ProgramScoreIndex = new Map([
    ['p1', entryWithPedagogyFit('p1', 90)],
    ['p2', entryWithPedagogyFit('p2', 70)],
    ['p3', entryWithPedagogyFit('p3', null)],
  ]);

  it('averages non-null program driver values and records the sample', () => {
    const d = rolledUpDriverForTest(index, ['p1', 'p2', 'p3'], 'relevance', 'pedagogical_fit');
    expect(d.label).toBe('pedagogical_fit');
    // (90 + 70) / 2 — p3's null is excluded, never counted as 0.
    expect(d.value).toBe(80);
    expect(d.raw).toEqual({ rolledUp: true, fromPrograms: 2, ofPrograms: 3 });
  });

  it('is null — never 0 — when no program carries the driver', () => {
    const d = rolledUpDriverForTest(index, ['p3'], 'relevance', 'pedagogical_fit');
    expect(d.value).toBeNull();
    expect(d.raw).toEqual({ rolledUp: true, fromPrograms: 0, ofPrograms: 1 });
  });

  it('is null for an empty program set', () => {
    const d = rolledUpDriverForTest(index, [], 'relevance', 'pedagogical_fit');
    expect(d.value).toBeNull();
  });

  it('ignores program ids absent from the index', () => {
    const d = rolledUpDriverForTest(index, ['p1', 'ghost'], 'relevance', 'pedagogical_fit');
    expect(d.value).toBe(90);
    expect(d.raw).toEqual({ rolledUp: true, fromPrograms: 1, ofPrograms: 2 });
  });
});

// ── scope program population ──────────────────────────────────────────

describe('collectProgramIdsForScope — canonical+active only', () => {
  it('filters to ACTIVE programmes carrying a sheet sequence number', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([]);

    await computeHealthScores('university', null);

    // The scope scorers resolve their programme set through
    // collectProgramIdsForScope, whose projection is exactly { id: true }.
    // getProgramScoreIndex also selects facultyId, so this isolates the
    // collector's calls.
    const collectorCalls = mocks.programFindMany.mock.calls.filter(
      ([args]) => args?.select?.id === true && args?.select?.facultyId === undefined,
    );
    expect(collectorCalls.length).toBeGreaterThan(0);
    for (const [args] of collectorCalls) {
      // Before v5.0 this counted retired and non-canonical rows the
      // heatmap never showed, so the scope drivers averaged a different
      // population than the row they rendered on.
      expect(args.where).toMatchObject({
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
      });
    }
  });
});

// ── relevance at scope ────────────────────────────────────────────────

describe('scoreRelevanceScope — carries every per-programme driver', () => {
  it('carries all six canonical relevance drivers', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([
      { id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' },
    ]);
    mocks.programFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] }),
    );

    const rows = await computeHealthScores('university', null);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.dimensions.relevance.drivers.map((d) => d.label)).toEqual([
        'labour_market_alignment',
        'demand_match_filled',
        'demographic_resilience',
        'strategic_sector_alignment',
        'pedagogical_fit',
        'jobthai_demand_alignment',
      ]);
    }
  });

  it('rolls pedagogical_fit up as the mean of its programmes', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([
      { id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' },
      { id: 'prog-2', nameEn: 'B', nameTh: 'ข', facultyId: 'fac-1' },
    ]);
    mocks.programFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] }),
    );
    // 90 for prog-1, 70 for prog-2 → rolled up to 80.
    mocks.programPedagogyAssessmentFindUnique.mockImplementation(
      ({ where }: { where: { programId: string } }) =>
        Promise.resolve({
          overallScore: where.programId === 'prog-1' ? 90 : 70,
          disciplineFitScore: null,
          qaScore: null,
        }),
    );

    const rows = await computeHealthScores('university', null);
    const fit = rows[0]!.dimensions.relevance.drivers.find((d) => d.label === 'pedagogical_fit');
    expect(fit!.value).toBe(80);
    expect(fit!.raw).toMatchObject({ rolledUp: true, fromPrograms: 2, ofPrograms: 2 });
    // The dimension is no longer the mean of one surviving low driver.
    expect(rows[0]!.dimensions.relevance.score).toBe(80);
  });
});

// ── financial at scope ────────────────────────────────────────────────

/** A MetricRow with only the fields the financial/enrolment paths read. */
function metricRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    scope: 'faculty',
    scopeId: 'fac-1',
    year: 2025,
    applicationsTotal: null,
    admittedTotal: null,
    enrolledTotal: null,
    retainedYear2Total: null,
    graduatedOnTimeTotal: null,
    graduatedLateTotal: null,
    dropoutsTotal: null,
    tuitionRevenueTotal: null,
    totalCostTotal: null,
    netContributionTotal: null,
    employmentRateWeighted: null,
    averageSalaryWeighted: null,
    programCount: 1,
    latestFreshness: null,
    ...over,
  };
}

describe('scoreFinancialScope', () => {
  beforeEach(() => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.programFindMany.mockResolvedValue([
      { id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' },
    ]);
    mocks.programFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] }),
    );
  });

  it('computes net_contribution_per_student as ratio-of-sums', async () => {
    // ฿10,000,000 net over 100 students = ฿100k/student → the top of the
    // scale (50 + 100k/100k * 50 = 100). Aggregating rather than averaging
    // per-programme ratios is what stops a 7-student programme counting
    // as much as a 700-student one.
    mocks.queryMetricByScope.mockImplementation(({ family }: { family: string }) => {
      if (family === 'financial') {
        return Promise.resolve([metricRow({ netContributionTotal: 10_000_000, programCount: 2 })]);
      }
      if (family === 'enrollment') return Promise.resolve([metricRow({ enrolledTotal: 100 })]);
      return Promise.resolve([]);
    });

    const rows = await computeHealthScores('university', null);
    const perStudent = rows[0]!.dimensions.financial.drivers.find(
      (d) => d.label === 'net_contribution_per_student',
    );
    expect(perStudent!.value).toBe(100);
    expect(perStudent!.raw).toMatchObject({ netContributionTotal: 10_000_000, enrolled: 100 });
  });

  it('omits revenue_coverage_program_direct — revenue_coverage_ratio is the same metric aggregated', async () => {
    mocks.queryMetricByScope.mockResolvedValue([]);
    const rows = await computeHealthScores('university', null);
    const labels = rows[0]!.dimensions.financial.drivers.map((d) => d.label);
    // Carrying both would weight cost coverage twice in the mean.
    expect(labels).toContain('revenue_coverage_ratio');
    expect(labels).not.toContain('revenue_coverage_program_direct');
    expect(labels).toContain('tuition_trend_slope');
    expect(labels).toContain('revenue_scale');
    expect(labels).toContain('net_contribution_per_program');
  });

  it('the programme scorer omits the two scope-only drivers', async () => {
    mocks.queryMetricByScope.mockResolvedValue([]);
    const rows = await computeHealthScores('faculty', 'fac-1');
    expect(rows.length).toBeGreaterThan(0);
    const labels = rows[0]!.dimensions.financial.drivers.map((d) => d.label);
    expect(labels).toContain('revenue_coverage_program_direct');
    expect(labels).not.toContain('revenue_coverage_ratio');
    expect(labels).not.toContain('net_contribution_per_program');
  });
});

// ── the guard ─────────────────────────────────────────────────────────
//
// The drift this whole change fixes was invisible for four minor versions
// because nothing compared the two driver sets. This test is that
// comparison. Add a driver to one scorer and not the other and it fails.

describe('driver parity between program and scope scorers', () => {
  // Documented, intentional asymmetries only. Adding an entry here is a
  // methodology decision — say why.
  const SCOPE_ONLY = new Set([
    // ratio-of-sums analogue of revenue_coverage_program_direct; carrying
    // both at one scope would weight cost coverage twice.
    'revenue_coverage_ratio',
    // "what does the average program contribute" is undefined for one.
    'net_contribution_per_program',
  ]);
  const PROGRAM_ONLY = new Set([
    // see revenue_coverage_ratio above.
    'revenue_coverage_program_direct',
  ]);

  it('every canonical driver is reachable at both scopes', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([
      { id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' },
    ]);
    mocks.programFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] }),
    );

    const facultyRows = await computeHealthScores('university', null);
    expect(facultyRows.length).toBeGreaterThan(0);
    const faculty = facultyRows[0]!;
    const programRows = await computeHealthScores('faculty', faculty.scopeId);
    expect(programRows.length).toBeGreaterThan(0);
    const program = programRows[0]!;

    for (const dim of HEALTH_DIMENSIONS) {
      const facLabels = new Set(faculty.dimensions[dim].drivers.map((d) => d.label));
      const progLabels = new Set(program.dimensions[dim].drivers.map((d) => d.label));
      for (const label of DIMENSION_DRIVERS[dim]) {
        if (!SCOPE_ONLY.has(label)) {
          expect(progLabels, `${dim}.${label} missing at program scope`).toContain(label);
          // Presence of the LABEL proves nothing — summariseDrivers pads
          // every canonical label, so the assertion above passes even for
          // a driver no scorer builds. The marker is what has teeth.
          expect(
            faculty.dimensions[dim].drivers.find((d) => d.label === label)?.raw,
            `${dim}.${label} is padded at faculty scope — the scope scorer never builds it`,
          ).not.toEqual(DRIVER_NOT_COMPUTED);
        }
        if (!PROGRAM_ONLY.has(label)) {
          expect(facLabels, `${dim}.${label} missing at faculty scope`).toContain(label);
          expect(
            program.dimensions[dim].drivers.find((d) => d.label === label)?.raw,
            `${dim}.${label} is padded at program scope — the program scorer never builds it`,
          ).not.toEqual(DRIVER_NOT_COMPUTED);
        }
      }
    }
  });
});

describe('external-grant award is not a driver', () => {
  it('never appears in any dimension driver list at either scope', async () => {
    mocks.facultyFindMany.mockResolvedValue([
      { id: 'fac-1', nameEn: 'Faculty of Science', nameTh: 'คณะวิทยาศาสตร์' },
    ]);
    mocks.programFindMany.mockResolvedValue([
      { id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' },
    ]);
    mocks.programFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] }),
    );
    mocks.programFacultyFindMany.mockResolvedValue([
      { programId: 'prog-1', facultyMember: { id: 's1', rank: 'LECTURER', isActive: true, retirementDate: null } },
    ]);
    const faculty = (await computeHealthScores('university', null))[0]!;
    const program = (await computeHealthScores('faculty', faculty.scopeId))[0]!;
    for (const row of [faculty, program]) {
      for (const dim of Object.values(row.dimensions)) {
        expect(dim.drivers.map((d) => d.label)).not.toContain('external_grant_award');
        expect(dim.drivers.map((d) => d.label)).not.toContain('external_grant_engagement');
      }
    }
  });
});

// ── jobthai_demand_alignment (v5.1, revised v5.2) ─────────────────────────

describe('jobthai_demand_alignment', () => {
  function facultyWithOneProgramme(level: string): void {
    mocks.facultyFindMany.mockResolvedValue([{ id: 'fac-1', nameEn: 'Science', nameTh: 'วิทย์' }]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([{ id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' }]);
    mocks.programFindUnique.mockResolvedValue({ id: 'prog-1', level, nameTh: 'ก', kmitlCareerIds: [] });
    // Ten occupations, so a skill demanded by one of them is not generic.
    mocks.jobThaiOccupationCount.mockResolvedValue(10);
  }
  const link = (over: Partial<{ linkSource: string; postingCount: number; score: number }> = {}) => ({
    jobThaiOccupationId: 'o1',
    linkSource: 'field-of-study',
    postingCount: 500,
    score: 0.8,
    occupation: { category: 'งานวิศวกรรม', subcategory: 'งานวิศวกรเครื่องกล' },
    ...over,
  });
  const occSkill = (skillId: string, share = 0.3, occupationId = 'o1') => ({ jobThaiOccupationId: occupationId, skillId, share });

  it('is a canonical relevance driver', () => {
    expect(DIMENSION_DRIVERS.relevance).toContain('jobthai_demand_alignment');
  });

  // v5.2: the AI curriculum check (program_demand_matches) decides taught /
  // relevant. Exact skill-ID overlap read 0 for 29 of 41 programmes on dev —
  // curricula say "Legal Drafting", postings say "Litigation".
  function aiMatches(rows: Array<{ skillId: string; matched: boolean; relevant?: boolean; sources?: string[] }>): void {
    mocks.programDemandMatchFindMany.mockImplementation(async (args: { where?: { demandSources?: { has?: string }; skillId?: { in?: string[] } } }) => {
      const has = args?.where?.demandSources?.has;
      const inIds = args?.where?.skillId?.in;
      return rows
        .map((r) => ({ relevant: true, sources: ['jobthai'], ...r }))
        .filter((r) => (has ? r.sources.includes(has) : true))
        .filter((r) => (inIds ? inIds.includes(r.skillId) : true))
        .map((r) => ({ skillId: r.skillId, matched: r.matched, relevant: r.relevant, programId: 'prog-1' }));
    });
  }

  it('is the share of RELEVANT JobThai-demanded skills the curriculum covers', async () => {
    facultyWithOneProgramme('BACHELOR');
    mocks.programJobThaiLinkFindMany.mockResolvedValue([link()]);
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue(ids.map((id) => occSkill(id)));
    // s7 judged irrelevant to the discipline: out of the denominator. 3 of 6 taught.
    aiMatches([
      { skillId: 's1', matched: true },
      { skillId: 's2', matched: true },
      { skillId: 's3', matched: true },
      { skillId: 's4', matched: false },
      { skillId: 's5', matched: false },
      { skillId: 's6', matched: false },
      { skillId: 's7', matched: false, relevant: false },
    ]);

    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBe(50);
  });

  it('is NULL when too few relevant skills were checked for the ratio to be stable', async () => {
    // MEASURED: two identical AI runs gave BBA Marketing 33 then 67 — a
    // three-skill ratio moves a whole third on one changed decision.
    facultyWithOneProgramme('BACHELOR');
    mocks.programJobThaiLinkFindMany.mockResolvedValue([link()]);
    const ids = Array.from({ length: JOBTHAI_MIN_RELEVANT_SKILLS - 1 }, (_, i) => `k${i}`);
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue(ids.map((id) => occSkill(id)));
    aiMatches(ids.map((skillId) => ({ skillId, matched: true })));
    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBeNull();
  });

  it('ignores LinkedIn-only match rows', async () => {
    facultyWithOneProgramme('BACHELOR');
    mocks.programJobThaiLinkFindMany.mockResolvedValue([link()]);
    const ids = ['s1', 's2', 's3', 's4', 's5', 'li'];
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue(ids.map((id) => occSkill(id)));
    aiMatches([
      ...['s1', 's2', 's3', 's4', 's5'].map((skillId) => ({ skillId, matched: true })),
      { skillId: 'li', matched: false, sources: ['kmitl-skill-mapping'] },
    ]);
    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    // 'li' was checked as LinkedIn demand only, so its gap does not count here.
    expect(d!.value).toBe(100);
  });

  it('is NULL, not 0, before the AI curriculum check has run', async () => {
    facultyWithOneProgramme('BACHELOR');
    mocks.programJobThaiLinkFindMany.mockResolvedValue([link()]);
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue([occSkill('s1')]);
    aiMatches([]);
    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBeNull();
  });

  it('does not count a generic skill even if the AI matched it', async () => {
    // "comm" is demanded by 3 of 10 occupations (> 20%) — teaching it says
    // nothing about fit to THIS field's jobs.
    facultyWithOneProgramme('BACHELOR');
    mocks.programJobThaiLinkFindMany.mockResolvedValue([link()]);
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue([
      ...ids.map((id) => occSkill(id)), occSkill('comm'), occSkill('comm', 0.3, 'o2'), occSkill('comm', 0.3, 'o3'),
    ]);
    aiMatches([...ids.map((skillId) => ({ skillId, matched: false })), { skillId: 'comm', matched: true }]);
    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBe(0);
  });

  it('is NULL when the only links are skill-overlap — they cannot vouch for themselves', async () => {
    // v5.1 scored these, and every one read >= 50 by construction: the overlap
    // path links a programme exactly when its taught skills are demanded.
    facultyWithOneProgramme('BACHELOR');
    mocks.programSkillFindMany.mockResolvedValue([{ skillId: 's1' }, { skillId: 's2' }]);
    mocks.programJobThaiLinkFindMany.mockResolvedValue([link({ linkSource: 'skill-overlap' })]);
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue([occSkill('s1'), occSkill('s2')]);

    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBeNull();
  });

  it('is NULL, never 0, for a postgraduate programme', async () => {
    // Not because no field matched — 82% of doctoral programmes DO match one —
    // but because the postings behind those matches require only a bachelor's.
    // Only 41 of 47,631 postings state a postgraduate minimum, so the bridge
    // leaves postgraduate programmes with no eligible link.
    facultyWithOneProgramme('DOCTORAL');
    mocks.programSkillFindMany.mockResolvedValue([{ skillId: 's1' }]);
    mocks.programJobThaiLinkFindMany.mockResolvedValue([]);

    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBeNull();
  });

  it('is NULL below the signal floor rather than scoring a handful of adverts', async () => {
    facultyWithOneProgramme('BACHELOR');
    mocks.programSkillFindMany.mockResolvedValue([{ skillId: 's1' }]);
    mocks.programJobThaiLinkFindMany.mockResolvedValue([link({ postingCount: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL - 1, score: 0.9 })]);
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue([occSkill('s1')]);

    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBeNull();
  });

});

// ── Domestic 75 : global 25 (v5.2) ────────────────────────────────────────

describe('relevance — labour-market demand weighting', () => {
  const others = [
    { label: 'demand_match_filled', value: 60, raw: null },
    { label: 'demographic_resilience', value: 60, raw: null },
    { label: 'strategic_sector_alignment', value: 60, raw: null },
    { label: 'pedagogical_fit', value: 60, raw: null },
  ];

  it('splits the labour-market pair 75:25 without changing the pair’s weight in the dimension', () => {
    // Pair value = 0.75 × 80 + 0.25 × 40 = 70, still worth TWO drivers:
    // (2 × 70 + 4 × 60) / 6 = 63.33. Counting the pair as one slot would have
    // halved labour-market's say in Relevance — measured on dev, Industrial
    // Engineering rose 66 -> 78 purely from that artefact.
    const r = summariseDriversForTest('relevance', [
      { label: 'jobthai_demand_alignment', value: 80, raw: null },
      { label: 'labour_market_alignment', value: 40, raw: null },
      ...others,
    ]);
    expect(r.score).toBeCloseTo((2 * 70 + 4 * 60) / 6, 6);
    expect(LABOUR_MARKET_DEMAND_WEIGHTS).toEqual({ jobthai_demand_alignment: 0.75, labour_market_alignment: 0.25 });
  });

  it('uses whichever source exists at its ordinary one-driver weight when the other is null', () => {
    // A missing source is a data gap: it must not drag the slot toward 0, and
    // LinkedIn alone must not be discounted to a quarter of a driver.
    const onlyGlobal = summariseDriversForTest('relevance', [
      { label: 'labour_market_alignment', value: 40, raw: null },
      ...others,
    ]);
    expect(onlyGlobal.score).toBeCloseTo((40 + 4 * 60) / 5, 6);
    const onlyDomestic = summariseDriversForTest('relevance', [
      { label: 'jobthai_demand_alignment', value: 80, raw: null },
      ...others,
    ]);
    expect(onlyDomestic.score).toBeCloseTo((80 + 4 * 60) / 5, 6);
  });

  it('keeps both drivers visible and counts both toward completeness', () => {
    const r = summariseDriversForTest('relevance', [
      { label: 'jobthai_demand_alignment', value: 80, raw: null },
      { label: 'labour_market_alignment', value: 40, raw: null },
    ]);
    expect(r.drivers.find((d) => d.label === 'jobthai_demand_alignment')?.value).toBe(80);
    expect(r.drivers.find((d) => d.label === 'labour_market_alignment')?.value).toBe(40);
    expect(r.dataCompletenessPct).toBeCloseTo((2 / DIMENSION_DRIVERS.relevance.length) * 100, 5);
    expect(r.score).toBeCloseTo(70, 6);
  });

  it('leaves the other dimensions equally weighted', () => {
    const r = summariseDriversForTest('capability', [
      { label: 'senior_rank_share', value: 80, raw: null },
      { label: 'student_faculty_ratio', value: 40, raw: null },
    ]);
    expect(r.score).toBe(60);
  });
});
