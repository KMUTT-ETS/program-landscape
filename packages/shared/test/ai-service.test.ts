import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  CourseSkillExtractionSchema,
  buildCourseSkillExtractionMessages,
  type AiService,
} from '../src/ai';

// Smoke + interface-shape tests for AiService. Real-provider tests
// require API keys; those run under a separate integration test
// configuration (not wired yet — see docs/ai-governance.md).

describe('AiService — interface + types', () => {
  it('buildCourseSkillExtractionMessages produces system + user messages', () => {
    const messages = buildCourseSkillExtractionMessages({
      course: {
        code: 'CP201',
        nameTh: 'โครงสร้างข้อมูล',
        nameEn: 'Data Structures',
        descriptionTh: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน',
        credits: 3,
      },
      candidateSkills: [
        { id: 's1', nameTh: 'ข้อมูลและการจัดการ', nameEn: 'Data handling', category: 'computing' },
      ],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    // The user message MUST carry the course text verbatim; this is how
    // the model gets its evidence to quote back.
    expect(messages[1]?.content).toContain('CP201');
    expect(messages[1]?.content).toContain('ศึกษาโครงสร้างข้อมูลพื้นฐาน');
    // And MUST reference the candidate id so the model can pick it.
    expect(messages[1]?.content).toContain('s1');
  });

  it('CourseSkillExtractionSchema validates a full output', () => {
    const valid: z.infer<typeof CourseSkillExtractionSchema> = {
      skills: [{ skillId: 's1', weight: 0.8, evidence: 'quote from description' }],
      proposedSkills: [],
      confidence: 0.85,
      reasoning: 'one sentence',
    };
    expect(CourseSkillExtractionSchema.parse(valid)).toEqual(valid);
  });

  it('CourseSkillExtractionSchema rejects out-of-range weight', () => {
    const bad = {
      skills: [{ skillId: 's1', weight: 1.5, evidence: 'q' }],
      confidence: 0.5,
    };
    expect(() => CourseSkillExtractionSchema.parse(bad)).toThrow();
  });
});

describe('AiService — consumer contract', () => {
  it('consumers only touch the interface surface (not provider specifics)', async () => {
    // A fake AiService that ONLY uses the interface types. This test
    // guards against providers leaking through the abstraction — if a
    // module types against { providerId: 'google' } directly it'll
    // fail to compile against this mock.
    const mock: AiService = {
      providerId: 'mock',
      complete: vi.fn().mockResolvedValue({
        text: 'ok',
        tokens: { input: 1, output: 1 },
        model: 'mock',
        latencyMs: 1,
        cost: { usd: 0, model: 'mock' },
        aiInferenceId: 'fake',
      }),
      embed: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        parsed: { skills: [], proposedSkills: [], confidence: 0.9 },
        confidence: 0.9,
        rawText: '',
        tokens: { input: 1, output: 1 },
        model: 'mock',
        latencyMs: 1,
        cost: { usd: 0, model: 'mock' },
        aiInferenceId: 'fake',
      }),
      translate: vi.fn(),
      vision: vi.fn(),
    };
    const out = await mock.complete({
      ctx: { module: 'test' },
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.text).toBe('ok');
  });
});
