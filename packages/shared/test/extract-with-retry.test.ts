import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  buildParseRetryMessage,
  extractStructuredWithParseRetry,
  type StructuredExtractor,
} from '../src/ai/extract-with-retry';
import type { AiMessage } from '../src/ai/types';

const SCHEMA = z.object({ value: z.number() });
const MESSAGES: AiMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'do the thing' },
];
const PARSE_ERROR = new Error(
  'AiService extractStructured: response failed schema validation (issues=no json found)',
);

/** Fake extractor that fails `failures` times, then succeeds, recording calls. */
function fake(failures: number, failWith: Error = PARSE_ERROR) {
  const calls: Array<AiMessage[]> = [];
  let remaining = failures;
  const ai: StructuredExtractor = {
    async extractStructured(params, schema) {
      calls.push(params.messages);
      if (remaining > 0) {
        remaining -= 1;
        throw failWith;
      }
      return {
        // Parsed through the caller's own schema — no cast needed.
        parsed: schema.parse({ value: 42 }),
        confidence: 1,
        rawText: '{"value":42}',
        tokens: { input: 1, output: 1 },
        model: 'fake',
        latencyMs: 1,
        cost: { usd: 0, model: 'fake' },
        aiInferenceId: 'fake-inference',
      };
    },
  };
  return { ai, calls };
}

describe('extractStructuredWithParseRetry', () => {
  it('passes through on first success — no retry, messages untouched', async () => {
    const { ai, calls } = fake(0);
    const out = await extractStructuredWithParseRetry(ai, { messages: MESSAGES }, SCHEMA, 't');
    expect(out.parsed).toEqual({ value: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
  });

  it('retries exactly once on a parse failure, appending the format-correction turn', async () => {
    const { ai, calls } = fake(1);
    const out = await extractStructuredWithParseRetry(ai, { messages: MESSAGES }, SCHEMA, 't');
    expect(out.parsed).toEqual({ value: 42 });
    expect(calls).toHaveLength(2);
    const retryMessages = calls[1]!;
    expect(retryMessages).toHaveLength(3);
    const last = retryMessages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('could not be parsed');
    expect(last.content).toContain('no markdown fences');
    expect(last.content).toContain('"confidence"');
  });

  it('throws after a second parse failure — never a third call', async () => {
    const { ai, calls } = fake(2);
    await expect(
      extractStructuredWithParseRetry(ai, { messages: MESSAGES }, SCHEMA, 't'),
    ).rejects.toThrow(/failed schema validation/);
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry non-parse failures — quota/auth errors re-throw untouched', async () => {
    const quota = new Error('429 quota exceeded');
    const { ai, calls } = fake(1, quota);
    await expect(
      extractStructuredWithParseRetry(ai, { messages: MESSAGES }, SCHEMA, 't'),
    ).rejects.toThrow('429 quota exceeded');
    expect(calls).toHaveLength(1);
  });

  it('buildParseRetryMessage truncates very long error messages', () => {
    const m = buildParseRetryMessage('x'.repeat(1000));
    expect(m.content.length).toBeLessThan(700);
  });
});
