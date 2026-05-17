import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AnalystStreamEvent, SessionUser } from '@kku/shared';
import { ANALYST_BRIEFS, getBriefTemplate } from '@kku/shared';
import {
  AiCall,
  AiQuota,
  AuditLog,
  AuthSession,
  Authorized,
  ZodValidationPipe,
} from '../common';
import { AnalystService } from './analyst.service';

// ═════════════════════════════════════════════════════════════════════
// AI Analyst API (prompt 11)
//
// 5 endpoints:
//   POST /analyst/chat           — one chat turn (non-streaming v1)
//   GET  /analyst/conversations  — list user's conversations
//   GET  /analyst/conversations/:id — fetch full conversation
//   POST /analyst/briefs/generate — run a pre-built brief template
//   POST /analyst/feedback       — thumbs up/down + correction
//
// Streaming (SSE) is scaffolded for prompt 13 hardening; v1 returns the
// full response in one JSON payload.
// ═════════════════════════════════════════════════════════════════════

// `kind` is optional for back-compat. When the client passes DASHBOARD,
// AnalystService routes to the dashboard tool catalog + system prompt.
// On a continuation turn (conversationId is set) the stored kind wins;
// `kind` is only honoured on first turn.
const ChatBodySchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(4000),
  kind: z.enum(['STRATEGIC', 'DASHBOARD']).optional(),
});
type ChatBody = z.infer<typeof ChatBodySchema>;

const FeedbackBodySchema = z.object({
  messageId: z.string(),
  vote: z.enum(['up', 'down']),
  correction: z.string().max(2000).optional(),
});
type FeedbackBody = z.infer<typeof FeedbackBodySchema>;

const BriefBodySchema = z.object({
  briefSlug: z.string(),
  scope: z.enum(['university', 'faculty', 'department', 'program']).optional(),
  scopeId: z.string().optional(),
  extraContext: z.string().optional(),
});
type BriefBody = z.infer<typeof BriefBodySchema>;

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Filter the list by conversation kind. Omit to see all. */
  kind: z.enum(['STRATEGIC', 'DASHBOARD']).optional(),
});
type ListQuery = z.infer<typeof ListQuerySchema>;

@Controller('/analyst')
export class AnalystController {
  constructor(private readonly analyst: AnalystService) {}

  @Get('brief-templates')
  @Authorized('programs:read:all')
  async briefTemplates() {
    return ANALYST_BRIEFS.map((b) => ({
      slug: b.slug,
      name: b.name,
      descriptionEn: b.descriptionEn,
      descriptionTh: b.descriptionTh,
      requiresScopeArg: b.requiresScopeArg,
      pdfTemplate: b.pdfTemplate,
    }));
  }

  @Get('conversations')
  @Authorized('programs:read:all')
  async listConversations(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery,
  ) {
    return this.analyst.listConversations(user.userId, q.kind);
  }

  @Get('conversations/:id')
  @Authorized('programs:read:all')
  async getConversation(@AuthSession() user: SessionUser, @Param('id') id: string) {
    return this.analyst.getConversation(id, user.userId);
  }

  @Post('chat')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 20, ttl: 60_000 }, ai_hourly: { limit: 200, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'analyst' })
  @AiCall({ module: 'analyst' })
  async chat(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(ChatBodySchema)) body: ChatBody,
  ) {
    return this.analyst.chat({
      userId: user.userId,
      conversationId: body.conversationId,
      userMessage: body.message,
      kind: body.kind,
    });
  }

  // Server-sent-events variant of /chat. Emits status events as the
  // tool loop progresses + delta events as the final text is chunked
  // out. Same rate-limit + audit posture as /chat. UI reads via a
  // streaming fetch reader.
  @Post('chat/stream')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 20, ttl: 60_000 }, ai_hourly: { limit: 200, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'analyst' })
  @AiCall({ module: 'analyst' })
  async chatStream(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(ChatBodySchema)) body: ChatBody,
    @Res() res: Response,
  ) {
    // SSE headers. Disabling buffering matters for nginx-fronted setups
    // — without `X-Accel-Buffering: no` events arrive in batches once
    // the connection closes, defeating the point of streaming.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const writeEvent = (e: AnalystStreamEvent) => {
      res.write(`event: ${e.type}\n`);
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    let clientGone = false;
    res.on('close', () => {
      clientGone = true;
    });

    try {
      await this.analyst.streamChat(
        {
          userId: user.userId,
          conversationId: body.conversationId,
          userMessage: body.message,
          kind: body.kind,
        },
        async (event) => {
          if (clientGone) return;
          writeEvent(event);
        },
      );
    } catch (err) {
      if (!clientGone) {
        writeEvent({ type: 'error', message: (err as Error).message });
      }
    } finally {
      if (!clientGone) res.end();
    }
  }

  @Delete('conversations/:id')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'analyst.delete_conversation', entityType: 'AnalystConversation' })
  async deleteConversation(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
  ) {
    return this.analyst.deleteConversation(id, user.userId);
  }

  @Delete('conversations')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'analyst.delete_all_conversations', entityType: 'AnalystConversation' })
  async deleteAllConversations(@AuthSession() user: SessionUser) {
    return this.analyst.deleteAllConversations(user.userId);
  }

  @Post('briefs/generate')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 10, ttl: 60_000 }, ai_hourly: { limit: 50, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'analyst' })
  @AiCall({ module: 'analyst' })
  async generateBrief(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(BriefBodySchema)) body: BriefBody,
  ) {
    const template = getBriefTemplate(body.briefSlug);
    if (!template) throw new Error(`Unknown brief template: ${body.briefSlug}`);
    if (template.requiresScopeArg && !body.scopeId) {
      throw new Error(`Brief ${body.briefSlug} requires scope + scopeId arguments`);
    }

    // A brief is just a chat turn with a pre-baked prompt. We create a
    // new conversation per brief so the evidence panel has a clean trace.
    const scopeLine = body.scopeId
      ? `\n\n[Scope] ${body.scope ?? 'faculty'} / ${body.scopeId}`
      : '';
    const extra = body.extraContext ? `\n\n[Additional context] ${body.extraContext}` : '';
    const result = await this.analyst.chat({
      userId: user.userId,
      userMessage: `${template.prompt}${scopeLine}${extra}`,
    });
    return {
      briefSlug: body.briefSlug,
      pdfTemplate: template.pdfTemplate,
      ...result,
    };
  }

  @Post('feedback')
  @Authorized('programs:read:all')
  async feedback(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(FeedbackBodySchema)) body: FeedbackBody,
  ) {
    return this.analyst.recordFeedback({
      messageId: body.messageId,
      userId: user.userId,
      vote: body.vote,
      correction: body.correction,
    });
  }
}
