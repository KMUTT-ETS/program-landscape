import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  AuthSession,
  Authorized,
  AuditLog,
  Provenance,
  ZodValidationPipe,
} from '../common';
import {
  RenderHtmlRequestSchema,
  type RenderHtmlRequest,
  type SessionUser,
} from '@kku/shared';
import { PdfService } from './pdf.service';

// All module code goes through POST /pdf/generate. There is no
// in-process fallback — if Gotenberg is down, this endpoint fails, and
// the user sees a clear error. That is intentional: silent fallback to
// a different renderer would produce PDFs with wrong fonts / wrong
// line-break rules, which is exactly what the Council-readiness rules
// forbid.
@Controller('/pdf')
export class PdfController {
  constructor(private readonly pdf: PdfService) {}

  @Post('generate')
  @Authorized('pdf:generate')
  @AuditLog({ action: 'pdf.generate', entityType: 'PdfGeneration' })
  async generate(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(RenderHtmlRequestSchema)) body: RenderHtmlRequest,
  ) {
    const result = await this.pdf.generateAndPersist(body, user.userId);
    return {
      pdfId: result.storageKey?.replace(/\.pdf$/, '').split('/').pop(),
      templateName: result.templateName,
      templateVersion: result.templateVersion,
      byteSize: result.byteSize,
      pageCount: result.pageCount,
      generationDurationMs: result.generationDurationMs,
      pdfUrl: result.signedUrl,
      expiresAt: result.signedUrlExpiresAt?.toISOString(),
    };
  }

  // Re-signs a URL for an already-generated PDF. The signed URL from
  // /generate eventually expires; this gives the UI a way to refresh.
  @Get(':id')
  @Authorized('pdf:generate')
  @Provenance({ sources: [{ id: 'pdf-service', name: 'PDF Generation' }] })
  async getOne(@Param('id') id: string) {
    try {
      return await this.pdf.getSignedUrl(id);
    } catch {
      throw new NotFoundException();
    }
  }

  @Get('templates')
  @Authorized('pdf:admin')
  @Provenance({ sources: [{ id: 'pdf-service', name: 'PDF Generation' }] })
  async listTemplates() {
    return this.pdf.listTemplates();
  }

  @Get('admin/recent')
  @Authorized('pdf:admin')
  @Provenance({ sources: [{ id: 'pdf-service', name: 'PDF Generation' }] })
  async listRecent() {
    return this.pdf.listRecent();
  }
}
