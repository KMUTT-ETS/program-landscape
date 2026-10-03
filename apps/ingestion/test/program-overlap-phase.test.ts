import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiService } from '@kku/shared';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  prep: vi.fn(),
  overlap: vi.fn(),
  recs: vi.fn(),
}));

vi.mock('../src/program-overlap/prep', () => ({ runOverlapPrep: mocks.prep }));
vi.mock('../src/program-overlap/run', () => ({
  runProgramOverlap: mocks.overlap,
  runOverlapRecommendations: mocks.recs,
}));

import { runOverlapPhase } from '../src/program-overlap/phase';

const ai = { name: 'ingestion-ai' } as unknown as AiService;

const prepResult = (written: number, cost: number) => ({
  plos: {},
  courseDescriptions: { programmesWithDigest: 1, coursesMatched: 4, coursesUpdated: 4 },
  marketProfiles: {},
  embeddings: {
    plos: { pending: 0, written: 0 },
    courses: { pending: written, written },
    profiles: { pending: 0, written: 0 },
    costUsd: cost,
  },
});

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.prep.mockReset().mockImplementation(async () => {
    mocks.calls.push('prep');
    return prepResult(4, 0.01);
  });
  mocks.overlap.mockReset().mockImplementation(async () => {
    mocks.calls.push('overlap');
    return [{ runId: 'r1', scored: 10, stored: 2 }];
  });
  mocks.recs.mockReset().mockImplementation(async () => {
    mocks.calls.push('recs');
    return { written: 1, skipped: 0, failed: 0, costUsd: 0.02 };
  });
});

describe('runOverlapPhase', () => {
  it('runs prep (apply, same AI service) before scoring, then recommendations', async () => {
    const r = await runOverlapPhase(ai, ['p1']);
    expect(mocks.calls).toEqual(['prep', 'overlap', 'recs']);
    expect(mocks.prep).toHaveBeenCalledWith(ai, { apply: true });
    expect(mocks.overlap).toHaveBeenCalledWith({ programIds: ['p1'], apply: true });
    expect(mocks.recs).toHaveBeenCalledWith({ ai, runIds: ['r1'] });
    expect(r.ok).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.03);
    expect(r.notes).toContain('4 vector(s) re-embedded');
  });

  it('does not score when prep fails, and never throws', async () => {
    mocks.prep.mockRejectedValueOnce(new Error('embed down'));
    const r = await runOverlapPhase(ai, undefined);
    expect(r).toEqual({ ok: false, costUsd: 0, notes: 'failed: embed down' });
    expect(mocks.overlap).not.toHaveBeenCalled();
  });
});
