import type { z } from 'zod';
import type {
  AiInferenceRecorder,
  AiService,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ExtractionRequest,
  ExtractionResponse,
  TranslateRequest,
  TranslateResponse,
  VisionRequest,
  VisionResponse,
} from '../types';

// OpenRouter provider — fan-out to any model through OpenRouter's
// unified API. NOT wired yet. Factory returns this when the app is
// configured with AI_PROVIDER=openrouter, and it throws at call time
// so misconfigurations fail loudly rather than silently degrading to
// a different provider.
//
// To wire up: use the OpenAI SDK with base URL set to OpenRouter's
// endpoint — OpenRouter is OpenAI-wire-compatible. Then implement
// complete/extractStructured/vision by model routing, translate via
// complete, embed via the OpenAI embedding API on OpenRouter.

export interface OpenrouterAiConfig {
  apiKey: string;
  recorder: AiInferenceRecorder;
}

const NOT_WIRED = (method: string) =>
  new Error(
    `OpenrouterAiService.${method}: not implemented yet. ` +
      'Wire to the OpenAI SDK with base URL set to https://openrouter.ai/api/v1. ' +
      'For now, use AI_PROVIDER=google or AI_PROVIDER=anthropic.',
  );

export class OpenrouterAiService implements AiService {
  readonly providerId = 'openrouter';
  constructor(_config: OpenrouterAiConfig) {
    // Keep the config reachable for when we wire this up.
    void _config;
  }
  complete(_req: CompletionRequest): Promise<CompletionResponse> {
    return Promise.reject(NOT_WIRED('complete'));
  }
  embed(_req: EmbeddingRequest): Promise<EmbeddingResponse> {
    return Promise.reject(NOT_WIRED('embed'));
  }
  extractStructured<T>(
    _req: ExtractionRequest,
    _schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<ExtractionResponse<T>> {
    return Promise.reject(NOT_WIRED('extractStructured'));
  }
  translate(_req: TranslateRequest): Promise<TranslateResponse> {
    return Promise.reject(NOT_WIRED('translate'));
  }
  vision(_req: VisionRequest): Promise<VisionResponse> {
    return Promise.reject(NOT_WIRED('vision'));
  }
}
