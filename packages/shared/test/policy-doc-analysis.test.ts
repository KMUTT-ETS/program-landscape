import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPolicyDocAnalysisMessages,
  POLICY_DOC_ANALYSIS_VERSION,
  PolicyDocAnalysisSchema,
  type PolicyDocAnalysisInput,
} from '../src/ai/prompts/policy-doc-analysis';

const BASE_INPUT: PolicyDocAnalysisInput = {
  fullText:
    'ประกาศกระทรวงการอุดมศึกษา วิทยาศาสตร์ วิจัยและนวัตกรรม เรื่อง เกณฑ์การสนับสนุนทุนวิจัยด้านปัญญาประดิษฐ์ ปี 2569',
  originalFilename: 'mhesi-ai-funding-2569.pdf',
  candidateSkills: [
    { id: 'sk-ai', nameEn: 'Artificial intelligence', nameTh: 'ปัญญาประดิษฐ์', category: 'Computing' },
    { id: 'sk-ds', nameEn: 'Data science', nameTh: 'วิทยาการข้อมูล', category: 'Computing' },
  ],
};

describe('policy-doc-analysis v2 builder', () => {
  const messages = buildPolicyDocAnalysisMessages(BASE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 2', () => {
    expect(POLICY_DOC_ANALYSIS_VERSION).toBe('policy-doc.v2');
  });

  it('carries the confidence rubric verbatim and the tell ban', () => {
    expect(system).toContain('CONFIDENCE RUBRIC');
    expect(system).toContain(
      '0.90-1.00  every key input channel present and mutually consistent',
    );
    expect(system).toContain('below 0.50 best effort over sparse input — flag for human review');
    expect(system).toMatch(/BANNED PHRASES/i);
  });

  it('requires the analysis summary to be English, not Thai-primary', () => {
    expect(system).toMatch(/"summary": "<3-5 sentences English/);
    expect(system).not.toMatch(/Thai primary/i);
  });

  it('requires affectedSkills evidence to stay a verbatim quote in the source language', () => {
    expect(system).toMatch(/VERBATIM quote/);
    expect(system).toMatch(/do not translate the quote/);
  });

  it('requires keyDirectives/impactReasoning to be English', () => {
    expect(system).toMatch(/keyDirectives.*impactReasoning.*are always English/s);
  });

  it('closes the world on skillId — must come from candidate skills', () => {
    expect(system).toMatch(/MUST be one of the candidate ids/);
    expect(system).toMatch(/never guess one when nothing in the document supports it/);
  });

  it('feeds the document text and candidate skills into the user snapshot', () => {
    expect(user).toContain(BASE_INPUT.fullText);
    expect(user).toContain('sk-ai: Artificial intelligence / ปัญญาประดิษฐ์ [Computing]');
  });
});

describe('CHANNEL MANIFEST', () => {
  it('is present as a file-level comment block', () => {
    const src = readFileSync(
      path.join(__dirname, '..', 'src', 'ai', 'prompts', 'policy-doc-analysis.ts'),
      'utf8',
    );
    expect(src).toMatch(/CHANNEL MANIFEST/);
  });
});

describe('PolicyDocAnalysisSchema', () => {
  const validPayload = {
    summary: 'MHESI raises AI research funding thresholds for FY2026, favouring institutions with existing AI programs.',
    issuingOrg: 'MHESI',
    publicationDate: '2026-01-15',
    keyDirectives: ['Minimum funding threshold raised to 5M THB for AI research grants.'],
    affectedSkills: [
      { skillId: 'sk-ai', evidence: 'เกณฑ์การสนับสนุนทุนวิจัยด้านปัญญาประดิษฐ์' },
    ],
    affectedSectors: ['Digital Economy'],
    suggestedProgramIds: [],
    estimatedImpact: 'medium' as const,
    impactReasoning: 'Affects faculty-level research funding strategy but not individual program curricula directly.',
    confidence: 0.75,
  };

  it('accepts a fully valid payload', () => {
    expect(PolicyDocAnalysisSchema.safeParse(validPayload).success).toBe(true);
  });

  it('requires `summary` (English) rather than `summaryTh`', () => {
    const { summary: _summary, ...withoutSummary } = validPayload;
    expect(PolicyDocAnalysisSchema.safeParse(withoutSummary).success).toBe(false);
    const withOldField = { ...withoutSummary, summaryTh: 'สรุปภาษาไทย' };
    expect(PolicyDocAnalysisSchema.safeParse(withOldField).success).toBe(false);
  });

  it('defaults keyDirectives/affectedSkills/affectedSectors/suggestedProgramIds to empty arrays', () => {
    const minimal = {
      summary: validPayload.summary,
      issuingOrg: validPayload.issuingOrg,
      estimatedImpact: validPayload.estimatedImpact,
      impactReasoning: validPayload.impactReasoning,
      confidence: validPayload.confidence,
    };
    const result = PolicyDocAnalysisSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keyDirectives).toEqual([]);
      expect(result.data.affectedSkills).toEqual([]);
      expect(result.data.affectedSectors).toEqual([]);
      expect(result.data.suggestedProgramIds).toEqual([]);
    }
  });

  it('keeps evidence as a free-text field (verbatim quote, not re-validated for language)', () => {
    const thaiEvidence = { ...validPayload, affectedSkills: [{ skillId: 'sk-ai', evidence: 'ข้อความภาษาไทยล้วน' }] };
    expect(PolicyDocAnalysisSchema.safeParse(thaiEvidence).success).toBe(true);
  });
});
