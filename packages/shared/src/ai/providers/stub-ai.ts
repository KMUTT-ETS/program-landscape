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
  ToolCall,
  ToolUseRequest,
  ToolUseResponse,
  TranslateRequest,
  TranslateResponse,
  VisionRequest,
  VisionResponse,
} from '../types';

// ─────────────────────────────────────────────────────────────────────
// StubAiService — development fallback when no API key is configured.
//
// Activated via AI_PROVIDER=stub in .env. Every method returns a
// deterministic placeholder + still writes one AiInference row so the
// audit trail stays consistent. This lets `pnpm dev` boot without
// real credentials; Council-facing text gets "(stub provider: set
// AI_PROVIDER=google|anthropic + the matching key)" so the no-key
// state is visible, not silent.
// ─────────────────────────────────────────────────────────────────────

const STUB_NOTICE =
  '(stub AI provider — no model was called. Set AI_PROVIDER and the matching API key in .env for real generation.)';

export interface StubAiConfig {
  recorder: AiInferenceRecorder;
}

export class StubAiService implements AiService {
  readonly providerId = 'stub';

  constructor(private readonly config: StubAiConfig) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const text = `${STUB_NOTICE}\n\n[echo of user intent for visibility]\n${summariseMessages(req.messages)}`;
    const { id } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'complete',
      prompt: summariseMessages(req.messages),
      model: 'stub',
      response: text,
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 0,
      costEstimateUsd: 0,
    });
    return {
      text,
      tokens: { input: 0, output: 0 },
      model: 'stub',
      latencyMs: 0,
      cost: { usd: 0, model: 'stub' },
      aiInferenceId: id,
    };
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    // Zero vectors at the requested dimension. pgvector can store them,
    // they're just not useful for retrieval — hence the stub warning.
    const dim = req.dimensions ?? 1536;
    const vectors = req.texts.map(() => new Array(dim).fill(0) as number[]);
    const { id } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'embed',
      prompt: `(stub embed of ${req.texts.length} texts)`,
      model: 'stub',
      response: '(zero-vector placeholder)',
    });
    return {
      vectors,
      model: 'stub',
      tokens: { input: 0, output: 0 },
      latencyMs: 0,
      cost: { usd: 0, model: 'stub' },
      aiInferenceId: id,
    };
  }

  async extractStructured<T>(
    req: ExtractionRequest,
    _schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<ExtractionResponse<T>> {
    const { id } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'extract',
      prompt: summariseMessages(req.messages),
      model: 'stub',
      response: STUB_NOTICE,
    });
    // We can't fabricate a valid T, so throw — the caller should be
    // written to handle provider absence before calling.
    throw new Error(
      `StubAiService.extractStructured: refuses to fabricate structured output. Configure AI_PROVIDER + API key. (aiInferenceId=${id})`,
    );
  }

  async translate(req: TranslateRequest): Promise<TranslateResponse> {
    const { id } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'translate',
      prompt: req.text,
      model: 'stub',
      response: req.text, // pass through
    });
    return {
      text: req.text,
      cached: false,
      tokens: { input: 0, output: 0 },
      latencyMs: 0,
      cost: { usd: 0, model: 'stub' },
      aiInferenceId: id,
    };
  }

  async vision(req: VisionRequest): Promise<VisionResponse> {
    const { id } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'vision',
      prompt: `${summariseMessages(req.messages)} [+${req.images.length} image(s)]`,
      model: 'stub',
      response: STUB_NOTICE,
    });
    return {
      text: STUB_NOTICE,
      tokens: { input: 0, output: 0 },
      model: 'stub',
      latencyMs: 0,
      cost: { usd: 0, model: 'stub' },
      aiInferenceId: id,
    };
  }

  async completeWithTools(
    req: ToolUseRequest,
    _executeTool: (call: ToolCall) => Promise<string>,
  ): Promise<ToolUseResponse> {
    const { id } = await this.config.recorder.record({
      userId: req.ctx.userId ?? null,
      module: req.ctx.module,
      kind: req.ctx.kind ?? 'tool-use',
      prompt: '(stub tool-use request)',
      model: 'stub',
      response: STUB_NOTICE,
    });
    return {
      trace: req.messages,
      finalText: STUB_NOTICE,
      pendingToolCalls: [],
      iterations: 0,
      tokens: { input: 0, output: 0 },
      model: 'stub',
      latencyMs: 0,
      cost: { usd: 0, model: 'stub' },
      aiInferenceIds: [id],
      stopReason: 'end_turn',
    };
  }
}

function summariseMessages(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => `[${m.role}] ${m.content.slice(0, 160)}`).join('\n');
}
