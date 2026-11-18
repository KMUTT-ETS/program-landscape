import { z } from 'zod';
import { scrubMessages } from '../scrub-messages';
import type {
  AiInferenceRecorder,
  AiService,
  AiTokenUsage,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ExtractionRequest,
  ExtractionResponse,
  ModelOverrideResolver,
  ToolCall,
  ToolUseMessage,
  ToolUseRequest,
  ToolUseResponse,
  TranslateRequest,
  TranslateResponse,
  VisionRequest,
  VisionResponse,
} from '../types';

// ──────────────────────────────────────────────────────────────────────────
// Shared engine for providers that speak the OpenAI chat-completions wire
// format (POST {baseUrl}/chat/completions, /embeddings, Bearer auth).
//
// Two providers sit on it, differing only in their `OpenAiChatDialect`:
//   - OpenrouterAiService      (openrouter-ai.ts) — OpenRouter, with its
//     vendor extras: billed cost in `usage`, `reasoning`, `X-Title`, and
//     `vendor/model` id mapping.
//   - OpenAiCompatibleAiService (openai-compatible-ai.ts) — any other
//     OpenAI-protocol server at a configured base URL (vLLM, LiteLLM, Ollama,
//     an institutional gateway). Plain protocol only, no vendor extras.
//
// Plain `fetch`, no SDK: the wire format is small and stable.
//
// Not supported on either:
//   - uploadFile / ExtractionRequest.fileAttachment — those are Gemini File
//     API URIs. A request carrying one is refused loudly rather than silently
//     dropping the document from the prompt.
//   - embed(), unless an embedding model is configured explicitly. Stored
//     vectors come from Google's embedding model; mixing another model's
//     vectors into the same columns would make similarity search quietly
//     wrong. The factory routes embed() to Google when a Google key exists.
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;

/** What differs between OpenAI-protocol servers. */
export interface OpenAiChatDialect {
  /** Class name used in error messages (`<className>.embed: …`). */
  className: string;
  /** Human label used in HTTP error messages (`<label> HTTP 429: …`). The
   *  status code must follow it so the transient-fallback regex sees it. */
  label: string;
  /** Map the id the rest of the system hands us to the server's id. */
  mapModel(id: string): string;
  /** Used when neither the request nor the config names a model. */
  fallbackModel?: string;
  /** Extra body fields on every chat call. */
  chatExtras?: Record<string, unknown>;
  /** Extra body fields on extractStructured calls. */
  extractionExtras?(thinking: boolean): Record<string, unknown>;
  /** Send `response_format: {type:'json_object'}` on extractStructured. */
  jsonMode: boolean;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Env var named in the "no embedding model" error. */
  embeddingModelEnv: string;
  /** Whether to honour the admin per-method model overrides. */
  useModelOverrides: boolean;
}

export interface OpenAiChatConfig {
  /** Bearer token. Empty/undefined sends no Authorization header (local
   *  servers such as Ollama need none). */
  apiKey?: string;
  recorder: AiInferenceRecorder;
  baseUrl: string;
  /** Baseline completion model. */
  defaultModel?: string;
  /** Embedding model. When unset, embed() refuses — see the header comment
   *  for why that is the safe default. */
  embeddingModel?: string;
  /** Runtime per-method-prefix model override (admin AI-settings page). */
  modelOverrideResolver?: ModelOverrideResolver;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

// ── Wire types (only the fields we read) ─────────────────────────────────

type OrContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OrToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type OrMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OrContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OrToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const UsageSchema = z
  .object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    cost: z.number().optional(),
  })
  .passthrough();

const ChatResponseSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable().optional(),
            message: z
              .object({
                content: z.string().nullable().optional(),
                tool_calls: z
                  .array(
                    z.object({
                      id: z.string(),
                      type: z.string().optional(),
                      function: z.object({ name: z.string(), arguments: z.string().optional() }),
                    }),
                  )
                  .nullable()
                  .optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: UsageSchema.optional(),
  })
  .passthrough();

const EmbeddingResponseSchema = z
  .object({
    model: z.string().optional(),
    data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().optional() })),
    usage: UsageSchema.optional(),
  })
  .passthrough();

type ChatResponse = z.infer<typeof ChatResponseSchema>;

export abstract class OpenAiChatAiService implements AiService {
  abstract readonly providerId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: OpenAiChatConfig,
    private readonly dialect: OpenAiChatDialect,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  // ── complete ────────────────────────────────────────────────────────────

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = this.pickModel(req.model);
    const started = Date.now();
    const result = await this.chat({
      model,
      messages: toOrMessages(req.messages),
      max_tokens: req.maxOutputTokens ?? 4096,
      temperature: req.temperature ?? 0,
    });
    const latencyMs = Date.now() - started;
    const text = result.choices[0]?.message.content ?? '';
    const { tokens, cost, servedModel } = usageOf(result, model);

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind,
      prompt: messagesToString(req.messages),
      model: servedModel,
      response: text,
      tokensInput: tokens.input,
      tokensOutput: tokens.output,
      latencyMs,
      costEstimateUsd: cost.usd,
    });
    return { text, tokens, model: servedModel, latencyMs, cost, aiInferenceId };
  }

  // ── extractStructured ──────────────────────────────────────────────────

  async extractStructured<T>(
    req: ExtractionRequest,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<ExtractionResponse<T>> {
    if (req.fileAttachment) {
      throw new Error(
        `${this.dialect.className}.extractStructured: fileAttachment is a Gemini File API URI and ` +
          `cannot be sent through ${this.dialect.label}. Pass the document text in the messages instead.`,
      );
    }
    // Resolution chain: explicit req.model → admin override → provider default.
    const override =
      req.methodVersion && this.dialect.useModelOverrides
        ? this.config.modelOverrideResolver?.resolve(req.methodVersion)
      : undefined;
    const model = this.pickModel(req.model ?? override);
    const started = Date.now();

    const messages = toOrMessages(req.messages);
    const guard =
      'You MUST respond with a single JSON object matching the requested schema. ' +
      'No prose before or after. No markdown fences.';
    const sysIdx = messages.findIndex((m) => m.role === 'system');
    if (sysIdx >= 0) {
      const sys = messages[sysIdx] as { role: 'system'; content: string };
      messages[sysIdx] = { role: 'system', content: `${sys.content}\n\n${guard}` };
    } else {
      messages.unshift({ role: 'system', content: guard });
    }

    const result = await this.chat({
      model,
      messages,
      max_tokens: req.maxOutputTokens ?? 4096,
      temperature: 0,
      ...(this.dialect.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(this.dialect.extractionExtras?.(req.thinking ?? false) ?? {}),
    });
    const latencyMs = Date.now() - started;
    const rawText = result.choices[0]?.message.content ?? '';
    const { tokens, cost, servedModel } = usageOf(result, model);

    // Record on BOTH paths — a failed parse is the row we most need to read.
    let parsedResult: { parsed: T; confidence: number; reasoning?: string };
    try {
      parsedResult = parseStructured<T>(rawText, schema);
    } catch (err) {
      await this.config.recorder.record({
        userId: req.ctx.userId ?? null,
        module: req.ctx.module,
        kind: req.ctx.kind ?? 'extract',
        prompt: messagesToString(req.messages),
        promptVersion: req.methodVersion,
        model: servedModel,
        response: rawText,
        confidence: 0,
        tokensInput: tokens.input,
        tokensOutput: tokens.output,
        latencyMs,
        costEstimateUsd: cost.usd,
      });
      throw err;
    }

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'extract',
      prompt: messagesToString(req.messages),
      promptVersion: req.methodVersion,
      model: servedModel,
      response: rawText,
      confidence: parsedResult.confidence,
      tokensInput: tokens.input,
      tokensOutput: tokens.output,
      latencyMs,
      costEstimateUsd: cost.usd,
    });

    return {
      ...parsedResult,
      rawText,
      tokens,
      model: servedModel,
      latencyMs,
      cost,
      aiInferenceId,
    };
  }

  // ── embed ──────────────────────────────────────────────────────────────

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = this.config.embeddingModel;
    if (!model) {
      throw new Error(
        `${this.dialect.className}.embed: no embedding model configured. Stored vectors come from ` +
          "Google's embedding model; set GOOGLE_AI_API_KEY so the factory routes embed() there, " +
          `or set ${this.dialect.embeddingModelEnv} deliberately (and re-embed everything).`,
      );
    }
    const started = Date.now();
    const body: Record<string, unknown> = { model: this.dialect.mapModel(model), input: req.texts };
    if (req.dimensions) body.dimensions = req.dimensions;
    const json = await this.post('/embeddings', body);
    const parsed = EmbeddingResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `${this.dialect.className}.embed: unexpected response shape (${JSON.stringify(parsed.error.issues.slice(0, 3))})`,
      );
    }
    const latencyMs = Date.now() - started;
    const vectors = [...parsed.data.data]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding);
    const servedModel = parsed.data.model ?? this.dialect.mapModel(model);
    const tokens = { input: parsed.data.usage?.prompt_tokens ?? 0, output: 0 };
    const cost = { usd: parsed.data.usage?.cost ?? 0, model: servedModel };

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'embedding',
      prompt: `[${req.texts.length} text(s) for embedding]`,
      model: servedModel,
      response: `[${vectors.length} vector(s), dim=${vectors[0]?.length ?? 0}]`,
      tokensInput: tokens.input,
      tokensOutput: 0,
      latencyMs,
      costEstimateUsd: cost.usd,
    });
    return { vectors, model: servedModel, tokens, latencyMs, cost, aiInferenceId };
  }

  // ── translate ──────────────────────────────────────────────────────────

  async translate(req: TranslateRequest): Promise<TranslateResponse> {
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

  // ── vision ─────────────────────────────────────────────────────────────

  async vision(req: VisionRequest): Promise<VisionResponse> {
    const model = this.pickModel(req.model);
    const started = Date.now();
    const scrubbed = scrubMessages(req.messages).messages;
    const system = scrubbed.find((m) => m.role === 'system')?.content;
    const userText = scrubbed
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n\n');
    const parts: OrContentPart[] = req.images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    }));
    parts.push({ type: 'text', text: userText });
    const messages: OrMessage[] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: parts });

    const result = await this.chat({
      model,
      messages,
      max_tokens: req.maxOutputTokens ?? 4096,
    });
    const latencyMs = Date.now() - started;
    const text = result.choices[0]?.message.content ?? '';
    const { tokens, cost, servedModel } = usageOf(result, model);

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'vision',
      prompt: messagesToString(req.messages) + `\n[+${req.images.length} image(s)]`,
      model: servedModel,
      response: text,
      tokensInput: tokens.input,
      tokensOutput: tokens.output,
      latencyMs,
      costEstimateUsd: cost.usd,
    });
    return { text, tokens, model: servedModel, latencyMs, cost, aiInferenceId };
  }

  // ── Tool-use agent loop (OpenAI function-calling wire format) ───────────

  async completeWithTools(
    req: ToolUseRequest,
    executeTool: (call: ToolCall) => Promise<string>,
  ): Promise<ToolUseResponse> {
    const model = this.pickModel(req.model);
    const maxIterations = Math.max(1, Math.min(req.maxIterations ?? 8, 16));
    const started = Date.now();

    const conversation: ToolUseMessage[] = req.messages.filter((m) => m.role !== 'system');
    const systemMsg = req.messages.find((m) => m.role === 'system');
    const system = systemMsg && systemMsg.role === 'system' ? systemMsg.content : undefined;
    const tools = req.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    const aiInferenceIds: string[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCostUsd = 0;
    let servedModel = model;
    let iterations = 0;
    let stopReason: ToolUseResponse['stopReason'] = 'max_iterations';
    let finalText = '';
    let pendingToolCalls: ToolCall[] = [];

    while (iterations < maxIterations) {
      iterations++;
      const iterationStarted = Date.now();
      const result = await this.chat({
        model,
        messages: toolUseToOrMessages(system, conversation),
        tools,
        max_tokens: req.maxOutputTokens ?? 4096,
        temperature: req.temperature ?? 0.3,
      });
      const iterationLatency = Date.now() - iterationStarted;
      const usage = usageOf(result, model);
      servedModel = usage.servedModel;
      totalInput += usage.tokens.input;
      totalOutput += usage.tokens.output;
      totalCostUsd += usage.cost.usd;

      const choice = result.choices[0];
      const text = choice?.message.content ?? '';
      const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: parseToolArguments(tc.function.arguments),
      }));

      conversation.push({
        role: 'assistant',
        content: [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...toolCalls.map((c) => ({
            type: 'tool_use' as const,
            id: c.id,
            name: c.name,
            input: c.input,
          })),
        ],
      });

      const { id: aiInferenceId } = await this.config.recorder.record({
        userId: req.ctx.userId ?? null,
        module: req.ctx.module,
        kind: req.ctx.kind ?? 'tool-use',
        prompt: toolUseMessagesToString(conversation.slice(0, -1)),
        model: servedModel,
        response:
          text + (toolCalls.length > 0 ? '\n' + toolCalls.map((c) => `[tool ${c.name}]`).join('\n') : ''),
        tokensInput: usage.tokens.input,
        tokensOutput: usage.tokens.output,
        latencyMs: iterationLatency,
        costEstimateUsd: usage.cost.usd,
        sourcesJson: { toolCalls },
      });
      aiInferenceIds.push(aiInferenceId);

      if (toolCalls.length === 0) {
        finalText = text.trim();
        stopReason = choice?.finish_reason === 'content_filter' ? 'refusal' : 'end_turn';
        break;
      }

      if (iterations === maxIterations) {
        pendingToolCalls = toolCalls;
        break;
      }

      const results = await Promise.all(
        toolCalls.map(async (call) => {
          try {
            return { toolCallId: call.id, content: await executeTool(call), isError: false };
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

    return {
      trace: conversation,
      finalText,
      pendingToolCalls,
      iterations,
      tokens: { input: totalInput, output: totalOutput },
      model: servedModel,
      latencyMs: Date.now() - started,
      cost: { usd: totalCostUsd, model: servedModel },
      aiInferenceIds,
      stopReason,
    };
  }

  // ── transport ──────────────────────────────────────────────────────────

  private pickModel(requested: string | undefined): string {
    const id = requested ?? this.config.defaultModel ?? this.dialect.fallbackModel;
    if (!id) {
      throw new Error(`${this.dialect.className}: no completion model configured.`);
    }
    return this.dialect.mapModel(id);
  }

  private async chat(body: Record<string, unknown>): Promise<ChatResponse> {
    const json = await this.post('/chat/completions', { ...body, ...this.dialect.chatExtras });
    const parsed = ChatResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `${this.dialect.className}: unexpected chat response shape (${JSON.stringify(parsed.error.issues.slice(0, 3))})`,
      );
    }
    return parsed.data;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        'Content-Type': 'application/json',
        ...this.dialect.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      // Status code first so wrapWithTransientFallback's /\b(429|5\d\d)\b/
      // classifies it; the body carries the server's reason (and is what
      // isModelInvalidError matches for an unknown model id).
      throw new Error(`${this.dialect.label} HTTP ${res.status}: ${text.slice(0, 1000)}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${this.dialect.label} returned non-JSON body: ${text.slice(0, 200)}`);
    }
    // OpenRouter (and some gateways) return 200 with an `error` object when
    // the upstream provider fails mid-request.
    const err = (json as { error?: { message?: string; code?: number | string } }).error;
    if (err) {
      throw new Error(`${this.dialect.label} upstream error ${err.code ?? ''}: ${err.message ?? JSON.stringify(err)}`);
    }
    return json;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function usageOf(
  result: ChatResponse,
  requestedModel: string,
): { tokens: AiTokenUsage; cost: { usd: number; model: string }; servedModel: string } {
  // The model the server actually ran — differs from the request when a
  // gateway-side route or fallback kicks in. The audit row names it.
  // `usage.cost` is OpenRouter's billed figure; servers that don't report it
  // record 0 (token counts are still recorded).
  const servedModel = result.model ?? requestedModel;
  return {
    tokens: {
      input: result.usage?.prompt_tokens ?? 0,
      output: result.usage?.completion_tokens ?? 0,
    },
    cost: { usd: result.usage?.cost ?? 0, model: servedModel },
    servedModel,
  };
}

// Scrub-aware conversion — the PII scrubber runs centrally here, as in the
// Google and Anthropic providers. System messages pass through untouched.
function toOrMessages(messages: CompletionRequest['messages']): OrMessage[] {
  return scrubMessages(messages).messages.map((m) =>
    m.role === 'system'
      ? { role: 'system', content: m.content }
      : m.role === 'assistant'
        ? { role: 'assistant', content: m.content }
        : { role: 'user', content: m.content },
  );
}

function toolUseToOrMessages(system: string | undefined, msgs: ToolUseMessage[]): OrMessage[] {
  const out: OrMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      const scrubbed = scrubMessages([{ role: 'user', content: m.content }]).messages[0];
      out.push({ role: 'user', content: scrubbed?.content ?? m.content });
    } else if (m.role === 'assistant') {
      const text = m.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      const toolCalls: OrToolCall[] = m.content
        .filter(
          (c): c is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
            c.type === 'tool_use',
        )
        .map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        }));
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
      }
    }
  }
  return out;
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toolUseMessagesToString(msgs: ToolUseMessage[]): string {
  return msgs
    .map((m) => {
      if (m.role === 'user') return `[user]\n${m.content}`;
      if (m.role === 'system') return `[system]\n${m.content}`;
      if (m.role === 'assistant') {
        const text = m.content
          .map((c) => (c.type === 'text' ? c.text : `[tool ${c.name}(${JSON.stringify(c.input)})]`))
          .join('\n');
        return `[assistant]\n${text}`;
      }
      return `[tool-results]\n${m.results.map((r) => `#${r.toolCallId}: ${r.content.slice(0, 120)}`).join('\n')}`;
    })
    .join('\n\n');
}

function messagesToString(messages: CompletionRequest['messages']): string {
  // Audit log gets the SCRUBBED text — keep PII out of our DB too.
  return scrubMessages(messages)
    .messages.map((m) => `[${m.role}]\n${m.content}`)
    .join('\n\n');
}

// Same tolerant parser as the other providers: fences, leading prose, and
// trailing surplus braces are all seen in practice across vendors.
function parseStructured<T>(
  rawText: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): { parsed: T; confidence: number; reasoning?: string } {
  const tryParse = (s: string) => {
    try {
      return schema.safeParse(JSON.parse(s));
    } catch {
      return null;
    }
  };

  let result = tryParse(rawText);
  let usedFixup = false;
  if (!result || !result.success) {
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    const firstBrace = stripped.search(/[{[]/);
    if (firstBrace >= 0) {
      const candidate = stripped.slice(firstBrace);
      result = tryParse(candidate);
      usedFixup = true;
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
      `OpenAI-protocol extractStructured: response failed schema validation (issues=${
        result?.success === false ? JSON.stringify(result.error.issues.slice(0, 3)) : 'no json found'
      })`,
    );
  }

  const parsed = result.data as T;
  let confidence = usedFixup ? 0.8 : 1;
  const withConf = parsed as unknown as { confidence?: unknown };
  if (typeof withConf.confidence === 'number') {
    confidence = Math.max(0, Math.min(1, withConf.confidence));
  }
  return { parsed, confidence, reasoning: undefined };
}
