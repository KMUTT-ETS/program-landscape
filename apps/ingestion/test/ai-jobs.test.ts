import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock prisma + an AiService. The test exercises the handlers' state
// transitions: AiExtraction creation with the right kind, confidence,
// review status based on threshold, inference id linkage.
const mocks = vi.hoisted(() => ({
  courseFindUnique: vi.fn(),
  postingFindUnique: vi.fn(),
  skillFindMany: vi.fn(),
  aiExtractionCreate: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  Prisma: { JsonNull: null, InputJsonValue: null },
  prisma: {
    course: { findUnique: mocks.courseFindUnique },
    jobPosting: { findUnique: mocks.postingFindUnique },
    skill: { findMany: mocks.skillFindMany },
    aiExtraction: { create: mocks.aiExtractionCreate },
  },
}));

import { buildHandlers } from '../src/ai-jobs/handlers';
import type { AiService } from '@kku/shared';

function fakeAi(confidence: number): AiService {
  return {
    providerId: 'mock',
    complete: vi.fn(),
    embed: vi.fn(),
    extractStructured: vi.fn().mockImplementation(async <T>(_r: unknown, schema: z.ZodType<T>) => {
      // Return a minimal valid CourseSkillExtraction payload. Confidence
      // is the dial we vary across tests.
      const parsed = schema.parse({
        skills: [{ skillId: 'sk-1', weight: 0.6, evidence: 'ศึกษา…' }],
        proposedSkills: [],
        confidence,
        reasoning: 'mock',
      });
      return {
        parsed,
        confidence,
        rawText: '{}',
        tokens: { input: 10, output: 5 },
        model: 'mock',
        latencyMs: 1,
        cost: { usd: 0.0001, model: 'mock' },
        aiInferenceId: 'inf-1',
      };
    }),
    translate: vi.fn(),
    vision: vi.fn(),
  };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.skillFindMany.mockResolvedValue([
    { id: 'sk-1', nameEn: 'Data', nameTh: 'ข้อมูล', category: 'computing' },
  ]);
  mocks.aiExtractionCreate.mockResolvedValue({ id: 'ext-1' });
});

describe('ai-jobs EXTRACT_COURSE_SKILLS handler', () => {
  it('routes low-confidence output to PENDING_REVIEW', async () => {
    mocks.courseFindUnique.mockResolvedValue({
      id: 'c-1',
      code: 'CP201',
      nameTh: 'โครงสร้างข้อมูล',
      nameEn: 'Data Structures',
      credits: 3,
      descriptionTh: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน',
      descriptionEn: null,
    });
    const handlers = buildHandlers({ ai: fakeAi(0.4), autoApproveThreshold: 0.85 });
    const outcome = await handlers.EXTRACT_COURSE_SKILLS({
      entityId: 'c-1',
      trigger: 'MANUAL',
      triggeredByUserId: null,
    });
    expect(outcome.status).toBe('SUCCEEDED');
    const call = mocks.aiExtractionCreate.mock.calls[0]?.[0] as {
      data: { reviewStatus: string; aiInferenceId: string; extractionKind: string };
    };
    expect(call.data.reviewStatus).toBe('PENDING_REVIEW');
    expect(call.data.extractionKind).toBe('COURSE_SKILLS');
    expect(call.data.aiInferenceId).toBe('inf-1');
  });

  it('auto-approves when confidence clears threshold', async () => {
    mocks.courseFindUnique.mockResolvedValue({
      id: 'c-2',
      code: 'CS101',
      nameTh: 'วิทยาการคอมพิวเตอร์พื้นฐาน',
      nameEn: 'Intro to Computer Science',
      credits: 3,
      descriptionTh: '...',
      descriptionEn: null,
    });
    const handlers = buildHandlers({ ai: fakeAi(0.95), autoApproveThreshold: 0.85 });
    await handlers.EXTRACT_COURSE_SKILLS({
      entityId: 'c-2',
      trigger: 'MANUAL',
      triggeredByUserId: null,
    });
    const call = mocks.aiExtractionCreate.mock.calls[0]?.[0] as {
      data: { reviewStatus: string };
    };
    expect(call.data.reviewStatus).toBe('AUTO_APPROVED');
  });

  it('skips gracefully when the referenced course does not exist', async () => {
    mocks.courseFindUnique.mockResolvedValue(null);
    const handlers = buildHandlers({ ai: fakeAi(0.9), autoApproveThreshold: 0.85 });
    const outcome = await handlers.EXTRACT_COURSE_SKILLS({
      entityId: 'c-missing',
      trigger: 'MANUAL',
      triggeredByUserId: null,
    });
    expect(outcome.status).toBe('SKIPPED');
    expect(mocks.aiExtractionCreate).not.toHaveBeenCalled();
  });
});
