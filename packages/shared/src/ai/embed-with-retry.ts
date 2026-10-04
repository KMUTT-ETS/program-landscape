import type { EmbeddingRequest, EmbeddingResponse } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// embedWithRetry — backoff on rate-limit and transient errors for bulk
// embedding loops.
//
// WHY: the first prod run of `programs-overlap-prep --apply` (2026-10-04)
// died on the second batch with 429 RESOURCE_EXHAUSTED. The bulk loops send
// 96-text batches back to back with no pacing; prod's Google key has a lower
// per-minute quota than dev's, so the first throttled batch killed the run.
// Every written batch survives (the loops are resumable), but a rate limit is
// a "slow down", not a failure, and the loop should wait it out itself.
//
// Only transient failures are retried (429, 5xx, timeouts, network resets,
// "quota"/"rate limit"/"unavailable" wording). Anything else — a wrong model
// id (404), bad auth, a malformed request — re-throws at once, because waiting
// does not fix it.
//
// Lives above AiService, in the bulk runners, for the same reason as
// extractStructuredWithParseRetry: AiService's own policy is transient
// FALLBACK to another provider, not waiting; a single interactive embed must
// not sit for minutes, while a 9,000-row backfill should.
// ─────────────────────────────────────────────────────────────────────────────

/** The one method this wrapper needs — any AiService satisfies it. */
export interface Embedder {
  embed(req: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface EmbedRetryOptions {
  /** Total attempts including the first. Default `AI_EMBED_MAX_ATTEMPTS` or 8. */
  maxAttempts?: number;
  /** First wait; doubles each retry. Default `AI_EMBED_BACKOFF_MS` or 15 s. */
  baseDelayMs?: number;
  /** Ceiling on a single wait. Default 120 s. */
  maxDelayMs?: number;
  /** Called before each wait — runners log it so a slow run is visibly waiting, not hung. */
  onRetry?: (info: { attempt: number; delayMs: number; error: string }) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const TRANSIENT_PATTERNS = [
  /\b(429|5\d\d)\b/,
  /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED/,
  /timeout|timed out/i,
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|fetch failed/,
  /quota|rate[_\s-]?limit|overloaded|try again later/i,
];

export function isTransientEmbedError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) return true;
    // Any other HTTP status is deterministic (404 model, 400 request, 401/403 auth).
    if (status >= 400) return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

function envInt(name: string): number | undefined {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function embedWithRetry(
  ai: Embedder,
  req: EmbeddingRequest,
  opts: EmbedRetryOptions = {},
): Promise<EmbeddingResponse> {
  const maxAttempts = opts.maxAttempts ?? envInt('AI_EMBED_MAX_ATTEMPTS') ?? 8;
  const baseDelayMs = opts.baseDelayMs ?? envInt('AI_EMBED_BACKOFF_MS') ?? 15_000;
  const maxDelayMs = opts.maxDelayMs ?? 120_000;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await ai.embed(req);
    } catch (err: unknown) {
      if (attempt >= maxAttempts || !isTransientEmbedError(err)) throw err;
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      opts.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
