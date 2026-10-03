import { describe, expect, it } from 'vitest';
import {
  PROGRAM_OVERLAP_RECOMMENDATION_VERSION,
  ProgramOverlapRecommendationSchema,
  buildProgramOverlapRecommendationMessages,
  overlapRecommendationConfidenceCeiling,
  type ProgramOverlapRecommendationInput,
} from '../src/ai/prompts/program-overlap-recommendation';

const valid = {
  rationale: 'x'.repeat(120),
  distinctiveA: 'Programme A covers field work.',
  distinctiveB: 'Programme B covers lab analytics.',
  nextSteps: ['Faculty curriculum committees meet to compare syllabi.', 'Registrar merges the shared course sections.'],
  confidence: 0.7,
  disagreesWithAction: false,
  disagreementReason: null,
};

const input: ProgramOverlapRecommendationInput = {
  programA: { code: 'KKU-SEQ-0001', nameTh: 'วิทยาการคอมพิวเตอร์', nameEn: 'Computer Science', faculty: 'Science', latestIntake: 120 },
  programB: { code: 'KKU-SEQ-0002', nameTh: 'วิศวกรรมคอมพิวเตอร์', nameEn: null, faculty: 'Engineering', latestIntake: null },
  level: 'BACHELOR',
  scores: { structure: 40, content: 60, outcome: 55, overlapIndex: 58, containmentAInB: 50, containmentBInA: 45, marketSimilarity: 75 },
  sharedCredits: 9,
  equivCredits: 6,
  sharedStaff: 2,
  languageVariant: false,
  actions: ['DIFFERENTIATE', 'COORDINATE_SHARED_COURSES'],
  evidence: {
    sharedCourses: [{ code: 'CS101', credits: 3, nameTh: 'การเขียนโปรแกรม' }],
    equivalentCourses: [{ codeA: 'A1', codeB: 'B1', nameA: 'a', nameB: 'b', credits: 3, similarity: 0.91, basis: 'name' }],
    matchedPlos: [{ textA: 'plo a', textB: 'plo b', similarity: 0.85 }],
    unmatchedPlosA: ['only a'],
    unmatchedPlosB: [],
    coverage: { majorCoursesA: 10, majorCoursesB: 12, describedA: 8, describedB: 9, descriptionMatches: 0, plosA: 5, plosB: 6 },
  },
  marketTextA: 'market a',
  marketTextB: 'market b',
};

describe('program-overlap-recommendation prompt', () => {
  it('has the v1 version string', () => {
    expect(PROGRAM_OVERLAP_RECOMMENDATION_VERSION).toBe('program-overlap-recommendation.v1');
  });

  it('accepts a valid object', () => {
    expect(ProgramOverlapRecommendationSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects 1 or 5 nextSteps and confidence above 1', () => {
    expect(ProgramOverlapRecommendationSchema.safeParse({ ...valid, nextSteps: [valid.nextSteps[0]] }).success).toBe(false);
    expect(
      ProgramOverlapRecommendationSchema.safeParse({ ...valid, nextSteps: Array(5).fill(valid.nextSteps[0]) }).success,
    ).toBe(false);
    expect(ProgramOverlapRecommendationSchema.safeParse({ ...valid, confidence: 1.2 }).success).toBe(false);
  });

  it('builds [system, user] with the standard markers and the pair data', () => {
    const msgs = buildProgramOverlapRecommendationMessages(input);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    const system = msgs[0]!.content;
    for (const marker of ['CHANNEL MANIFEST', 'CONFIDENCE RUBRIC', 'English', 'BANNED PHRASES']) expect(system).toContain(marker);
    expect(system).toMatch(/never suggest merging/i);
    expect(system).toMatch(/basis "name"/);
    const user = msgs[1]!.content;
    expect(user).toContain('KKU-SEQ-0001');
    expect(user).toContain('KKU-SEQ-0002');
    expect(user).toContain('DIFFERENTIATE');
    expect(user).toContain('COORDINATE_SHARED_COURSES');
    expect(user).toContain('"basis": "name"');
  });

  it('caps confidence by the missing channels', () => {
    // name-only equivalence counts as one missing channel
    expect(overlapRecommendationConfidenceCeiling(input)).toBe(0.89);
    expect(
      overlapRecommendationConfidenceCeiling({
        ...input,
        evidence: { ...input.evidence, equivalentCourses: [{ ...input.evidence.equivalentCourses[0]!, basis: 'description' }] },
      }),
    ).toBe(1);
    expect(
      overlapRecommendationConfidenceCeiling({
        ...input,
        scores: { ...input.scores, content: null, outcome: null, marketSimilarity: null },
      }),
    ).toBe(0.49);
  });
});
