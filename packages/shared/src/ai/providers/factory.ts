import type { AiInferenceRecorder, AiService } from '../types';
import { GoogleAiService } from './google-ai';
import { AnthropicAiService } from './anthropic-ai';
import { OpenrouterAiService } from './openrouter-ai';
import { IntelSphereAiService } from './intel-sphere-ai';
import { StubAiService } from './stub-ai';

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
}

export function createAiService(config: AiFactoryConfig): AiService {
  const { providerId, apiKeys, recorder, models } = config;

  switch (providerId) {
    case 'google': {
      if (!apiKeys.google) throw new Error('AI_PROVIDER=google but no GOOGLE_AI_API_KEY configured');
      return new GoogleAiService({
        apiKey: apiKeys.google,
        recorder,
        defaultCompletionModel: models?.google?.completion,
        defaultEmbeddingModel: models?.google?.embedding,
      });
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
      });
      const embeddingFallback = apiKeys.google
        ? new GoogleAiService({
            apiKey: apiKeys.google,
            recorder,
            defaultCompletionModel: models?.google?.completion,
            defaultEmbeddingModel: models?.google?.embedding,
          })
        : undefined;
      return wrapWithEmbeddingFallback(primary, embeddingFallback);
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
