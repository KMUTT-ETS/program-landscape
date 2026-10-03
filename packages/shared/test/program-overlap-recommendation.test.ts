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
  programA: { code: 'KKU-SEQ-0001', nameTh: 'วิทยาการคอมพิวเตอร์', nameEn: 'Computer Science', faculty: 'Science', latestEnrolled: 120 },
  programB: { code: 'KKU-SEQ-0002', nameTh: 'วิศวกรรมคอมพิวเตอร์', nameEn: null, faculty: 'Engineering', latestEnrolled: null },
  level: 'BACHELOR',
  scores: { structure: 40, content: 60, outcome: 55, overlapIndex: 58, containmentAInB: 50, containmentBInA: 45, marketSimilarity: 75 },
  sharedCredits: 9,
  equivCredits: 6,
  sharedStaff: 2,
  languageVariant: false,
  actions: ['DIFFERENTIATE', 'COORDINATE_SHARED_COURSES'],
  primaryAction: 'DIFFERENTIATE',
  evidence: {
    sharedCourses: { items: [{ code: 'CS101', credits: 3, nameTh: 'การเขียนโปรแกรม' }], omitted: 0 },
    equivalentCourses: {
      items: [{ codeA: 'A1', codeB: 'B1', nameA: 'a', nameB: 'b', credits: 3, similarity: 0.91, basis: 'name' }],
      omitted: 0,
    },
    matchedPlos: { items: [{ textA: 'plo a', textB: 'plo b', similarity: 0.85 }], omitted: 0 },
    unmatchedPlosA: { items: ['only a'], omitted: 0 },
    unmatchedPlosB: { items: [], omitted: 0 },
    coverage: { majorCoursesA: 10, majorCoursesB: 12, describedA: 8, describedB: 9, descriptionMatches: 0, plosA: 5, plosB: 6 },
  },
  marketTextA: 'market a',
  marketTextB: 'market b',
};

describe('program-overlap-recommendation prompt', () => {
  it('has the v2 version string (D9: course-based index)', () => {
    expect(PROGRAM_OVERLAP_RECOMMENDATION_VERSION).toBe('program-overlap-recommendation.v2');
  });

  it('describes the index as structure + content only, with PLO alignment as context (D9)', () => {
    const system = buildProgramOverlapRecommendationMessages(input)[0]!.content;
    expect(system).toMatch(/overlapIndex \(the mean of structure and content ONLY/);
    expect(system).toMatch(/NOT part of overlapIndex/);
    expect(system).not.toMatch(/material channels are:[^\n]*outcome layer,/);
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

  it('requires a reason of at least 20 characters when disagreeing', () => {
    const s = ProgramOverlapRecommendationSchema;
    expect(s.safeParse({ ...valid, disagreesWithAction: true, disagreementReason: null }).success).toBe(false);
    expect(s.safeParse({ ...valid, disagreesWithAction: true, disagreementReason: 'too short' }).success).toBe(false);
    expect(
      s.safeParse({ ...valid, disagreesWithAction: true, disagreementReason: 'equivalentCourses all rest on names alone' }).success,
    ).toBe(true);
  });

  it('builds [system, user] with the standard markers and the pair data', () => {
    const msgs = buildProgramOverlapRecommendationMessages(input);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    const system = msgs[0]!.content;
    for (const marker of ['CHANNEL MANIFEST', 'CONFIDENCE RUBRIC', 'English', 'BANNED PHRASES']) expect(system).toContain(marker);
    expect(system).toMatch(/never suggest merging/i);
    expect(system).toMatch(/basis "name"/);
    expect(system).toMatch(/never quote a Thai sentence/);
    expect(system).toMatch(/Never propose closure/);
    expect(system).toMatch(/unless CONSIDER_MERGE_OR_TRACK is in actions/);
    const user = msgs[1]!.content;
    expect(user).toContain('KKU-SEQ-0001');
    expect(user).toContain('KKU-SEQ-0002');
    expect(user).toContain('DIFFERENTIATE');
    expect(user).toContain('COORDINATE_SHARED_COURSES');
    expect(user).toContain('"basis":"name"');
    expect(user).not.toContain('\n'); // compact JSON
    expect(JSON.parse(user).primaryAction).toBe('DIFFERENTIATE');
  });

  it('caps confidence by the missing channels', () => {
    // name-only equivalence counts as one missing channel
    expect(overlapRecommendationConfidenceCeiling(input)).toBe(0.89);
    expect(
      overlapRecommendationConfidenceCeiling({
        ...input,
        evidence: {
          ...input.evidence,
          equivalentCourses: { items: [{ ...input.evidence.equivalentCourses.items[0]!, basis: 'description' }], omitted: 0 },
        },
      }),
    ).toBe(1);
    expect(
      overlapRecommendationConfidenceCeiling({
        ...input,
        scores: { ...input.scores, content: null, outcome: null, marketSimilarity: null },
      }),
    ).toBe(0.49);
    // the outcome (PLO) layer is context, not a material channel (D9)
    expect(overlapRecommendationConfidenceCeiling({ ...input, scores: { ...input.scores, outcome: null } })).toBe(0.89);
    // market is ONE channel: null similarity and a missing text count once
    expect(
      overlapRecommendationConfidenceCeiling({
        ...input,
        scores: { ...input.scores, marketSimilarity: null },
        marketTextA: null,
        evidence: {
          ...input.evidence,
          equivalentCourses: { items: [{ ...input.evidence.equivalentCourses.items[0]!, basis: 'description' }], omitted: 0 },
        },
      }),
    ).toBe(0.89);
  });
});
