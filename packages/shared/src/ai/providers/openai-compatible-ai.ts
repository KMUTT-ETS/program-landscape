import type { AiInferenceRecorder } from '../types';
import { OpenAiChatAiService, type OpenAiChatDialect } from './openai-chat-base';

// ──────────────────────────────────────────────────────────────────────────
// OpenAI-compatible provider — any server that speaks the OpenAI
// chat-completions protocol at a base URL you choose: vLLM, LiteLLM, Ollama,
// LM Studio, Azure-style proxies, an institutional AI gateway, or OpenAI
// itself. AI_PROVIDER=openai-compatible.
//
// Deliberately the PLAIN protocol: none of OpenRouter's extras (`usage`
// include, `reasoning`, `X-Title`), so strict servers don't reject the body.
//
// Differences from the other providers an operator should know:
//   - Model ids are sent exactly as configured. No mapping.
//   - The admin per-method model overrides are IGNORED. They pick from the
//     Gemini/Anthropic catalogue, whose ids this server almost certainly
//     doesn't serve; honouring them would fail every overridden method.
//     Every call uses AI_OPENAI_COMPATIBLE_COMPLETION_MODEL unless the call
//     names a model itself.
//   - Cost: recorded from `usage.cost` when the server reports it, else 0.
//     Token counts are always recorded.
//   - `response_format: json_object` is sent on structured extraction unless
//     AI_OPENAI_COMPATIBLE_JSON_MODE=false (for servers that reject it; the
//     prompt still demands JSON and the parser tolerates fences/prose).
// ──────────────────────────────────────────────────────────────────────────

export interface OpenAiCompatibleAiConfig {
  /** e.g. https://gateway.example.ac.th/v1 — the part before /chat/completions. */
  baseUrl: string;
  /** Optional: no Authorization header is sent when empty. */
  apiKey?: string;
  recorder: AiInferenceRecorder;
  /** Completion model id, sent verbatim. Required. */
  defaultModel: string;
  /** Embedding model id. Must return 1536 dimensions. */
  embeddingModel?: string;
  /** Send `response_format: json_object` on extraction (default true). */
  jsonMode?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleAiService extends OpenAiChatAiService {
  readonly providerId = 'openai-compatible';

  constructor(config: OpenAiCompatibleAiConfig) {
    const dialect: OpenAiChatDialect = {
      className: 'OpenAiCompatibleAiService',
      label: 'OpenAI-compatible',
      mapModel: (id) => id.trim(),
      jsonMode: config.jsonMode ?? true,
      embeddingModelEnv: 'AI_OPENAI_COMPATIBLE_EMBEDDING_MODEL',
      useModelOverrides: false,
    };
    super(
      {
        apiKey: config.apiKey,
        recorder: config.recorder,
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel,
        embeddingModel: config.embeddingModel,
        timeoutMs: config.timeoutMs,
        fetchImpl: config.fetchImpl,
      },
      dialect,
    );
  }
}
