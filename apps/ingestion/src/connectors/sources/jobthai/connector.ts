import { parseJobThaiSheet } from '@kku/shared/src/jobthai/parse-sheet';
import type {
  ConnectorContext,
  HealthStatus,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';
import { prisma } from '@kku/db';

import { CsvFileConnector } from '../../base/csv-file-connector';
import { NonRetryableError } from '../../base/base-connector';

// ─────────────────────────────────────────────────────────────────────────────
// JobThai — manual XLSX drops.
//
// Replaces a one-record ApiConnector stub whose load() wrote nothing. The
// 2026-05-01 supersession by kmitl-skill-mapping assumed JobThai meant a paid
// API we never bought; hand-delivered files give us province granularity,
// industry sector and explicit degree + field-of-study requirements, none of
// which kmitl-skill-mapping can provide.
//
// Lifecycle, per CsvFileConnector's contract: fetch() enumerates PENDING
// JobThaiBatch rows and reads their bytes from MinIO, transform() parses one
// batch into rows, load() writes job_postings.
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingBatch {
  id: string;
  contentHash: string;
  storageKey: string;
  receivedDate: Date;
}

/** Injected so the unit tests need neither MinIO nor a database. */
export interface JobThaiConnectorDeps {
  listPendingBatches: () => Promise<PendingBatch[]>;
  readObject: (storageKey: string) => Promise<Buffer>;
  writePostings?: (rows: Array<Record<string, unknown>>) => Promise<number>;
  markBatch?: (id: string, status: 'PARSING' | 'PARSED' | 'FAILED', detail?: string, rowCount?: number) => Promise<void>;
}

/** Chunk size for posting inserts. 47,643 sequential round-trips is the
 *  bottleneck the kku-research and kmitl-skill-mapping sessions both hit. */
const LOAD_CHUNK = 500;

export class JobThaiConnector extends CsvFileConnector {
  readonly slug = 'jobthai';
  readonly mocked = false;
  override readonly inputFormat = 'XLSX' as const;

  private readonly deps: JobThaiConnectorDeps;

  constructor(deps?: Partial<JobThaiConnectorDeps>) {
    super();
    this.deps = {
      listPendingBatches: deps?.listPendingBatches ?? defaultListPendingBatches,
      readObject: deps?.readObject ?? defaultReadObject,
      writePostings: deps?.writePostings ?? defaultWritePostings,
      markBatch: deps?.markBatch ?? defaultMarkBatch,
    };
  }

  // A manual-upload connector has no upstream to ping. How many batches are
  // waiting is the only health signal that means anything.
  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    const pending = await this.deps.listPendingBatches();
    return { ok: true, message: `${pending.length} batch(es) pending parse` };
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const pending = await this.deps.listPendingBatches();
    const out: RawRecord[] = [];
    for (const b of pending) {
      const bytes = await this.deps.readObject(b.storageKey);
      ctx.log.info('jobthai: read batch', { batchId: b.id, bytes: bytes.byteLength });
      out.push({
        externalId: b.contentHash,
        sourceTimestamp: b.receivedDate,
        data: { batchId: b.id, contentHash: b.contentHash, receivedDate: b.receivedDate, bytes },
      });
    }
    return out;
  }

  async transform(ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const { batchId, contentHash, receivedDate, bytes } = raw.data as {
      batchId: string;
      contentHash: string;
      receivedDate: Date;
      bytes: Buffer;
    };
    await this.deps.markBatch?.(batchId, 'PARSING');

    const parsed = parseJobThaiSheet(bytes);
    if (!parsed.ok) {
      // Deterministic: the same bytes will fail identically on every retry,
      // so short-circuit BullMQ and leave the operator a readable reason.
      await this.deps.markBatch?.(batchId, 'FAILED', parsed.error);
      throw new NonRetryableError('JOBTHAI_SHEET_INVALID', parsed.error, { batchId });
    }

    ctx.log.info('jobthai: parsed batch', {
      batchId,
      rows: parsed.rows.length,
      duplicatesDropped: parsed.duplicatesDropped,
      hasDateColumn: parsed.hasDateColumn,
    });

    const shortHash = contentHash.slice(0, 8);
    return parsed.rows.map((r, i) => ({
      target: 'job_postings',
      externalId: `${shortHash}:${i}`,
      freshnessDate: r.postedDate ?? receivedDate,
      payload: {
        jobThaiBatchId: batchId,
        title: r.title,
        province: r.province,
        jobCategory: r.jobCategory,
        jobSubcategory: r.jobSubcategory,
        businessType: r.businessType,
        descriptionRaw: r.descriptionRaw,
        qualificationRaw: r.qualificationRaw,
        requiredFieldsRaw: r.requiredFieldsRaw,
        minEducationLevel: r.minEducationLevel,
        // postedDate is NOT NULL in the schema. The 2026-09 drop carries no
        // date column, so it falls back to the batch receipt date with the
        // estimated flag set — honest, and no migration needed when JobThai
        // starts supplying real dates.
        postedDate: r.postedDate ?? receivedDate,
        postedDateEstimated: r.postedDate === null,
      },
    }));
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    const rows: Array<Record<string, unknown>> = normalized.map((n) => ({
      source: this.slug,
      externalId: n.externalId,
      freshnessDate: n.freshnessDate,
      // Without this every row fails realDataWhere() and is invisible to
      // every surface that filters on it, with no error and no empty state.
      ingestionRunId: ctx.runId,
      ...n.payload,
    }));

    let loaded = 0;
    let failed = 0;
    let firstError: string | null = null;
    for (let i = 0; i < rows.length; i += LOAD_CHUNK) {
      const chunk = rows.slice(i, i + LOAD_CHUNK);
      try {
        const written = (await this.deps.writePostings?.(chunk)) ?? 0;
        loaded += written;
        // A chunk that writes fewer rows than it was given had rejections
        // inside it. Counting only successes would report loaded=0 and
        // failed=0 on a run where every single upsert failed — which is
        // exactly what happened on the first live run here.
        failed += chunk.length - written;
      } catch (e) {
        failed += chunk.length;
        firstError ??= (e as Error).message;
        ctx.log.error('jobthai: chunk threw', { from: i, error: (e as Error).message });
      }
    }

    const batchIds = [...new Set(rows.map((r) => r.jobThaiBatchId as string).filter(Boolean))];
    for (const id of batchIds) {
      if (loaded === 0 && rows.length > 0) {
        // Never claim PARSED when nothing landed. The operator needs to see
        // FAILED with a reason, not a green batch holding zero postings.
        await this.deps.markBatch?.(
          id,
          'FAILED',
          firstError ?? `all ${rows.length} rows failed to load`,
          0,
        );
      } else {
        // rowCount is NOT touched here. It was set at upload time from the
        // parse and is per-batch; `loaded` is the total across every batch in
        // this run, so writing it would show 39,996 rows against a
        // 10,000-row file. Observed on the first multi-batch run.
        await this.deps.markBatch?.(id, 'PARSED');
      }
    }

    if (loaded === 0 && rows.length > 0) {
      throw new Error(`jobthai: every one of ${rows.length} rows failed to load. First error: ${firstError ?? 'unknown'}`);
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: { batches: batchIds.length, chunkSize: LOAD_CHUNK, firstError },
    };
  }
}

// ── Prisma/MinIO-backed defaults ───────────────────────────────────────────

async function defaultListPendingBatches(): Promise<PendingBatch[]> {
  return prisma.jobThaiBatch.findMany({
    where: { status: 'PENDING' },
    select: { id: true, contentHash: true, storageKey: true, receivedDate: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function defaultReadObject(storageKey: string): Promise<Buffer> {
  const { S3Storage } = await import('@kku/shared');
  const storage = new S3Storage({
    endpoint: requireEnv('MINIO_ENDPOINT'),
    region: process.env.MINIO_REGION ?? 'us-east-1',
    accessKeyId: requireEnv('MINIO_ACCESS_KEY'),
    secretAccessKey: requireEnv('MINIO_SECRET_KEY'),
  });
  // Defaulted rather than required, matching JobThaiService — the bucket name
  // is not a secret and a missing override should not stop a connector run.
  const bucket = process.env.MINIO_BUCKET_CSV_UPLOADS ?? 'csv-uploads';
  return storage.getObject({ bucket, key: storageKey });
}

async function defaultWritePostings(rows: Array<Record<string, unknown>>): Promise<number> {
  const results = await Promise.allSettled(
    rows.map((r) =>
      prisma.jobPosting.upsert({
        where: { source_externalId: { source: r.source as string, externalId: r.externalId as string } },
        create: r as never,
        update: r as never,
      }),
    ),
  );
  const rejected = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
  if (rejected.length > 0) {
    // allSettled makes it very easy to lose the reason entirely. Throw the
    // first one so the caller can record it rather than reporting a silent
    // zero.
    throw new Error(
      `${rejected.length} of ${rows.length} upserts failed. First: ${String((rejected[0]!.reason as Error).message).split('\n').slice(0, 3).join(' ')}`,
    );
  }
  return results.length;
}

async function defaultMarkBatch(
  id: string,
  status: 'PARSING' | 'PARSED' | 'FAILED',
  detail?: string,
  rowCount?: number,
): Promise<void> {
  await prisma.jobThaiBatch.update({
    where: { id },
    data: {
      status,
      parseError: status === 'FAILED' ? (detail ?? 'unknown parse failure') : null,
      ...(rowCount === undefined ? {} : { rowCount }),
    },
  });
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set — required by the JobThai connector.`);
  return v;
}
