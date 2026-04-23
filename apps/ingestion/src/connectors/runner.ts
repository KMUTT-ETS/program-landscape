import { Logger } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';
import type {
  Connector,
  ConnectorContext,
  IngestionRunTrigger,
  NormalizedRecord,
} from '@kku/shared';
import { NonRetryableError } from './base';

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
        `No DataSource row for slug "${opts.dataSourceSlug}". Run \`pnpm db:seed\` — the catalog in @kku/shared drives the seed.`,
      );
    }

    const run = await prisma.ingestionRun.create({
      data: {
        dataSourceId: dataSource.id,
        trigger: opts.trigger,
        triggeredByUserId: opts.triggeredByUserId ?? null,
        status: 'RUNNING',
        startedAt: new Date(),
        attempt: opts.attempt ?? 1,
      },
    });

    const ctx: ConnectorContext = {
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
      const isNonRetryable = err instanceof NonRetryableError;
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof NonRetryableError ? err.code : 'UNCAUGHT';

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
