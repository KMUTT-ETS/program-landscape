import { Logger } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';
import type {
  Connector,
  ConnectorContext,
  IngestionRunTrigger,
  NormalizedRecord,
} from '@kku/shared';
import { OrganizationNotConfiguredError, connectorModeEnvKey, mockRunsAllowed } from '@kku/shared';
import { NonRetryableError } from './base';

/** A fresh install with no organisation profile: retrying cannot help until an admin fills it in. */
export function isOrganizationNotConfigured(err: unknown): boolean {
  return err instanceof OrganizationNotConfiguredError;
}

// ConnectorRunner is the single entry point for executing a connector.
// The BullMQ worker calls it for scheduled jobs; the /pdf/run-now admin
// endpoint calls it for manual triggers. Both paths flow through here
// so there's exactly one place that writes IngestionRun rows.
//
// Lifecycle:
//   1. Create IngestionRun row (status=RUNNING, startedAt=now)
//   2. healthCheck — skip the run (status=SKIPPED) if the source is
//      unhealthy, so we don't scribble half-data into domain tables.
//   3. fetch(since=lastSyncedAt) → RawRecord[]
//   4. transform each RawRecord → NormalizedRecord[]
//   5. load(all normalized) → LoadResult
//   6. Update IngestionRun (status=SUCCEEDED, durationMs, counts)
//      and DataSource.lastSyncedAt
//
// On failure:
//   - NonRetryableError → IngestionRun(status=FAILED, errorCode) and DO
//     NOT re-throw; BullMQ's retry machinery should not fire.
//   - anything else → IngestionRun(status=FAILED) and re-throw so
//     BullMQ schedules a retry with exponential backoff.

export interface RunOptions {
  dataSourceSlug: string;
  trigger: IngestionRunTrigger;
  triggeredByUserId?: string | null;
  attempt?: number;
}

export interface RunOutcome {
  runId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  recordsLoaded: number;
  recordsFailed: number;
}

export class ConnectorRunner {
  private readonly logger = new Logger('ConnectorRunner');

  constructor(private readonly registry: Map<string, Connector>) {}

  async run(opts: RunOptions): Promise<RunOutcome> {
    const connector = this.registry.get(opts.dataSourceSlug);
    if (!connector) {
      throw new Error(
        `No connector registered for slug "${opts.dataSourceSlug}". Add it to apps/ingestion/src/connectors/sources/ and the registry.`,
      );
    }

    const dataSource = await prisma.dataSource.findUnique({
      where: { slug: opts.dataSourceSlug },
    });
    if (!dataSource) {
      throw new Error(
        `No DataSource row for slug "${opts.dataSourceSlug}". Run \`pnpm data-sources:sync --apply\` — the catalog in @kku/shared drives it.`,
      );
    }

    // A mock implementation writes invented rows. Refuse unless the operator
    // explicitly allowed it; record one SKIPPED run and touch nothing else
    // (no lastSyncedAt bump, no fetch).
    if (connector.mocked && !mockRunsAllowed()) {
      const now = new Date();
      // Same FK guard as the normal path: an unknown trigger user is recorded as null.
      const skipUser = opts.triggeredByUserId
        ? await prisma.user.findUnique({ where: { id: opts.triggeredByUserId }, select: { id: true } })
        : null;
      const skipped = await prisma.ingestionRun.create({
        data: {
          dataSourceId: dataSource.id,
          trigger: opts.trigger,
          triggeredByUserId: skipUser?.id ?? null,
          status: 'SKIPPED',
          startedAt: now,
          completedAt: now,
          errorCode: 'MOCK_NOT_ALLOWED',
          errorMessage:
            `This source has no real connection configured. Set ${connectorModeEnvKey(opts.dataSourceSlug)}=real ` +
            'and its connection settings, or load the matching spreadsheet dataset.',
        },
      });
      return { runId: skipped.id, status: 'SKIPPED', recordsLoaded: 0, recordsFailed: 0 };
    }

    // ── Orphan reaper ───────────────────────────────────────────────────
    // A run row is created RUNNING and only closed when the connector
    // finishes. If the worker froze or was restarted mid-run (exactly the
    // kku-evaluations freeze), the row is left RUNNING forever — it skews
    // freshness AND would block the in-flight guard below indefinitely.
    // Reap any RUNNING row for this source older than STALE_RUN_MS. No real
    // connector runs anywhere near this long (the heaviest, kku-evaluations,
    // is ~11 min), so the threshold can't catch a legitimately-live run.
    const STALE_RUN_MS = 30 * 60_000;
    const reaped = await prisma.ingestionRun.updateMany({
      where: {
        dataSourceId: dataSource.id,
        status: 'RUNNING',
        startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
      },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorCode: 'ORPHANED',
        errorMessage:
          'Run exceeded the max-duration ceiling without completing — reaped as orphaned ' +
          '(worker froze or was restarted mid-run).',
      },
    });
    if (reaped.count > 0) {
      this.logger.warn(
        `[${opts.dataSourceSlug}] reaped ${reaped.count} orphaned RUNNING run(s) older than ${STALE_RUN_MS / 60_000}m`,
      );
    }

    // ── In-flight guard ─────────────────────────────────────────────────
    // If a *recent* RUNNING row still exists, another execution of this
    // same slug is already underway — a stalled-then-reclaimed copy, an
    // overlapping cron fire, or a manual "Run now" racing the scheduler.
    // Running a second copy is what amplified into the freeze, so skip.
    // (Single-process worker: the find→create window is tiny, and the
    //  30-min BullMQ lock now prevents the stall-requeue that drove most
    //  overlaps in the first place.)
    const inFlight = await prisma.ingestionRun.findFirst({
      where: { dataSourceId: dataSource.id, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, startedAt: true },
    });
    if (inFlight) {
      this.logger.warn(
        `[${opts.dataSourceSlug}] skipping — a run is already in flight ` +
          `(run ${inFlight.id}, started ${inFlight.startedAt?.toISOString() ?? 'unknown'})`,
      );
      return { runId: inFlight.id, status: 'SKIPPED', recordsLoaded: 0, recordsFailed: 0 };
    }

    // Guard the FK: a triggeredByUserId that isn't a real users row would make
    // ingestion_runs.create throw on ingestion_runs_triggered_by_user_id_fkey
    // and fail the entire run before any work. Degrade to null (the run is still
    // recorded + audited) rather than abort. Covers manual enqueues that pass a
    // synthetic/ops id.
    let triggeredByUserId = opts.triggeredByUserId ?? null;
    if (triggeredByUserId) {
      const triggerUser = await prisma.user.findUnique({
        where: { id: triggeredByUserId },
        select: { id: true },
      });
      if (!triggerUser) {
        this.logger.warn(
          `[${opts.dataSourceSlug}] triggeredByUserId ${triggeredByUserId} not found — recording run with null trigger user`,
        );
        triggeredByUserId = null;
      }
    }

    const run = await prisma.ingestionRun.create({
      data: {
        dataSourceId: dataSource.id,
        trigger: opts.trigger,
        triggeredByUserId,
        status: 'RUNNING',
        startedAt: new Date(),
        attempt: opts.attempt ?? 1,
      },
    });

    const ctx: ConnectorContext = {
      runId: run.id,
      dataSource: {
        id: dataSource.id,
        slug: dataSource.slug,
        name: dataSource.name,
        baseUrl: dataSource.baseUrl,
        lastSyncedAt: dataSource.lastSyncedAt,
      },
      log: {
        info: (msg, meta) => this.logger.log(`[${opts.dataSourceSlug}] ${msg}` + (meta ? ` ${JSON.stringify(meta)}` : '')),
        warn: (msg, meta) => this.logger.warn(`[${opts.dataSourceSlug}] ${msg}` + (meta ? ` ${JSON.stringify(meta)}` : '')),
        error: (msg, meta) => this.logger.error(`[${opts.dataSourceSlug}] ${msg}` + (meta ? ` ${JSON.stringify(meta)}` : '')),
      },
    };

    const startedAt = Date.now();

    try {
      const health = await connector.healthCheck(ctx);
      if (!health.ok) {
        await prisma.ingestionRun.update({
          where: { id: run.id },
          data: {
            status: 'SKIPPED',
            completedAt: new Date(),
            durationMs: Date.now() - startedAt,
            errorCode: 'UNHEALTHY',
            errorMessage: health.message ?? 'Connector reported unhealthy',
          },
        });
        return { runId: run.id, status: 'SKIPPED', recordsLoaded: 0, recordsFailed: 0 };
      }

      const rawRecords = await connector.fetch(ctx, dataSource.lastSyncedAt ?? undefined);

      const normalizedBatches: NormalizedRecord[][] = [];
      for (const raw of rawRecords) {
        normalizedBatches.push(await connector.transform(ctx, raw));
      }
      const normalized = normalizedBatches.flat();

      const result = await connector.load(ctx, normalized);

      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
          recordsFetched: rawRecords.length,
          recordsLoaded: result.recordsLoaded,
          recordsFailed: result.recordsFailed,
          pdfDocumentId: result.pdfDocumentId ?? null,
          metadata: (result.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });

      await prisma.dataSource.update({
        where: { id: dataSource.id },
        data: { lastSyncedAt: new Date() },
      });

      return {
        runId: run.id,
        status: 'SUCCEEDED',
        recordsLoaded: result.recordsLoaded,
        recordsFailed: result.recordsFailed,
      };
    } catch (err) {
      const orgMissing = isOrganizationNotConfigured(err);
      const isNonRetryable = err instanceof NonRetryableError || orgMissing;
      const message = err instanceof Error ? err.message : String(err);
      let code = 'UNCAUGHT';
      if (err instanceof NonRetryableError) code = err.code;
      else if (orgMissing) code = 'ORG_NOT_CONFIGURED';

      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
          errorCode: code,
          errorMessage: message.slice(0, 2000),
        },
      });

      if (isNonRetryable) {
        // Swallow — the IngestionRun row tells the story; no retry.
        return { runId: run.id, status: 'FAILED', recordsLoaded: 0, recordsFailed: 0 };
      }
      throw err;
    }
  }
}
