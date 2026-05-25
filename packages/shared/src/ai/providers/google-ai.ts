import { GoogleGenAI } from '@google/genai';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  AiFileUpload,
  AiInferenceRecorder,
  AiService,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ExtractionRequest,
  ExtractionResponse,
  ModelOverrideResolver,
  TranslateRequest,
  TranslateResponse,
  VisionRequest,
  VisionResponse,
} from '../types';
import { findAiMethodEntry } from '../method-catalog';
import { scrubMessages } from '../scrub-messages';

// Google/Gemini provider. Default because:
//   - Thai handling is strong on Gemini's top-tier models; Claude is
//     equally strong but the Anthropic API's Thai responses occasionally
//     drop tone marks under high-temp settings
//   - flash-lite tier is cost-effective for extractor pipelines
//   - embedding model (text-embedding-004) is multilingual
//
// Model choice per call. Resolution order (see pickModelForMethod):
//   1. explicit `model:` on the request   (highest priority)
//   2. per-method admin override          (ai_model_overrides table)
//   3. static MODEL_BY_METHOD_PREFIX       (empty since 2026-05-20)
//   4. DEFAULT_COMPLETION_MODEL            (provider default)
//   embed always → 'text-embedding-004' (1536 dims — matches pgvector)

// Universal default (2026-05-20). gemini-3.5-flash is the default for
// every Gemini call — extraction, narrative, and reasoning alike —
// superseding the all-Pro posture of 2026-05-12. 3.5 Flash is a premium
// Flash tier (priced near Pro) and does not exhibit the mid-JSON
// truncation that drove the earlier retreat off gemini-3-flash-preview /
// gemini-flash-latest. Pin a specific prompt back to Pro per-method on
// the admin AI-settings page if a regression ever warrants it.
const DEFAULT_COMPLETION_MODEL = 'gemini-3.5-flash';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';

// Per-1k-token prices in USD — FALLBACK ONLY. The authoritative cost
// figures now live in the ai_model_catalog table (refreshed daily from
// OpenRouter); PrismaAiInferenceRecorder computes costEstimateUsd from
// there and only falls back to this table for a model absent from the
// catalog. Update when Google bumps pricing.
const PRICING: Record<string, { input: number; output: number }> = {
  // Flash tier — extraction tasks (digest, faculty, skills, careers,
  // demand-match, skill-normaliser).
  'gemini-3-flash-preview':   { input: 0.00030,  output: 0.00250 },
  // gemini-3.5-flash — premium Flash tier, priced near Pro. Universal
  // default since 2026-05-20.
  'gemini-3.5-flash':         { input: 0.00150,  output: 0.00900 },
  'gemini-2.5-flash':         { input: 0.00030,  output: 0.00250 },
  'gemini-2.5-flash-lite':    { input: 0.00010,  output: 0.00040 },
  'gemini-flash-latest':      { input: 0.00030,  output: 0.00250 },
  // Pro tier (thinking) — high-stakes reasoning (peer review,
  // recommendations, AI readiness narratives). Higher cost; better
  // judgment + structure on long-form qualitative output.
  'gemini-3.1-pro-preview':   { input: 0.00125,  output: 0.01000 },
  'gemini-2.5-pro':           { input: 0.00125,  output: 0.01000 },
  // Embedding
  'text-embedding-004':       { input: 0.00001,  output: 0 },
};

// Static per-method-prefix model assignment — a fallback layer consulted
// AFTER runtime admin overrides (ai_model_overrides) but BEFORE the
// provider default. Empty since the 2026-05-20 universal-flash switch:
// every method resolves to DEFAULT_COMPLETION_MODEL unless an admin pins
// a different model on the AI-settings page. The prior Pro-tier pins
// (program-peer-review / -peer-selection / -strategic-narrative /
// -ai-readiness / -pedagogy) are in git history — re-add an entry here
// only for a hard, non-admin-overridable pin; the admin override is the
// supported per-method mechanism.
// Static method-prefix → model pin table. Reserved for hard pins that
// MUST trump the admin's runtime override (the catalog's `lockedModel`
// is now the canonical way to express this — kept here as a fast-path
// only). Re-add an entry here only if the catalog mechanism isn't an
// option (e.g. a method that has no catalog entry).
const MODEL_BY_METHOD_PREFIX: Array<{ prefix: string; model: string }> = [];

function pickModelForMethod(
  methodVersion: string | undefined,
  fallback: string,
  resolver?: ModelOverrideResolver,
): string {
  if (!methodVersion) return fallback;
  // 1. Catalog `lockedModel` — highest priority, trumps the admin
  //    override. Used for methods with a documented model-specific
  //    failure mode (e.g. program-courses-extract on Flash truncates).
  const entry = findAiMethodEntry(
    methodVersion.replace(/\.v\d+(?:\.\d+)*$/, ''),
  );
  if (entry?.lockedModel) return entry.lockedModel;
  // 2. Runtime override (admin AI-settings page).
  if (resolver) {
    const override = resolver.resolve(methodVersion);
    if (override) return override;
  }
  // 3. Hardcoded prefix table (legacy / no-catalog-entry pins).
  for (const r of MODEL_BY_METHOD_PREFIX) {
    if (methodVersion.startsWith(r.prefix)) return r.model;
  }
  // 4. Provider-level default.
  return fallback;
}

export interface GoogleAiConfig {
  apiKey: string;
  recorder: AiInferenceRecorder;
  // Optional model overrides per call type.
  defaultCompletionModel?: string;
  defaultEmbeddingModel?: string;
  /** Runtime per-method-prefix model override (admin AI-settings page,
   *  Phase 3). Consulted before the static MODEL_BY_METHOD_PREFIX table. */
  modelOverrideResolver?: ModelOverrideResolver;
}

export class GoogleAiService implements AiService {
  readonly providerId = 'google';
  private readonly client: GoogleGenAI;

  constructor(private readonly config: GoogleAiConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = req.model ?? this.config.defaultCompletionModel ?? DEFAULT_COMPLETION_MODEL;
    const started = Date.now();
    // Pre-flight PII scrub — strips Thai citizen IDs, phones, non-KKU
    // emails, and HR salary lines from the OUTBOUND prompt before any
    // network call. Audit log captures the scrubbed text only.
    const scrubbed = scrubMessages(req.messages);
    const { system, userText } = splitSystemFromMessages(scrubbed.messages);

    const result = await this.client.models.generateContent({
      model,
      contents: userText,
      config: {
        systemInstruction: system,
        temperature: req.temperature ?? 0,
        maxOutputTokens: req.maxOutputTokens,
      },
    });
    const latencyMs = Date.now() - started;

    const text = result.text ?? '';
    const tokens = extractUsage(result.usageMetadata);
    const cost = estimateCost(model, tokens);

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind,
      // Audit-log the SCRUBBED prompt — keeps PII out of our DB too.
      prompt: messagesToString(scrubbed.messages),
      model,
      response: text,
      tokensInput: tokens.input,
      tokensOutput: tokens.output,
      latencyMs,
      costEstimateUsd: cost.usd,
      sourcesJson: scrubbed.didScrub
        ? { inputRedactions: scrubbed.redactions }
        : undefined,
    });

    return { text, tokens, model, latencyMs, cost, aiInferenceId };
  }

  async extractStructured<T>(
    req: ExtractionRequest,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<ExtractionResponse<T>> {
    const model =
      req.model ??
      pickModelForMethod(
        req.methodVersion,
        this.config.defaultCompletionModel ?? DEFAULT_COMPLETION_MODEL,
        this.config.modelOverrideResolver,
      );
    const started = Date.now();
    const { system, userText } = splitSystemFromMessages(req.messages);

    // Build the contents array. When a file attachment is provided
    // (Gemini File API), reference it as a `fileData` part — the
    // model reads the file natively. Caller's user text becomes the
    // instruction; the file content is implicit via URI (no
    // re-tokenisation per call).
    const userParts: Array<Record<string, unknown>> = [];
    if (req.fileAttachment) {
      userParts.push({
        fileData: {
          fileUri: req.fileAttachment.fileUri,
          mimeType: req.fileAttachment.mimeType,
        },
      });
    }
    userParts.push({ text: userText });
    const contents = [{ role: 'user', parts: userParts }];

    // Thinking config — disabled by default for extraction (thinking
    // tokens eat the JSON output budget). Enabled when the caller
    // explicitly requests it OR when method-version routes to Pro
    // (reasoning tasks benefit from thinking).
    const isProModel = model.includes('-pro');
    const useThinking = req.thinking ?? isProModel;

    // Single in-line retry on JSON-schema-validation failure.
    // Common Gemini failure modes are stochastic: mid-output truncation
    // when temperature jitter shifts token sampling, "no json found"
    // when thinking output bleeds through, schema mismatches when an
    // optional field gets emitted with a different shape. A retry at
    // temperature 0 with the SAME prompt clears 60-80% of these cases
    // in our SEQ-0062 baseline. Each attempt is recorded as its own
    // AiInference row for full audit (failed attempts get
    // confidence=0). Only retried once — second failure throws.
    const baseConfig = {
      systemInstruction: system,
      temperature: 0,
      maxOutputTokens: req.maxOutputTokens ?? (isProModel ? 16384 : 4096),
      responseMimeType: 'application/json',
      thinkingConfig: useThinking
        ? // For Pro thinking, cap thinking budget so a fraction of the
          // output budget is preserved for the JSON itself. Without
          // this cap, Pro routinely consumes the entire budget on
          // thinking tokens and emits a truncated JSON response.
          { thinkingBudget: Math.floor((req.maxOutputTokens ?? 16384) * 0.4) }
        : { thinkingBudget: 0 },
    };

    let parseOutcome: { parsed: T; confidence: number; reasoning?: string } | null = null;
    let rawText = '';
    let tokens = { input: 0, output: 0 };
    let cost: { usd: number; model: string } = { usd: 0, model };
    let latencyMs = 0;
    let attemptedTimes = 0;
    let lastParseError: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      attemptedTimes = attempt;
      const attemptStarted = Date.now();
      const result = await this.client.models.generateContent({
        model,
        contents,
        config: baseConfig as Parameters<typeof this.client.models.generateContent>[0]['config'],
      });
      latencyMs = Date.now() - attemptStarted;
      rawText = result.text ?? '';
      tokens = extractUsage(result.usageMetadata);
      cost = estimateCost(model, tokens);

      try {
        parseOutcome = parseStructured<T>(rawText, schema);
        break; // success
      } catch (parseErr) {
        lastParseError = parseErr;
        // Record the failed attempt (audit trail intact) but DON'T
        // throw — give it one more shot.
        await this.config.recorder.record({
          userId: req.ctx.userId ?? null,
          module: req.ctx.module,
          kind: req.ctx.kind ?? 'extract',
          prompt: messagesToString(req.messages) + (attempt === 2 ? ' [retry]' : ''),
          promptVersion: req.methodVersion,
          model,
          response: rawText,
          confidence: 0,
          tokensInput: tokens.input,
          tokensOutput: tokens.output,
          latencyMs,
          costEstimateUsd: cost.usd,
        });
        if (attempt === 2) throw parseErr;
        // Else loop: try again at the same temperature (token sampling
        // is non-deterministic under the hood; same prompt → different
        // tokens on the retry).
      }
    }
    if (!parseOutcome) {
      throw lastParseError ?? new Error('extractStructured: no parse outcome after 2 attempts');
    }
    const { parsed, confidence, reasoning } = parseOutcome;
    void attemptedTimes; // recorded via separate inference rows

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'extract',
      prompt: messagesToString(req.messages),
      promptVersion: req.methodVersion,
      model,
      response: rawText,
      confidence,
      tokensInput: tokens.input,
      tokensOutput: tokens.output,
      latencyMs,
      costEstimateUsd: cost.usd,
    });

    return {
      parsed,
      confidence,
      reasoning,
      rawText,
      tokens,
      model,
      latencyMs,
      cost,
      aiInferenceId,
    };
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = this.config.defaultEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    const started = Date.now();

    const result = await this.client.models.embedContent({
      model,
      contents: req.texts,
      config: req.dimensions ? { outputDimensionality: req.dimensions } : undefined,
    });
    const latencyMs = Date.now() - started;

    const vectors = (result.embeddings ?? []).map((e) => e.values ?? []);
    // Google's embed API returns no token count; estimate from chars/4.
    const approxInputTokens = Math.ceil(
      req.texts.reduce((s, t) => s + t.length, 0) / 4,
    );
    const tokens = { input: approxInputTokens, output: 0 };
    const cost = estimateCost(model, tokens);

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'embedding',
      prompt: req.texts.join('\n---\n'),
      model,
      response: `<${vectors.length} vectors × ${vectors[0]?.length ?? 0} dims>`,
      tokensInput: tokens.input,
      latencyMs,
      costEstimateUsd: cost.usd,
    });

    return { vectors, model, tokens, latencyMs, cost, aiInferenceId };
  }

  async translate(req: TranslateRequest): Promise<TranslateResponse> {
    // Minimal translate — asks the model to produce only translated text.
    // Caching against (sourceLang, targetLang, text) is intentionally left
    // as a higher-level concern (apps add Redis caching if they need it).
    const src = req.sourceLang === 'th' ? 'Thai' : 'English';
    const dst = req.targetLang === 'th' ? 'Thai' : 'English';
    const system = `You are a precise translator. Translate the user message from ${src} to ${dst}. Output ONLY the translated text, preserve formatting, do not add commentary.`;

    const resp = await this.complete({
      ctx: { ...req.ctx, kind: req.ctx.kind ?? 'translation' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: req.text },
      ],
      temperature: 0,
      maxOutputTokens: Math.max(256, req.text.length),
    });

    return {
      text: resp.text.trim(),
      cached: false,
      tokens: resp.tokens,
      latencyMs: resp.latencyMs,
      cost: resp.cost,
      aiInferenceId: resp.aiInferenceId,
    };
  }

  async vision(req: VisionRequest): Promise<VisionResponse> {
    const model = req.model ?? this.config.defaultCompletionModel ?? DEFAULT_COMPLETION_MODEL;
    const started = Date.now();
    const { system, userText } = splitSystemFromMessages(req.messages);

    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [{ text: userText }];
    for (const img of req.images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }

    const result = await this.client.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: system,
        temperature: 0,
        maxOutputTokens: req.maxOutputTokens ?? 4096,
      },
    });
    const latencyMs = Date.now() - started;

    const text = result.text ?? '';
    const tokens = extractUsage(result.usageMetadata);
    const cost = estimateCost(model, tokens);

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'vision',
      prompt: messagesToString(req.messages) + `\n[+${req.images.length} image(s)]`,
      model,
      response: text,
      tokensInput: tokens.input,
      tokensOutput: tokens.output,
      latencyMs,
      costEstimateUsd: cost.usd,
    });

    return { text, tokens, model, latencyMs, cost, aiInferenceId };
  }

  /**
   * Upload bytes to Gemini's File API. Returns a stable URI that can
   * be attached to subsequent extraction calls via
   * `ExtractionRequest.fileAttachment`. Files are retained for 48
   * hours by Google; callers that need longer caching should re-upload.
   *
   * The SDK's `files.upload` takes a path or a Blob. We hand it a
   * Buffer wrapped as a Blob to avoid an intermediate disk write.
   */
  async uploadFile(
    bytes: Buffer,
    displayName: string,
    mimeType = 'application/pdf',
  ): Promise<AiFileUpload> {
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    const uploaded = await this.client.files.upload({
      file: blob,
      config: { mimeType, displayName },
    });
    if (!uploaded.uri) {
      throw new Error(`Gemini File API upload returned no URI for "${displayName}"`);
    }
    return {
      fileUri: uploaded.uri,
      mimeType: uploaded.mimeType ?? mimeType,
      name: uploaded.name ?? displayName,
      contentHash,
      expiresAt: uploaded.expirationTime ?? null,
    };
  }

  // ── completeWithTools — Gemini function-calling agent loop ─────────
  // Mirrors the Anthropic implementation but uses Gemini's
  // functionDeclarations + functionCall / functionResponse parts.
  // Defaults to Flash (fast + cheap) — caller can override via
  // req.model. Each iteration produces one AiInference row; the agent
  // service stitches them into the evidence panel.
  async completeWithTools(
    req: import('../types').ToolUseRequest,
    executeTool: (call: import('../types').ToolCall) => Promise<string>,
  ): Promise<import('../types').ToolUseResponse> {
    const model =
      req.model ?? this.config.defaultCompletionModel ?? DEFAULT_COMPLETION_MODEL;
    const maxIterations = Math.max(1, Math.min(req.maxIterations ?? 8, 16));
    const started = Date.now();

    // Split system + working messages from the incoming trace.
    const sysMsg = req.messages.find((m) => m.role === 'system');
    const systemInstruction =
      sysMsg && sysMsg.role === 'system' ? sysMsg.content : undefined;
    const workingMessages: import('../types').ToolUseMessage[] = req.messages
      .filter((m) => m.role !== 'system') as import('../types').ToolUseMessage[];

    const conversation: import('../types').ToolUseMessage[] = [...workingMessages];
    const aiInferenceIds: string[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCostUsd = 0;
    let iterations = 0;
    let stopReason: import('../types').ToolUseResponse['stopReason'] = 'end_turn';
    let finalText = '';
    let pendingToolCalls: import('../types').ToolCall[] = [];

    // Gemini 2.5+/3.x: when a function call comes back with a
    // `thoughtSignature`, that signature MUST be echoed on the same
    // call when we re-send the assistant turn in the next iteration —
    // otherwise the API rejects the request with HTTP 400. Track them
    // alongside the conversation by synthesised call id.
    const signaturesByCallId = new Map<string, string>();

    // Gemini tool declaration shape: array with one entry containing
    // every function we expose. Gemini accepts the input schema as
    // OpenAPI 3.0 Schema (functionally a JSON Schema subset). The
    // sanitiser strips schema constructs Gemini rejects (number-typed
    // enums in particular — Gemini's enum field is hard-coded to
    // string-typed values regardless of the property's declared type).
    const toolDeclarations = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: sanitiseSchemaForGemini(t.inputSchema),
        })),
      },
    ];

    for (iterations = 0; iterations < maxIterations; iterations++) {
      const contents = toolUseToGeminiContents(conversation, signaturesByCallId);
      const iterationStarted = Date.now();
      const result = await this.client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: req.temperature ?? 0.3,
          maxOutputTokens: req.maxOutputTokens,
          tools: toolDeclarations,
        },
      });
      const iterationLatency = Date.now() - iterationStarted;

      const tokens = extractUsage(result.usageMetadata);
      totalInput += tokens.input;
      totalOutput += tokens.output;
      const iterCost = estimateCost(model, tokens);
      totalCostUsd += iterCost.usd;

      // Parse out text + functionCall blocks from the response parts.
      const parts = result.candidates?.[0]?.content?.parts ?? [];
      const textBlocks: string[] = [];
      const toolCalls: import('../types').ToolCall[] = [];
      for (const part of parts) {
        const p = part as {
          text?: string;
          functionCall?: { name?: string; args?: Record<string, unknown> };
          thoughtSignature?: string;
        };
        if (typeof p.text === 'string' && p.text.length > 0) {
          textBlocks.push(p.text);
        } else if (p.functionCall && typeof p.functionCall.name === 'string') {
          // Gemini doesn't return an id; synthesise one so the
          // ToolUseMessage shape stays consistent across providers.
          const callId = `gemini-${iterations}-${toolCalls.length}-${p.functionCall.name}`;
          if (typeof p.thoughtSignature === 'string' && p.thoughtSignature.length > 0) {
            signaturesByCallId.set(callId, p.thoughtSignature);
          }
          toolCalls.push({
            id: callId,
            name: p.functionCall.name,
            input: (p.functionCall.args ?? {}) as Record<string, unknown>,
          });
        }
      }

      const assistantTurn: import('../types').ToolUseMessage = {
        role: 'assistant',
        content: [
          ...textBlocks.map((t) => ({ type: 'text' as const, text: t })),
          ...toolCalls.map((c) => ({
            type: 'tool_use' as const,
            id: c.id,
            name: c.name,
            input: c.input,
          })),
        ],
      };
      conversation.push(assistantTurn);

      const { id: aiInferenceId } = await this.config.recorder.record({
        userId: req.ctx.userId ?? null,
        module: req.ctx.module,
        kind: req.ctx.kind ?? 'tool-use',
        prompt: toolUseMessagesToString(conversation.slice(0, -1)),
        model,
        response:
          textBlocks.join('\n') +
          (toolCalls.length > 0
            ? '\n' + toolCalls.map((c) => `[tool ${c.name}]`).join('\n')
            : ''),
        tokensInput: tokens.input,
        tokensOutput: tokens.output,
        latencyMs: iterationLatency,
        costEstimateUsd: iterCost.usd,
        sourcesJson: { toolCalls },
      });
      aiInferenceIds.push(aiInferenceId);

      if (toolCalls.length === 0) {
        finalText = textBlocks.join('\n').trim();
        pendingToolCalls = [];
        stopReason = 'end_turn';
        break;
      }

      // Execute each tool; feed results back as a `tool` turn so the
      // next iteration's contents include them as functionResponse parts.
      const results = await Promise.all(
        toolCalls.map(async (call) => {
          try {
            const content = await executeTool(call);
            return { toolCallId: call.id, content, isError: false };
          } catch (err) {
            return {
              toolCallId: call.id,
              content: `Tool error: ${(err as Error).message}`,
              isError: true,
            };
          }
        }),
      );
      conversation.push({ role: 'tool', results });
    }

    if (iterations === maxIterations) {
      stopReason = 'max_iterations';
      const last = conversation[conversation.length - 1];
      if (last && last.role === 'assistant') {
        pendingToolCalls = last.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            const tu = b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
            return { id: tu.id, name: tu.name, input: tu.input };
          });
      }
    }

    const latencyMs = Date.now() - started;
    return {
      trace: conversation,
      finalText,
      pendingToolCalls,
      iterations,
      tokens: { input: totalInput, output: totalOutput },
      model,
      latencyMs,
      cost: { usd: totalCostUsd, model },
      aiInferenceIds,
      stopReason,
    };
  }
}

// Recursively walk a JSON-Schema-shaped object and remove constructs
// Gemini's function-calling validator rejects:
//   - `enum` on non-string types (number-enum throws TYPE_STRING)
//   - `default`, `examples`, `$ref`, `additionalProperties` (silently
//     ignored or sometimes rejected depending on Gemini version)
// Returns a new object — does not mutate the input.
function sanitiseSchemaForGemini(schema: unknown): Record<string, unknown> {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'enum') {
      // Drop enum unless every value is a string — Gemini only accepts string enums.
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
        out[k] = v;
      }
      continue;
    }
    if (k === '$ref' || k === 'additionalProperties' || k === 'examples') continue;
    if (k === 'properties' && v !== null && typeof v === 'object') {
      const props: Record<string, unknown> = {};
      for (const [propKey, propVal] of Object.entries(v)) {
        props[propKey] = sanitiseSchemaForGemini(propVal);
      }
      out[k] = props;
    } else if (k === 'items') {
      out[k] = sanitiseSchemaForGemini(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Tool-use helpers ─────────────────────────────────────────────────
// Convert our ToolUseMessage[] into Gemini's contents shape. Gemini
// uses { role: 'user' | 'model', parts: [{ text } | { functionCall }
// | { functionResponse } | ...] }. Tool results land as a 'user' turn
// with functionResponse parts (the role 'function' is legacy).
function toolUseToGeminiContents(
  msgs: import('../types').ToolUseMessage[],
  signaturesByCallId?: Map<string, string>,
): Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> {
  const out: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];
  for (const m of msgs) {
    if (m.role === 'system') continue; // handled separately as systemInstruction
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      for (const block of m.content) {
        if (block.type === 'text') parts.push({ text: block.text });
        else if (block.type === 'tool_use') {
          // Echo the thoughtSignature back to Gemini if we captured one
          // for this call. Required by Gemini 2.5+/3.x for multi-turn
          // tool-use to work.
          const sig = signaturesByCallId?.get(block.id);
          const part: Record<string, unknown> = {
            functionCall: { name: block.name, args: block.input },
          };
          if (sig) part.thoughtSignature = sig;
          parts.push(part);
        }
      }
      if (parts.length === 0) parts.push({ text: '' });
      out.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        parts: m.results.map((r) => ({
          functionResponse: {
            name: extractToolNameFromId(r.toolCallId),
            response: r.isError
              ? { error: r.content }
              : { result: r.content },
          },
        })),
      });
    }
  }
  return out;
}

// Synthesised tool-call id format: `gemini-<iter>-<idx>-<name>` — pull
// the name back out for the functionResponse part. Falls back to the id
// itself when the format doesn't match.
function extractToolNameFromId(id: string): string {
  const match = id.match(/^gemini-\d+-\d+-(.+)$/);
  return match ? match[1]! : id;
}

function toolUseMessagesToString(msgs: import('../types').ToolUseMessage[]): string {
  return msgs
    .map((m) => {
      if (m.role === 'user') return `[user]\n${m.content}`;
      if (m.role === 'system') return `[system]\n${m.content}`;
      if (m.role === 'assistant') {
        const text = m.content
          .map((c) =>
            c.type === 'text' ? c.text : `[tool ${c.name}(${JSON.stringify(c.input)})]`,
          )
          .join('\n');
        return `[assistant]\n${text}`;
      }
      return `[tool-results]\n${m.results.map((r) => `#${r.toolCallId}: ${r.content.slice(0, 120)}`).join('\n')}`;
    })
    .join('\n\n');
}

// Scrub-aware message split. Every caller goes through this helper, so
// applying the PII scrubber here means EVERY outbound prompt + every
// audit-log entry contains scrubbed text — no caller can forget to
// scrub. System messages are server-controlled and pass through.
function splitSystemFromMessages(messages: CompletionRequest['messages']): {
  system: string | undefined;
  userText: string;
} {
  const scrubbed = scrubMessages(messages).messages;
  const system = scrubbed.find((m) => m.role === 'system')?.content;
  const userText = scrubbed
    .filter((m) => m.role !== 'system')
    .map((m) => m.content)
    .join('\n\n');
  return { system, userText };
}

function messagesToString(messages: CompletionRequest['messages']): string {
  // Audit log gets the SCRUBBED text — the prompt-04 audit confirmed
  // PII must not land in our DB any more than it does on the wire.
  const scrubbed = scrubMessages(messages).messages;
  return scrubbed.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
}

function extractUsage(usage: unknown): { input: number; output: number } {
  const u = usage as
    | { promptTokenCount?: number; candidatesTokenCount?: number }
    | undefined;
  return {
    input: u?.promptTokenCount ?? 0,
    output: u?.candidatesTokenCount ?? 0,
  };
}

function estimateCost(model: string, tokens: { input: number; output: number }) {
  const price = PRICING[model];
  if (!price) return { usd: 0, model };
  const usd = (tokens.input / 1000) * price.input + (tokens.output / 1000) * price.output;
  return { usd, model };
}

// Parse structured output. Gemini with responseMimeType=application/json
// returns a JSON string. We try to Zod-validate; on parse failure we
// strip common LLM quirks (markdown fences, leading prose) and retry once.
// Confidence is a heuristic — 1 for a clean validated parse, 0.5 for a
// "validated after fixup", 0 for "couldn't parse". Real per-field
// confidence belongs in the extractor's prompt (it can return
// `{ data, confidence, reasoning }` directly).
function parseStructured<T>(
  rawText: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): { parsed: T; confidence: number; reasoning?: string } {
  const tryParse = (s: string) => {
    try {
      const json = JSON.parse(s);
      return schema.safeParse(json);
    } catch {
      return null;
    }
  };

  let result = tryParse(rawText);
  let usedFixup = false;
  if (!result || !result.success) {
    // Strip markdown fences + leading prose
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    const firstBrace = stripped.search(/[{[]/);
    if (firstBrace >= 0) {
      const candidate = stripped.slice(firstBrace);
      result = tryParse(candidate);
      usedFixup = true;

      // Brace-balance fixup. Gemini occasionally emits one or more trailing
      // `}` past the structurally-balanced point of a valid JSON object —
      // observed in ~80% of program-digest failures. Drop trailing `}` /
      // `]` chars one at a time while the count of closes exceeds opens,
      // re-trying parse after each. Skips silently if the imbalance goes
      // the other way (truncation) — that's not recoverable here.
      if (!result || !result.success) {
        const open = (candidate.match(/[{[]/g) ?? []).length;
        const close = (candidate.match(/[}\]]/g) ?? []).length;
        if (close > open) {
          let trimmed = candidate;
          let drops = close - open;
          while (drops > 0 && trimmed.length > 0) {
            const last = trimmed.search(/[}\]]\s*$/);
            if (last < 0) break;
            trimmed = trimmed.slice(0, last).trimEnd();
            drops--;
          }
          const balanced = tryParse(trimmed);
          if (balanced && balanced.success) result = balanced;
        }
      }
    }
  }
  if (!result || !result.success) {
    throw new Error(
      `AiService extractStructured: response failed schema validation (issues=${
        result?.success === false ? JSON.stringify(result.error.issues.slice(0, 3)) : 'no json found'
      })`,
    );
  }

  const parsed = result.data as T;
  // Heuristic confidence. Higher-quality providers' own confidence scores
  // can be surfaced through extractor prompt schemas (e.g. include a
  // `confidence` field in the Zod schema and the parser picks it up).
  let confidence = usedFixup ? 0.8 : 1;
  const maybeWithConfidence = parsed as unknown as { confidence?: unknown };
  if (typeof maybeWithConfidence.confidence === 'number') {
    confidence = Math.max(0, Math.min(1, maybeWithConfidence.confidence));
  }

  return { parsed, confidence, reasoning: undefined };
}
