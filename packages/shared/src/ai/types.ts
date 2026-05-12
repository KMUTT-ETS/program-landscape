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
  // Optional file URI to attach (Gemini File API; 48h retention). When
  // provided the model reads the file natively instead of receiving
  // pre-parsed text in the prompt — better quality for PDFs and 30-50×
  // cheaper input tokens than re-sending the full text per call.
  fileAttachment?: {
    fileUri: string;
    mimeType: string;
  };
  // Enable thinking-mode reasoning (Gemini Pro). Default false on
  // extractStructured because thinking tokens often eat the JSON
  // output budget. Set true for high-stakes reasoning calls (peer
  // review, recommendations).
  thinking?: boolean;
}

/**
 * Synchronous resolver for runtime model overrides.
 *
 * Implementations are expected to back this with a cached read of the
 * `ai_model_overrides` table (see packages/db's ModelOverrideStore).
 * Synchronous because the AiService dispatch path runs many times per
 * second and can't afford an async DB hop per call — the cache is
 * populated out-of-band (refreshed on TTL or on PUT/DELETE).
 *
 * Returning `undefined` means "no override; fall through to the
 * provider's static MODEL_BY_METHOD_PREFIX → defaults".
 *
 * Phase 3 (admin redesign) of the curriculum-landscape app.
 */
export interface ModelOverrideResolver {
  /** Resolve a per-method-prefix override for the given methodVersion.
   *  Implementations prefix-match against `methodVersion` (e.g.
   *  `program-pedagogy.v1` → `program-pedagogy`). */
  resolve(methodVersion: string): string | undefined;
}

/** Result of uploading a file to Gemini's File API. URI valid for 48h. */
export interface AiFileUpload {
  fileUri: string;
  mimeType: string;
  name: string;
  /** SHA-256 of file bytes — used by callers for caching. */
  contentHash: string;
  /** Server-reported expiry (ISO). */
  expiresAt: string | null;
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

// ── Tool-use (agent) ─────────────────────────────────────────────────────
//
// Thin wrapper over Anthropic's native tool_use blocks. Exposed as its
// own call to keep `complete()` simple; agents ("AI Analyst") use this
// and non-agent callers keep using `complete()`.
//
// v1 only supports Anthropic. GoogleAiService throws a friendly
// `ToolUseNotSupported` error — modules that need tool-use must run
// on an Anthropic provider. Documented in CLAUDE.md.

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema for the input. Callers build this from their Zod
  // schema via `zodToJsonSchema` (or equivalent). We accept `unknown`
  // here so we don't leak a JSON-Schema dependency into types.ts.
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type ToolUseMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      // Mixed content: some text, some tool_use blocks.
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >;
    }
  | {
      role: 'tool';
      // Results of previously-requested tool calls.
      results: ToolResult[];
    };

export interface ToolUseRequest {
  ctx: AiCallContext;
  messages: ToolUseMessage[];
  tools: ToolDefinition[];
  // Iteration cap — agents loop "call tool → feed result back" until
  // the model stops requesting tools or this limit hits. Default 8.
  maxIterations?: number;
  maxOutputTokens?: number;
  temperature?: number;
  model?: string;
}

export interface ToolUseResponse {
  // All messages produced during the loop (assistant turns + tool-result turns).
  trace: ToolUseMessage[];
  // Final assistant text (what the UI shows).
  finalText: string;
  // The last assistant turn's tool_use blocks — if any remain, the
  // iteration cap was hit.
  pendingToolCalls: ToolCall[];
  iterations: number;
  tokens: AiTokenUsage;
  model: string;
  latencyMs: number;
  cost: AiCostEstimate;
  // One AiInference row per LLM invocation across the loop. The AGENT
  // service stitches them into an evidence panel.
  aiInferenceIds: string[];
  stopReason: 'end_turn' | 'max_iterations' | 'error' | 'refusal';
}

export class ToolUseNotSupportedError extends Error {
  constructor(providerId: string) {
    super(`Tool use is not supported by provider '${providerId}'. Set AI_PROVIDER=anthropic for the analyst module.`);
    this.name = 'ToolUseNotSupportedError';
  }
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
  /** Upload a file (typically a PDF) for reuse across multiple
   *  extraction calls within the provider's retention window
   *  (Gemini: 48h). Returns a stable URI to attach via
   *  `ExtractionRequest.fileAttachment`. Optional — non-File-API
   *  providers throw `FileApiNotSupportedError`. */
  uploadFile?(bytes: Buffer, displayName: string, mimeType?: string): Promise<AiFileUpload>;
  // v1: Anthropic only. Others throw ToolUseNotSupportedError.
  // `executeTool` is provided by the CALLER — it receives a tool call
  // and returns the string result that gets fed back as a tool-result
  // message. This keeps the service provider-agnostic from tool
  // implementations.
  completeWithTools?(
    req: ToolUseRequest,
    executeTool: (call: ToolCall) => Promise<string>,
  ): Promise<ToolUseResponse>;
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
