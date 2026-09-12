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
  summariseDriversForTest,
} from '../src/health-score';
import { invalidateAcademicYearCache } from '../src/academic-year';

beforeEach(() => {
  invalidateAcademicYearCache();
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
