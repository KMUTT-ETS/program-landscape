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
      demographicProjection: { findFirst: mocks.demographicFindFirst },
      kmitlCareer: { findMany: mocks.kmitlCareerFindMany },
      graduateOutcome: { findFirst: mocks.graduateOutcomeFindFirst },
      programPedagogyAssessment: { findUnique: mocks.programPedagogyAssessmentFindUnique },
      systemSetting: { findUnique: mocks.systemSettingFindUnique },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      admissionCampaignStat: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };
});

vi.mock('../src/scope', async () => {
  const actual = await vi.importActual<typeof import('../src/scope')>('../src/scope');
  return { ...actual, queryMetricByScope: mocks.queryMetricByScope };
});

import {
  computeHealthScores,
  DIMENSION_DRIVERS,
  invalidateProgramScoreIndexCache,
  rolledUpDriverForTest,
  summariseDriversForTest,
  type HealthScore,
  type ProgramScoreIndex,
} from '../src/health-score';
import { invalidateAcademicYearCache } from '../src/academic-year';

beforeEach(() => {
  invalidateAcademicYearCache();
  // The program-score index memo is per-process. Without this a later
  // test reads the program set an earlier test mocked, and the failure
  // looks like a scorer bug.
  invalidateProgramScoreIndexCache();
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
    // 1 of 5, NOT 1 of 1.
    expect(result.dataCompletenessPct).toBeCloseTo(20, 5);
    expect(result.drivers.map((d) => d.label)).toEqual([...DIMENSION_DRIVERS.relevance]);
    const padded = result.drivers.find((d) => d.label === 'pedagogical_fit');
    expect(padded).toBeDefined();
    expect(padded!.value).toBeNull();
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

describe('scoreRelevanceScope — no longer drops the per-programme drivers', () => {
  it('carries all five canonical relevance drivers', async () => {
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
