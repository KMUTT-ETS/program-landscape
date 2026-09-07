import { describe, it, expect, vi } from 'vitest';
import { wrapWithModelInvalidFallback } from '../src/ai/providers/factory';
import type { AiService } from '../src/ai/types';

function svc(overrides: Partial<AiService>): AiService {
  return { complete: vi.fn(), extractStructured: vi.fn(), embed: vi.fn(), ...overrides } as unknown as AiService;
}

const MODEL_INVALID = new Error(
  '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
);

describe('wrapWithModelInvalidFallback', () => {
  it('retries once on the catalog default and returns the retry result', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(MODEL_INVALID)
      .mockResolvedValueOnce({ parsed: { ok: true }, confidence: 0.9 });
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    const out = await wrapped.extractStructured({ methodVersion: 'program-courses-extract.v4' } as never);
    expect(out).toMatchObject({ parsed: { ok: true } });
    expect(extract).toHaveBeenCalledTimes(2);
    expect((extract.mock.calls[1][0] as { model?: string }).model).toBeDefined();
  });

  it('does not retry a transient error — that path is already owned', async () => {
    const transient = new Error('{"error":{"code":429,"message":"Resource exhausted","status":"RESOURCE_EXHAUSTED"}}');
    const extract = vi.fn().mockRejectedValue(transient);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(wrapped.extractStructured({ methodVersion: 'program-digest.v1' } as never)).rejects.toThrow('429');
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('rethrows when the retry also fails, rather than looping', async () => {
    const extract = vi.fn().mockRejectedValue(MODEL_INVALID);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(wrapped.extractStructured({ methodVersion: 'program-digest.v1' } as never)).rejects.toThrow('INVALID_ARGUMENT');
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('rethrows without retrying when the method has no catalog entry', async () => {
    const extract = vi.fn().mockRejectedValue(MODEL_INVALID);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(
      wrapped.extractStructured({ methodVersion: 'not-a-real-method.v1' } as never),
    ).rejects.toThrow('INVALID_ARGUMENT');
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('forwards optional provider methods rather than dropping them', async () => {
    const completeWithTools = vi.fn().mockResolvedValue({ finalText: 'ok' });
    const uploadFile = vi.fn().mockResolvedValue({ fileUri: 'x' });
    const wrapped = wrapWithModelInvalidFallback(svc({ completeWithTools, uploadFile }));
    expect(wrapped.completeWithTools).toBeDefined();
    expect(wrapped.uploadFile).toBeDefined();
    await wrapped.completeWithTools?.({} as never, vi.fn());
    expect(completeWithTools).toHaveBeenCalledTimes(1);
  });
});
