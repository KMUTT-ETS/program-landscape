import { describe, it, expect, vi } from 'vitest';
import { createAiService, wrapWithTransientFallback } from '../src/ai/providers/factory';
import type { AiService, AiInferenceRecorder } from '../src/ai/types';

/**
 * Regression guard for the /analyst tool-use outage.
 *
 * Every wrapper in factory.ts returns a fresh object literal. Two of them
 * omitted `completeWithTools` and `uploadFile`, so composing them silently
 * stripped those capabilities — and `analyst.service.ts` reads
 * `if (!this.ai.completeWithTools) throw ToolUseNotSupportedError`, so the
 * analyst refused to run on a provider that fully supports tool use.
 *
 * It was armed by configuration, not by code: any truthy ANTHROPIC_API_KEY
 * alongside AI_PROVIDER=google builds a secondary and takes that path, and
 * .env.prod.example ships ANTHROPIC_API_KEY=REPLACE_ME.
 */
const recorder: AiInferenceRecorder = { record: vi.fn(async () => ({ id: 'rec-1' })) };

class FakeProvider {
  providerId = 'google';
  async complete() { return {} as never; }
  async extractStructured() { return {} as never; }
  async embed() { return {} as never; }
  async translate() { return {} as never; }
  async vision() { return {} as never; }
  async completeWithTools() { return {} as never; }
  async uploadFile() { return {} as never; }
}
class FakeWithoutTools {
  providerId = 'openrouter';
  async complete() { return {} as never; }
  async extractStructured() { return {} as never; }
  async embed() { return {} as never; }
  async translate() { return {} as never; }
  async vision() { return {} as never; }
}

const asService = (o: object) => o as unknown as AiService;

describe('optional capability forwarding', () => {
  it('wrapWithTransientFallback keeps completeWithTools and uploadFile', () => {
    const wrapped = wrapWithTransientFallback(
      asService(new FakeProvider()),
      asService(new FakeProvider()),
    );
    expect(typeof wrapped.completeWithTools).toBe('function');
    expect(typeof wrapped.uploadFile).toBe('function');
  });

  it('absence stays absent, so capability checks stay truthful', () => {
    const wrapped = wrapWithTransientFallback(
      asService(new FakeWithoutTools()),
      asService(new FakeWithoutTools()),
    );
    // Must be genuinely absent — assigning `undefined` would make
    // `'completeWithTools' in wrapped` true and break the check differently.
    expect('completeWithTools' in wrapped).toBe(false);
    expect('uploadFile' in wrapped).toBe(false);
  });

  it('google primary WITH an anthropic key still exposes tool use', () => {
    // The exact production configuration that broke: a truthy secondary key
    // builds the secondary and routes through the transient wrapper.
    const ai = createAiService({
      recorder,
      providerId: 'google',
      apiKeys: { google: 'test-key', anthropic: 'REPLACE_ME' },
    });
    expect(typeof ai.completeWithTools).toBe('function');
  });

  it('google primary WITHOUT an anthropic key still exposes tool use', () => {
    const ai = createAiService({
      recorder,
      providerId: 'google',
      apiKeys: { google: 'test-key' },
    });
    expect(typeof ai.completeWithTools).toBe('function');
  });

  it('anthropic primary exposes tool use — wrapWithEmbeddingFallback runs unconditionally there', () => {
    const ai = createAiService({
      recorder,
      providerId: 'anthropic',
      apiKeys: { anthropic: 'test-key', google: 'test-key' },
    });
    expect(typeof ai.completeWithTools).toBe('function');
  });
});
