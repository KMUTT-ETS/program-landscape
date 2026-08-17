import { describe, expect, it } from 'vitest';
import {
  BENCHMARKING_INSIGHTS_VERSION,
  BenchmarkingInsightsOutputSchema,
  buildBenchmarkingInsightsMessages,
  type BenchmarkingInsightsInput,
  type CurriculumGapInput,
  type DistinctivenessInput,
  type PositioningBriefInput,
  type SuggestPeersInput,
} from '../src/ai/prompts/benchmarking-insights';

const SUGGEST_PEERS_INPUT: SuggestPeersInput = {
  mode: 'suggest-peers',
  programId: 'prog-1',
  programName: { en: 'Computer Engineering', th: 'วิศวกรรมคอมพิวเตอร์' },
  subjectArea: 'Computer Science',
  programLevel: 'BACHELOR',
  existingPeerInstitutions: ['NUS'],
  region: 'ASEAN',
};

const CURRICULUM_GAP_INPUT: CurriculumGapInput = {
  mode: 'curriculum-gap',
  programId: 'prog-1',
  programName: { en: 'Computer Engineering', th: 'วิศวกรรมคอมพิวเตอร์' },
  kkuSkills: [{ nameEn: 'Algorithms', nameTh: 'อัลกอริทึม' }],
  peerSkillCoverage: [{ nameEn: 'Cloud Architecture', nameTh: 'สถาปัตยกรรมคลาวด์', peerCount: 4 }],
  peerInstitutions: ['NUS', 'NTU'],
  graduateOutcomes: {
    surveyYear: 2024,
    employmentRatePct: 88.5,
    averageSalaryThb: 32000,
    sampleSize: 40,
  },
  kmitlDemandMatch: {
    matchedDemanded: 3,
    relevantDemanded: 8,
    topUnmatchedSkills: ['Cloud Architecture'],
  },
};

const DISTINCTIVENESS_INPUT: DistinctivenessInput = {
  mode: 'distinctiveness',
  programId: 'prog-1',
  programName: { en: 'Computer Engineering', th: 'วิศวกรรมคอมพิวเตอร์' },
  distinctivenessScore: 62,
  distinctiveSkills: [{ nameEn: 'Embedded Systems', nameTh: 'ระบบฝังตัว' }],
  sharedSkills: [{ nameEn: 'Algorithms', count: 5 }],
  peerSetName: 'ASEAN Top-20',
};

const POSITIONING_BRIEF_INPUT: PositioningBriefInput = {
  mode: 'positioning-brief',
  subjectArea: 'Computer Science',
  kkuPercentileLatest: 45,
  rankingTrends: [{ institution: 'NUS', source: 'QS', trend: 'stable', latestRank: 8 }],
  kkuProgramCount: 3,
  peerProgramCount: 6,
};

describe('benchmarking-insights v2 builder', () => {
  it('is version 2', () => {
    expect(BENCHMARKING_INSIGHTS_VERSION).toBe('benchmarking-insights.v2');
  });

  for (const [label, input] of [
    ['suggest-peers', SUGGEST_PEERS_INPUT],
    ['curriculum-gap', CURRICULUM_GAP_INPUT],
    ['distinctiveness', DISTINCTIVENESS_INPUT],
    ['positioning-brief', POSITIONING_BRIEF_INPUT],
  ] as const) {
    describe(`${label} mode`, () => {
      const messages = buildBenchmarkingInsightsMessages(input as BenchmarkingInsightsInput);
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const user = messages.find((m) => m.role === 'user')?.content ?? '';

      it('demands English output', () => {
        expect(system).toMatch(/Write in English|English/i);
      });

      it('carries the confidence rubric verbatim', () => {
        expect(system).toContain('CONFIDENCE RUBRIC');
        expect(system).toContain(
          '0.90-1.00  every key input channel present and mutually consistent',
        );
      });

      it('carries the banned-phrases block', () => {
        expect(system).toMatch(/BANNED PHRASES/i);
      });

      it('produces both a system and a user message', () => {
        expect(system.length).toBeGreaterThan(0);
        expect(user.length).toBeGreaterThan(0);
      });
    });
  }

  it('curriculum-gap feeds graduate outcomes and KMITL demand match into the user snapshot', () => {
    const user = buildBenchmarkingInsightsMessages(CURRICULUM_GAP_INPUT).find(
      (m) => m.role === 'user',
    )!.content;
    expect(user).toContain('88.5');
    expect(user).toContain('Matched 3 of 8');
    expect(user).toContain('Cloud Architecture');
  });

  it('curriculum-gap labels missing graduate outcomes / demand-match channels explicitly', () => {
    const emptyInput: CurriculumGapInput = {
      ...CURRICULUM_GAP_INPUT,
      graduateOutcomes: null,
      kmitlDemandMatch: null,
    };
    const user = buildBenchmarkingInsightsMessages(emptyInput).find((m) => m.role === 'user')!
      .content;
    const matches = user.match(/data not available/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('curriculum-gap instructs the model to weigh outcomes/demand into bridging opportunities', () => {
    const system = buildBenchmarkingInsightsMessages(CURRICULUM_GAP_INPUT).find(
      (m) => m.role === 'system',
    )!.content;
    expect(system).toMatch(/GRADUATE OUTCOMES/);
    expect(system).toMatch(/LABOUR-MARKET DEMAND/);
  });
});

describe('BenchmarkingInsightsOutputSchema', () => {
  it('accepts a valid curriculum-gap payload with English-only prose fields', () => {
    const payload = {
      mode: 'curriculum-gap' as const,
      result: {
        programId: 'prog-1',
        whatPeersHave: ['Cloud Architecture'],
        whatKkuHas: ['Algorithms'],
        bridgingOpportunities: [
          {
            title: 'Add a cloud architecture elective',
            rationale: '4 of 6 peers teach it and demand match is weak.',
            urgency: 'high' as const,
          },
        ],
        summary: 'KKU lags peers on cloud architecture coverage.',
        confidence: 0.75,
      },
    };
    expect(BenchmarkingInsightsOutputSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a payload still using the old whatPeersHaveTh/summaryTh shape', () => {
    const payload = {
      mode: 'curriculum-gap' as const,
      result: {
        programId: 'prog-1',
        whatPeersHaveTh: ['สถาปัตยกรรมคลาวด์'],
        whatKkuHasTh: ['อัลกอริทึม'],
        bridgingOpportunitiesTh: [],
        summaryTh: 'สรุป',
        confidence: 0.75,
      },
    };
    expect(BenchmarkingInsightsOutputSchema.safeParse(payload).success).toBe(false);
  });
});
