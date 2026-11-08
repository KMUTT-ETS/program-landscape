import { describe, expect, it } from 'vitest';

import { ProgramAiReadinessAssessmentSchema } from '../src/ai/prompts/program-ai-readiness';

const long = (n: number): string => 'x'.repeat(n);

function valid(): Record<string, unknown> {
  return {
    relevanceScore: 60,
    disciplineAiContext: long(100),
    aiApplicationsForDiscipline: [1, 2, 3].map((i) => ({
      title: `Application ${i}`,
      description: long(40),
    })),
    currentCoverageAssessment: long(60),
    summary: long(60),
    gaps: [],
    recommendations: [
      { priority: 'high', title: 'Add a course', detail: long(50), effortHorizon: 'short' },
    ],
    peerReferences: [
      { institution: 'Fictional University', country: 'Nowhere', whatTheyDo: long(50) },
    ],
    confidence: 0.8,
  };
}

describe('program-ai-readiness parser leniency', () => {
  it('accepts a clean payload unchanged', () => {
    expect(ProgramAiReadinessAssessmentSchema.safeParse(valid()).success).toBe(true);
  });

  it('clamps an over-long peer whatTheyDo (recorded failure: too_big max 200)', () => {
    const p = valid();
    p.peerReferences = [
      { institution: 'A Institute', country: 'Nowhere', whatTheyDo: long(50) },
      { institution: 'B Institute', country: 'Nowhere', whatTheyDo: long(50) },
      { institution: 'C Institute', country: 'Nowhere', whatTheyDo: long(260) },
    ];
    const r = ProgramAiReadinessAssessmentSchema.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) {
      const v = r.data.peerReferences[2]?.whatTheyDo ?? '';
      expect(v.length).toBe(200);
      expect(v.endsWith('…')).toBe(true);
    }
  });

  it('drops a peer reference with a stray type instead of failing (recorded: invalid_type string)', () => {
    const p = valid();
    p.peerReferences = [
      { institution: 'A Institute', country: 'Nowhere', whatTheyDo: long(50) },
      { institution: 'B Institute', country: 42, whatTheyDo: long(50) },
    ];
    const r = ProgramAiReadinessAssessmentSchema.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.peerReferences).toHaveLength(1);
  });

  it('treats a stray-typed optional field as absent and a stray gap peerReference as null', () => {
    const p = valid();
    p.automationOutlook = { text: 'oops' };
    p.gaps = [
      { topic: 'A gap topic', severity: 'major', observation: long(30), peerReference: 7 },
    ];
    const r = ProgramAiReadinessAssessmentSchema.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.automationOutlook).toBeUndefined();
      expect(r.data.gaps[0]?.peerReference).toBeNull();
    }
  });

  it('still fails when too few required items survive', () => {
    const p = valid();
    p.recommendations = [{ priority: 'nope' }];
    expect(ProgramAiReadinessAssessmentSchema.safeParse(p).success).toBe(false);
  });
});
