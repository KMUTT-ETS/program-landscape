import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma, PrismaAiInferenceRecorder } from '@kku/db';
import {
  ANALYST_SYSTEM_PROMPT,
  ANALYST_SYSTEM_PROMPT_VERSION,
  ANALYST_TOOL_DEFINITIONS,
  checkAnalystSafety,
  createAiService,
  detectLanguage,
  ToolUseNotSupportedError,
  wrapUserContent,
  type AiProviderId,
  type AiService,
  type ToolCall,
  type ToolUseMessage,
  type ToolUseRequest,
} from '@kku/shared';
import { AnalystToolExecutor } from './tool-executor.service';

// ═════════════════════════════════════════════════════════════════════
// Analyst service — orchestrates one chat turn.
//
// Flow:
//   1. Safety gate (heuristic — rule-based refusal patterns).
//   2. Build ToolUseRequest with bilingual-aware system prompt.
//   3. Run AiService.completeWithTools() — the tool executor runs
//      inside the loop.
//   4. Persist one AnalystMessage (assistant turn) with the full trace
//      + aiInferenceIds.
// ═════════════════════════════════════════════════════════════════════

export interface ChatTurnResult {
  conversationId: string;
  messageId: string;
  text: string;
  refused: boolean;
  refusalCategories: string[];
  evidence: {
    toolCalls: Array<{ name: string; input: Record<string, unknown>; result?: string }>;
    aiInferenceIds: string[];
    iterations: number;
    stopReason: string;
  };
  model: string;
  tokens: { input: number; output: number };
  costUsd: number;
  latencyMs: number;
  methodologyVersion: typeof ANALYST_SYSTEM_PROMPT_VERSION;
}

@Injectable()
export class AnalystService implements OnModuleInit {
  private readonly logger = new Logger(AnalystService.name);
  private ai!: AiService;

  constructor(
    private readonly config: ConfigService,
    private readonly toolExecutor: AnalystToolExecutor,
  ) {}

  onModuleInit(): void {
    const recorder = new PrismaAiInferenceRecorder();
    // Analyst follows the global AI_PROVIDER setting. Both Anthropic and
    // Google now support `completeWithTools`: Google via Gemini Flash
    // function calling (cheap + fast), Anthropic via the native tool_use
    // protocol. OpenRouter / IntelSphere still throw ToolUseNotSupportedError.
    const providerId = (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId;
    const intelSphereUrl = this.config.get<string>('KKU_INTELSPHERE_URL');
    const intelSphereKey = this.config.get<string>('KKU_INTELSPHERE_API_KEY');
    this.ai = createAiService({
      recorder,
      providerId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
        intelSphere:
          intelSphereUrl && intelSphereKey
            ? { url: intelSphereUrl, apiKey: intelSphereKey }
            : undefined,
      },
    });
  }

  private hasAnthropicKey(): boolean {
    return Boolean(this.config.get<string>('ANTHROPIC_API_KEY'));
  }

  /** Either provider supports the agent loop now. Google via Gemini Flash
   *  function-calling, Anthropic via the native tool_use API. */
  private hasToolUseProvider(): boolean {
    return Boolean(
      this.config.get<string>('ANTHROPIC_API_KEY') || this.config.get<string>('GOOGLE_AI_API_KEY'),
    );
  }

  // ── Conversation CRUD ───────────────────────────────────────────────
  async listConversations(userId: string) {
    return prisma.analystConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        language: true,
        messageCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getConversation(conversationId: string, userId: string) {
    const c = await prisma.analystConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!c) throw new NotFoundException();
    if (c.userId !== userId) throw new ForbiddenException('Not your conversation');
    return c;
  }

  // ── Chat turn ──────────────────────────────────────────────────────
  async chat(params: {
    userId: string;
    conversationId?: string;
    userMessage: string;
  }): Promise<ChatTurnResult> {
    const trimmed = params.userMessage.trim();
    if (!trimmed) throw new Error('Empty message');

    // 0. Resolve the caller — needed by the tool executor to clamp
    // spatial tool inputs (prompt 10 server-side scope authz).
    const callerRow = await prisma.user.findUniqueOrThrow({
      where: { id: params.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        facultyId: true,
        departmentId: true,
        programId: true,
        themePreference: true,
      },
    });
    const caller = {
      userId: callerRow.id,
      email: callerRow.email,
      name: callerRow.name,
      role: callerRow.role,
      facultyId: callerRow.facultyId,
      departmentId: callerRow.departmentId,
      programId: callerRow.programId,
      themePreference: callerRow.themePreference,
    };

    // 1. Safety gate.
    const verdict = checkAnalystSafety(trimmed);

    // 2. Ensure conversation exists; create if first turn.
    const language = detectLanguage(trimmed);
    let conversationId = params.conversationId;
    if (!conversationId) {
      const created = await prisma.analystConversation.create({
        data: {
          userId: params.userId,
          title: truncate(trimmed, 80),
          language,
        },
      });
      conversationId = created.id;
    }

    // Persist the user turn regardless — we keep the full audit trail
    // whether or not we refuse or successfully answer.
    await prisma.analystMessage.create({
      data: {
        conversationId,
        role: 'USER',
        content: trimmed,
      },
    });

    // 3. Safety refusal short-circuit.
    if (verdict.refuse) {
      const refusalText =
        language === 'th'
          ? `ขออภัย — คำถามนี้อยู่นอกขอบเขตของระบบ: ${verdict.explanation}`
          : `Sorry — that question is out of scope for this system: ${verdict.explanation}`;
      const message = await prisma.analystMessage.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: refusalText,
          refused: true,
          evidenceJson: { refusalCategories: verdict.categories, safetyVersion: verdict.version },
        },
      });
      await prisma.analystConversation.update({
        where: { id: conversationId },
        data: { messageCount: { increment: 2 }, language },
      });
      return {
        conversationId,
        messageId: message.id,
        text: refusalText,
        refused: true,
        refusalCategories: verdict.categories,
        evidence: { toolCalls: [], aiInferenceIds: [], iterations: 0, stopReason: 'refusal' },
        model: 'none',
        tokens: { input: 0, output: 0 },
        costUsd: 0,
        latencyMs: 0,
        methodologyVersion: ANALYST_SYSTEM_PROMPT_VERSION,
      };
    }

    // 4. No tool-use-capable provider → friendly placeholder. Both
    //    Anthropic + Google now support the agent loop; we only refuse
    //    when neither key is set.
    if (!this.hasToolUseProvider()) {
      const placeholderText =
        language === 'th'
          ? 'ไม่พบการตั้งค่า AI provider — โมดูล AI Analyst ต้องการ key ของ Google (GOOGLE_AI_API_KEY) หรือ Anthropic (ANTHROPIC_API_KEY) อย่างน้อยหนึ่งตัว'
          : 'No AI provider configured — the AI Analyst module needs either GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY.';
      const message = await prisma.analystMessage.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: placeholderText,
          evidenceJson: { reason: 'no-tool-use-provider' },
        },
      });
      await prisma.analystConversation.update({
        where: { id: conversationId },
        data: { messageCount: { increment: 2 }, language },
      });
      return {
        conversationId,
        messageId: message.id,
        text: placeholderText,
        refused: false,
        refusalCategories: [],
        evidence: { toolCalls: [], aiInferenceIds: [], iterations: 0, stopReason: 'error' },
        model: 'none',
        tokens: { input: 0, output: 0 },
        costUsd: 0,
        latencyMs: 0,
        methodologyVersion: ANALYST_SYSTEM_PROMPT_VERSION,
      };
    }

    // 5. Build conversation window (last N user+assistant messages).
    const history = await prisma.analystMessage.findMany({
      where: { conversationId, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    history.reverse();

    // Convert stored messages into ToolUseMessages. Strip stored tool
    // traces from the history — we keep only the user+assistant TEXT
    // turns, so the LLM re-asks for tool calls when it needs current
    // data. This avoids pushing stale tool results back in.
    // Wrap historical + current user content in a <USER_DOC> envelope.
    // The system prompt already instructs the model to treat content
    // inside the envelope as DATA, not instructions — closes the
    // prompt-injection vector where a user's own message tries to
    // override the system prompt.
    const messages: ToolUseMessage[] = [
      { role: 'system', content: ANALYST_SYSTEM_PROMPT },
      ...history
        .filter((m) => m.content && m.role !== 'ASSISTANT' || (m.role === 'ASSISTANT' && !m.refused))
        .slice(-10) // sliding window of 10 turns
        .map<ToolUseMessage>((m) =>
          m.role === 'USER'
            ? { role: 'user', content: wrapUserContent(m.content) }
            : { role: 'assistant', content: [{ type: 'text', text: m.content }] },
        ),
    ];
    // The current user turn was already persisted — but history was fetched
    // BEFORE its persistence if the above `find` raced; rather than rely
    // on ordering guarantees, append the turn explicitly so the agent
    // always sees it.
    const wrappedTrimmed = wrapUserContent(trimmed);
    if (messages[messages.length - 1]?.role !== 'user' || (messages[messages.length - 1] as { content?: string }).content !== wrappedTrimmed) {
      messages.push({ role: 'user', content: wrappedTrimmed });
    }

    // 6. Run the tool-use loop.
    //
    // Force model = `gemini-2.5-pro` (Anthropic provider ignores this
    // string). Reason: Gemini 3.x preview models mandate echoing a
    // `thoughtSignature` field that the @google/genai v0.3.1 SDK
    // doesn't expose on its Part type → multi-turn agent loops fail
    // with HTTP 400. The 2.5 family uses the same function-calling
    // protocol but doesn't require signatures, so the agent works
    // without an SDK upgrade. 2.5-pro (vs the previous 2.5-flash) is
    // part of the 2026-05-12 all-Pro posture — Pro reasoning helps
    // multi-tool plans land in fewer iterations. Anthropic users get
    // their default Sonnet/Haiku via the provider's own routing.
    const req: ToolUseRequest = {
      ctx: { module: 'analyst', kind: 'chat', userId: params.userId },
      messages,
      tools: ANALYST_TOOL_DEFINITIONS,
      maxIterations: 6,
      maxOutputTokens: 2500,
      temperature: 0.3,
      model: this.ai.providerId === 'google' ? 'gemini-2.5-pro' : undefined,
    };

    const toolCallsForEvidence: Array<{ name: string; input: Record<string, unknown>; result?: string }> = [];
    const executeTool = async (call: ToolCall): Promise<string> => {
      const result = await this.toolExecutor.execute(call, caller);
      toolCallsForEvidence.push({ name: call.name, input: call.input, result: result.slice(0, 2000) });
      return result;
    };

    try {
      if (!this.ai.completeWithTools) {
        throw new ToolUseNotSupportedError(this.ai.providerId);
      }
      const resp = await this.ai.completeWithTools(req, executeTool);

      // 7. Persist assistant turn with evidence.
      const message = await prisma.analystMessage.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: resp.finalText || '(no final text)',
          toolCallsJson: resp.trace as unknown as object,
          evidenceJson: {
            toolCalls: toolCallsForEvidence,
            iterations: resp.iterations,
            stopReason: resp.stopReason,
          } as object,
          aiInferenceIds: resp.aiInferenceIds,
          stopReason: resp.stopReason,
          tokensInput: resp.tokens.input,
          tokensOutput: resp.tokens.output,
          costEstimateUsd: resp.cost.usd,
          latencyMs: resp.latencyMs,
        },
      });
      await prisma.analystConversation.update({
        where: { id: conversationId },
        data: { messageCount: { increment: 2 }, language },
      });

      return {
        conversationId,
        messageId: message.id,
        text: resp.finalText,
        refused: false,
        refusalCategories: [],
        evidence: {
          toolCalls: toolCallsForEvidence,
          aiInferenceIds: resp.aiInferenceIds,
          iterations: resp.iterations,
          stopReason: resp.stopReason,
        },
        model: resp.model,
        tokens: resp.tokens,
        costUsd: resp.cost.usd,
        latencyMs: resp.latencyMs,
        methodologyVersion: ANALYST_SYSTEM_PROMPT_VERSION,
      };
    } catch (err) {
      const msg = err instanceof ToolUseNotSupportedError
        ? err.message
        : `Agent error: ${(err as Error).message}`;
      this.logger.error(msg);
      const message = await prisma.analystMessage.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: msg,
          refused: true,
          evidenceJson: { reason: 'agent-error' },
          stopReason: 'error',
        },
      });
      return {
        conversationId,
        messageId: message.id,
        text: msg,
        refused: true,
        refusalCategories: [],
        evidence: { toolCalls: toolCallsForEvidence, aiInferenceIds: [], iterations: 0, stopReason: 'error' },
        model: 'none',
        tokens: { input: 0, output: 0 },
        costUsd: 0,
        latencyMs: 0,
        methodologyVersion: ANALYST_SYSTEM_PROMPT_VERSION,
      };
    }
  }

  async recordFeedback(params: {
    messageId: string;
    userId: string;
    vote: 'up' | 'down';
    correction?: string;
  }) {
    const message = await prisma.analystMessage.findUnique({ where: { id: params.messageId } });
    if (!message) throw new NotFoundException();
    return prisma.analystFeedback.create({
      data: {
        messageId: params.messageId,
        userId: params.userId,
        vote: params.vote,
        correction: params.correction,
      },
    });
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
