import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import { ANALYST_BRIEFS, getBriefTemplate } from '@kku/shared';
import {
  AuthSession,
  Authorized,
  AiCall,
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

const ChatBodySchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(4000),
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
    @Query(new ZodValidationPipe(ListQuerySchema)) _q: ListQuery,
  ) {
    return this.analyst.listConversations(user.userId);
  }

  @Get('conversations/:id')
  @Authorized('programs:read:all')
  async getConversation(@AuthSession() user: SessionUser, @Param('id') id: string) {
    return this.analyst.getConversation(id, user.userId);
  }

  @Post('chat')
  @Authorized('programs:read:all')
  @AiCall({ module: 'analyst' })
  async chat(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(ChatBodySchema)) body: ChatBody,
  ) {
    return this.analyst.chat({
      userId: user.userId,
      conversationId: body.conversationId,
      userMessage: body.message,
    });
  }

  @Post('briefs/generate')
  @Authorized('programs:read:all')
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
