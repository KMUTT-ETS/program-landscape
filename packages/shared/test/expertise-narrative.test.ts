import { describe, expect, it } from 'vitest';
import {
  buildExpertiseNarrativeMessages,
  EXPERTISE_NARRATIVE_VERSION,
  ExpertiseNarrativeSchema,
  type ExpertiseNarrativeInput,
} from '../src/ai/prompts/expertise-narrative';

const FIXTURE_INPUT: ExpertiseNarrativeInput = {
  education: ['Doctor of Philosophy, New South Wales University'],
  publicationTitles: [
    'Thermal management of electronic packaging under cyclic load',
    'Computational fluid dynamics for data centre cooling',
    'Machine-learning-assisted thermal design of server racks',
  ],
};

describe('expertise-narrative v3 builder', () => {
  const messages = buildExpertiseNarrativeMessages(FIXTURE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 3', () => {
    expect(EXPERTISE_NARRATIVE_VERSION).toBe('expertise-narrative.v3');
  });

  it('demands English output for the narrative', () => {
    expect(system).toMatch(/Write the narrative in English only/);
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
  });

  it('still permits the Thai keyword array — the standard exemption', () => {
    expect(system).toContain('expertiseKeywordsTh');
    expect(system).toMatch(/parallel Thai translation array/i);
  });

  it('feeds education and publication titles into the user snapshot', () => {
    expect(user).toContain('New South Wales University');
    expect(user).toContain('Thermal management of electronic packaging under cyclic load');
  });

  it('labels missing education/titles channels explicitly rather than dropping them', () => {
    const empty: ExpertiseNarrativeInput = { education: [], publicationTitles: [] };
    const u = buildExpertiseNarrativeMessages(empty).find((m) => m.role === 'user')!.content;
    expect(u).toContain('data not available');
  });

  it('keeps the hard no-biography / no-metrics rules from v1/v2', () => {
    for (const marker of [
      'Do NOT name the person',
      'Do NOT cite a publication count',
      '80-160 words',
    ]) {
      expect(system).toContain(marker);
    }
  });
});

describe('ExpertiseNarrativeSchema', () => {
  it('accepts a valid payload with narrativeEn only (no narrativeTh field)', () => {
    const payload = {
      narrativeEn:
        'Research focuses on thermal management of electronic packaging, with particular emphasis on computational fluid dynamics applied to data centre cooling. Recent work extends to machine-learning-assisted thermal design.',
      expertiseKeywordsEn: ['thermal management', 'CFD', 'data centre cooling'],
      expertiseKeywordsTh: ['การจัดการความร้อน', 'พลศาสตร์ของไหลเชิงคำนวณ', 'การระบายความร้อนศูนย์ข้อมูล'],
      confidence: 0.8,
    };
    expect(ExpertiseNarrativeSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a payload still carrying the old narrativeTh field alone without narrativeEn', () => {
    const payload = {
      narrativeTh: 'เชี่ยวชาญด้านการจัดการความร้อน',
      expertiseKeywordsEn: ['thermal management'],
      expertiseKeywordsTh: ['การจัดการความร้อน'],
      confidence: 0.8,
    };
    expect(ExpertiseNarrativeSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a narrative shorter than 40 characters', () => {
    const payload = {
      narrativeEn: 'Too short.',
      expertiseKeywordsEn: [],
      expertiseKeywordsTh: [],
      confidence: 0.8,
    };
    expect(ExpertiseNarrativeSchema.safeParse(payload).success).toBe(false);
  });
});
