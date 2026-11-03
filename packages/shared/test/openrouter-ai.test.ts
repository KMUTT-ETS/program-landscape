import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { OpenrouterAiService, toOpenRouterModel } from '../src/ai/providers/openrouter-ai';
import { createAiService } from '../src/ai/providers/factory';
import { isModelInvalidError } from '../src/ai/model-invalid';
import type { AiInferenceRecorder, InferenceRecord } from '../src/ai/types';

const ctx = { module: 'test' };

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

function chatReply(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    model: 'google/gemini-2.5-flash',
    choices: [{ finish_reason: 'stop', message }],
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0012 },
    ...extra,
  };
}

/** A fetch double that records each request body and answers from a queue. */
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

describe('toOpenRouterModel', () => {
  it('passes vendor/model ids through and maps bare Gemini ids to google/', () => {
    expect(toOpenRouterModel('anthropic/claude-sonnet-4.5')).toBe('anthropic/claude-sonnet-4.5');
    expect(toOpenRouterModel('gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
    expect(toOpenRouterModel('mistral-large')).toBe('mistral-large');
  });
});

describe('OpenrouterAiService', () => {
  it('complete: sends the OpenAI wire shape and records the billed cost', async () => {
    const { r, rows } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: 'hello' }) }]);
    const svc = new OpenrouterAiService({ apiKey: 'k', recorder: r, fetchImpl: f.impl });

    const res = await svc.complete({
      ctx,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    });

    expect(res.text).toBe('hello');
    expect(res.cost.usd).toBeCloseTo(0.0012);
    expect(res.tokens).toEqual({ input: 10, output: 5 });
    expect(f.calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(f.calls[0]!.headers.Authorization).toBe('Bearer k');
    expect(f.calls[0]!.body.model).toBe('google/gemini-2.5-flash');
    expect(f.calls[0]!.body.usage).toEqual({ include: true });
    expect(f.calls[0]!.body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(rows[0]!.costEstimateUsd).toBeCloseTo(0.0012);
  });

  it('extractStructured: honours the admin override and requests JSON mode', async () => {
    const { r } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: '```json\n{"a":1}\n```' }) }]);
    const svc = new OpenrouterAiService({
      apiKey: 'k',
      recorder: r,
      fetchImpl: f.impl,
      modelOverrideResolver: { resolve: () => 'gemini-3.5-flash' },
    });

    const res = await svc.extractStructured(
      { ctx, methodVersion: 'x.v1', messages: [{ role: 'user', content: 'go' }] },
      z.object({ a: z.number() }),
    );

    expect(res.parsed).toEqual({ a: 1 });
    expect(res.confidence).toBe(0.8); // fence fixup
    expect(f.calls[0]!.body.model).toBe('google/gemini-3.5-flash');
    expect(f.calls[0]!.body.response_format).toEqual({ type: 'json_object' });
  });

  // `thinking` defaults off on extractStructured because reasoning tokens eat
  // the JSON budget. Sending nothing left reasoning models (z-ai/glm-5.3)
  // thinking at full effort: a curriculum digest spent its whole 50,000-token
  // output on reasoning and returned an empty body. Some models refuse
  // reasoning off outright ("Reasoning is mandatory"), so off means minimal.
  it('extractStructured: asks for minimal reasoning unless thinking is on', async () => {
    const { r } = recorder();
    const f = fakeFetch([
      { body: chatReply({ content: '{"a":1}' }) },
      { body: chatReply({ content: '{"a":1}' }) },
    ]);
    const svc = new OpenrouterAiService({ apiKey: 'k', recorder: r, fetchImpl: f.impl });
    const schema = z.object({ a: z.number() });
    const messages = [{ role: 'user' as const, content: 'go' }];

    await svc.extractStructured({ ctx, methodVersion: 'x.v1', messages }, schema);
    await svc.extractStructured({ ctx, methodVersion: 'x.v1', messages, thinking: true }, schema);

    expect(f.calls[0]!.body.reasoning).toEqual({ effort: 'minimal' });
    expect(f.calls[1]!.body.reasoning).toEqual({ effort: 'medium' });
  });

  it('extractStructured: records the failed response before rethrowing', async () => {
    const { r, rows } = recorder();
    const f = fakeFetch([{ body: chatReply({ content: 'not json' }) }]);
    const svc = new OpenrouterAiService({ apiKey: 'k', recorder: r, fetchImpl: f.impl });

    await expect(
      svc.extractStructured(
        { ctx, methodVersion: 'x.v1', messages: [{ role: 'user', content: 'go' }] },
        z.object({ a: z.number() }),
      ),
    ).rejects.toThrow(/schema validation/);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.confidence).toBe(0);
    expect(rows[0]!.response).toBe('not json');
  });

  it('extractStructured: refuses a Gemini File API attachment', async () => {
    const { r } = recorder();
    const svc = new OpenrouterAiService({ apiKey: 'k', recorder: r, fetchImpl: fakeFetch([]).impl });
    await expect(
      svc.extractStructured(
        {
          ctx,
          methodVersion: 'x.v1',
          messages: [],
          fileAttachment: { fileUri: 'https://generativelanguage/files/1', mimeType: 'application/pdf' },
        },
        z.object({}),
      ),
    ).rejects.toThrow(/fileAttachment/);
  });

  it('embed: refuses without an explicitly configured embedding model', async () => {
    const { r } = recorder();
    const svc = new OpenrouterAiService({ apiKey: 'k', recorder: r, fetchImpl: fakeFetch([]).impl });
    await expect(svc.embed({ ctx, texts: ['x'] })).rejects.toThrow(/no embedding model/);
  });

  it('errors carry the status code so transient and model-invalid classifiers see them', async () => {
    const { r } = recorder();
    const f = fakeFetch([
      { status: 429, body: { error: { message: 'Rate limit exceeded', code: 429 } } },
      { status: 400, body: { error: { message: 'foo/bar is not a valid model ID', code: 400 } } },
    ]);
    const svc = new OpenrouterAiService({ apiKey: 'k', recorder: r, fetchImpl: f.impl });

    await expect(svc.complete({ ctx, messages: [] })).rejects.toThrow(/OpenRouter HTTP 429/);
    const err = await svc.complete({ ctx, messages: [] }).catch((e: unknown) => e);
    expect(isModelInvalidError(err)).toBe(true);
  });

  it('completeWithTools: runs the tool loop to a final answer', async () => {
    const { r } = recorder();
    const f = fakeFetch([
      {
        body: chatReply({
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } },
          ],
        }),
      },
      { body: chatReply({ content: 'done' }) },
    ]);
    const svc = new OpenrouterAiService({ apiKey: 'k', recorder: r, fetchImpl: f.impl });
    const executeTool = vi.fn(async () => 'result-x');

    const res = await svc.completeWithTools(
      {
        ctx,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'ask' },
        ],
        tools: [{ name: 'lookup', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      },
      executeTool,
    );

    expect(executeTool).toHaveBeenCalledWith({ id: 'c1', name: 'lookup', input: { q: 'x' } });
    expect(res.finalText).toBe('done');
    expect(res.stopReason).toBe('end_turn');
    expect(res.iterations).toBe(2);
    expect(res.aiInferenceIds).toHaveLength(2);
    expect(res.cost.usd).toBeCloseTo(0.0024);
    // Second request replays the assistant tool call and its result.
    const second = f.calls[1]!.body.messages as Array<Record<string, unknown>>;
    expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(second[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'result-x' });
    expect(f.calls[0]!.body.tools).toEqual([
      { type: 'function', function: { name: 'lookup', description: 'd', parameters: { type: 'object', properties: {} } } },
    ]);
  });
});

describe('createAiService(openrouter)', () => {
  it('exposes tool use and keeps the openrouter provider id', () => {
    const { r } = recorder();
    const svc = createAiService({
      recorder: r,
      providerId: 'openrouter',
      apiKeys: { openrouter: 'k', google: 'g' },
    });
    expect(svc.providerId).toBe('openrouter');
    expect(typeof svc.completeWithTools).toBe('function');
    expect('uploadFile' in svc).toBe(false);
  });

  it('fails fast without a key', () => {
    const { r } = recorder();
    expect(() => createAiService({ recorder: r, providerId: 'openrouter', apiKeys: {} })).toThrow(
      /OPENROUTER_API_KEY/,
    );
  });
});
