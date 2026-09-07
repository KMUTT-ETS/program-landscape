import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createAiService: vi.fn(() => ({} as never)) }));
vi.mock('@kku/shared', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createAiService: mocks.createAiService,
}));
vi.mock('@kku/db', () => ({
  getAiModelOverrideStore: () => ({ resolve: () => 'from-store' }),
  PrismaAiInferenceRecorder: class {},
}));

import { createIngestionAiService } from '../src/lib/ai-service';

describe('createIngestionAiService', () => {
  it('always passes a modelOverrideResolver', () => {
    createIngestionAiService();
    const cfg = mocks.createAiService.mock.calls[0][0] as { modelOverrideResolver?: unknown };
    expect(cfg.modelOverrideResolver).toBeDefined();
  });
});
