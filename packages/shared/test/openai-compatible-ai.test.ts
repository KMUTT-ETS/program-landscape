import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { OpenAiCompatibleAiService } from '../src/ai/providers/openai-compatible-ai';
import { createAiService, parseJsonModeFlag } from '../src/ai/providers/factory';
import type { AiInferenceRecorder, InferenceRecord } from '../src/ai/types';

const ctx = { module: 'test' };
const BASE = 'http://gateway.test/v1';

function recorder() {
  const rows: InferenceRecord[] = [];
  const r: AiInferenceRecorder = {
    record: vi.fn(async (row: InferenceRecord) => {
      rows.push(row);
      return { id: `inf-${rows.length}` };
    }),
  };
  return { r, rows };
}

function chatReply(message: Record<string, unknown>, usage: Record<string, unknown> = {}) {
  return {
    model: 'qwen3-32b',
    choices: [{ finish_reason: 'stop', message }],
    usage: { prompt_tokens: 10, completion_tokens: 5, ...usage },
  };
}

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: init?.headers as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) throw new Error('fakeFetch: no response queued');
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function svc(
  f: ReturnType<typeof fakeFetch>,
  r: AiInferenceRecorder,
  extra: Partial<ConstructorParameters<typeof OpenAiCompatibleAiService>[0]> = {},
) {
  return new OpenAiCompatibleAiService({
    baseUrl: `${BASE}/`,
    apiKey: 'secret',
    recorder: r,
    defaultModel: 'qwen3-32b',
    fetchImpl: f.impl,
    ...extra,
  });
}

describe('OpenAiCompatibleAiService', () => {
  it('complete: posts the plain OpenAI wire shape to the configured base URL', async () => {
    const { r, rows } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: 'hello' }) }]);
    const res = await svc(f, r).complete({ ctx, messages: [{ role: 'user', content: 'hi' }] });

    expect(res.text).toBe('hello');
    expect(f.calls[0]!.url).toBe(`${BASE}/chat/completions`);
    expect(f.calls[0]!.headers.Authorization).toBe('Bearer secret');
    expect(f.calls[0]!.body.model).toBe('qwen3-32b');
    // None of OpenRouter's extras: strict servers reject unknown fields.
    expect(f.calls[0]!.body).not.toHaveProperty('usage');
    expect(f.calls[0]!.body).not.toHaveProperty('reasoning');
    expect(f.calls[0]!.headers).not.toHaveProperty('X-Title');
    expect(rows[0]!.costEstimateUsd).toBe(0);
    expect(rows[0]!.tokensInput).toBe(10);
  });

  it('records usage.cost when the server reports it', async () => {
    const { r, rows } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: 'x' }, { cost: 0.004 }) }]);
    await svc(f, r).complete({ ctx, messages: [{ role: 'user', content: 'hi' }] });
    expect(rows[0]!.costEstimateUsd).toBe(0.004);
  });

  it('sends model ids verbatim (no google/ prefixing)', async () => {
    const { r } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: 'x' }) }]);
    await svc(f, r).complete({ ctx, model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }] });
    expect(f.calls[0]!.body.model).toBe('gemini-2.5-flash');
  });

  it('omits the Authorization header when no key is set', async () => {
    const { r } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: 'x' }) }]);
    await svc(f, r, { apiKey: undefined }).complete({ ctx, messages: [{ role: 'user', content: 'hi' }] });
    expect(f.calls[0]!.headers).not.toHaveProperty('Authorization');
  });

  it('extractStructured: json_object by default, no reasoning field, and ignores admin overrides', async () => {
    const { r } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: '{"a":1}' }) }]);
    const s = svc(f, r);
    const out = await s.extractStructured(
      { ctx, methodVersion: 'program-digest.v3', messages: [{ role: 'user', content: 'go' }] },
      z.object({ a: z.number() }),
    );
    expect(out.parsed).toEqual({ a: 1 });
    expect(f.calls[0]!.body.response_format).toEqual({ type: 'json_object' });
    expect(f.calls[0]!.body).not.toHaveProperty('reasoning');
    expect(f.calls[0]!.body.model).toBe('qwen3-32b');
  });

  it('extractStructured: jsonMode=false drops response_format', async () => {
    const { r } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: '```json\n{"a":1}\n```' }) }]);
    const out = await svc(f, r, { jsonMode: false }).extractStructured(
      { ctx, messages: [{ role: 'user', content: 'go' }] },
      z.object({ a: z.number() }),
    );
    expect(out.parsed).toEqual({ a: 1 });
    expect(f.calls[0]!.body).not.toHaveProperty('response_format');
  });

  it('labels HTTP errors so the transient fallback can classify them', async () => {
    const { r } = recorder();
    const f = fakeFetch([{ status: 503, body: 'busy' }]);
    await expect(svc(f, r).complete({ ctx, messages: [] })).rejects.toThrow(/OpenAI-compatible HTTP 503/);
  });

  it('embed: refuses without a model, posts to /embeddings with one', async () => {
    const { r } = recorder();
    const none = fakeFetch([]);
    await expect(svc(none, r).embed({ ctx, texts: ['x'] })).rejects.toThrow(
      /AI_OPENAI_COMPATIBLE_EMBEDDING_MODEL/,
    );
    const f = fakeFetch([{ body: { data: [{ embedding: [0.1, 0.2], index: 0 }], usage: { prompt_tokens: 1 } } }]);
    const res = await svc(f, r, { embeddingModel: 'bge-m3' }).embed({ ctx, texts: ['x'] });
    expect(f.calls[0]!.url).toBe(`${BASE}/embeddings`);
    expect(f.calls[0]!.body.model).toBe('bge-m3');
    expect(res.vectors).toEqual([[0.1, 0.2]]);
  });
});

describe('createAiService(openai-compatible)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads base URL and model from env, exposes tool use', () => {
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', BASE);
    vi.stubEnv('AI_OPENAI_COMPATIBLE_COMPLETION_MODEL', 'qwen3-32b');
    const { r } = recorder();
    const s = createAiService({ recorder: r, providerId: 'openai-compatible', apiKeys: {} });
    expect(s.providerId).toBe('openai-compatible');
    expect(typeof s.completeWithTools).toBe('function');
    expect('uploadFile' in s).toBe(false);
  });

  it('fails fast without a base URL', () => {
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', '');
    vi.stubEnv('AI_OPENAI_COMPATIBLE_COMPLETION_MODEL', 'm');
    const { r } = recorder();
    expect(() => createAiService({ recorder: r, providerId: 'openai-compatible', apiKeys: {} })).toThrow(
      /OPENAI_COMPATIBLE_BASE_URL/,
    );
  });

  it('fails fast without a completion model', () => {
    vi.stubEnv('AI_OPENAI_COMPATIBLE_COMPLETION_MODEL', '');
    const { r } = recorder();
    expect(() =>
      createAiService({
        recorder: r,
        providerId: 'openai-compatible',
        apiKeys: { openaiCompatible: { baseUrl: BASE } },
      }),
    ).toThrow(/AI_OPENAI_COMPATIBLE_COMPLETION_MODEL/);
  });
});

describe('parseJsonModeFlag', () => {
  it('is on unless explicitly turned off', () => {
    expect(parseJsonModeFlag(undefined)).toBe(true);
    expect(parseJsonModeFlag('')).toBe(true);
    expect(parseJsonModeFlag('true')).toBe(true);
    for (const off of ['false', 'FALSE', '0', 'no', ' off ']) expect(parseJsonModeFlag(off)).toBe(false);
  });
});
