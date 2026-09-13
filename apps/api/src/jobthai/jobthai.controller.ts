import { Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';

import { ApiError, type SessionUser } from '@kku/shared';

import { AuditLog, AuthSession, Authorized, ZodValidationPipe } from '../common';
import { JOBTHAI_MAX_UPLOAD_BYTES, JobThaiService } from './jobthai.service';

// Admin surface for JobThai XLSX drops.
//
// POST   /admin/jobthai/batches      (multipart .xlsx; ANALYST + ADMIN)
// GET    /admin/jobthai/batches      (recent, with status + postings loaded)
// DELETE /admin/jobthai/batches/:id  (removes the batch; postings cascade)

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

@Controller('/admin/jobthai')
export class JobThaiController {
  constructor(private readonly service: JobThaiService) {}

  @Post('batches')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'jobthai.batch.upload', entityType: 'JobThaiBatch' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: JOBTHAI_MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: { originalname: string; buffer: Buffer } | undefined, @AuthSession() user: SessionUser) {
    if (!file) throw new ApiError('VALIDATION_FAILED', 'No file was uploaded (expected multipart field "file").');
    return this.service.ingestFile({
      originalFilename: decodeFilename(file.originalname),
      bytes: file.buffer,
      uploadedByUserId: user.userId,
    });
  }

  @Get('batches')
  @Authorized('data_sources:read')
  async list(@Query(new ZodValidationPipe(ListQuerySchema)) query: { limit: number }) {
    return this.service.list(query.limit);
  }

  @Delete('batches/:id')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'jobthai.batch.delete', entityType: 'JobThaiBatch' })
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
