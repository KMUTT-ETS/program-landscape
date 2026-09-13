import { describe, expect, it } from 'vitest';

import {
  buildDemandMatchMessages,
  DemandMatchSchema,
  DEMAND_MATCH_VERSION,
  isRelevantFit,
  type DemandMatchInput,
} from '../src/ai/prompts/demand-skill-match';

// demand-match.v4 — the relevance judgement became profession-aware after
// v3 called "Electrical engineering" and "Industrial engineering" relevant
// gaps for a Mechanical Engineering programme. In the JobThai data those
// strings come almost entirely from qualification lines listing ACCEPTED
// degrees ("Bachelor's in Mechanical, Electrical or related"), 41 of 45.

const input: DemandMatchInput = {
  programDegree: 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล',
  programDegreeEn: 'Bachelor of Engineering Program in Mechanical Engineering',
  programLevel: 'BACHELOR',
  programFaculty: 'คณะวิศวกรรมศาสตร์',
  programLearningOutcomes: ['ออกแบบระบบทางกล'],
  courses: [{ code: 'ME 101', nameTh: 'อุณหพลศาสตร์', nameEn: 'Thermodynamics', descriptionTh: 'กฎของอุณหพลศาสตร์' }],
  extractedSkills: [{ nameTh: 'อุณหพลศาสตร์', nameEn: 'Thermodynamics', evidence: '' }],
  targetCareers: [
    { source: 'JobThai', title: 'งานวิศวกรรม / งานวิศวกรเครื่องกล/ยานยนต์', detail: '57% of these postings ask for this field' },
    { source: 'LinkedIn', title: 'Mechanical Engineer' },
  ],
  demandedSkills: [
    {
      skillId: 'sk-ee',
      nameEn: 'Electrical engineering',
      nameTh: 'วิศวกรรมไฟฟ้า',
      sources: ['JobThai'],
      demandPct: 9,
      demandedIn: ['งานวิศวกรเครื่องกล/ยานยนต์'],
    },
  ],
};

describe('demand-match.v4 prompt', () => {
  it('is versioned v4', () => {
    expect(DEMAND_MATCH_VERSION).toBe('demand-match.v4');
  });

  it('gives the model the programme’s target careers and each skill’s demand context', () => {
    const [system, user] = buildDemandMatchMessages(input);
    expect(user!.content).toContain('Mechanical Engineer');
    expect(user!.content).toContain('57% of these postings ask for this field');
    expect(user!.content).toContain('sources: JobThai');
    expect(user!.content).toContain('9% of linked postings');
    expect(user!.content).toContain('Bachelor of Engineering Program in Mechanical Engineering');
    // The trap, stated to the model in so many words.
    expect(system!.content).toMatch(/list several acceptable degrees/i);
    expect(system!.content).toContain('other-profession');
    expect(system!.content).toContain('uncertain');
  });

  it('parses a fit class and reason, and derives relevance from the fit — not from matched', () => {
    const parsed = DemandMatchSchema.parse({
      matches: [
        {
          skillId: 'sk-ee', skillName: 'Electrical engineering', matched: true,
          fit: 'other-profession', fitReason: 'A separate engineering degree employers accept instead.',
          matchSource: 'course', relatedness: 0.7, evidenceQuote: 'ME 210 Electrical circuits', matchedTaughtSkillName: '',
        },
      ],
      confidence: 0.8,
    });
    const m = parsed.matches[0]!;
    expect(m.fit).toBe('other-profession');
    // Taught as a service course, yet still not relevant: it must neither be
    // a gap nor lift the match score.
    expect(isRelevantFit(m.fit)).toBe(false);
    expect(isRelevantFit('core')).toBe(true);
    expect(isRelevantFit('supporting')).toBe(true);
    expect(isRelevantFit('not-relevant')).toBe(false);
    expect(isRelevantFit('uncertain')).toBe(false);
  });

  it('rejects a fit label the prompt did not offer (closed-world classification)', () => {
    expect(() =>
      DemandMatchSchema.parse({
        matches: [{ skillId: 'x', skillName: 'x', matched: false, fit: 'adjacent', fitReason: '', matchSource: 'unmatched', relatedness: 0 }],
        confidence: 0.5,
      }),
    ).toThrow();
  });
});
