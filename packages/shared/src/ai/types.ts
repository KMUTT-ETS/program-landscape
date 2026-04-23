import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────
// AiService — the one abstraction every module uses to reach an LLM.
//
// Why this exists (not just "call Gemini/Claude directly in a module"):
//   1. Auditability: every call writes AiInference with prompt, response,
//      tokens, latency, cost. The Council needs a paper trail.
//   2. Provider-switchable: the KKU multi-AI gateway (IntelSphereAiService)
//      is planned — we want modules to be ignorant of which provider ran
//      the call.
//   3. Typed extraction: extractStructured<T>() is the only sane way to
//      get LLM output into Prisma rows without brittle JSON parsing.
//   4. Cost + quota centralisation.
//
// Shape is intentionally minimal: complete / embed / extractStructured /
// translate / vision. Anything else is a higher-level convenience built
// ON TOP of these five (see ai/prompts/* for curriculum-skill etc.).
// ──────────────────────────────────────────────────────────────────────────

// ── Shared identity ───────────────────────────────────────────────────────

export interface AiCallContext {
  // Logical module issuing the call — 'pdf-intake', 'curriculum', 'policy',
  // 'analyst'. Lets us group AiInference rows for the per-module cost dash.
  module: string;
  // Free-text kind for dashboards — 'course-skills.extract', 'embedding', etc.
  kind?: string;
  // Who triggered the call (null for scheduled jobs).
  userId?: string | null;
  // Caller-supplied trace id — propagates through job → LLM call → logs.
  traceId?: string;
}

export type AiMessageRole = 'system' | 'user' | 'assistant';
export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

export interface AiTokenUsage {
  input: number;
  output: number;
}

export interface AiCostEstimate {
  usd: number;
  // Model + per-1k rates used to compute — surfaced in AiInference for audit.
  model: string;
}

// ── Completion ────────────────────────────────────────────────────────────

export interface CompletionRequest {
  ctx: AiCallContext;
  messages: AiMessage[];
  // Upper bound on output tokens. Keeps runaway responses + controls cost.
  maxOutputTokens?: number;
  // Temperature 0-1. Extraction jobs use 0; analysis prose uses ~0.3.
  temperature?: number;
  // Preferred model name (provider-specific). Omit to let the provider
  // pick its default.
  model?: string;
}

export interface CompletionResponse {
  text: string;
  tokens: AiTokenUsage;
  model: string;
  latencyMs: number;
  cost: AiCostEstimate;
  aiInferenceId: string;
}

// ── Embeddings ────────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  ctx: AiCallContext;
  // Batch of strings; providers with native batch APIs use them.
  texts: string[];
  // Dimension hint; most providers have one correct answer per model.
  dimensions?: number;
}

export interface EmbeddingResponse {
  vectors: number[][];
  model: string;
  tokens: AiTokenUsage;
  latencyMs: number;
  cost: AiCostEstimate;
  aiInferenceId: string;
}

// ── Typed extraction ──────────────────────────────────────────────────────

export interface ExtractionRequest {
  ctx: AiCallContext;
  // The system + user messages that teach the LLM what to extract. Callers
  // use the prompt templates in ai/prompts/* to build these.
  messages: AiMessage[];
  // Name of the extraction — maps to method_version / prompt_version on
  // AiInference. Bump when the prompt changes behaviour.
  methodVersion: string;
  // Preferred model override (per-extractor tuning).
  model?: string;
  // Max output tokens. Budget at 2× worst-case expected JSON size.
  maxOutputTokens?: number;
}

export interface ExtractionResponse<T> {
  parsed: T;
  confidence: number;
  reasoning?: string;
  // The raw LLM output we parsed from (or tried to). Stored for audit.
  rawText: string;
  tokens: AiTokenUsage;
  model: string;
  latencyMs: number;
  cost: AiCostEstimate;
  aiInferenceId: string;
}

// ── Translation ───────────────────────────────────────────────────────────

export interface TranslateRequest {
  ctx: AiCallContext;
  text: string;
  sourceLang: 'th' | 'en';
  targetLang: 'th' | 'en';
  // For caching; identical (source, target, text) hits the cache.
  cacheKey?: string;
}

export interface TranslateResponse {
  text: string;
  cached: boolean;
  tokens: AiTokenUsage;
  latencyMs: number;
  cost: AiCostEstimate;
  aiInferenceId: string;
}

// ── Vision ────────────────────────────────────────────────────────────────

export interface VisionRequest {
  ctx: AiCallContext;
  // Base64-encoded image bytes + mime. Callers (PDF intake) convert
  // PDF page → PNG before invocation.
  images: Array<{ base64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }>;
  messages: AiMessage[];
  maxOutputTokens?: number;
  model?: string;
}

export interface VisionResponse {
  text: string;
  tokens: AiTokenUsage;
  model: string;
  latencyMs: number;
  cost: AiCostEstimate;
  aiInferenceId: string;
}

// ──────────────────────────────────────────────────────────────────────────
// The service.
// ──────────────────────────────────────────────────────────────────────────

export interface AiService {
  // Stable identifier for the provider — 'google', 'anthropic',
  // 'openrouter', 'intelsphere'. Used in model routing logs.
  readonly providerId: string;

  complete(req: CompletionRequest): Promise<CompletionResponse>;
  embed(req: EmbeddingRequest): Promise<EmbeddingResponse>;
  extractStructured<T>(
    req: ExtractionRequest,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<ExtractionResponse<T>>;
  translate(req: TranslateRequest): Promise<TranslateResponse>;
  vision(req: VisionRequest): Promise<VisionResponse>;
}

// ──────────────────────────────────────────────────────────────────────────
// Recorder contract — every provider writes AiInference rows via this.
// Implemented in ai/inference-recorder.ts with a Prisma write; mocked in
// tests for isolation.
// ──────────────────────────────────────────────────────────────────────────

export interface InferenceRecord {
  userId?: string | null;
  module: string;
  kind?: string;
  prompt: string;
  promptVersion?: string;
  model: string;
  response: string;
  confidence?: number;
  sourcesJson?: unknown;
  tokensInput?: number;
  tokensOutput?: number;
  latencyMs?: number;
  costEstimateUsd?: number;
}

export interface AiInferenceRecorder {
  record(r: InferenceRecord): Promise<{ id: string }>;
}
