import { describe, expect, it } from 'vitest';
import {
  buildGapInsightsMessages,
  GAP_INSIGHTS_VERSION,
  GapInsightsOutputSchema,
  type ProgramSkillsInput,
  type SectorBriefInput,
  type StrategicTop5Input,
} from '../src/ai/prompts/gap-insights';

const STRATEGIC_TOP5_INPUT: StrategicTop5Input = {
  mode: 'strategic-top-5',
  scopeLabel: 'KKU (all faculties)',
  topSkillGaps: [
    { skillId: 'sk1', nameEn: 'Data Engineering', nameTh: 'วิศวกรรมข้อมูล', gap: 42.5, demand: 90, supply: 47.5 },
  ],
  sectorSnapshot: [
    { sectorCode: 'SC-DIGITAL', nameEn: 'Digital Economy', family: 'SCURVE', demand: 120, supply: 80, trend: 'growing' },
  ],
  demographicNote: 'Thailand 18-22 cohort projected to shrink ~1.8%/year through 2035.',
};

const PROGRAM_SKILLS_INPUT: ProgramSkillsInput = {
  mode: 'program-skills-to-add',
  programId: 'prog-1',
  programName: { en: 'Computer Engineering', th: 'วิศวกรรมคอมพิวเตอร์' },
  currentSkills: [{ id: 'sk0', nameEn: 'Algorithms', nameTh: 'อัลกอริทึม' }],
  topDemandedSkillsMissing: [
    { id: 'sk1', nameEn: 'Data Engineering', nameTh: 'วิศวกรรมข้อมูล', demandEvidence: 'demand=90.0, top employers: Acme Co, Beta Ltd' },
  ],
};

const SECTOR_BRIEF_INPUT: SectorBriefInput = {
  mode: 'sector-brief',
  sectorCode: 'SC-DIGITAL',
  sectorNames: { en: 'Digital Economy', th: 'เศรษฐกิจดิจิทัล' },
  family: 'SCURVE',
  demandSnapshot: { totalDemand: 120, topSkills: ['Data Engineering', 'Cloud Architecture'], topEmployers: ['Acme Co', 'Beta Ltd'] },
  supplySnapshot: { totalSupply: 80, topPrograms: ['Computer Engineering'] },
  recentPolicySignals: ['Digital Economy Promotion Act amendment'],
};

describe('gap-insights v2 builder', () => {
  it('is version 2', () => {
    expect(GAP_INSIGHTS_VERSION).toBe('gap-insights.v2');
  });

  for (const [label, input] of [
    ['strategic-top-5', STRATEGIC_TOP5_INPUT],
    ['program-skills-to-add', PROGRAM_SKILLS_INPUT],
    ['sector-brief', SECTOR_BRIEF_INPUT],
  ] as const) {
    describe(`${label} mode`, () => {
      const messages = buildGapInsightsMessages(input);
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
        expect(system).toContain('delve');
        expect(system).toContain('robust');
      });

      it('produces both a system and a user message', () => {
        expect(system.length).toBeGreaterThan(0);
        expect(user.length).toBeGreaterThan(0);
      });
    });
  }

  it('sector-brief renders topSkills/topEmployers when present', () => {
    const user = buildGapInsightsMessages(SECTOR_BRIEF_INPUT).find((m) => m.role === 'user')!
      .content;
    expect(user).toContain('Data Engineering');
    expect(user).toContain('Acme Co');
  });

  it('sector-brief labels an empty topSkills/topEmployers channel as unavailable, not silently dropped', () => {
    const emptyInput: SectorBriefInput = {
      ...SECTOR_BRIEF_INPUT,
      demandSnapshot: { ...SECTOR_BRIEF_INPUT.demandSnapshot, topSkills: [], topEmployers: [] },
    };
    const user = buildGapInsightsMessages(emptyInput).find((m) => m.role === 'user')!.content;
    expect(user).toContain('data not available');
  });

  it('sector-brief labels empty recentPolicySignals explicitly', () => {
    const emptyInput: SectorBriefInput = { ...SECTOR_BRIEF_INPUT, recentPolicySignals: [] };
    const user = buildGapInsightsMessages(emptyInput).find((m) => m.role === 'user')!.content;
    expect(user).toContain('(none on file)');
  });

  it('program-skills-to-add requires closed-world skill selection in the system prompt', () => {
    const system = buildGapInsightsMessages(PROGRAM_SKILLS_INPUT).find((m) => m.role === 'system')!
      .content;
    expect(system).toMatch(/closed-world/i);
  });
});

describe('GapInsightsOutputSchema', () => {
  it('accepts a valid strategic-top-5 payload with English-only prose fields', () => {
    const payload = {
      mode: 'strategic-top-5' as const,
      gaps: [
        {
          rank: 1,
          title: 'Data engineering pipeline talent shortfall',
          rationale: 'Demand exceeds supply by 42.5 points at university scope.',
          affectedSkillIds: ['sk1'],
          affectedSectorCodes: ['SC-DIGITAL'],
          recommendedAction: 'new-track' as const,
          confidence: 0.8,
        },
      ],
    };
    expect(GapInsightsOutputSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a strategic-top-5 payload still using the old titleTh/rationaleTh shape', () => {
    const payload = {
      mode: 'strategic-top-5' as const,
      gaps: [
        {
          rank: 1,
          titleTh: 'สาขาที่ขาดแคลน',
          rationaleTh: 'เหตุผล',
          affectedSkillIds: [],
          affectedSectorCodes: [],
          recommendedAction: 'new-track' as const,
          confidence: 0.8,
        },
      ],
    };
    expect(GapInsightsOutputSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts a valid sector-brief payload', () => {
    const payload = {
      mode: 'sector-brief' as const,
      brief: {
        sectorCode: 'SC-DIGITAL',
        title: 'Digital Economy sector brief',
        body: 'Demand for digital-economy skills continues to outstrip KKU supply.',
        headlineMetrics: [{ label: 'Total demand index', value: '120.0' }],
        strategicImplications: ['Expand intake in Computer Engineering.'],
        confidence: 0.75,
      },
    };
    expect(GapInsightsOutputSchema.safeParse(payload).success).toBe(true);
  });
});
