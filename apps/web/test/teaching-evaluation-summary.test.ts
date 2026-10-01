import { describe, expect, it } from 'vitest';
import { evaluationRadarDomain, summariseTeachingEvaluation } from '@/lib/teaching-evaluation-summary';
import type { InstructorPersonalResult } from '@kku/db';

const q = (themeTag: string | null, ratingAvg: number, respondentCount: number, byYear: Record<string, { ratingAvg: number; respondentCount: number }>) => ({
  questionId: Math.random().toString(), questionIdRegistrar: 'Q', questionTextTh: 'q', questionTextEn: null, themeTag,
  ratingAvg, cellCount: 1, respondentCount, byYear,
});

const result: InstructorPersonalResult = {
  methodologyVersion: 'kku-evaluations.v1',
  summary: { ratingAvg: 4.35, totalRespondents: 400, cellCount: 8, courseCount: 2, questionCount: 4, semestersObserved: 4 },
  trend: [
    { acadYearBE: 2567, semester: 1, label: 'BE 2567 / S1', ratingAvg: 4.2, respondentCount: 100, cellCount: 2, courseCount: 1 },
    { acadYearBE: 2567, semester: 2, label: 'BE 2567 / S2', ratingAvg: 4.4, respondentCount: 100, cellCount: 2, courseCount: 1 },
    { acadYearBE: 2568, semester: 1, label: 'BE 2568 / S1', ratingAvg: 4.6, respondentCount: 150, cellCount: 2, courseCount: 2 },
    { acadYearBE: 2568, semester: 2, label: 'BE 2568 / S2', ratingAvg: null, respondentCount: 0, cellCount: 0, courseCount: 0 },
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

  it('returns null when there are no answers at all', () => {
    expect(summariseTeachingEvaluation({ ...result, summary: { ...result.summary, totalRespondents: 0 } }, null)).toBeNull();
  });
});

describe('evaluationRadarDomain', () => {
  it('starts at 3 unless a plotted value is lower, then floors to the half point below it', () => {
    expect(evaluationRadarDomain([4.2, 4.6, null])).toEqual([3, 5]);
    expect(evaluationRadarDomain([2.7, 4.1])).toEqual([2.5, 5]);
    expect(evaluationRadarDomain([null])).toEqual([3, 5]);
  });
});
