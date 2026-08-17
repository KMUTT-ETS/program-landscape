import { describe, expect, it } from 'vitest';
import {
  buildScenarioInsightsMessages,
  SCENARIO_INSIGHTS_VERSION,
  ScenarioInsightsOutputSchema,
  type ExistingRiskAssessmentSummary,
  type ScenarioContext,
  type ScenarioInsightsInput,
} from '../src/ai/prompts/scenario-insights';

const SCENARIO: ScenarioContext = {
  id: 'sc-1',
  name: 'Sunset Biotech BSc',
  scenarioType: 'SUNSET',
  horizonYears: 5,
  assumptions: { tuitionGrowthPct: 2, retentionRate: 0.9 },
  affectedProgramNames: ['Biotechnology'],
  totalNetContribution: 1_000_000,
  monteCarloCi80: [800_000, 1_200_000],
  topSensitivityAssumptions: [{ key: 'retentionRate', impact: 150_000 }],
};

const RISK_ROW: ExistingRiskAssessmentSummary = {
  programName: 'Biotechnology',
  compositeScore: 62,
  tier: 'ELEVATED',
  topLikelihoodDriver: 'L3 demographic ceiling',
  narrative: 'Composite risk driven by demographic ceiling.',
};

const MODES: Array<{ label: string; input: ScenarioInsightsInput }> = [
  {
    label: 'suggest-assumptions',
    input: {
      mode: 'suggest-assumptions',
      scenario: {
        id: SCENARIO.id,
        name: SCENARIO.name,
        scenarioType: SCENARIO.scenarioType,
        horizonYears: SCENARIO.horizonYears,
        assumptions: SCENARIO.assumptions,
        affectedProgramNames: SCENARIO.affectedProgramNames,
      },
      currentAssumptions: SCENARIO.assumptions,
    },
  },
  {
    label: 'identify-risks',
    input: { mode: 'identify-risks', scenario: SCENARIO, existingRiskAssessments: [RISK_ROW] },
  },
  { label: 'compare-narrative', input: { mode: 'compare-narrative', scenarios: [SCENARIO] } },
  {
    label: 'devils-advocate',
    input: { mode: 'devils-advocate', scenario: SCENARIO, apparentBestReason: 'Highest net contribution' },
  },
  { label: 'what-would-change-my-mind', input: { mode: 'what-would-change-my-mind', scenario: SCENARIO } },
];

describe('scenario-insights v2 builder', () => {
  it('is version 2', () => {
    expect(SCENARIO_INSIGHTS_VERSION).toBe('scenario-insights.v2');
  });

  for (const { label, input } of MODES) {
    describe(`${label} mode`, () => {
      const messages = buildScenarioInsightsMessages(input);
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

      it('feeds affected programs into the user snapshot', () => {
        expect(user).toContain('Biotechnology');
      });
    });
  }

  it('identify-risks feeds existing risk assessments into the user snapshot', () => {
    const user = buildScenarioInsightsMessages(MODES[1]!.input).find((m) => m.role === 'user')!
      .content;
    expect(user).toContain('[Existing risk assessments for the affected programs]');
    expect(user).toContain('L3 demographic ceiling');
    expect(user).toContain('62');
  });

  it('identify-risks instructs the model to distinguish grounded-vs-new risks', () => {
    const system = buildScenarioInsightsMessages(MODES[1]!.input).find((m) => m.role === 'system')!
      .content;
    expect(system).toContain('groundedInExistingAssessment');
  });

  it('identify-risks labels a missing risk-assessment channel explicitly', () => {
    const noRisk: ScenarioInsightsInput = {
      mode: 'identify-risks',
      scenario: SCENARIO,
      existingRiskAssessments: [],
    };
    const user = buildScenarioInsightsMessages(noRisk).find((m) => m.role === 'user')!.content;
    expect(user).toContain('data not available');
  });

  it('labels an empty affectedProgramNames channel explicitly rather than dropping it', () => {
    const noPrograms: ScenarioInsightsInput = {
      mode: 'what-would-change-my-mind',
      scenario: { ...SCENARIO, affectedProgramNames: [] },
    };
    const user = buildScenarioInsightsMessages(noPrograms).find((m) => m.role === 'user')!.content;
    expect(user).toContain('data not available');
  });
});

describe('ScenarioInsightsOutputSchema', () => {
  it('accepts a valid identify-risks payload with English-only prose fields', () => {
    const payload = {
      mode: 'identify-risks' as const,
      risks: [
        {
          category: 'academic' as const,
          severity: 'medium' as const,
          title: 'Faculty transition disruption',
          description: 'Sunsetting the program mid-cohort risks faculty attrition.',
          groundedInExistingAssessment: true,
          mitigation: 'Phase the sunset over two cohorts.',
        },
      ],
      confidence: 0.7,
    };
    expect(ScenarioInsightsOutputSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a payload still using the old titleTh/descriptionTh shape', () => {
    const payload = {
      mode: 'identify-risks' as const,
      risks: [
        {
          category: 'academic' as const,
          severity: 'medium' as const,
          titleTh: 'ความเสี่ยงคณาจารย์',
          descriptionTh: 'คำอธิบาย',
        },
      ],
      confidence: 0.7,
    };
    expect(ScenarioInsightsOutputSchema.safeParse(payload).success).toBe(false);
  });
});
