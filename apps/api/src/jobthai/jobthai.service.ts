import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { ApiError, S3Storage } from '@kku/shared';
import { parseJobThaiSheet } from '@kku/shared/src/jobthai/parse-sheet';
import { prisma } from '@kku/db';

import { IngestionQueueService } from '../data-sources/ingestion-queue.service';

// ─────────────────────────────────────────────────────────────────────────────
// JobThai batch management.
//
// Upload validates, stores and enqueues; the CONNECTOR does the parsing. That
// keeps exactly one code path reading a sheet into job_postings, and the run
// shows up in /admin/data-sources history like every other connector run.
// ─────────────────────────────────────────────────────────────────────────────

/** Collaborators, injected so the unit tests need no database and no MinIO. */
export interface JobThaiServiceDeps {
  findByHash: (contentHash: string) => Promise<{ id: string } | null>;
  createBatch: (data: Record<string, unknown>) => Promise<{ id: string }>;
  putObject: (args: { bucket: string; key: string; body: Buffer; contentType: string }) => Promise<void>;
  enqueue: (userId: string | null) => Promise<void>;
}

export interface IngestResult {
  batchId: string;
  deduplicated: boolean;
  rowCount: number;
}

/** The files are 4.2-5.4 MB. 25 MB is headroom without inviting a
 *  whole-year dump through a synchronous request. */
export const JOBTHAI_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Injectable()
export class JobThaiService implements OnModuleInit {
  private readonly logger = new Logger(JobThaiService.name);
  private storage?: S3Storage;
  private bucket = 'csv-uploads';
  private readonly deps: JobThaiServiceDeps;

  constructor(
    private readonly config?: ConfigService,
    private readonly ingestion?: IngestionQueueService,
    deps?: Partial<JobThaiServiceDeps>,
  ) {
    this.deps = {
      findByHash: deps?.findByHash ?? ((h) => prisma.jobThaiBatch.findUnique({ where: { contentHash: h }, select: { id: true } })),
      createBatch: deps?.createBatch ?? ((d) => prisma.jobThaiBatch.create({ data: d as never, select: { id: true } })),
      putObject:
        deps?.putObject ??
        ((a) => {
          if (!this.storage) throw new Error('JobThaiService storage not initialised');
          return this.storage.putObject(a).then(() => undefined);
        }),
      enqueue: deps?.enqueue ?? ((userId) => this.ingestion!.enqueueManual('jobthai', userId ?? 'system').then(() => undefined)),
    };
  }

  onModuleInit(): void {
    if (!this.config) return;
    this.storage = new S3Storage({
      endpoint: this.required('MINIO_ENDPOINT'),
      region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
      accessKeyId: this.required('MINIO_ACCESS_KEY'),
      secretAccessKey: this.required('MINIO_SECRET_KEY'),
      publicEndpoint: this.config.get<string>('MINIO_PUBLIC_ENDPOINT') || undefined,
    });
    this.bucket = this.config.get<string>('MINIO_BUCKET_CSV_UPLOADS') ?? 'csv-uploads';
  }

  async ingestFile(input: {
    originalFilename: string;
    bytes: Buffer;
    uploadedByUserId: string | null;
  }): Promise<IngestResult> {
    const ext = (input.originalFilename.split('.').pop() ?? '').toLowerCase();
    if (ext !== 'xlsx') {
      throw new ApiError('VALIDATION_FAILED', `Unsupported file type ".${ext || '(none)'}". JobThai drops must be .xlsx.`);
    }
    if (input.bytes.length < 4) throw new ApiError('VALIDATION_FAILED', 'Uploaded file is empty.');
    if (input.bytes.length > JOBTHAI_MAX_UPLOAD_BYTES) {
      throw new ApiError('VALIDATION_FAILED', `File exceeds the ${JOBTHAI_MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`);
    }

    // Validate the HEADERS BEFORE storing anything. The operator is standing
    // there watching the upload; accepting a wrong-columns file and failing
    // asynchronously would send them to a job log to learn that Province was
    // missing.
    const parsed = parseJobThaiSheet(input.bytes);
    if (!parsed.ok) throw new ApiError('VALIDATION_FAILED', parsed.error);

    const contentHash = createHash('sha256').update(input.bytes).digest('hex');
    const existing = await this.deps.findByHash(contentHash);
    if (existing) {
      return { batchId: existing.id, deduplicated: true, rowCount: parsed.rows.length };
    }

    const key = `jobthai/${contentHash}.xlsx`;
    await this.deps.putObject({
      bucket: this.bucket,
      key,
      body: input.bytes,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const batch = await this.deps.createBatch({
      filename: input.originalFilename,
      contentHash,
      storageKey: key,
      fileSize: input.bytes.byteLength,
      rowCount: parsed.rows.length,
      receivedDate: new Date(),
      status: 'PENDING',
      uploadedByUserId: input.uploadedByUserId,
    });

    await this.deps.enqueue(input.uploadedByUserId);
    this.logger.log(`jobthai batch ${batch.id} accepted: ${parsed.rows.length} rows, ${parsed.duplicatesDropped} duplicates dropped`);
    return { batchId: batch.id, deduplicated: false, rowCount: parsed.rows.length };
  }

  async list(limit = 30) {
    const batches = await prisma.jobThaiBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, filename: true, rowCount: true, fileSize: true, receivedDate: true,
        status: true, parseError: true, createdAt: true,
        uploadedBy: { select: { name: true, email: true } },
        _count: { select: { postings: true } },
      },
    });
    return batches.map((b) => ({
      id: b.id,
      filename: b.filename,
      rowCount: b.rowCount,
      fileSize: b.fileSize,
      receivedDate: b.receivedDate,
      status: b.status,
      parseError: b.parseError,
      createdAt: b.createdAt,
      uploadedBy: b.uploadedBy?.name ?? b.uploadedBy?.email ?? null,
      postingsLoaded: b._count.postings,
    }));
  }

  async remove(id: string): Promise<{ removed: boolean; postingsDeleted: number }> {
    const batch = await prisma.jobThaiBatch.findUnique({
      where: { id },
      select: { id: true, storageKey: true, _count: { select: { postings: true } } },
    });
    if (!batch) throw new ApiError('NOT_FOUND', `JobThai batch ${id} not found.`);
    const postingsDeleted = batch._count.postings;
    // Postings cascade via the FK. JobThaiOccupation rows are left intact —
    // they are derived from the union of all batches, and phase 2 recomputes
    // their counts on the next run.
    await prisma.jobThaiBatch.delete({ where: { id } });
    if (this.storage) {
      await this.storage.deleteObject(this.bucket, batch.storageKey).catch((e: unknown) => {
        // A missing object is not a reason to fail the delete: the row is the
        // record of truth and it is already gone.
        this.logger.warn(`jobthai: could not delete s3 object ${batch.storageKey}: ${(e as Error).message}`);
      });
    }
    return { removed: true, postingsDeleted };
  }

  private required(key: string): string {
    const v = this.config?.get<string>(key);
    if (!v) throw new Error(`${key} is required by JobThaiService`);
    return v;
  }
}
