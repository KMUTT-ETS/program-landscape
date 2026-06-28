import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import { ApiError } from '@kku/shared';
import { AuditLog, AuthSession, Authorized, ZodValidationPipe } from '../common';
import { TrendDocumentsService } from './trend-documents.service';

// Admin surface: upload a document (PDF) or paste a URL; it's analysed by AI
// and auto-published as a signal on the Trends Radar.
//
// POST /admin/trend-documents          (multipart PDF; ANALYST + ADMIN)
// POST /admin/trend-documents/from-url (JSON { url })
// GET  /admin/trend-documents          (recent, with status + signal link)
// GET  /admin/trend-documents/:id      (single — for status polling)
// DELETE /admin/trend-documents/:id    (remove source + its signal from radar)

const SIGNAL_TYPES = ['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS'] as const;

const FromUrlSchema = z.object({
  url: z.string().min(4),
  signalTypeHint: z.enum(SIGNAL_TYPES).optional(),
});
type FromUrlBody = z.infer<typeof FromUrlSchema>;

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(30),
});

function decodeFilename(name: string): string {
  // Multipart filenames arrive latin1-encoded; recover UTF-8 for Thai names.
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

@Controller('/admin/trend-documents')
export class TrendDocumentsController {
  constructor(private readonly service: TrendDocumentsService) {}

  @Post()
  @Authorized('pdf:upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @AuditLog({ action: 'trend_document.upload', entityType: 'TrendDocument' })
  async upload(
    @AuthSession() user: SessionUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { signalTypeHint?: string },
  ) {
    if (!file) throw new ApiError('VALIDATION_FAILED', 'No file uploaded (field "file").');
    const hint = SIGNAL_TYPES.includes(body.signalTypeHint as (typeof SIGNAL_TYPES)[number])
      ? (body.signalTypeHint as (typeof SIGNAL_TYPES)[number])
      : undefined;
    return this.service.ingestFile({
      originalFilename: decodeFilename(file.originalname),
      bytes: file.buffer,
      signalTypeHint: hint,
      uploadedByUserId: user.userId,
    });
  }

  @Post('from-url')
  @Authorized('pdf:upload')
  @AuditLog({ action: 'trend_document.from_url', entityType: 'TrendDocument' })
  async fromUrl(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(FromUrlSchema)) body: FromUrlBody,
  ) {
    return this.service.ingestUrl({
      url: body.url,
      signalTypeHint: body.signalTypeHint,
      uploadedByUserId: user.userId,
    });
  }

  @Get()
  @Authorized('pdf:upload')
  async list(@Query(new ZodValidationPipe(ListQuerySchema)) query: { limit: number }) {
    return this.service.list(query.limit);
  }

  @Get(':id')
  @Authorized('pdf:upload')
  async getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }

  // Remove the source document/URL and its published signal from the radar.
  @Delete(':id')
  @Authorized('pdf:upload')
  @AuditLog({ action: 'trend_document.remove', entityType: 'TrendDocument' })
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
