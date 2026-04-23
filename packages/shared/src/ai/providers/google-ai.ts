import { GoogleGenAI } from '@google/genai';
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

// Google/Gemini provider. Default because:
//   - Thai handling is strong on Gemini's top-tier models (1.5 Pro, 2.0
//     Flash); Claude is equally strong but the Anthropic API's Thai
//     responses occasionally drop tone marks under high-temp settings
//   - flash-lite tier is cost-effective for extractor pipelines
//   - embedding model (text-embedding-004) is multilingual
//
// Model choice per call:
//   extractStructured → 'gemini-2.0-flash-001' (reliable structured output)
//   complete/analysis  → 'gemini-2.0-flash-001' (or override per call)
//   vision             → 'gemini-2.0-flash-001'
//   embed              → 'text-embedding-004' (1536 dims — matches pgvector)

const DEFAULT_COMPLETION_MODEL = 'gemini-2.0-flash-001';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';

// Per-1k-token prices in USD. Approximate + conservative — used for cost
// audit only, not billing. Update when Google bumps pricing.
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.0-flash-001': { input: 0.000075, output: 0.0003 },
  'gemini-1.5-pro-002':   { input: 0.00125,  output: 0.005 },
  'gemini-1.5-flash-002': { input: 0.000075, output: 0.0003 },
  'text-embedding-004':   { input: 0.00001,  output: 0 },
};

export interface GoogleAiConfig {
  apiKey: string;
  recorder: AiInferenceRecorder;
  // Optional model overrides per call type.
  defaultCompletionModel?: string;
  defaultEmbeddingModel?: string;
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
    const { system, userText } = splitSystemFromMessages(req.messages);

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
    const model = req.model ?? this.config.defaultCompletionModel ?? DEFAULT_COMPLETION_MODEL;
    const started = Date.now();
    const { system, userText } = splitSystemFromMessages(req.messages);

    // Ask for JSON directly. Gemini honours responseMimeType when set.
    const result = await this.client.models.generateContent({
      model,
      contents: userText,
      config: {
        systemInstruction: system,
        temperature: 0,
        maxOutputTokens: req.maxOutputTokens ?? 4096,
        responseMimeType: 'application/json',
      },
    });
    const latencyMs = Date.now() - started;

    const rawText = result.text ?? '';
    const tokens = extractUsage(result.usageMetadata);
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
}

function splitSystemFromMessages(messages: CompletionRequest['messages']): {
  system: string | undefined;
  userText: string;
} {
  const system = messages.find((m) => m.role === 'system')?.content;
  const userText = messages
    .filter((m) => m.role !== 'system')
    .map((m) => m.content)
    .join('\n\n');
  return { system, userText };
}

function messagesToString(messages: CompletionRequest['messages']): string {
  return messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
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
    // Strip markdown fences
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    // Find first '{' or '['
    const firstBrace = stripped.search(/[{[]/);
    if (firstBrace >= 0) {
      const candidate = stripped.slice(firstBrace);
      result = tryParse(candidate);
      usedFixup = true;
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
