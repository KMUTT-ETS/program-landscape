import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma, prisma, materialiseProgramDigest, materialiseImdRankings } from '@kku/db';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';

// Admin endpoints for AI extractions + inference trail.
//
//   GET  /ai/extractions           — queue list (filter by status / kind)
//   GET  /ai/extractions/:id       — single extraction
//   POST /ai/extractions/:id/approve
//   POST /ai/extractions/:id/reject
//   GET  /ai/inferences            — recent AI calls (observability)
//   GET  /ai/inferences/stats      — per-module cost + latency + success rate
//
// Approve writes reviewStatus=APPROVED on the AiExtraction row and
// triggers a post-approval handler that materialises the payload into
// the real domain tables (CourseSkill / JobPostingSkill / policy tags).
// The handler lives in ai-admin.service.ts to keep the controller thin.

const ListQuerySchema = z.object({
  status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_APPROVED']).optional(),
  kind: z.string().optional(),
  // Filter by source entity. Useful for "show AI extractions linked to
  // this PDF" on /admin/pdf-review/[id].
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const ApproveBodySchema = z.object({
  reviewNotes: z.string().optional(),
  editedPayload: z.record(z.string(), z.unknown()).optional(),
});
type ApproveBody = z.infer<typeof ApproveBodySchema>;

const RejectBodySchema = z.object({
  reviewNotes: z.string().min(1),
});
type RejectBody = z.infer<typeof RejectBodySchema>;

@Controller('/ai')
export class AiAdminController {
  @Get('extractions')
  @Authorized('pdf:approve_extraction')
  @Provenance({ sources: [{ id: 'ai-extraction', name: 'AI Extraction Queue' }] })
  async listExtractions(@Query(new ZodValidationPipe(ListQuerySchema)) q: z.infer<typeof ListQuerySchema>) {
    const where: Prisma.AiExtractionWhereInput = {};
    if (q.status) where.reviewStatus = q.status;
    if (q.kind) where.extractionKind = q.kind;
    if (q.sourceEntityType) where.sourceEntityType = q.sourceEntityType;
    if (q.sourceEntityId) where.sourceEntityId = q.sourceEntityId;
    return prisma.aiExtraction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: {
        aiInference: {
          select: { id: true, model: true, tokensInput: true, tokensOutput: true, latencyMs: true, costEstimateUsd: true },
        },
      },
    });
  }

  @Get('extractions/:id')
  @Authorized('pdf:approve_extraction')
  @Provenance({ sources: [{ id: 'ai-extraction', name: 'AI Extraction Queue' }] })
  async getExtraction(@Param('id') id: string) {
    return prisma.aiExtraction.findUnique({
      where: { id },
      include: {
        aiInference: true,
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  @Post('extractions/:id/approve')
  @Authorized('pdf:approve_extraction')
  @AuditLog({ action: 'ai.extraction.approve', entityType: 'AiExtraction' })
  async approve(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApproveBodySchema)) body: ApproveBody,
  ) {
    const update: Prisma.AiExtractionUpdateInput = {
      reviewStatus: 'APPROVED',
      reviewedBy: { connect: { id: user.userId } },
      reviewedAt: new Date(),
      reviewNotes: body.reviewNotes,
    };
    if (body.editedPayload) {
      update.payloadJson = body.editedPayload as Prisma.InputJsonValue;
    }
    const updated = await prisma.aiExtraction.update({ where: { id }, data: update });

    // Post-approval materialisation. PROGRAM_DIGEST writes through to
    // Program columns + ProgramSkill rows; unmatched skill names land
    // as PROPOSED_SKILL extractions for analyst follow-up. Other
    // extractionKinds keep the deferred-scaffold posture for now.
    if (updated.extractionKind === 'PROGRAM_DIGEST') {
      try {
        const result = await materialiseProgramDigest(id);
        return {
          ...updated,
          materialisation: result,
        };
      } catch (err) {
        // Don't unwind the approval — materialisation can be retried.
        // The error surfaces in the API response so the reviewer can
        // re-trigger via the admin UI's "Re-materialise" action (lands
        // in Phase 4.2 alongside the per-program detail page).
        return {
          ...updated,
          materialisationError: err instanceof Error ? err.message : String(err),
        };
      }
    }
    if (updated.extractionKind === 'IMD_RANKINGS') {
      try {
        const result = await materialiseImdRankings(id);
        return { ...updated, materialisation: result };
      } catch (err) {
        return {
          ...updated,
          materialisationError: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return updated;
  }

  @Post('extractions/:id/reject')
  @Authorized('pdf:approve_extraction')
  @AuditLog({ action: 'ai.extraction.reject', entityType: 'AiExtraction' })
  async reject(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectBodySchema)) body: RejectBody,
  ) {
    return prisma.aiExtraction.update({
      where: { id },
      data: {
        reviewStatus: 'REJECTED',
        reviewedBy: { connect: { id: user.userId } },
        reviewedAt: new Date(),
        reviewNotes: body.reviewNotes,
      },
    });
  }

  @Get('inferences')
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'ai-inference', name: 'AI Inference Log' }] })
  async listInferences(@Query('limit') limitRaw?: string) {
    const limit = Math.min(Number(limitRaw ?? '100') || 100, 500);
    return prisma.aiInference.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        module: true,
        kind: true,
        model: true,
        tokensInput: true,
        tokensOutput: true,
        latencyMs: true,
        costEstimateUsd: true,
        confidence: true,
        createdAt: true,
      },
    });
  }

  @Get('inferences/stats')
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'ai-inference', name: 'AI Inference Log' }] })
  async stats() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // Aggregate per module over the last 7 days. groupBy gives us counts
    // + sums without round-tripping the full row list to the app.
    const perModule = await prisma.aiInference.groupBy({
      by: ['module'],
      where: { createdAt: { gte: since } },
      _count: { id: true },
      _sum: {
        tokensInput: true,
        tokensOutput: true,
        costEstimateUsd: true,
      },
      _avg: { latencyMs: true, confidence: true },
      orderBy: { _count: { id: 'desc' } },
    });
    return {
      windowDays: 7,
      perModule: perModule.map((m) => ({
        module: m.module,
        calls: m._count.id,
        tokensInput: m._sum.tokensInput ?? 0,
        tokensOutput: m._sum.tokensOutput ?? 0,
        costUsd: m._sum.costEstimateUsd ?? 0,
        avgLatencyMs: m._avg.latencyMs,
        avgConfidence: m._avg.confidence,
      })),
    };
  }
}
