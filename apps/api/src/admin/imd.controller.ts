import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { prisma } from '@kku/db';
import { ApiError } from '@kku/shared';
import type { SessionUser } from '@kku/shared';
import { AuthSession, AuditLog, Authorized } from '../common';
import { AiJobsQueueService } from '../ai-jobs/ai-jobs-queue.service';

// ─────────────────────────────────────────────────────────────────────────────
// IMD admin endpoints — enqueue the rankings extractor for an uploaded PDF.
// The PDF is uploaded via the standard /api/v1/pdfs/upload endpoint
// (with sourceCategoryHint=REPORT, sourceOrg=IMD); this controller
// kicks off the AI-job that runs the imd-rankings.v1 extractor.
//
// Approval still happens at /admin/extraction-review — the extractor
// writes an AiExtraction row in PENDING_REVIEW. On approve, the
// existing /ai/extractions/:id/approve flow calls
// materialiseImdRankings which upserts ImdRanking rows.
// ─────────────────────────────────────────────────────────────────────────────

@Controller('/admin/imd')
export class ImdController {
  constructor(private readonly aiJobs: AiJobsQueueService) {}

  @Post('extract/:pdfId')
  @HttpCode(202)
  @Authorized('pdf:upload')
  @AuditLog({ action: 'imd.extract.enqueue', entityType: 'PdfDocument' })
  async enqueueExtract(
    @AuthSession() user: SessionUser,
    @Param('pdfId') pdfId: string,
  ): Promise<{ jobId: string; pdfId: string }> {
    const pdf = await prisma.pdfDocument.findUnique({
      where: { id: pdfId },
      select: { id: true },
    });
    if (!pdf) {
      throw new ApiError('NOT_FOUND', `PdfDocument ${pdfId} not found`);
    }
    const jobId = await this.aiJobs.enqueue({
      kind: 'RUN_IMD_RANKINGS_EXTRACT',
      entityId: pdfId,
      triggeredByUserId: user.userId,
      trigger: 'MANUAL',
    });
    return { jobId, pdfId };
  }
}
