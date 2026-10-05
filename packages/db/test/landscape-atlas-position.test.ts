import { describe, expect, it } from 'vitest';
import {
  actionQuadrant,
  buildGrowthShare,
  buildHealthRisk,
  buildPosition,
  growthQuadrant,
  type GrowthShareInput,
  type HealthRiskInput,
} from '../src/landscape-atlas/position';

const gs = (over: Partial<GrowthShareInput>): GrowthShareInput => ({
  programId: 'p',
  code: 'C',
  nameTh: 'ท',
  nameEn: 'E',
  facultyCode: 'F',
  applications: 300,
  seats: 100,
  tcasYearBe: 2568,
  enrolmentChangePct: 10,
  activeStudents: 200,
  contributionPerStudentThb: 5000,
  ...over,
});

const hr = (over: Partial<HealthRiskInput>): HealthRiskInput => ({
  programId: 'p',
  code: 'C',
  nameTh: 'ท',
  nameEn: 'E',
  facultyCode: 'F',
  health: 70,
  riskMatrixScore: 6,
  riskLevel: 'MODERATE',
  activeStudents: 100,
  ...over,
});

describe('growthQuadrant (split at 1.0 applications per seat and 0 % change)', () => {
  it('assigns the four quadrants with the split lines inclusive on the strong side', () => {
    expect(growthQuadrant(1, 0.1)).toBe('star');
    expect(growthQuadrant(1, 0)).toBe('cash-cow');
    expect(growthQuadrant(0.99, 5)).toBe('question');
    expect(growthQuadrant(0.99, 0)).toBe('dog');
  });
});

describe('actionQuadrant (split at health 65 and KKU risk 10)', () => {
  it('assigns the four quadrants at the exact split values', () => {
    expect(actionQuadrant(64.9, 10)).toBe('act-now');
    expect(actionQuadrant(65, 10)).toBe('watch');
    expect(actionQuadrant(64.9, 9)).toBe('fix-quietly');
    expect(actionQuadrant(65, 9)).toBe('protect');
  });
});

describe('buildGrowthShare', () => {
  it('lists programmes it cannot place, with the reason', () => {
    const out = buildGrowthShare([
      gs({ programId: 'a', applications: null }),
      gs({ programId: 'b', seats: 0 }),
      gs({ programId: 'c', applications: 0 }),
      gs({ programId: 'd', enrolmentChangePct: null }),
      gs({ programId: 'e' }),
    ]);
    expect(out.unplotted.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'No TCAS data'],
      ['b', 'No TCAS seats (quota 0)'],
      ['c', 'No TCAS applications'],
      ['d', 'No enrolment three years ago'],
    ]);
    expect(out.points.map((p) => p.id)).toEqual(['e']);
  });

  it('places the split at 1.0 and 0 %, counts quadrants, colours by contribution', () => {
    const out = buildGrowthShare([
      gs({ programId: 'star', applications: 400, seats: 100, enrolmentChangePct: 20, contributionPerStudentThb: 100 }),
      gs({ programId: 'dog', applications: 50, seats: 100, enrolmentChangePct: -30, contributionPerStudentThb: -100 }),
      gs({ programId: 'q', applications: 80, seats: 100, enrolmentChangePct: 5, contributionPerStudentThb: null }),
    ]);
    expect(out.counts).toEqual({ star: 1, 'cash-cow': 0, question: 1, dog: 1 });
    const star = out.points.find((p) => p.id === 'star')!;
    const dog = out.points.find((p) => p.id === 'dog')!;
    expect(star.x).toBeGreaterThan(out.frame.split!.x);
    expect(dog.x).toBeLessThan(out.frame.split!.x);
    expect(star.y).toBeGreaterThan(out.frame.split!.y);
    expect([star.tone, dog.tone, out.points.find((p) => p.id === 'q')!.tone]).toEqual(['positive', 'negative', 'neutral']);
  });

  it('clamps extreme enrolment growth to the axis instead of squashing the chart', () => {
    const out = buildGrowthShare([gs({ programId: 'a', enrolmentChangePct: 900 }), gs({ programId: 'b', enrolmentChangePct: 0 })]);
    expect(out.points.find((p) => p.id === 'a')!.y).toBe(100);
    expect(out.points.find((p) => p.id === 'a')!.values['Enrolment change (3 yr, %)']).toBe(900);
  });
});

describe('buildHealthRisk', () => {
  it('lists NEEDS_DATA risk and missing health, plots the rest with risk-level tones', () => {
    const out = buildHealthRisk([
      hr({ programId: 'a', riskLevel: 'NEEDS_DATA', riskMatrixScore: null }),
      hr({ programId: 'b', health: null }),
      hr({ programId: 'c', health: 50, riskMatrixScore: 16, riskLevel: 'VERY_HIGH' }),
      hr({ programId: 'd', health: 80, riskMatrixScore: 2, riskLevel: 'LOW' }),
    ]);
    expect(out.unplotted.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'Risk needs data'],
      ['b', 'No health score'],
    ]);
    expect(out.counts).toEqual({ 'act-now': 1, watch: 0, 'fix-quietly': 0, protect: 1 });
    expect(out.points.map((p) => p.tone)).toEqual(['negative', 'positive']);
    expect(out.frame.split).toEqual({ x: 65, y: 37.5 });
  });
});

describe('buildPosition answer', () => {
  it('leads with "act now" and adds the Dogs', () => {
    const out = buildPosition(
      buildGrowthShare([gs({ programId: 'dog', applications: 10, enrolmentChangePct: -5 })]),
      buildHealthRisk([hr({ programId: 'x', health: 40, riskMatrixScore: 12, riskLevel: 'HIGH' })]),
      'now',
    );
    expect(out.answer).toEqual({
      figure: '1',
      sentence:
        '1 bachelor programme sits in "act now" (health below 65 and KKU risk score 10 or more); 1 is a Dog on the growth–share matrix.',
    });
  });

  it('falls back when neither chart has a point', () => {
    expect(buildPosition(buildGrowthShare([]), buildHealthRisk([]), 'now').answer.figure).toBeNull();
  });
});
