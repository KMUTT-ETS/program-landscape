import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import type { Request } from 'express';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';
import { PdfIntakeService } from './pdf-intake.service';

// Multipart upload + review admin surface.
//
// POST /pdfs/upload          (multipart; ANALYST + ADMIN)
// GET  /pdfs/pending         (review queue)
// GET  /pdfs/:id             (full detail — pages + extractions)
// GET  /pdfs/:id/file        (signed MinIO URL — 302 redirect)
// POST /pdfs/:id/re-extract
// POST /pdfs/extractions/:extractionId/approve
// POST /pdfs/extractions/:extractionId/reject
// POST /pdfs/bulk-reprocess  (ADMIN only)

const ListQuerySchema = z.object({
  status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_APPROVED']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const ApproveBodySchema = z.object({
  reviewNotes: z.string().optional(),
  editedPayload: z.record(z.string(), z.unknown()).optional(),
});
type ApproveBody = z.infer<typeof ApproveBodySchema>;

const RejectBodySchema = z.object({
  reviewNotes: z.string().min(1, 'Rejection reason is required'),
});
type RejectBody = z.infer<typeof RejectBodySchema>;

const BulkReprocessBodySchema = z.object({
  sourceCategory: z
    .enum(['POLICY', 'REPORT', 'CURRICULUM', 'PEER_PROGRAM', 'SURVEY', 'COMMITTEE_MINUTES', 'JOB_POSTINGS_BATCH', 'OTHER'])
    .optional(),
  limit: z.number().int().positive().max(500).default(100),
});
type BulkReprocessBody = z.infer<typeof BulkReprocessBodySchema>;

@Controller('/pdfs')
export class PdfIntakeController {
  constructor(private readonly service: PdfIntakeService) {}

  // Single or multi-file upload. Sibling fields on the multipart form
  // apply to ALL files in the request — the caller should split uploads
  // by category if the hints differ. (Matches how /upload UI works.)
  @Post('upload')
  @Authorized('pdf:upload')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: 50 * 1024 * 1024 } }))
  @AuditLog({ action: 'pdf.upload', entityType: 'PdfDocument' })
  async upload(
    @AuthSession() user: SessionUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ) {
    // Form fields come through as strings in req.body.
    const body = req.body as {
      sourceCategoryHint?: string;
      sourceOrg?: string;
      language?: string;
      notes?: string;
    };
    const hint = body.sourceCategoryHint && body.sourceCategoryHint !== ''
      ? body.sourceCategoryHint as
        | 'POLICY' | 'REPORT' | 'CURRICULUM' | 'PEER_PROGRAM' | 'SURVEY'
        | 'COMMITTEE_MINUTES' | 'JOB_POSTINGS_BATCH' | 'OTHER'
      : undefined;
    const language = body.language && body.language !== ''
      ? body.language as 'TH' | 'EN' | 'MIXED'
      : undefined;

    const results = [];
    for (const file of files) {
      results.push(
        await this.service.uploadPdf({
          originalFilename: file.originalname,
          bytes: file.buffer,
          uploadedByUserId: user.userId,
          sourceCategoryHint: hint,
          sourceOrg: body.sourceOrg || undefined,
          language,
          notes: body.notes || undefined,
        }),
      );
    }
    return { uploaded: results };
  }

  @Get('pending')
  @Authorized('pdf:upload')
  @Provenance({ sources: [{ id: 'pdf-intake', name: 'PDF Intake' }] })
  async pending(@Query(new ZodValidationPipe(ListQuerySchema)) q: z.infer<typeof ListQuerySchema>) {
    return this.service.listQueue({ status: q.status, limit: q.limit });
  }

  @Get(':id')
  @Authorized('pdf:upload')
  @Provenance({ sources: [{ id: 'pdf-intake', name: 'PDF Intake' }] })
  async getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  @Get(':id/signed-url')
  @Authorized('pdf:upload')
  async signedUrl(@Param('id') id: string) {
    return { url: await this.service.signedPdfUrl(id) };
  }

  @Post(':id/re-extract')
  @Authorized('pdf:upload')
  @AuditLog({ action: 'pdf.re_extract', entityType: 'PdfDocument' })
  async reExtract(@Param('id') id: string) {
    await this.service.requeueIntake(id);
    return { queued: true, pdfDocumentId: id };
  }

  @Post('extractions/:extractionId/approve')
  @Authorized('pdf:approve_extraction')
  @AuditLog({ action: 'pdf.extraction.approve', entityType: 'PdfExtraction' })
  async approveExtraction(
    @AuthSession() user: SessionUser,
    @Param('extractionId') extractionId: string,
    @Body(new ZodValidationPipe(ApproveBodySchema)) body: ApproveBody,
  ) {
    return this.service.approveExtraction({
      extractionId,
      reviewerId: user.userId,
      reviewNotes: body.reviewNotes,
      editedPayload: body.editedPayload,
    });
  }

  @Post('extractions/:extractionId/reject')
  @Authorized('pdf:approve_extraction')
  @AuditLog({ action: 'pdf.extraction.reject', entityType: 'PdfExtraction' })
  async rejectExtraction(
    @AuthSession() user: SessionUser,
    @Param('extractionId') extractionId: string,
    @Body(new ZodValidationPipe(RejectBodySchema)) body: RejectBody,
  ) {
    return this.service.rejectExtraction({
      extractionId,
      reviewerId: user.userId,
      reviewNotes: body.reviewNotes,
    });
  }

  @Post('bulk-reprocess')
  @Authorized('pdf:approve_extraction')
  @AuditLog({ action: 'pdf.bulk_reprocess', entityType: 'PdfDocument' })
  async bulkReprocess(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(BulkReprocessBodySchema)) body: BulkReprocessBody,
  ) {
    return this.service.bulkReprocess({
      sourceCategory: body.sourceCategory,
      limit: body.limit,
      triggeredBy: user.userId,
    });
  }
}
