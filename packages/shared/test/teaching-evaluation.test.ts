import { describe, expect, it } from 'vitest';
import {
  summariseTeachingEvaluation,
  type EvaluationSource,
} from '../src/staff-profile/teaching-evaluation';

const q = (
  themeTag: string | null,
  ratingAvg: number,
  respondentCount: number,
  byYear: Record<string, { ratingAvg: number; respondentCount: number }>,
) => ({ themeTag, ratingAvg, respondentCount, byYear });

const course = (courseCode: string, latestYearBE: number, latestSemester: number, ratingAvg = 4.5, respondentCount = 100) => ({
  courseCode,
  courseNameTh: `วิชา ${courseCode}`,
  courseNameEn: null,
  ratingAvg,
  respondentCount,
  latestYearBE,
  latestSemester,
});

const result: EvaluationSource = {
  methodologyVersion: 'kku-evaluations.v1',
  summary: { ratingAvg: 4.35, totalRespondents: 400, courseCount: 2 },
  trend: [
    { acadYearBE: 2567, ratingAvg: 4.2, respondentCount: 100 },
    { acadYearBE: 2567, ratingAvg: 4.4, respondentCount: 100 },
    { acadYearBE: 2568, ratingAvg: 4.6, respondentCount: 150 },
    { acadYearBE: 2568, ratingAvg: null, respondentCount: 0 },
  ],
  byQuestion: [
    q('active-learning', 4.4, 100, { '2567': { ratingAvg: 4.2, respondentCount: 50 }, '2568': { ratingAvg: 4.6, respondentCount: 50 } }),
    q('active-learning', 4.2, 300, { '2567': { ratingAvg: 4.0, respondentCount: 150 }, '2568': { ratingAvg: 4.4, respondentCount: 150 } }),
    q('ethics', 4.5, 100, { '2567': { ratingAvg: 4.5, respondentCount: 100 } }),
    q(null, 4.0, 100, { '2568': { ratingAvg: 4.0, respondentCount: 100 } }),
  ],
  byCourse: [],
};

describe('summariseTeachingEvaluation', () => {
  const s = summariseTeachingEvaluation(result, '2026-09-30T00:00:00.000Z')!;

  it('carries the overall KPIs', () => {
    expect(s.overall).toBeCloseTo(4.35);
    expect(s.totalAnswers).toBe(400);
    expect(s.courseCount).toBe(2);
    expect(s.termCount).toBe(3); // terms with answers; BE 2568 S2 has none
    expect([s.firstYearBE, s.lastYearBE]).toEqual([2567, 2568]);
  });

  it('rates the latest and previous academic year, respondent-weighted across terms with data', () => {
    expect(s.latestYearBE).toBe(2568);
    expect(s.latestRating).toBeCloseTo(4.6); // S2 has no data and is excluded
    expect(s.previousYearBE).toBe(2567);
    expect(s.previousRating).toBeCloseTo(4.3);
  });

  it('weights category scores by respondents, all-time and latest year', () => {
    const al = s.categories.find((c) => c.tag === 'active-learning')!;
    expect(al.allTime).toBeCloseTo((4.4 * 100 + 4.2 * 300) / 400);
    expect(al.latest).toBeCloseTo((4.6 * 50 + 4.4 * 150) / 200);
    expect(al.questions).toBe(2);
  });

  it('reports a category with no answers in the latest year as null, never 0', () => {
    expect(s.categories.find((c) => c.tag === 'ethics')!.latest).toBeNull();
  });

  it('counts untagged questions without giving them an axis', () => {
    expect(s.untaggedQuestions).toBe(1);
    expect(s.categories.map((c) => c.tag)).toEqual(['active-learning', 'ethics']);
  });

  it('treats an empty-string themeTag as untagged, not as a category named ""', () => {
    const t = summariseTeachingEvaluation(
      { ...result, byQuestion: [...result.byQuestion, q('', 3.9, 50, {})] },
      null,
    )!;
    expect(t.untaggedQuestions).toBe(2);
    expect(t.categories.map((c) => c.tag)).toEqual(['active-learning', 'ethics']);
  });

  it('returns null when there are no answers at all', () => {
    expect(summariseTeachingEvaluation({ ...result, summary: { ...result.summary, totalRespondents: 0 } }, null)).toBeNull();
  });

  it('has no courses when the source has none', () => {
    expect(s.courses).toEqual([]);
  });

  it('lists courses newest term first, then by code, carrying name, rating and answers', () => {
    const t = summariseTeachingEvaluation(
      {
        ...result,
        byCourse: [
          course('CS200', 2567, 2),
          course('CS100', 2568, 1, 4.1, 30),
          course('CS300', 2568, 2),
          course('CS050', 2568, 1),
        ],
      },
      null,
    )!;
    expect(t.courses.map((c) => c.code)).toEqual(['CS300', 'CS050', 'CS100', 'CS200']);
    expect(t.courses.find((c) => c.code === 'CS100')).toEqual({
      code: 'CS100',
      nameTh: 'วิชา CS100',
      nameEn: null,
      rating: 4.1,
      answers: 30,
      latestYearBE: 2568,
      latestSemester: 1,
    });
  });
});
