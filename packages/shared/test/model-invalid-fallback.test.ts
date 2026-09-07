import { describe, it, expect, vi } from 'vitest';
import {
  wrapWithModelInvalidFallback,
  wrapWithTransientFallback,
} from '../src/ai/providers/factory';
import type { AiService } from '../src/ai/types';
import type { AiMethodEntry } from '../src/ai/method-catalog';

// Nothing in AI_METHOD_CATALOG sets `lockedModel` today, so the guard that
// refuses to substitute a locked method has no real entry to exercise.
// Inject one synthetic locked entry and pass every other prefix through to
// the real catalog, so the rest of the suite still runs against real data.
vi.mock('../src/ai/method-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai/method-catalog')>();
  const locked: AiMethodEntry = {
    methodPrefix: 'locked-test-method',
    currentVersion: 'locked-test-method.v1',
    label: 'Locked test method',
    description: 'Synthetic catalog entry — exercises the lockedModel guard.',
    module: 'pipeline',
    tier: 'extraction',
    defaultModel: 'gemini-3.5-flash',
    lockedModel: 'gemini-3.5-pro',
    lockReason: 'Flash truncates deterministically on this prompt.',
  };
  return {
    ...actual,
    findAiMethodEntry: (prefix: string): AiMethodEntry | undefined =>
      prefix === locked.methodPrefix ? locked : actual.findAiMethodEntry(prefix),
  };
});

// A CLASS, deliberately — not an object literal. `wrapWithTransientFallback`
// returns its argument untouched when there is no secondary, so in the live
// google-only config the thing this wrapper receives IS a class instance.
// A regression to `{ ...primary }` copies own enumerable properties and
// silently drops prototype methods; with an object-literal fake, every own
// property survives the spread and the guard tests below would still pass
// while production broke.
class FakeService {
  providerId = 'google';
  async complete(): Promise<never> {
    throw new Error('complete: not stubbed');
  }
  async extractStructured(): Promise<never> {
    throw new Error('extractStructured: not stubbed');
  }
  async embed(): Promise<never> {
    throw new Error('embed: not stubbed');
  }
  async translate(): Promise<never> {
    throw new Error('translate: not stubbed');
  }
  async vision(): Promise<never> {
    throw new Error('vision: not stubbed');
  }
}

function svc(overrides: Partial<AiService>): AiService {
  return Object.assign(new FakeService(), overrides) as unknown as AiService;
}

const MODEL_INVALID = new Error(
  '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
);
const TRANSIENT = new Error(
  '{"error":{"code":429,"message":"Resource exhausted","status":"RESOURCE_EXHAUSTED"}}',
);

describe('wrapWithModelInvalidFallback', () => {
  it('retries once on the catalog default and returns the retry result', async () => {
    const extract = vi
      .fn()
      .mockRejectedValueOnce(MODEL_INVALID)
      .mockResolvedValueOnce({ parsed: { ok: true }, confidence: 0.9 });
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    const out = await wrapped.extractStructured({
      methodVersion: 'program-courses-extract.v4',
    } as never);
    expect(out).toMatchObject({ parsed: { ok: true } });
    expect(extract).toHaveBeenCalledTimes(2);
    expect((extract.mock.calls[1][0] as { model?: string }).model).toBe('gemini-3.5-flash');
  });

  it('does not retry a transient error — that path is already owned', async () => {
    const extract = vi.fn().mockRejectedValue(TRANSIENT);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(
      wrapped.extractStructured({ methodVersion: 'program-digest.v1' } as never),
    ).rejects.toThrow('429');
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('rethrows when the retry also fails, rather than looping', async () => {
    const extract = vi.fn().mockRejectedValue(MODEL_INVALID);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(
      wrapped.extractStructured({ methodVersion: 'program-digest.v1' } as never),
    ).rejects.toThrow('INVALID_ARGUMENT');
    expect(extract).toHaveBeenCalledTimes(2);
  });

  // Pins the F2 decision: the SECOND error surfaces. "The catalog default was
  // refused too" is the actionable fact; masking it with the first error would
  // make a broken catalog default look like a broken pin.
  it('surfaces the SECOND error when the retry fails differently', async () => {
    const secondFailure = new Error(
      '{"error":{"code":404,"message":"models/gemini-3.5-flash is not found for API version v1","status":"NOT_FOUND"}}',
    );
    const extract = vi
      .fn()
      .mockRejectedValueOnce(MODEL_INVALID)
      .mockRejectedValueOnce(secondFailure);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(
      wrapped.extractStructured({ methodVersion: 'program-digest.v1' } as never),
    ).rejects.toThrow('NOT_FOUND');
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

  // F3: a lock records a documented model-specific failure mode. Substituting
  // the default would return a SUCCESS on the very model the lock forbids —
  // silent degradation. Fail loudly instead.
  it('never substitutes a method whose catalog entry is locked', async () => {
    const extract = vi.fn().mockRejectedValue(MODEL_INVALID);
    const wrapped = wrapWithModelInvalidFallback(svc({ extractStructured: extract }));
    await expect(
      wrapped.extractStructured({ methodVersion: 'locked-test-method.v1' } as never),
    ).rejects.toThrow('INVALID_ARGUMENT');
    expect(extract).toHaveBeenCalledTimes(1);
  });

  // The spread-regression guard. These methods live ONLY on the prototype —
  // no vi.fn() override, because `Object.assign(new FakeService(), overrides)`
  // would make an override an OWN property, which a spread happily copies.
  // Only a prototype-resident method proves `{ ...primary }` was not used.
  it('preserves prototype methods when the primary is a class instance', async () => {
    const wrapped = wrapWithModelInvalidFallback(svc({}));
    expect(typeof wrapped.complete).toBe('function');
    expect(typeof wrapped.embed).toBe('function');
    expect(typeof wrapped.translate).toBe('function');
    expect(typeof wrapped.vision).toBe('function');
    expect(typeof wrapped.extractStructured).toBe('function');
    // Reaches the real prototype implementation rather than a hole.
    await expect(wrapped.complete({} as never)).rejects.toThrow('complete: not stubbed');
  });

  it('forwards optional provider methods rather than dropping them', async () => {
    // Same reasoning: on the prototype, counted by hand rather than by a spy,
    // since vi.spyOn would install an own property and defeat the check.
    let toolCalls = 0;
    class WithOptionalMethods extends FakeService {
      async completeWithTools(): Promise<never> {
        toolCalls += 1;
        return { finalText: 'ok' } as unknown as never;
      }
      async uploadFile(): Promise<never> {
        return { fileUri: 'x' } as unknown as never;
      }
    }
    const wrapped = wrapWithModelInvalidFallback(
      new WithOptionalMethods() as unknown as AiService,
    );
    expect(wrapped.completeWithTools).toBeDefined();
    expect(wrapped.uploadFile).toBeDefined();
    await wrapped.completeWithTools?.({} as never, vi.fn());
    expect(toolCalls).toBe(1);
  });

  // The other direction of the same guard: absence must stay absence, or
  // `if (!ai.completeWithTools) throw ToolUseNotSupportedError` starts lying.
  it('leaves optional methods undefined when the primary lacks them', () => {
    const wrapped = wrapWithModelInvalidFallback(svc({}));
    expect(wrapped.completeWithTools).toBeUndefined();
    expect(wrapped.uploadFile).toBeUndefined();
  });

  // Pins the composition order in createAiService. Nested INSIDE the transient
  // wrapper, the retry would only ever reach the primary — so when the retry
  // hits a capacity failure, the secondary would be handed the ORIGINAL request
  // with no model override. Applied OUTSIDE, the retry re-enters the full
  // failover chain and the secondary receives the substituted model.
  it('sits outside the transient wrapper, so the retry still gets provider failover', async () => {
    const primaryExtract = vi
      .fn()
      .mockRejectedValueOnce(MODEL_INVALID) // pinned model refused
      .mockRejectedValueOnce(TRANSIENT); // retry on the catalog default: no capacity
    const secondaryExtract = vi.fn().mockResolvedValue({ parsed: { from: 'secondary' } });

    const wrapped = wrapWithModelInvalidFallback(
      wrapWithTransientFallback(
        svc({ providerId: 'google', extractStructured: primaryExtract }),
        svc({ providerId: 'anthropic', extractStructured: secondaryExtract }),
      ),
    );

    const out = await wrapped.extractStructured({ methodVersion: 'program-digest.v1' } as never);
    expect(out).toMatchObject({ parsed: { from: 'secondary' } });
    expect(primaryExtract).toHaveBeenCalledTimes(2);
    // The RETRY reached the secondary — not the original request.
    expect((secondaryExtract.mock.calls[0][0] as { model?: string }).model).toBe(
      'gemini-3.5-flash',
    );
  });
});
