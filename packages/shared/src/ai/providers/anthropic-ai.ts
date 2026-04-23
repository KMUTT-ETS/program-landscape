import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
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
    const model = req.model ?? this.config.defaultModel ?? DEFAULT_MODEL;
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
}

function splitSystem(messages: CompletionRequest['messages']): {
  system: string | undefined;
  userMessages: CompletionRequest['messages'];
} {
  return {
    system: messages.find((m) => m.role === 'system')?.content,
    userMessages: messages.filter((m) => m.role !== 'system'),
  };
}

function messagesToString(messages: CompletionRequest['messages']): string {
  return messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
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
