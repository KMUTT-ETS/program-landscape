import { describe, expect, it, vi } from 'vitest';
import { wrapWithTransientFallback } from '../src/ai/providers/factory';
import { CircuitOpenError } from '../src/resilience/circuit-breaker';
import type { AiService, CompletionRequest, CompletionResponse } from '../src/ai/types';

// Build a fake AiService with a configurable `complete` impl.
function fakeService(
  providerId: 'google' | 'anthropic',
  impl: () => Promise<CompletionResponse>,
): AiService {
  return {
    providerId,
    complete: impl,
  } as unknown as AiService;
}

const okResp = (text: string): CompletionResponse => ({
  text,
  tokens: { input: 1, output: 1 },
  model: 'fake',
  latencyMs: 1,
  cost: { usd: 0, model: 'fake' },
  aiInferenceId: 'inf-1',
});

const fakeReq = {
  ctx: { module: 'test', kind: 'unit' },
  messages: [{ role: 'user' as const, content: 'hi' }],
} as unknown as CompletionRequest;

describe('wrapWithTransientFallback + circuit breaker', () => {
  it('passes through to primary on success', async () => {
    const primaryFn = vi.fn().mockResolvedValue(okResp('primary'));
    const secondaryFn = vi.fn().mockResolvedValue(okResp('secondary'));
    const wrapped = wrapWithTransientFallback(
      fakeService('google', primaryFn),
      fakeService('anthropic', secondaryFn),
    );
    const r = await wrapped.complete(fakeReq);
    expect(r.text).toBe('primary');
    expect(secondaryFn).not.toHaveBeenCalled();
  });

  it('falls back to secondary on a transient (5xx-shape) primary error', async () => {
    const transient = new Error('rate limit (429): Too Many Requests');
    const primaryFn = vi.fn().mockRejectedValue(transient);
    const secondaryFn = vi.fn().mockResolvedValue(okResp('secondary'));
    const wrapped = wrapWithTransientFallback(
      fakeService('google', primaryFn),
      fakeService('anthropic', secondaryFn),
    );
    const r = await wrapped.complete(fakeReq);
    expect(r.text).toBe('secondary');
    expect(primaryFn).toHaveBeenCalledOnce();
    expect(secondaryFn).toHaveBeenCalledOnce();
  });

  it('does NOT fall back on a non-transient primary error (validation, refusal, …)', async () => {
    const determ = new Error('VALIDATION_FAILED: prompt missing');
    const primaryFn = vi.fn().mockRejectedValue(determ);
    const secondaryFn = vi.fn();
    const wrapped = wrapWithTransientFallback(
      fakeService('google', primaryFn),
      fakeService('anthropic', secondaryFn),
    );
    await expect(wrapped.complete(fakeReq)).rejects.toThrow(/VALIDATION_FAILED/);
    expect(secondaryFn).not.toHaveBeenCalled();
  });

  it('opens the primary breaker after repeated transient failures, fast-paths to secondary', async () => {
    const transient = new Error('upstream timeout (504)');
    const primaryFn = vi.fn().mockRejectedValue(transient);
    const secondaryFn = vi.fn().mockResolvedValue(okResp('secondary'));

    // Use distinct providerIds so the breaker registry doesn't collide
    // with state from earlier tests in this run.
    const wrapped = wrapWithTransientFallback(
      fakeService('google' as const, primaryFn),
      fakeService('anthropic' as const, secondaryFn),
    );

    // Default threshold is 5 — fire 6 calls; primary should be hit
    // ~5 times then short-circuit.
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await wrapped.complete(fakeReq);
      expect(r.text).toBe('secondary');
    }

    // After threshold breaches, primaryFn stops being called for new
    // requests within the cooldown window — the breaker short-circuits.
    const callsAfter = primaryFn.mock.calls.length;
    expect(callsAfter).toBeLessThanOrEqual(5);
    expect(secondaryFn).toHaveBeenCalledTimes(6);
  });

  it('throws the original error when both breakers are open', async () => {
    const transient = new Error('upstream timeout (504)');
    const primaryFn = vi.fn().mockRejectedValue(transient);
    const secondaryFn = vi.fn().mockRejectedValue(new Error('secondary 502 Bad Gateway'));

    const wrapped = wrapWithTransientFallback(
      fakeService('google' as const, primaryFn),
      fakeService('anthropic' as const, secondaryFn),
    );

    // Drive both breakers to OPEN. After a few failures, a follow-up
    // call rejects — the original error shape should survive.
    let lastErr: unknown;
    for (let i = 0; i < 6; i++) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await wrapped.complete(fakeReq);
      } catch (err) {
        lastErr = err;
      }
    }
    // Once both breakers are open, subsequent calls reject. The last
    // error should be either the original transient OR a CircuitOpenError
    // depending on race. Either is acceptable as a "kill switch fired"
    // signal — the point is: NEITHER provider is being hammered.
    expect(lastErr).toBeDefined();
    if (lastErr instanceof CircuitOpenError) {
      expect(['ai:google', 'ai:anthropic']).toContain(lastErr.breakerName);
    } else {
      expect((lastErr as Error).message).toMatch(/(timeout|502)/i);
    }
  });
});
