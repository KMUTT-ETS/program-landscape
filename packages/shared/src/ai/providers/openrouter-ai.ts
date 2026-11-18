import type { AiInferenceRecorder, ModelOverrideResolver } from '../types';
import { OpenAiChatAiService, type OpenAiChatDialect } from './openai-chat-base';

// ──────────────────────────────────────────────────────────────────────────
// OpenRouter provider — any model OpenRouter fronts, through its
// OpenAI-compatible chat-completions API (https://openrouter.ai/api/v1).
// The wire handling lives in openai-chat-base.ts; this file is OpenRouter's
// dialect.
//
// Model ids are OpenRouter's `vendor/model` form (`google/gemini-2.5-flash`,
// `anthropic/claude-sonnet-4.5`). A BARE id is accepted too, because the rest
// of the system speaks bare Gemini ids — the method catalog's defaults, the
// admin model overrides, and wrapWithModelInvalidFallback's forced retry all
// hand us `gemini-…`. Those map to `google/<id>`, which is exactly the
// OpenRouter id (see openrouter-catalog.ts: the Google id is the OpenRouter id
// minus `google/`). Any other bare id is sent as-is and OpenRouter decides.
//
// Cost: we ask OpenRouter to report the billed cost per call
// (`usage: { include: true }`), so AiInference.costEstimateUsd is the real
// charge rather than a hand-maintained PRICING table that drifts.
// ──────────────────────────────────────────────────────────────────────────

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = 'google/gemini-2.5-flash';
const APP_TITLE = 'Program Landscape';

export interface OpenrouterAiConfig {
  apiKey: string;
  recorder: AiInferenceRecorder;
  /** Baseline completion model (OpenRouter id). */
  defaultModel?: string;
  /** Embedding model (OpenRouter id). When unset, embed() refuses. */
  embeddingModel?: string;
  /** Runtime per-method-prefix model override (admin AI-settings page). */
  modelOverrideResolver?: ModelOverrideResolver;
  /** Override for tests. A self-hosted gateway is AI_PROVIDER=openai-compatible. */
  baseUrl?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Map a model id to OpenRouter's `vendor/model` form. */
export function toOpenRouterModel(id: string): string {
  const trimmed = id.trim();
  if (trimmed.includes('/')) return trimmed;
  if (trimmed.startsWith('gemini-')) return `google/${trimmed}`;
  return trimmed;
}

const OPENROUTER_DIALECT: OpenAiChatDialect = {
  className: 'OpenrouterAiService',
  label: 'OpenRouter',
  mapModel: toOpenRouterModel,
  fallbackModel: OPENROUTER_DEFAULT_MODEL,
  chatExtras: { usage: { include: true } },
  // `thinking` is off by default here because reasoning tokens share the
  // output budget with the JSON. Omitting the field is NOT off: reasoning
  // models then think at full effort (a z-ai/glm-5.3 curriculum digest
  // spent all 50,000 output tokens reasoning and returned nothing). Some
  // models also reject reasoning off ("Reasoning is mandatory"), so the
  // nearest accepted setting is minimal.
  extractionExtras: (thinking) => ({ reasoning: { effort: thinking ? 'medium' : 'minimal' } }),
  jsonMode: true,
  headers: { 'X-Title': APP_TITLE },
  embeddingModelEnv: 'AI_OPENROUTER_EMBEDDING_MODEL',
  useModelOverrides: true,
};

export class OpenrouterAiService extends OpenAiChatAiService {
  readonly providerId = 'openrouter';

  constructor(config: OpenrouterAiConfig) {
    super({ ...config, baseUrl: config.baseUrl ?? OPENROUTER_BASE_URL }, OPENROUTER_DIALECT);
  }
}
