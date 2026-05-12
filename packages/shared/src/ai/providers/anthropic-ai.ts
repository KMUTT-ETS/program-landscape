import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { scrubMessages } from '../scrub-messages';
import type {
  AiInferenceRecorder,
  AiService,
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

// Anthropic/Claude provider. Second in priority after Google — used
// when a module wants Claude-specific behaviour (longer context, better
// reasoning on complex policy docs, or when the KKU multi-AI gateway
// routes a specific module there).
//
// Claude does NOT offer an embeddings API. This provider throws for
// embed() — the factory is expected to route embedding calls to a
// provider that does (Google is the default for embedding regardless
// of which provider handles completions).

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Per-1k-token pricing, USD. Update when Anthropic publishes new rates.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':       { input: 0.003,  output: 0.015 },
  'claude-haiku-4-5':        { input: 0.001,  output: 0.005 },
  'claude-opus-4-7':         { input: 0.015,  output: 0.075 },
};

export interface AnthropicAiConfig {
  apiKey: string;
  recorder: AiInferenceRecorder;
  defaultModel?: string;
  /** Runtime per-method-prefix model override (admin AI-settings page,
   *  Phase 3). Consulted before the provider's default model.
   *  Anthropic has no static MODEL_BY_METHOD_PREFIX table (every call
   *  uses `defaultModel`), so the resolver is the only source of
   *  per-task differentiation. */
  modelOverrideResolver?: ModelOverrideResolver;
}

export class AnthropicAiService implements AiService {
  readonly providerId = 'anthropic';
  private readonly client: Anthropic;

  constructor(private readonly config: AnthropicAiConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = req.model ?? this.config.defaultModel ?? DEFAULT_MODEL;
    const started = Date.now();
    const { system, userMessages } = splitSystem(req.messages);

    const result = await this.client.messages.create({
      model,
      system,
      max_tokens: req.maxOutputTokens ?? 4096,
      temperature: req.temperature ?? 0,
      messages: userMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    });
    const latencyMs = Date.now() - started;

    const text = result.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    const tokens = {
      input: result.usage.input_tokens,
      output: result.usage.output_tokens,
    };
    const cost = estimateCost(model, tokens);

    const { id: aiInferenceId } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind,
      prompt: messagesToString(req.messages),
      model,
      response: text,
      tokensInput: tokens.input,
      tokensOutput: tokens.output,
      latencyMs,
      costEstimateUsd: cost.usd,
    });

    return { text, tokens, model, latencyMs, cost, aiInferenceId };
  }

  async extractStructured<T>(
    req: ExtractionRequest,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<ExtractionResponse<T>> {
    // Claude doesn't have a strict JSON mode like Gemini; we prompt for
    // JSON explicitly in the system message. The caller's prompt
    // template should ALSO spell "return only JSON" — belt + braces.
    //
    // Resolution chain: explicit req.model → admin-set override (Phase
    // 3 AI-settings page) → provider default. Unlike Google, Anthropic
    // has no static MODEL_BY_METHOD_PREFIX table.
    const override = req.methodVersion
      ? this.config.modelOverrideResolver?.resolve(req.methodVersion)
      : undefined;
    const model = req.model ?? override ?? this.config.defaultModel ?? DEFAULT_MODEL;
    const started = Date.now();
    const { system, userMessages } = splitSystem(req.messages);
    const systemWithJsonGuard =
      (system ?? '') +
      '\n\nYou MUST respond with a single JSON object matching the requested schema. No prose before or after. No markdown fences.';

    const result = await this.client.messages.create({
      model,
      system: systemWithJsonGuard,
      max_tokens: req.maxOutputTokens ?? 4096,
      temperature: 0,
      messages: userMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    });
    const latencyMs = Date.now() - started;

    const rawText = result.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    const tokens = {
      input: result.usage.input_tokens,
      output: result.usage.output_tokens,
    };
    const cost = estimateCost(model, tokens);

    const { parsed, confidence, reasoning } = parseStructured<T>(rawText, schema);

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

    return { parsed, confidence, reasoning, rawText, tokens, model, latencyMs, cost, aiInferenceId };
  }

  embed(_req: EmbeddingRequest): Promise<EmbeddingResponse> {
    return Promise.reject(
      new Error(
        "AnthropicAiService.embed: Claude has no embeddings API. Route embedding requests to the Google provider (see ai/factory.ts)."
      ),
    );
  }

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

  async vision(req: VisionRequest): Promise<VisionResponse> {
    const model = req.model ?? this.config.defaultModel ?? DEFAULT_MODEL;
    const started = Date.now();
    const { system, userMessages } = splitSystem(req.messages);

    const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
    for (const img of req.images) {
      contentBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
      });
    }
    const userText = userMessages.map((m) => m.content).join('\n\n');
    contentBlocks.push({ type: 'text', text: userText });

    const result = await this.client.messages.create({
      model,
      system,
      max_tokens: req.maxOutputTokens ?? 4096,
      messages: [{ role: 'user', content: contentBlocks }],
    });
    const latencyMs = Date.now() - started;

    const text = result.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    const tokens = {
      input: result.usage.input_tokens,
      output: result.usage.output_tokens,
    };
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

  // ── Tool-use agent loop (prompt 11) ────────────────────────────────────
  async completeWithTools(
    req: ToolUseRequest,
    executeTool: (call: ToolCall) => Promise<string>,
  ): Promise<ToolUseResponse> {
    const model = req.model ?? this.config.defaultModel ?? DEFAULT_MODEL;
    const maxIterations = Math.max(1, Math.min(req.maxIterations ?? 8, 16));
    const started = Date.now();

    // Split system out; rebuild per-iteration conversation from incoming
    // trace + new assistant / tool-result turns.
    const { system, workingMessages } = splitSystemToolUse(req.messages);
    const conversation: ToolUseMessage[] = [...workingMessages];
    const aiInferenceIds: string[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCostUsd = 0;
    let iterations = 0;
    let stopReason: ToolUseResponse['stopReason'] = 'end_turn';
    let finalText = '';
    let pendingToolCalls: ToolCall[] = [];

    for (iterations = 0; iterations < maxIterations; iterations++) {
      const anthropicMessages = toAnthropicMessages(conversation);
      const iterationStarted = Date.now();
      const result = await this.client.messages.create({
        model,
        system,
        max_tokens: req.maxOutputTokens ?? 4096,
        temperature: req.temperature ?? 0.3,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as { type: 'object'; properties: Record<string, unknown> },
        })),
        messages: anthropicMessages,
      });
      const iterationLatency = Date.now() - iterationStarted;

      totalInput += result.usage.input_tokens;
      totalOutput += result.usage.output_tokens;
      const iterCost = estimateCost(model, {
        input: result.usage.input_tokens,
        output: result.usage.output_tokens,
      });
      totalCostUsd += iterCost.usd;

      // Separate text + tool_use blocks.
      const textBlocks: string[] = [];
      const toolCalls: ToolCall[] = [];
      for (const block of result.content) {
        if (block.type === 'text') textBlocks.push(block.text);
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      const assistantTurn: ToolUseMessage = {
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
        response: textBlocks.join('\n') + (toolCalls.length > 0 ? '\n' + toolCalls.map((c) => `[tool ${c.name}]`).join('\n') : ''),
        tokensInput: result.usage.input_tokens,
        tokensOutput: result.usage.output_tokens,
        latencyMs: iterationLatency,
        costEstimateUsd: iterCost.usd,
        sourcesJson: { toolCalls },
      });
      aiInferenceIds.push(aiInferenceId);

      if (result.stop_reason !== 'tool_use' || toolCalls.length === 0) {
        finalText = textBlocks.join('\n').trim();
        pendingToolCalls = [];
        stopReason = 'end_turn';
        break;
      }

      // Execute each tool; feed results back.
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
      pendingToolCalls = (conversation[conversation.length - 1] as { content?: unknown })?.content &&
        Array.isArray((conversation[conversation.length - 1] as { content: unknown[] }).content)
        ? (
            (conversation[conversation.length - 1] as { content: unknown[] }).content.filter(
              (b) => (b as { type?: string }).type === 'tool_use',
            ) as Array<{ id: string; name: string; input: Record<string, unknown> }>
          ).map((b) => ({ id: b.id, name: b.name, input: b.input }))
        : [];
    }

    const latencyMs = Date.now() - started;
    return {
      trace: conversation,
      finalText,
      pendingToolCalls,
      iterations: iterations + (stopReason === 'max_iterations' ? 0 : 1),
      tokens: { input: totalInput, output: totalOutput },
      model,
      latencyMs,
      cost: { usd: totalCostUsd, model },
      aiInferenceIds,
      stopReason,
    };
  }
}

function splitSystemToolUse(messages: ToolUseMessage[]): {
  system: string | undefined;
  workingMessages: ToolUseMessage[];
} {
  const sys = messages.find((m) => m.role === 'system');
  return {
    system: sys && sys.role === 'system' ? sys.content : undefined,
    workingMessages: messages.filter((m) => m.role !== 'system'),
  };
}

type AnthropicMessageParam = {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      >;
};

function toAnthropicMessages(msgs: ToolUseMessage[]): AnthropicMessageParam[] {
  const out: AnthropicMessageParam[] = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content });
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.toolCallId,
          content: r.content,
          is_error: r.isError,
        })),
      });
    }
  }
  return out;
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

// Scrub-aware split. Mirrors GoogleAiService — every caller goes
// through here, so the PII scrubber lands centrally and no caller
// can forget to scrub. System messages are server-controlled and
// pass through untouched.
function splitSystem(messages: CompletionRequest['messages']): {
  system: string | undefined;
  userMessages: CompletionRequest['messages'];
} {
  const scrubbed = scrubMessages(messages).messages;
  return {
    system: scrubbed.find((m) => m.role === 'system')?.content,
    userMessages: scrubbed.filter((m) => m.role !== 'system'),
  };
}

function messagesToString(messages: CompletionRequest['messages']): string {
  // Audit log gets the SCRUBBED text — keep PII out of our DB too.
  const scrubbed = scrubMessages(messages).messages;
  return scrubbed.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
}

function estimateCost(model: string, tokens: { input: number; output: number }) {
  const price = PRICING[model];
  if (!price) return { usd: 0, model };
  return {
    usd: (tokens.input / 1000) * price.input + (tokens.output / 1000) * price.output,
    model,
  };
}

// Same heuristic parser as GoogleAiService. Kept here rather than shared
// because each provider has its own fixup quirks (Claude occasionally
// adds a "Here is the JSON:" preamble even with the guard).
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
      result = tryParse(stripped.slice(firstBrace));
      usedFixup = true;
    }
  }
  if (!result || !result.success) {
    throw new Error(
      `AnthropicAiService.extractStructured: response failed schema validation (issues=${
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
