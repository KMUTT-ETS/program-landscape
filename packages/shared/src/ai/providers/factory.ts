import type { AiInferenceRecorder, AiService } from '../types';
import { GoogleAiService } from './google-ai';
import { AnthropicAiService } from './anthropic-ai';
import { OpenrouterAiService } from './openrouter-ai';
import { IntelSphereAiService } from './intel-sphere-ai';
import { StubAiService } from './stub-ai';
import {
  CircuitBreaker,
  CircuitOpenError,
  registerBreaker,
} from '../../resilience/circuit-breaker';

// Provider factory.
//
//   AI_PROVIDER=google       — Gemini via @google/genai (default)
//   AI_PROVIDER=anthropic    — Claude via @anthropic-ai/sdk
//   AI_PROVIDER=openrouter   — stub; throws on call
//   AI_PROVIDER=intelsphere  — stub; throws on call
//   AI_PROVIDER=stub         — dev fallback; deterministic placeholders +
//                              AiInference rows, no external call. Use when
//                              running `pnpm dev` without API keys.
//
// Routing exception: embeddings. Anthropic doesn't have an embeddings
// API, so when a caller invokes `.embed()` through an Anthropic-primary
// service we transparently fall back to Google. This fallback is
// visible in AiInference (you'll see the embedding row with
// model='text-embedding-004' + provider='google' even on an
// anthropic-primary install), which is the right audit trail.

export type AiProviderId = 'google' | 'anthropic' | 'openrouter' | 'intelsphere' | 'stub';

export interface AiFactoryConfig {
  recorder: AiInferenceRecorder;
  providerId: AiProviderId;
  apiKeys: {
    google?: string;
    anthropic?: string;
    openrouter?: string;
    intelSphere?: { url: string; apiKey: string };
  };
  // Optional default model override per provider. Extractors can still
  // override per-call via ExtractionRequest.model.
  models?: {
    google?: { completion?: string; embedding?: string };
    anthropic?: { completion?: string };
  };
  /** Runtime per-method-prefix model override resolver. Backed by the
   *  ai_model_overrides table via @kku/db's AiModelOverrideStore.
   *  Optional — when absent, only the static MODEL_BY_METHOD_PREFIX
   *  table + provider defaults apply (the pre-Phase-3 behaviour). */
  modelOverrideResolver?: import('../types').ModelOverrideResolver;
}

export function createAiService(config: AiFactoryConfig): AiService {
  const { providerId, apiKeys, recorder, models, modelOverrideResolver } = config;

  switch (providerId) {
    case 'google': {
      if (!apiKeys.google) throw new Error('AI_PROVIDER=google but no GOOGLE_AI_API_KEY configured');
      const google = new GoogleAiService({
        apiKey: apiKeys.google,
        recorder,
        defaultCompletionModel: models?.google?.completion,
        defaultEmbeddingModel: models?.google?.embedding,
        modelOverrideResolver,
      });
      // Optional secondary: if an Anthropic key is also configured,
      // build a claude provider and use it as the transient-error
      // fallback. Swap is only triggered on 429/5xx/timeouts.
      const secondary = apiKeys.anthropic
        ? new AnthropicAiService({
            apiKey: apiKeys.anthropic,
            recorder,
            defaultModel: models?.anthropic?.completion,
            modelOverrideResolver,
          })
        : undefined;
      return wrapWithTransientFallback(google, secondary);
    }
    case 'anthropic': {
      if (!apiKeys.anthropic) throw new Error('AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY configured');
      if (!apiKeys.google) {
        // We COULD let embed() throw loudly at first call, but it's friendlier
        // to fail-fast at boot.
        // eslint-disable-next-line no-console
        console.warn(
          '[ai/factory] AI_PROVIDER=anthropic without GOOGLE_AI_API_KEY — embed() calls will fail.',
        );
      }
      const primary = new AnthropicAiService({
        apiKey: apiKeys.anthropic,
        recorder,
        defaultModel: models?.anthropic?.completion,
        modelOverrideResolver,
      });
      const googleSecondary = apiKeys.google
        ? new GoogleAiService({
            apiKey: apiKeys.google,
            recorder,
            defaultCompletionModel: models?.google?.completion,
            defaultEmbeddingModel: models?.google?.embedding,
            modelOverrideResolver,
          })
        : undefined;
      // Embedding fallback first (Claude has no embed API), then layer
      // transient-error fallback on top so Claude 429 → Gemini.
      const withEmbeddings = wrapWithEmbeddingFallback(primary, googleSecondary);
      return wrapWithTransientFallback(withEmbeddings, googleSecondary);
    }
    case 'openrouter': {
      if (!apiKeys.openrouter) throw new Error('AI_PROVIDER=openrouter but no OPENROUTER_API_KEY configured');
      return new OpenrouterAiService({ apiKey: apiKeys.openrouter, recorder });
    }
    case 'intelsphere': {
      if (!apiKeys.intelSphere) throw new Error('AI_PROVIDER=intelsphere but KKU_INTELSPHERE_* vars missing');
      return new IntelSphereAiService({
        gatewayUrl: apiKeys.intelSphere.url,
        apiKey: apiKeys.intelSphere.apiKey,
        recorder,
      });
    }
    case 'stub':
      return new StubAiService({ recorder });
    default: {
      const _exhaustive: never = providerId;
      throw new Error(`Unknown AI_PROVIDER: ${_exhaustive}`);
    }
  }
}

// Returns a wrapper that delegates everything to `primary` except
// `embed`, which it delegates to `fallback` (if present). Lets us use
// Claude as the primary reasoning model while still getting embeddings
// from Google without callers juggling two AiService instances.
function wrapWithEmbeddingFallback(primary: AiService, fallback: AiService | undefined): AiService {
  return {
    providerId: primary.providerId,
    complete: (r) => primary.complete(r),
    extractStructured: (r, s) => primary.extractStructured(r, s),
    translate: (r) => primary.translate(r),
    vision: (r) => primary.vision(r),
    embed: (r) => {
      if (!fallback) return primary.embed(r);
      return fallback.embed(r);
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Transient-error fallback.
//
// Wrap a primary + secondary AiService so that transient failures on the
// primary (429, 5xx, timeouts, network drops) transparently retry on the
// secondary. Every swap is logged via console.warn — upstream services
// that care (AI governance dashboard) consume this from AiInference rows,
// where the model name reveals which provider ultimately ran the call.
//
// Non-transient failures (4xx other than 429, safety refusals, schema
// validation on structured output) are NOT retried — they're deterministic
// and would fail on the secondary too.
// ──────────────────────────────────────────────────────────────────────

const TRANSIENT_ERROR_PATTERNS = [
  /\b(429|5\d\d)\b/,
  /timeout/i,
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED/,
  /unavailable|overloaded/i,
  /quota|rate[_\s-]?limit/i,
];

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_ERROR_PATTERNS.some((re) => re.test(msg));
}

// Process-wide breakers per AI provider. Registered on first call to
// `wrapWithTransientFallback` so /api/v1/ready can surface them.
const _aiBreakers = new Map<string, CircuitBreaker>();
function aiBreakerFor(providerId: string): CircuitBreaker {
  let cb = _aiBreakers.get(providerId);
  if (!cb) {
    cb = registerBreaker(
      new CircuitBreaker({
        name: `ai:${providerId}`,
        // Threshold + cooldown tuned for AI vendors: brief outages are
        // common; we want the breaker to open quickly enough to switch
        // to the secondary, then re-probe within a minute.
        threshold: Number(process.env.AI_BREAKER_THRESHOLD) || 5,
        cooldownMs: Number(process.env.AI_BREAKER_COOLDOWN_MS) || 30_000,
        // Only count INFRA failures (transient errors) toward opening.
        // Validation/refusal errors from the model are caller-fault.
        isFailure: isTransientError,
      }),
    );
    _aiBreakers.set(providerId, cb);
  }
  return cb;
}

export function wrapWithTransientFallback(
  primary: AiService,
  secondary: AiService | undefined,
): AiService {
  if (!secondary) {
    // Even with no fallback, register the primary breaker so /ready
    // sees it. The fallback chain is what executes the breaker; if
    // there's no secondary, calls flow naked but we still benefit from
    // observation. Skip the breaker.execute wrapper entirely in this
    // branch — opening the breaker would just turn outages into hard
    // 503s with no recovery path.
    aiBreakerFor(primary.providerId);
    return primary;
  }
  const primaryBreaker = aiBreakerFor(primary.providerId);
  const secondaryBreaker = aiBreakerFor(secondary.providerId);

  const withFallback = async <T>(
    label: string,
    primaryCall: () => Promise<T>,
    secondaryCall: () => Promise<T>,
  ): Promise<T> => {
    // 1. If the primary breaker is OPEN, skip primary entirely.
    try {
      return await primaryBreaker.execute(primaryCall);
    } catch (err) {
      // CircuitOpenError → primary unavailable; try secondary.
      // Otherwise: only fall back on transient errors (existing rule).
      if (!(err instanceof CircuitOpenError) && !isTransientError(err)) {
        throw err;
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[ai/fallback] ${label}: primary=${primary.providerId} ${
          err instanceof CircuitOpenError ? 'circuit OPEN' : 'transient failure'
        }, switching to secondary=${secondary.providerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // 2. Secondary call also goes through its own breaker. If it too
      // is OPEN, the original error bubbles up so the caller sees a real
      // failure rather than a synthetic CircuitOpenError on the fallback.
      try {
        return await secondaryBreaker.execute(secondaryCall);
      } catch (secErr) {
        if (secErr instanceof CircuitOpenError) {
          // Both breakers open. Throw the ORIGINAL primary error so
          // the upstream caller sees a representative failure shape.
          throw err;
        }
        throw secErr;
      }
    }
  };

  return {
    providerId: primary.providerId,
    complete: (r) =>
      withFallback(
        'complete',
        () => primary.complete(r),
        () => secondary.complete(r),
      ),
    extractStructured: (r, s) =>
      withFallback(
        'extractStructured',
        () => primary.extractStructured(r, s),
        () => secondary.extractStructured(r, s),
      ),
    translate: (r) =>
      withFallback(
        'translate',
        () => primary.translate(r),
        () => secondary.translate(r),
      ),
    vision: (r) =>
      withFallback(
        'vision',
        () => primary.vision(r),
        () => secondary.vision(r),
      ),
    // Embeddings: if the primary supports it, prefer it. Otherwise the
    // secondary is the designated embedding provider (typical setup: we
    // keep google for embeddings even with anthropic-primary).
    embed: (r) => primary.embed(r).catch(() => secondary.embed(r)),
  };
}
