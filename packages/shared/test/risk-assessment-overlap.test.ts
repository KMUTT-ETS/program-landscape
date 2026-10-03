import { describe, expect, it } from 'vitest';
import {
  buildRiskAssessmentMessages,
  RISK_ASSESSMENT_VERSION,
  type RiskAssessmentInput,
} from '../src/ai/prompts/risk-assessment';
import { AI_METHOD_CATALOG } from '../src/ai/method-catalog';

const input = (over: Partial<RiskAssessmentInput> = {}): RiskAssessmentInput => ({
  program: {
    code: 'KKU-SEQ-0001', nameTh: 'หลักสูตร ก', nameEn: 'Programme A', facultyNameTh: 'คณะ ก',
    departmentNameTh: null, levelTh: 'ปริญญาตรี', durationYears: 4, totalCredits: 130, recruitmentSummaryTh: null,
  },
  scores: {
    l1RecruitmentScore: null, l2AiDisruptionScore: null, l3DemographicScore: null, composite: null, tier: 'NEEDS_DATA',
    impact: { directRevenueAtRiskThb: null, strandedCostThb: null },
  },
  driverDetail: { l1: {}, l2: {}, l3: {} },
  tcasYears: [], skills: [], topAutomationRiskSkills: [], aiReadinessSnapshot: null,
  peerPrograms: [], whitespaceSkills: [], sectorOutlook: [], kriBreaches: [], ruleDerivedMeasures: [], dataGaps: [],
  ...over,
} as RiskAssessmentInput);

const user = (i: RiskAssessmentInput): string => buildRiskAssessmentMessages(i)[1]!.content as string;

describe('risk-assessment.v4 overlap context', () => {
  it('bumps the version and the method catalogue follows', () => {
    expect(RISK_ASSESSMENT_VERSION).toBe('risk-assessment.v4');
    expect(AI_METHOD_CATALOG.find((m) => m.methodPrefix === 'risk-assessment')?.currentVersion).toBe(RISK_ASSESSMENT_VERSION);
  });
  it('the system prompt says overlap measures are for review and never closure', () => {
    const system = buildRiskAssessmentMessages(input())[0]!.content as string;
    expect(system).toContain('curriculum_overlap_max');
    expect(system).toContain('for review');
    expect(system).toContain('PROGRAM_PHASE_OUT');
  });
  it('renders the named siblings when present', () => {
    const text = user(input({
      overlapContext: {
        curriculum: { siblingCode: 'KKU-SEQ-0002', siblingNameTh: 'หลักสูตร ข', siblingNameEn: 'Programme B', overlapIndex: 74.6, containmentMax: 83.2, actions: ['CONSIDER_MERGE_OR_TRACK'], limitedEvidence: false },
        market: { siblingCode: 'KKU-SEQ-0003', siblingNameTh: 'หลักสูตร ค', siblingNameEn: null, marketSimilarity: 81.4 },
      },
    }));
    expect(text).toContain('curriculum_overlap_max: 75/100 กับ KKU-SEQ-0002 หลักสูตร ข (Programme B)');
    expect(text).toContain('containment สูงสุด 83%');
    expect(text).toContain('CONSIDER_MERGE_OR_TRACK');
    expect(text).toContain('market_confusion_max: 81/100 กับ KKU-SEQ-0003 หลักสูตร ค');
    expect(text).not.toContain('limited evidence');
  });
  it('marks a limited-evidence sibling as a lead to verify', () => {
    const text = user(input({
      overlapContext: {
        curriculum: { siblingCode: 'KKU-SEQ-0002', siblingNameTh: 'หลักสูตร ข', siblingNameEn: null, overlapIndex: 100, containmentMax: null, actions: [], limitedEvidence: true },
        market: null,
      },
    }));
    expect(text).toContain('limited evidence (PLO-only or no course comparison) — a lead to verify, not a finding');
    const system = buildRiskAssessmentMessages(input())[0]!.content as string;
    expect(system).toContain('limited evidence = PLO-only or no course comparison; treat as a lead to verify, not a finding');
  });
  it('omits the block without overlap context', () => {
    expect(user(input())).not.toContain('program-overlap.v1');
    expect(user(input({ overlapContext: { curriculum: null, market: null } }))).not.toContain('program-overlap.v1');
  });
});
