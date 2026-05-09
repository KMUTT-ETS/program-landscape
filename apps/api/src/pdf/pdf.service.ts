import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kku/db';
import {
  ApiError,
  GotenbergClient,
  PdfGenerationError,
  PdfGenerationService,
  S3Storage,
  TemplateRegistry,
  stableHash,
  type RenderHtmlRequest,
  type PdfResult,
} from '@kku/shared';
import { registerBuiltinTemplates } from '@kku/pdf-templates';
import { gotenbergSemaphore } from '../common/semaphore';

// NestJS wrapper around the core @kku/shared PdfGenerationService. This
// layer:
//   - reads config and wires the dependencies (Gotenberg URL, MinIO
//     credentials, template registry)
//   - writes pdf_generations rows so the admin dashboard has something
//     to render
//   - persists generated PDFs to MinIO and cuts a signed URL
//   - maps PdfGenerationError → ApiError so the global filter can emit
//     a consistent envelope
//
// Modules that need to emit a PDF DO NOT instantiate Gotenberg directly.
// They inject this service and call generateAndPersist().
@Injectable()
export class PdfService implements OnModuleInit {
  private readonly logger = new Logger(PdfService.name);
  private core!: PdfGenerationService;
  private storage!: S3Storage;
  private bucket!: string;
  private signedUrlTtlSeconds!: number;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const registry = new TemplateRegistry();
    registerBuiltinTemplates(registry);

    const gotenberg = new GotenbergClient({
      baseUrl: this.required('GOTENBERG_URL'),
      requestTimeoutMs: Number(this.config.get('GOTENBERG_REQUEST_TIMEOUT_MS') ?? 55_000),
    });

    this.core = new PdfGenerationService({
      gotenberg,
      registry,
      buildVersion: process.env.APP_BUILD_VERSION ?? 'dev',
    });

    this.storage = new S3Storage({
      endpoint: this.required('MINIO_ENDPOINT'),
      region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
      accessKeyId: this.required('MINIO_ACCESS_KEY'),
      secretAccessKey: this.required('MINIO_SECRET_KEY'),
      publicEndpoint: this.config.get<string>('MINIO_PUBLIC_ENDPOINT') || undefined,
    });

    this.bucket = this.required('MINIO_BUCKET_PDF_OUTPUT');
    this.signedUrlTtlSeconds = Number(
      this.config.get('PDF_SIGNED_URL_TTL_SECONDS') ?? 900,
    );
  }

  listTemplates() {
    return this.core.listTemplates();
  }

  async generateAndPersist(
    req: RenderHtmlRequest,
    requesterId: string | null,
  ): Promise<PdfResult> {
    const dataHash = stableHash(req.data);
    const log = await prisma.pdfGeneration.create({
      data: {
        templateName: req.templateName,
        templateVersion: 'pending',
        requesterId,
        scopeLevel: req.scope?.level,
        scopeId: req.scope?.id ?? null,
        dataHash,
        status: 'RENDERING',
      },
    });

    // Cap concurrent Gotenberg renders across the whole instance.
    // Headless Chromium peaks at ~200 MB per render; 4 parallel is the
    // ceiling on a 32 GB / 8-core box without crowding out other
    // services. Excess requests queue here (FIFO). Surfaces depth at
    // /admin/system-status so a Council session that goes deep into the
    // queue is visible to ops.
    const release = await gotenbergSemaphore().acquire();
    try {
      const result = await this.core.renderHtml(req);

      const key = `${req.templateName}/${log.id}.pdf`;
      await this.storage.putObject({
        bucket: this.bucket,
        key,
        body: result.buffer,
        contentType: 'application/pdf',
        metadata: {
          template: req.templateName,
          templateVersion: result.templateVersion,
          requester: requesterId ?? 'system',
        },
      });

      const signedUrl = await this.storage.getSignedDownloadUrl({
        bucket: this.bucket,
        key,
        ttlSeconds: this.signedUrlTtlSeconds,
      });

      const expiresAt = new Date(Date.now() + this.signedUrlTtlSeconds * 1000);

      await prisma.pdfGeneration.update({
        where: { id: log.id },
        data: {
          status: 'SUCCEEDED',
          templateVersion: result.templateVersion,
          byteSize: result.byteSize,
          pageCount: result.pageCount,
          generationDurationMs: result.generationDurationMs,
          storageBucket: this.bucket,
          storageKey: key,
          completedAt: new Date(),
        },
      });

      return {
        ...result,
        storageKey: key,
        signedUrl,
        signedUrlExpiresAt: expiresAt,
      };
    } catch (err) {
      await this.markFailed(log.id, err).catch((e) =>
        this.logger.error(`Failed to update pdf_generations: ${e?.message}`),
      );
      throw toApiError(err);
    } finally {
      release();
    }
  }

  async getSignedUrl(generationId: string): Promise<{
    url: string;
    expiresAt: Date;
    byteSize: number;
    pageCount: number;
    templateName: string;
  }> {
    const row = await prisma.pdfGeneration.findUnique({ where: { id: generationId } });
    if (!row || !row.storageKey || !row.storageBucket) {
      throw new ApiError('NOT_FOUND', `PDF generation ${generationId} not found or not yet succeeded`);
    }
    const url = await this.storage.getSignedDownloadUrl({
      bucket: row.storageBucket,
      key: row.storageKey,
      ttlSeconds: this.signedUrlTtlSeconds,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + this.signedUrlTtlSeconds * 1000),
      byteSize: row.byteSize ?? 0,
      pageCount: row.pageCount ?? 0,
      templateName: row.templateName,
    };
  }

  async listRecent(limit = 50) {
    return prisma.pdfGeneration.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        templateName: true,
        templateVersion: true,
        status: true,
        byteSize: true,
        pageCount: true,
        generationDurationMs: true,
        requesterId: true,
        createdAt: true,
        completedAt: true,
        errorCode: true,
      },
    });
  }

  private async markFailed(id: string, err: unknown) {
    const code = err instanceof PdfGenerationError ? err.code : 'PDF_INTERNAL';
    const message =
      err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    await prisma.pdfGeneration.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorCode: code,
        errorMessage: message,
        completedAt: new Date(),
      },
    });
  }

  private required(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new Error(`Missing required env var: ${key}`);
    return v;
  }
}

function toApiError(err: unknown): Error {
  if (err instanceof PdfGenerationError) {
    const mapped: Record<string, string> = {
      PDF_TEMPLATE_NOT_FOUND: 'NOT_FOUND',
      PDF_TEMPLATE_DATA_INVALID: 'VALIDATION_FAILED',
      PDF_RENDER_TIMEOUT: 'UPSTREAM_UNAVAILABLE',
      PDF_UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
      PDF_UPSTREAM_REJECTED: 'INTERNAL',
      PDF_STORAGE_FAILED: 'INTERNAL',
      PDF_INTERNAL: 'INTERNAL',
    };
    return new ApiError(
      (mapped[err.code] ?? 'INTERNAL') as ConstructorParameters<typeof ApiError>[0],
      err.message,
      { pdfCode: err.code, ...err.details },
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}
