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

// IntelSphere provider — routes to KKU's multi-AI gateway, the
// already-existing internal service the user's team maintains. NOT
// wired in this session; needs the gateway's API contract + creds.
//
// When wired: per-call model selection lives in the gateway's routing
// rules, so this provider's complete() mostly proxies + respects the
// gateway's response envelope. Cost estimation comes from the gateway
// (which aggregates vendor invoices).

export interface IntelSphereAiConfig {
  gatewayUrl: string;
  apiKey: string;
  recorder: AiInferenceRecorder;
}

const NOT_WIRED = (method: string) =>
  new Error(
    `IntelSphereAiService.${method}: not wired. ` +
      'Needs the KKU multi-AI gateway contract + creds. ' +
      'Use AI_PROVIDER=google or AI_PROVIDER=anthropic in the meantime.',
  );

export class IntelSphereAiService implements AiService {
  readonly providerId = 'intelsphere';
  constructor(_config: IntelSphereAiConfig) {
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
