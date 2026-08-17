import type { ZodType, ZodTypeDef } from 'zod';

import type { AiMessage, ExtractionRequest, ExtractionResponse } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// extractStructuredWithParseRetry — one corrective retry on parse/validation
// failure.
//
// WHY: the 2026-08-17 narrative bulk run stopped itself at a 14% failure
// rate — all seven failures were the same class: the model returned output
// `extractStructured` could not validate ("no json found" ×5, missing
// `confidence` ×2). The runner already retried banned-tell violations but
// not parse failures — this closes that asymmetry.
//
// The retry appends a user turn restating the format contract and naming
// the failure. It cannot quote the model's bad output (the provider error
// does not carry raw text — the AiInference audit row does, but not
// in-process), and for format failures the restated contract is the signal
// that matters. Exactly ONE retry: a model that fails the format twice in a
// row should surface as a failure, not burn budget.
//
// Deliberately provider-agnostic and runner-owned: AiService's own policy is
// that deterministic failures do not retry (model fallback is transient-only)
// — this wrapper is a *corrective* second call with new input, not a blind
// re-send, so it lives above the service, in the runners that own prompts.
// ─────────────────────────────────────────────────────────────────────────────

/** The one method this wrapper needs — any AiService satisfies it. */
export interface StructuredExtractor {
  extractStructured<T>(
    req: ExtractionRequest,
    schema: ZodType<T, ZodTypeDef, unknown>,
  ): Promise<ExtractionResponse<T>>;
}

export function buildParseRetryMessage(errorMessage: string): AiMessage {
  return {
    role: 'user',
    content:
      `Your previous response could not be parsed as valid JSON matching the required schema ` +
      `(error: ${errorMessage.slice(0, 300)}). Respond again with ONLY the JSON object described ` +
      `in the system prompt — no prose before or after it, no markdown fences, and include every ` +
      `required field (including "confidence").`,
  };
}

export async function extractStructuredWithParseRetry<T>(
  ai: StructuredExtractor,
  params: ExtractionRequest,
  schema: ZodType<T, ZodTypeDef, unknown>,
  label: string,
): Promise<ExtractionResponse<T>> {
  try {
    return await ai.extractStructured(params, schema);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Only parse/validation failures get the corrective retry; anything else
    // (auth, quota, network) re-throws untouched — those are not fixable by
    // restating the format, and AiService's transient-fallback already
    // handled what is retryable at its level.
    if (!/failed schema validation/i.test(message)) throw err;
    console.warn(`[${label}] parse failure, retrying once with format correction: ${message}`);
    return await ai.extractStructured(
      { ...params, messages: [...params.messages, buildParseRetryMessage(message)] },
      schema,
    );
  }
}
