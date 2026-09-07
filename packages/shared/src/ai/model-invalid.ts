// packages/shared/src/ai/model-invalid.ts
/**
 * "The model itself is wrong" — as distinct from "the call failed".
 *
 * Kept deliberately narrow. wrapWithTransientFallback already owns 429/5xx and
 * timeouts; if this predicate widened to those, a capacity problem would be
 * absorbed as a model substitution and the /ready breaker would never see it.
 *
 * Matched on message text because the Google SDK surfaces the provider's JSON
 * error body in the thrown Error's message rather than as structured fields.
 */
const MODEL_INVALID_MARKERS = [
  /"code"\s*:\s*400[\s\S]*"status"\s*:\s*"INVALID_ARGUMENT"/,
  /"code"\s*:\s*404[\s\S]*"status"\s*:\s*"NOT_FOUND"/,
  /is not found for API version/i,
];

export function isModelInvalidError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  if (!message) return false;
  return MODEL_INVALID_MARKERS.some((re) => re.test(message));
}
