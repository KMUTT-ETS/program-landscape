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
import { refreshJobThaiDerived, type RefreshSummary } from '../../../jobthai/refresh';

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
//
// END OF RUN (2026-09-13). load() then (1) drains any batch that became PENDING
// while this run was underway and (2) rebuilds every derived layer —
// occupations, skill matches, programme links — from the postings that now
// exist. (1) matters because an upload of several files queues one run per
// file, the worker runs 4 jobs at once, and the runner's in-flight guard SKIPS
// every overlapping copy: the surviving run must pick up its siblings' files.
// (2) is what makes an upload or a delete sufficient on its own; before it,
// prod loaded 47,631 postings and every Deep-Dive still showed no demand.
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
  /** Rebuilds occupations, skill matches and programme links. */
  refresh?: (opts: { runId: string; log: (line: string) => void }) => Promise<RefreshSummary>;
}

/** Safety bound on drain rounds; each round needs a new upload to land mid-run. */
const MAX_DRAIN_ROUNDS = 10;

/**
 * Rebuilds per run. One rebuild is ~11 minutes at 47k postings (measured on
 * dev, 2026-09-13: 600 s of it the skill scan). The runner's stale-run reaper
 * and the BullMQ lock are both 30 minutes, so a third rebuild would let a
 * second copy of this connector start alongside the first. Batches arriving
 * after the last allowed rebuild still load; the run records refreshStale and
 * the next upload, delete or "Run now" brings the derived layers up to date.
 */
export const JOBTHAI_MAX_REFRESHES_PER_RUN = 2;

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
      refresh: deps?.refresh ?? refreshJobThaiDerived,
    };
  }

  // A manual-upload connector has no upstream to ping. How many batches are
  // waiting is the only health signal that means anything.
  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    const pending = await this.deps.listPendingBatches();
    return { ok: true, message: `${pending.length} batch(es) pending parse` };
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    return this.rawsFor(ctx, await this.deps.listPendingBatches());
  }

  private async rawsFor(ctx: ConnectorContext, pending: PendingBatch[]): Promise<RawRecord[]> {
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
    const first = await this.loadRows(ctx, normalized);
    let recordsFetched = first.recordsFetched;
    let recordsLoaded = first.recordsLoaded;
    let recordsFailed = first.recordsFailed;
    let batches = first.batches;
    let drainedBatches = 0;
    let refresh: RefreshSummary | undefined;
    let refreshes = 0;
    let refreshStale = false;

    for (let round = 0; round < MAX_DRAIN_ROUNDS; round++) {
      // Batches uploaded while this run was busy — their own runs were skipped.
      const late = await this.drain(ctx);
      recordsFetched += late.recordsFetched;
      recordsLoaded += late.recordsLoaded;
      recordsFailed += late.recordsFailed;
      batches += late.batches;
      drainedBatches += late.batches;
      const needsRefresh = late.batches > 0 || refresh === undefined;
      if (!needsRefresh) break;
      if (refreshes >= JOBTHAI_MAX_REFRESHES_PER_RUN) {
        refreshStale = true;
        ctx.log.warn('jobthai: rebuild cap reached — derived layers do not include the latest batches yet', {
          refreshes,
          drainedBatches,
        });
        break;
      }
      ctx.log.info('jobthai: rebuilding derived layers', { round, drainedBatches });
      refresh = await this.deps.refresh!({ runId: ctx.runId, log: (line) => ctx.log.info(`jobthai refresh: ${line}`) });
      refreshes += 1;
      // A file may have landed during the rebuild, which takes minutes.
    }

    return {
      recordsFetched,
      recordsLoaded,
      recordsFailed,
      metadata: { batches, drainedBatches, chunkSize: LOAD_CHUNK, firstError: first.firstError, refresh, refreshes, refreshStale },
    };
  }

  /** Fetch → transform → load for whatever is PENDING right now. */
  private async drain(ctx: ConnectorContext): Promise<{ recordsFetched: number; recordsLoaded: number; recordsFailed: number; batches: number }> {
    const pending = await this.deps.listPendingBatches();
    if (pending.length === 0) return { recordsFetched: 0, recordsLoaded: 0, recordsFailed: 0, batches: 0 };
    ctx.log.info('jobthai: batches arrived during the run', { count: pending.length });
    // Exactly the batches just listed — a second lookup could disagree.
    const raws = await this.rawsFor(ctx, pending);
    const normalized: NormalizedRecord[] = [];
    for (const raw of raws) normalized.push(...(await this.transform(ctx, raw)));
    const r = await this.loadRows(ctx, normalized);
    return { recordsFetched: r.recordsFetched, recordsLoaded: r.recordsLoaded, recordsFailed: r.recordsFailed, batches: raws.length };
  }

  private async loadRows(
    ctx: ConnectorContext,
    normalized: NormalizedRecord[],
  ): Promise<{ recordsFetched: number; recordsLoaded: number; recordsFailed: number; batches: number; firstError: string | null }> {
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
      batches: batchIds.length,
      firstError,
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
