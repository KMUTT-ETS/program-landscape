import { Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';

import { ApiError, type SessionUser } from '@kku/shared';

import { AuditLog, AuthSession, Authorized, ZodValidationPipe } from '../common';
import { IMPORT_MAX_UPLOAD_BYTES, ImportService } from './import.service';

// Admin surface for spreadsheet imports.
//
// GET  /admin/imports                     dataset list with row counts
// GET  /admin/imports/:dataset            columns, batches, key columns
// GET  /admin/imports/:dataset/template   generated .xlsx download
// POST /admin/imports/:dataset            multipart .xlsx upload
// POST /admin/imports/:dataset/start-over clears the dataset

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const UploadQuerySchema = z.object({
  /** Set by the UI's second-step confirmation after a shrink refusal. */
  allowShrink: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(false),
});

const TemplateQuerySchema = z.object({
  fromYear: z.coerce.number().int().min(1900).max(2200).optional(),
  toYear: z.coerce.number().int().min(1900).max(2200).optional(),
});

const StartOverBodySchema = z.object({
  /** Must equal the dataset's title; the service checks it. */
  confirmName: z.string().min(1),
});

interface ResponseLike {
  setHeader: (key: string, value: string) => void;
  send: (body: Buffer) => void;
}

function decodeFilename(name: string): string {
  // Multipart filenames arrive latin1-encoded; recover UTF-8 for Thai names.
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

@Controller('/admin/imports')
export class ImportController {
  constructor(private readonly service: ImportService) {}

  @Get()
  @Authorized('data_sources:read')
  async list() {
    return this.service.listDatasets();
  }

  @Get(':dataset')
  @Authorized('data_sources:read')
  async detail(@Param('dataset') dataset: string) {
    return this.service.getDataset(dataset);
  }

  @Get(':dataset/template')
  @Authorized('data_sources:read')
  async template(
    @Param('dataset') dataset: string,
    @Query(new ZodValidationPipe(TemplateQuerySchema)) query: { fromYear?: number; toYear?: number },
    @Res() res: ResponseLike,
  ): Promise<void> {
    const { filename, bytes } = await this.service.getTemplate(dataset, query);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(bytes);
  }

  @Post(':dataset')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'import.upload', entityType: 'ImportBatch' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_UPLOAD_BYTES } }))
  async upload(
    @Param('dataset') dataset: string,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @Query(new ZodValidationPipe(UploadQuerySchema)) query: { allowShrink: boolean },
    @AuthSession() user: SessionUser,
  ) {
    if (!file) {
      throw new ApiError('VALIDATION_FAILED', 'No file was uploaded (expected multipart field "file").');
    }
    return this.service.uploadFile({
      datasetSlug: dataset,
      originalFilename: decodeFilename(file.originalname),
      bytes: file.buffer,
      uploadedByUserId: user.userId,
      allowShrink: query.allowShrink,
    });
  }

  @Post(':dataset/start-over')
  @Authorized('imports:destroy')
  @AuditLog({ action: 'import.start_over', entityType: 'ImportBatch' })
  async startOver(
    @Param('dataset') dataset: string,
    @Body(new ZodValidationPipe(StartOverBodySchema)) body: { confirmName: string },
    @AuthSession() user: SessionUser,
  ) {
    return this.service.startOver(dataset, body.confirmName, user.userId);
  }
}
