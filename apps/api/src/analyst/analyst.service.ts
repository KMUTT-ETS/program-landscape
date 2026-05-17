import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  prisma,
  PrismaAiInferenceRecorder,
  getAiModelOverrideStore,
  type AnalystConversationKind,
} from '@kku/db';
import {
  ANALYST_DASHBOARD_SYSTEM_PROMPT,
  ANALYST_DASHBOARD_SYSTEM_PROMPT_VERSION,
  ANALYST_DASHBOARD_TOOL_DEFINITIONS,
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
  type AnalystStreamEvent,
  type ToolCall,
  type ToolDefinition,
  type ToolUseMessage,
  type ToolUseRequest,
} from '@kku/shared';
import { AnalystToolExecutor } from './tool-executor.service';
import { DashboardToolExecutor } from './dashboard-tool-executor.service';
import type { SessionUser } from '@kku/shared';

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
  /** Either the strategic prompt's version stamp or the dashboard
   *  prompt's, depending on the conversation's kind. */
  methodologyVersion: string;
}

// Per-kind config bundle: which system prompt, which tool catalog,
// which methodology version stamp the AnalystMessage row carries.
interface KindConfig {
  systemPrompt: string;
  systemPromptVersion: string;
  tools: ToolDefinition[];
  // 'strategic' → AnalystToolExecutor with scope clamping.
  // 'dashboard' → DashboardToolExecutor with caller passed straight through.
  executor: 'strategic' | 'dashboard';
}

@Injectable()
export class AnalystService implements OnModuleInit {
  private readonly logger = new Logger(AnalystService.name);
  private ai!: AiService;

  constructor(
    private readonly config: ConfigService,
    private readonly toolExecutor: AnalystToolExecutor,
    private readonly dashboardExecutor: DashboardToolExecutor,
  ) {}

  /** Resolve the system prompt + tool catalog + executor flavour for a
   *  conversation kind. Default STRATEGIC keeps the original /analyst
   *  surface intact for any caller that doesn't pass kind. */
  private kindConfig(kind: AnalystConversationKind | undefined): KindConfig {
    if (kind === 'DASHBOARD') {
      return {
        systemPrompt: ANALYST_DASHBOARD_SYSTEM_PROMPT,
        systemPromptVersion: ANALYST_DASHBOARD_SYSTEM_PROMPT_VERSION,
        tools: ANALYST_DASHBOARD_TOOL_DEFINITIONS,
        executor: 'dashboard',
      };
    }
    return {
      systemPrompt: ANALYST_SYSTEM_PROMPT,
      systemPromptVersion: ANALYST_SYSTEM_PROMPT_VERSION,
      tools: ANALYST_TOOL_DEFINITIONS,
      executor: 'strategic',
    };
  }

  /** Pick the right executor and dispatch a tool call. */
  private async dispatchTool(
    cfg: KindConfig,
    call: ToolCall,
    caller: SessionUser,
  ): Promise<string> {
    if (cfg.executor === 'dashboard') {
      return this.dashboardExecutor.execute(call, caller);
    }
    return this.toolExecutor.execute(call, caller);
  }

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
      modelOverrideResolver: getAiModelOverrideStore(),
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
  /** List a user's conversations, optionally filtered by kind.
   *  `kind` undefined returns the full history across both flavours
   *  (admin / audit use); pass STRATEGIC or DASHBOARD to scope. */
  async listConversations(userId: string, kind?: AnalystConversationKind) {
    return prisma.analystConversation.findMany({
      where: { userId, ...(kind ? { kind } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        kind: true,
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
    /** STRATEGIC = the Council /analyst (default). DASHBOARD = the
     *  Education/Staff dashboard chatbot. Ignored when continuing an
     *  existing conversation — the conversation's stored kind wins. */
    kind?: AnalystConversationKind;
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

    // 1. Resolve the conversation kind FIRST — the safety gate is
    // kind-aware (dashboard surface allows aggregate-only salary
    // questions because the compensation tool masks <5-person buckets
    // server-side). On continuation, the stored kind is authoritative.
    const language = detectLanguage(trimmed);
    let conversationId = params.conversationId;
    let kind: AnalystConversationKind = params.kind ?? 'STRATEGIC';
    if (!conversationId) {
      const created = await prisma.analystConversation.create({
        data: {
          userId: params.userId,
          kind,
          title: truncate(trimmed, 80),
          language,
        },
      });
      conversationId = created.id;
    } else {
      const existing = await prisma.analystConversation.findUnique({
        where: { id: conversationId },
        select: { kind: true, userId: true },
      });
      if (!existing) throw new NotFoundException();
      if (existing.userId !== params.userId)
        throw new ForbiddenException('Not your conversation');
      kind = existing.kind;
    }
    const cfg = this.kindConfig(kind);

    // 2. Safety gate — surface picks which salary/performance ruleset
    // applies. Strategic = strict; Dashboard = aggregate-friendly.
    const verdict = checkAnalystSafety(
      trimmed,
      kind === 'DASHBOARD' ? 'dashboard' : 'strategic',
    );

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
        methodologyVersion: cfg.systemPromptVersion,
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
        methodologyVersion: cfg.systemPromptVersion,
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
      { role: 'system', content: cfg.systemPrompt },
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
      ctx: { module: 'analyst', kind: kind === 'DASHBOARD' ? 'dashboard-chat' : 'chat', userId: params.userId },
      messages,
      tools: cfg.tools,
      maxIterations: 6,
      maxOutputTokens: 2500,
      temperature: 0.3,
      model: this.ai.providerId === 'google' ? 'gemini-2.5-pro' : undefined,
    };

    const toolCallsForEvidence: Array<{ name: string; input: Record<string, unknown>; result?: string }> = [];
    const executeTool = async (call: ToolCall): Promise<string> => {
      const result = await this.dispatchTool(cfg, call, caller);
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
        methodologyVersion: cfg.systemPromptVersion,
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
        methodologyVersion: cfg.systemPromptVersion,
      };
    }
  }

  // ── Streaming chat ─────────────────────────────────────────────────
  // Same flow as `chat()` but emits status + delta events through the
  // supplied callback. v1 calls the underlying provider non-streaming
  // and chunks the final text server-side (simulated output streaming).
  // A future iteration can plumb provider-native token streaming through
  // `completeWithTools` without breaking this surface.
  async streamChat(
    params: {
      userId: string;
      conversationId?: string;
      userMessage: string;
      /** STRATEGIC (default) | DASHBOARD. Mirrors `chat()`. */
      kind?: AnalystConversationKind;
    },
    onEvent: (e: AnalystStreamEvent) => void | Promise<void>,
  ): Promise<void> {
    const emit = async (e: AnalystStreamEvent) => {
      try {
        await onEvent(e);
      } catch {
        // Client disconnected — swallow. The work still completes server-
        // side; we just can't deliver the rest of the stream.
      }
    };

    const trimmed = params.userMessage.trim();
    if (!trimmed) {
      await emit({ type: 'error', message: 'Empty message' });
      return;
    }

    await emit({ type: 'status', phase: 'opening', label: 'Starting…' });

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

    const language = detectLanguage(trimmed);
    let conversationId = params.conversationId;
    // Resolve kind FIRST so the safety gate runs against the right
    // surface (strategic = strict, dashboard = aggregate-friendly).
    // Stored kind on continuation is authoritative.
    let kind: AnalystConversationKind = params.kind ?? 'STRATEGIC';
    if (!conversationId) {
      const created = await prisma.analystConversation.create({
        data: { userId: params.userId, kind, title: truncate(trimmed, 80), language },
      });
      conversationId = created.id;
    } else {
      const existing = await prisma.analystConversation.findUnique({
        where: { id: conversationId },
        select: { kind: true, userId: true },
      });
      if (!existing) {
        await emit({ type: 'error', message: 'Conversation not found' });
        return;
      }
      if (existing.userId !== params.userId) {
        await emit({ type: 'error', message: 'Not your conversation' });
        return;
      }
      kind = existing.kind;
    }
    const cfg = this.kindConfig(kind);

    await emit({ type: 'status', phase: 'safety_check', label: 'Checking safety…' });
    const verdict = checkAnalystSafety(
      trimmed,
      kind === 'DASHBOARD' ? 'dashboard' : 'strategic',
    );
    await emit({ type: 'open', conversationId });

    await prisma.analystMessage.create({
      data: { conversationId, role: 'USER', content: trimmed },
    });

    // Safety refusal — same shape as chat(), emit text as one delta and done.
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
      await emit({ type: 'delta', text: refusalText });
      await emit({
        type: 'done',
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
        methodologyVersion: cfg.systemPromptVersion,
      });
      return;
    }

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
      await emit({ type: 'delta', text: placeholderText });
      await emit({
        type: 'done',
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
        methodologyVersion: cfg.systemPromptVersion,
      });
      return;
    }

    await emit({
      type: 'status',
      phase: 'fetching_history',
      label: 'Loading conversation context…',
    });
    const history = await prisma.analystMessage.findMany({
      where: { conversationId, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    history.reverse();

    const messages: ToolUseMessage[] = [
      { role: 'system', content: cfg.systemPrompt },
      ...history
        .filter((m) => m.content && m.role !== 'ASSISTANT' || (m.role === 'ASSISTANT' && !m.refused))
        .slice(-10)
        .map<ToolUseMessage>((m) =>
          m.role === 'USER'
            ? { role: 'user', content: wrapUserContent(m.content) }
            : { role: 'assistant', content: [{ type: 'text', text: m.content }] },
        ),
    ];
    const wrappedTrimmed = wrapUserContent(trimmed);
    if (
      messages[messages.length - 1]?.role !== 'user' ||
      (messages[messages.length - 1] as { content?: string }).content !== wrappedTrimmed
    ) {
      messages.push({ role: 'user', content: wrappedTrimmed });
    }

    await emit({ type: 'status', phase: 'thinking', label: 'Thinking…' });

    const req: ToolUseRequest = {
      ctx: { module: 'analyst', kind: kind === 'DASHBOARD' ? 'dashboard-chat' : 'chat', userId: params.userId },
      messages,
      tools: cfg.tools,
      maxIterations: 6,
      maxOutputTokens: 2500,
      temperature: 0.3,
      model: this.ai.providerId === 'google' ? 'gemini-2.5-pro' : undefined,
    };

    const toolCallsForEvidence: Array<{
      name: string;
      input: Record<string, unknown>;
      result?: string;
    }> = [];
    const executeTool = async (call: ToolCall): Promise<string> => {
      const label = humaniseToolName(call.name);
      await emit({
        type: 'status',
        phase: 'tool_call',
        label: `Running ${label}…`,
        detail: describeToolInput(call.name, call.input),
        toolName: call.name,
      });
      const t0 = Date.now();
      const result = await this.dispatchTool(cfg, call, caller);
      const durationMs = Date.now() - t0;
      toolCallsForEvidence.push({
        name: call.name,
        input: call.input,
        result: result.slice(0, 2000),
      });
      await emit({
        type: 'status',
        phase: 'tool_result',
        label: `${label} → ${formatToolByteCount(result.length)} (${durationMs}ms)`,
        toolName: call.name,
      });
      // Re-emit a "thinking" status so the UI shows the loop continuing
      // until the next tool call (or final text) lands.
      await emit({ type: 'status', phase: 'thinking', label: 'Reasoning…' });
      return result;
    };

    try {
      if (!this.ai.completeWithTools) {
        throw new ToolUseNotSupportedError(this.ai.providerId);
      }
      const resp = await this.ai.completeWithTools(req, executeTool);

      // Stream the final text in small chunks so the UI sees output
      // arriving incrementally. ~40-char chunks at 25ms cadence land
      // a 2-3 paragraph answer in 1-2 seconds — feels live without
      // hammering the SSE channel. Paragraph boundaries get a small
      // extra pause so reading-pace feels natural.
      await emit({ type: 'status', phase: 'synthesising', label: 'Writing answer…' });
      const finalText = resp.finalText || '(no final text)';
      const chunks = chunkForStreaming(finalText, 40);
      for (const chunk of chunks) {
        await emit({ type: 'delta', text: chunk });
        await sleep(chunk.endsWith('\n\n') ? 35 : 18);
      }

      await emit({ type: 'status', phase: 'persisting', label: 'Saving…' });
      const message = await prisma.analystMessage.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: finalText,
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

      await emit({
        type: 'done',
        conversationId,
        messageId: message.id,
        text: finalText,
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
        methodologyVersion: cfg.systemPromptVersion,
      });
    } catch (err) {
      const msg =
        err instanceof ToolUseNotSupportedError
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
      await emit({ type: 'delta', text: msg });
      await emit({
        type: 'done',
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
        methodologyVersion: cfg.systemPromptVersion,
      });
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────
  async deleteConversation(conversationId: string, userId: string): Promise<{ deleted: true }> {
    const c = await prisma.analystConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!c) throw new NotFoundException();
    if (c.userId !== userId) throw new ForbiddenException('Not your conversation');
    // Cascade deletes messages + feedback via Prisma onDelete relations.
    await prisma.analystConversation.delete({ where: { id: conversationId } });
    return { deleted: true };
  }

  async deleteAllConversations(userId: string): Promise<{ deletedCount: number }> {
    const result = await prisma.analystConversation.deleteMany({
      where: { userId },
    });
    return { deletedCount: result.count };
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

// ── Stream helpers ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Map snake-case tool names to friendlier UI labels. The analyst's tool
// catalog uses verb_noun names that look fine in audit logs but read as
// tech jargon in a status pill; this table replaces them with the same
// surface labels the rest of the app uses (e.g. "Risk portfolio" vs
// "get_risk_portfolio").
const TOOL_LABELS: Record<string, string> = {
  query_programs: 'Program search',
  get_program: 'Program detail',
  query_skills: 'Skill taxonomy',
  query_trends: 'Trend signals',
  query_gaps: 'Demand-supply gap',
  compare_peers: 'Peer comparison',
  run_quick_scenario: 'Scenario simulation',
  generate_chart: 'Chart spec',
  cite_source: 'Citation',
  search_policy_docs: 'Policy doc search',
  search_research: 'Research search',
  get_methodology: 'Methodology lookup',
  list_data_sources: 'Data connectors',
  query_pipeline_runs: 'Pipeline runs',
  query_pdf_library: 'PDF library',
  query_ai_extractions: 'AI extractions',
  get_education_kpis: 'Education KPIs',
  get_staff_kpis: 'Staff KPIs',
  get_risk_portfolio: 'Risk portfolio',
  query_recruitment: 'Recruitment funnel',
  // Dashboard-scoped tools (v1.2.3 dashboard chatbot).
  dash_education_student_info: 'Student info',
  dash_education_by_location: 'Student location',
  dash_education_active_pivot: 'Cohort pivot',
  dash_education_international: 'International students',
  dash_education_tuition: 'Tuition revenue',
  dash_education_performance: 'Academic performance',
  dash_education_recruitment: 'TCAS recruitment',
  dash_education_class_offerings: 'Class offerings',
  dash_staff_workforce: 'Workforce',
  dash_staff_compensation: 'Compensation',
  dash_staff_teaching_workload: 'Teaching workload',
  dash_staff_research: 'Research outputs',
  dash_staff_faculty_by_program: 'Faculty by program',
  dash_filter_options: 'Filter options',
  dash_data_freshness: 'Data freshness',
  dash_compute: 'Calculation',
};

function humaniseToolName(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}

// Best-effort 1-line summary of a tool's input — used in the status
// pill's tooltip so the operator can see "what specifically the model
// asked for" without expanding the evidence panel. Falls back to a
// JSON-stringified excerpt when no key is matched.
function describeToolInput(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === 'get_program' && typeof input.programId === 'string') {
    return `programId=${input.programId}`;
  }
  if (toolName === 'query_programs') {
    const bits: string[] = [];
    if (typeof input.scope === 'string') bits.push(`scope=${input.scope}`);
    if (typeof input.status === 'string') bits.push(`status=${input.status}`);
    if (typeof input.level === 'string') bits.push(`level=${input.level}`);
    return bits.length > 0 ? bits.join(' · ') : undefined;
  }
  if (toolName === 'query_gaps' && typeof input.dimension === 'string') {
    return `dimension=${input.dimension}`;
  }
  if (toolName === 'search_policy_docs' && typeof input.query === 'string') {
    return `q=${truncate(input.query, 60)}`;
  }
  if (toolName === 'search_research' && typeof input.query === 'string') {
    return `q=${truncate(input.query, 60)}`;
  }
  const j = JSON.stringify(input);
  return j.length > 80 ? j.slice(0, 80) + '…' : j;
}

function formatToolByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

// Break a long string into ~`size`-character chunks at the nearest
// natural boundary (space, newline, sentence end) so streamed output
// doesn't truncate words mid-stride. Always preserves the original
// content when joined.
function chunkForStreaming(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      // Backtrack to the nearest whitespace / sentence break to avoid
      // splitting mid-word. Bounded backtrack so we don't degenerate to
      // chunk-of-1 on long URLs etc.
      const minEnd = i + Math.floor(size / 2);
      let cut = end;
      while (cut > minEnd && !/[\s.!?,;:)\]]/.test(text[cut - 1] ?? '')) cut -= 1;
      if (cut > minEnd) end = cut;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}
