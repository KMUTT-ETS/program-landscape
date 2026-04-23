import type { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { prisma } from '@kku/db';
import type { IngestionJobData, IngestionJobResult } from './queue';

// Reads DataSource rows from the DB at boot and registers one BullMQ
// repeatable job per source with cadenceCron set + scheduleEnabled=true.
// We intentionally DO NOT read the cron strings from `@kku/shared`'s
// catalog here — the DB is the mutable source of truth, so ops can
// edit cadence via the admin UI and have it take effect without a code
// deploy.
//
// Each call to registerSchedules() removes existing repeats first (by
// the same job name) so changes from the admin UI flow through on the
// next bounce. Hot reconfiguration without a bounce is deferred — the
// overhead of a BullMQ pub-sub on DataSource updates isn't worth it for
// a daily-cadence service.

export class IngestionScheduler {
  private readonly logger = new Logger('IngestionScheduler');

  constructor(private readonly queue: Queue<IngestionJobData, IngestionJobResult>) {}

  async registerSchedules(): Promise<{ registered: number; skipped: number }> {
    const sources = await prisma.dataSource.findMany({
      where: {
        scheduleEnabled: true,
        status: { not: 'disabled' },
        cadenceCron: { not: null },
      },
    });

    // Clear existing repeats so stale schedules vanish.
    const existing = await this.queue.getRepeatableJobs();
    for (const rep of existing) {
      await this.queue.removeRepeatableByKey(rep.key);
    }

    let registered = 0;
    let skipped = 0;

    for (const src of sources) {
      if (!src.cadenceCron) {
        skipped++;
        continue;
      }
      await this.queue.add(
        `ds:${src.slug}`,
        {
          dataSourceSlug: src.slug,
          trigger: 'SCHEDULED',
        },
        {
          repeat: {
            pattern: src.cadenceCron,
            // IDs by (name, pattern) so dedup across process restarts.
            // BullMQ stores them keyed like that internally.
          },
        },
      );
      this.logger.log(`Scheduled ${src.slug} @ ${src.cadenceCron}`);
      registered++;
    }

    return { registered, skipped };
  }

  // Enqueues a one-off manual run. Used by the NestJS admin controller
  // in apps/api via a direct Queue handle.
  async enqueueManual(dataSourceSlug: string, triggeredByUserId: string): Promise<string> {
    const job = await this.queue.add(
      `manual:${dataSourceSlug}`,
      { dataSourceSlug, trigger: 'MANUAL', triggeredByUserId },
      {
        // Manual runs should not inherit the default exponential retry —
        // an operator clicking "Run now" probably wants to know right
        // away if something's off, not have BullMQ silently retry.
        attempts: 1,
      },
    );
    return job.id ?? '';
  }
}
