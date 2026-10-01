import { describe, expect, it } from 'vitest';
import { evaluationRadarDomain, summariseTeachingEvaluation } from '@/lib/teaching-evaluation-summary';

// The summary logic and its tests live in @kku/shared
// (packages/shared/test/teaching-evaluation.test.ts); only the radar's axis
// rule is web-side.

describe('teaching-evaluation-summary re-export', () => {
  it('still exposes the shared summariser to the panel', () => {
    expect(typeof summariseTeachingEvaluation).toBe('function');
  });
});

describe('evaluationRadarDomain', () => {
  it('starts at 3 unless a plotted value is lower, then floors to the half point below it', () => {
    expect(evaluationRadarDomain([4.2, 4.6, null])).toEqual([3, 5]);
    expect(evaluationRadarDomain([2.7, 4.1])).toEqual([2.5, 5]);
    expect(evaluationRadarDomain([null])).toEqual([3, 5]);
  });
});
