import { describe, expect, it, vi } from 'vitest';

import { embedWithRetry, isTransientEmbedError, type Embedder } from '../../src/ai/embed-with-retry';
import type { EmbeddingRequest, EmbeddingResponse } from '../../src/ai/types';

const req = { ctx: { module: 'test', kind: 'embedding.test' }, texts: ['a'] } as EmbeddingRequest;
const ok = { vectors: [[0.1]] } as unknown as EmbeddingResponse;

function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

// The two errors prod actually returned on 2026-10-04.
const RATE_LIMITED = apiError(429, '{"error":{"code":429,"message":"Resource exhausted. Please try again later.","status":"RESOURCE_EXHAUSTED"}}');
const MODEL_NOT_FOUND = apiError(404, '{"error":{"code":404,"message":"models/text-embedding-001 is not found","status":"NOT_FOUND"}}');

function embedder(...outcomes: Array<Error | EmbeddingResponse>): Embedder & { embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async () => {
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return next ?? ok;
  });
  return { embed };
}

describe('isTransientEmbedError', () => {
  it('retries rate limits and server errors', () => {
    expect(isTransientEmbedError(RATE_LIMITED)).toBe(true);
    expect(isTransientEmbedError(apiError(503, 'unavailable'))).toBe(true);
    expect(isTransientEmbedError(new Error('fetch failed'))).toBe(true);
  });

  it('does not retry a deterministic 4xx, whatever the message says', () => {
    expect(isTransientEmbedError(MODEL_NOT_FOUND)).toBe(false);
    expect(isTransientEmbedError(apiError(400, 'please try again later'))).toBe(false);
    expect(isTransientEmbedError(new Error('vector of 768 dimensions'))).toBe(false);
  });
});

describe('embedWithRetry', () => {
  it('waits out a rate limit with doubling delays, then succeeds', async () => {
    const ai = embedder(RATE_LIMITED, RATE_LIMITED, ok);
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const res = await embedWithRetry(ai, req, { baseDelayMs: 1000, sleep, onRetry });
    expect(res).toBe(ok);
    expect(ai.embed).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('caps a single wait at maxDelayMs', async () => {
    const ai = embedder(RATE_LIMITED, RATE_LIMITED, RATE_LIMITED, ok);
    const sleep = vi.fn(async () => {});
    await embedWithRetry(ai, req, { baseDelayMs: 1000, maxDelayMs: 1500, sleep });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 1500, 1500]);
  });

  it('throws a non-transient error at once', async () => {
    const ai = embedder(MODEL_NOT_FOUND);
    const sleep = vi.fn(async () => {});
    await expect(embedWithRetry(ai, req, { sleep })).rejects.toBe(MODEL_NOT_FOUND);
    expect(ai.embed).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const ai = embedder(RATE_LIMITED, RATE_LIMITED, RATE_LIMITED);
    const sleep = vi.fn(async () => {});
    await expect(embedWithRetry(ai, req, { maxAttempts: 3, baseDelayMs: 1, sleep })).rejects.toBe(RATE_LIMITED);
    expect(ai.embed).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
