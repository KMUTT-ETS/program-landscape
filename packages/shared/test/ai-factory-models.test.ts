import { describe, expect, it } from 'vitest';
import { normaliseModels, parseOpenrouterTimeoutMs } from '../src/ai/providers/factory';

// .env.example ships AI_GOOGLE_COMPLETION_MODEL= empty. Read through
// process.env that is '', which `??` does not skip — the provider then sent
// an empty model name and every Gemini call failed with "model is required".
describe('normaliseModels', () => {
  it('treats blank model names as unset so the provider default applies', () => {
    expect(
      normaliseModels({
        google: { completion: '', embedding: '   ' },
        anthropic: { completion: '' },
      }),
    ).toEqual({
      google: { completion: undefined, embedding: undefined },
      anthropic: { completion: undefined },
    });
  });

  it('keeps (and trims) configured model names', () => {
    expect(
      normaliseModels({
        google: { completion: ' gemini-2.5-flash ', embedding: 'gemini-embedding-001' },
      }),
    ).toEqual({
      google: { completion: 'gemini-2.5-flash', embedding: 'gemini-embedding-001' },
      anthropic: undefined,
    });
  });

  it('passes through an absent models block', () => {
    expect(normaliseModels(undefined)).toBeUndefined();
  });
});

// A whole-curriculum digest (~360k input tokens, a large structured answer)
// runs past the OpenRouter provider's built-in 120 s limit, and the Google
// fallback cannot take a prompt that size on a free-tier key either, so the
// digest failed on every run. The limit is now an env setting.
describe('parseOpenrouterTimeoutMs', () => {
  it('reads a positive whole number of milliseconds', () => {
    expect(parseOpenrouterTimeoutMs('600000')).toBe(600_000);
    expect(parseOpenrouterTimeoutMs(' 300000 ')).toBe(300_000);
  });

  it('treats blank, non-numeric, zero and negative values as unset', () => {
    for (const raw of [undefined, '', '  ', 'abc', '0', '-5', '12.5']) {
      expect(parseOpenrouterTimeoutMs(raw)).toBeUndefined();
    }
  });
});
