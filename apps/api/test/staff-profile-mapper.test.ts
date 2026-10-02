import { describe, expect, it } from 'vitest';
import {
  StaffProfileResponseDataSchema,
  type StaffGrantsSummary,
  type TeachingEvaluationSummary,
} from '@kku/shared';
import { toStaffProfileResponse } from '../src/external/staff-profile.mapper';
import { staffProfileFixture } from './fixtures/staff-profile';

const ALL = ['affiliation', 'education', 'teaching', 'research', 'publications', 'teachingEvaluation', 'grants'];

const evaluation = (): TeachingEvaluationSummary => ({
  overall: 4.348,
  totalAnswers: 1880,
  courseCount: 2,
  termCount: 3,
  firstYearBE: 2566,
  lastYearBE: 2568,
  latestYearBE: 2568,
  latestRating: 4.4,
  previousYearBE: 2567,
  previousRating: 4.3,
  categories: [
    { tag: 'ethics', questions: 2, allTime: 4.4, latest: 4.5 },
    { tag: 'unmapped-tag', questions: 1, allTime: 4.1, latest: null },
  ],
  untaggedQuestions: 1,
  courses: [
    { code: '000102', nameTh: 'ข', nameEn: null, rating: 4.2, answers: 900, latestYearBE: 2568, latestSemester: 2 },
    { code: '000101', nameTh: 'ก', nameEn: 'A', rating: 4.5, answers: 980, latestYearBE: 2567, latestSemester: 1 },
  ],
  freshnessDate: '2026-09-30T00:00:00.000Z',
  methodologyVersion: 'evaluations.v1',
});
const grant = (allowedSections: string[], allowEmailLookup = true) => ({ allowedSections, allowEmailLookup });

describe('toStaffProfileResponse', () => {
  it('produces a body that satisfies the v1 wire schema', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(ALL), {
      teachingEvaluation: evaluation(),
      grants: { led: 0, coInvestigator: 0, active: 0,
        byType: { RESEARCH: 0, ACADEMIC_SERVICE: 0, CONSULTING: 0, OTHER: 0 }, projects: [], freshnessDate: null },
    });
    expect(StaffProfileResponseDataSchema.safeParse(data).success).toBe(true);
    expect(data.teachingEvaluation).not.toBeUndefined();
    expect(data.grants).toBeDefined();
  });

  it('always returns person; returns only granted sections; lists the rest as withheld', () => {
    const r = toStaffProfileResponse(staffProfileFixture(), grant(['education']));
    expect(Object.keys(r.data).sort()).toEqual(['education', 'person']);
    expect(r.included).toEqual(['person', 'education']);
    expect(r.withheld).toEqual([
      'affiliation', 'teaching', 'research', 'publications', 'teachingEvaluation', 'grants',
    ]);
  });

  it('takes the title abbreviation from the builder, not a table of its own', () => {
    const p = staffProfileFixture();
    p.basic = { ...p.basic, rankAbbrevTh: 'รศ.x', rankAbbrevEn: 'Assoc.x' };
    const { title } = toStaffProfileResponse(p, grant([])).data.person;
    expect(title).toMatchObject({ abbrevTh: 'รศ.x', abbrevEn: 'Assoc.x' });
  });

  it('withholds the staff email unless the client holds email lookup', () => {
    expect(toStaffProfileResponse(staffProfileFixture(), grant([], false)).data.person.email).toBeNull();
    expect(toStaffProfileResponse(staffProfileFixture(), grant([], true)).data.person.email).toBe('somchai@kku.ac.th');
  });

  it('sorts publications by year desc, then citations desc, then title', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['publications']));
    expect(data.publications!.map((p) => p.title)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('carries each paper source, the research basis and an APA string', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['publications', 'research']));
    expect(data.publications![0]).toMatchObject({ source: 'google-scholar', scholarPaperId: 'sp1' });
    expect(data.publications![2]!.apa).toContain('Jaidee');
    expect(data.research!.basis).toBe('library');
  });

  it('maps teaching totals and every course', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['teaching']));
    expect(data.teaching!.totals.studentsTaught).toBe(180);
    expect(data.teaching!.courses).toHaveLength(1);
    expect(data.teaching!.byYear[0]).toEqual({ yearBE: 2569, sections: 2, studentsTaught: 90, contactHrsPerWeek: 12 });
  });

  it('maps a granted teaching evaluation to the wire shape', () => {
    const r = toStaffProfileResponse(staffProfileFixture(), grant(['teachingEvaluation']), {
      teachingEvaluation: evaluation(),
    });
    const t = r.data.teachingEvaluation!;
    expect(StaffProfileResponseDataSchema.safeParse(r.data).success).toBe(true);
    expect(t.scale).toEqual({ min: 1, max: 5 });
    expect(t).toMatchObject({ overall: 4.348, totalAnswers: 1880, courseCount: 2, untaggedQuestions: 1 });
    expect(t.categories[0]).toEqual({
      tag: 'ethics', labelEn: 'Ethics', labelTh: 'คุณธรรมจริยธรรม', questions: 2, latest: 4.5, allTime: 4.4,
    });
    // An unknown tag keeps the tag as its label rather than vanishing.
    expect(t.categories[1]).toMatchObject({ tag: 'unmapped-tag', labelEn: 'unmapped-tag', labelTh: 'unmapped-tag' });
    expect(t.courses.map((c) => c.code)).toEqual(['000102', '000101']);
    expect(t.courses[1]).toEqual({
      code: '000101', nameTh: 'ก', nameEn: 'A', rating: 4.5, answers: 980, latestYearBE: 2567, latestSemester: 1,
    });
    // Internal bookkeeping stays off the wire.
    expect(t).not.toHaveProperty('freshnessDate');
    expect(t).not.toHaveProperty('methodologyVersion');
    expect(r.included).toEqual(['person', 'teachingEvaluation']);
    expect(r.withheld).not.toContain('teachingEvaluation');
  });

  it('returns null, not absent, when granted but nothing is on record', () => {
    const r = toStaffProfileResponse(staffProfileFixture(), grant(['teachingEvaluation']), {
      teachingEvaluation: null,
    });
    expect(r.data).toHaveProperty('teachingEvaluation', null);
    expect(r.included).toContain('teachingEvaluation');
    expect(StaffProfileResponseDataSchema.safeParse(r.data).success).toBe(true);
  });

  it('omits the evaluation when not granted, even if one was supplied', () => {
    const r = toStaffProfileResponse(staffProfileFixture(), grant(['education']), {
      teachingEvaluation: evaluation(),
    });
    expect(r.data).not.toHaveProperty('teachingEvaluation');
    expect(r.withheld).toContain('teachingEvaluation');
  });

  it('refuses to answer a granted evaluation it was never given, rather than claim none exist', () => {
    expect(() => toStaffProfileResponse(staffProfileFixture(), grant(['teachingEvaluation']))).toThrow(
      /not loaded/,
    );
  });

  describe('grants', () => {
    const grants = (): StaffGrantsSummary => ({
      led: 1, coInvestigator: 0, active: 0,
      byType: { RESEARCH: 1, ACADEMIC_SERVICE: 0, CONSULTING: 0, OTHER: 0 },
      projects: [{ sourceProposalId: 9, titleTh: 'ก', titleEn: null, type: 'RESEARCH', role: 'LEAD', fiscalYearBe: 2568,
        startDate: null, endDate: null, funderName: null, budgetThb: 10, workflowStatus: 's', teamSize: 2 }],
      freshnessDate: '2026-10-02T04:00:00.000Z',
    });

    it('maps granted grants without freshness, and the result satisfies the wire schema', () => {
      const r = toStaffProfileResponse(staffProfileFixture(), grant(['grants']), { grants: grants() });
      expect(StaffProfileResponseDataSchema.safeParse(r.data).success).toBe(true);
      expect(r.data.grants!.projects[0]!.sourceProposalId).toBe(9);
      expect(r.data.grants).not.toHaveProperty('freshnessDate');
      expect(r.included).toContain('grants');
    });

    it('builds from a whitelist: an extra property on a project never reaches the wire', () => {
      const g = grants();
      (g.projects[0] as unknown as Record<string, unknown>).citizenIdHash = 'deadbeef';
      (g as unknown as Record<string, unknown>).leakedTop = 'x';
      const r = toStaffProfileResponse(staffProfileFixture(), grant(['grants']), { grants: g });
      expect(r.data.grants!.projects[0]).not.toHaveProperty('citizenIdHash');
      expect(r.data.grants).not.toHaveProperty('leakedTop');
      expect(Object.keys(r.data.grants!.projects[0]!).sort()).toEqual([
        'budgetThb', 'endDate', 'fiscalYearBe', 'funderName', 'role', 'sourceProposalId',
        'startDate', 'teamSize', 'titleEn', 'titleTh', 'type', 'workflowStatus',
      ]);
      expect(StaffProfileResponseDataSchema.safeParse(r.data).success).toBe(true);
    });

    it('refuses a granted grants section that was never loaded', () => {
      expect(() => toStaffProfileResponse(staffProfileFixture(), grant(['grants']))).toThrow(/grants is granted/);
    });

    it('withholds grants by default', () => {
      expect(toStaffProfileResponse(staffProfileFixture(), grant(['education'])).withheld).toContain('grants');
    });
  });
});
