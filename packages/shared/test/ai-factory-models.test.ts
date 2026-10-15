import { describe, expect, it } from 'vitest';
import { normaliseModels } from '../src/ai/providers/factory';

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
