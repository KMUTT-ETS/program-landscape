import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';
import { z } from 'zod';
import {
  RUN_LOG_PAGE_SIZE,
  RunLogQuerySchema,
  RunLogResponseSchema,
  type RunLogQuery,
  type RunLogResponse,
  type SessionUser,
} from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';
import { IngestionQueueService } from './ingestion-queue.service';

type RunBucket = { status: string; createdAt: Date; durationMs: number | null };
function bucketByDay(runs: RunBucket[]): Array<{ day: string; succeeded: number; failed: number }> {
  const days: Record<string, { succeeded: number; failed: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    days[key] = { succeeded: 0, failed: 0 };
  }
  for (const r of runs) {
    const key = r.createdAt.toISOString().slice(0, 10);
    if (!days[key]) continue;
    if (r.status === 'SUCCEEDED') days[key].succeeded++;
    else if (r.status === 'FAILED') days[key].failed++;
  }
  return Object.entries(days).map(([day, v]) => ({ day, ...v }));
}

const PatchBodySchema = z.object({
  cadenceCron: z.string().min(1).nullable().optional(),
  scheduleEnabled: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'error', 'disabled', 'mocked']).optional(),
  ownerContact: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
});
type PatchBody = z.infer<typeof PatchBodySchema>;

const BulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  status: z.enum(['active', 'paused']),
});
type BulkStatusBody = z.infer<typeof BulkStatusSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Admin surface for the ingestion framework. ANALYST + ADMIN see it; the
// web page at /admin/data-sources is the UI.
// ──────────────────────────────────────────────────────────────────────────

@Controller('/data-sources')
export class DataSourcesController {
  constructor(private readonly queue: IngestionQueueService) {}

  @Get()
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'internal', name: 'Ingestion Framework' }] })
  async list() {
    return prisma.dataSource.findMany({
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { ingestionRuns: true } },
      },
    });
  }

  @Get('admin/overview')
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'internal', name: 'Ingestion Framework' }] })
  async overview() {
    const [total, active, paused, erroring, runsLast24h, failuresLast24h] = await Promise.all([
      prisma.dataSource.count(),
      prisma.dataSource.count({ where: { status: 'active' } }),
      prisma.dataSource.count({ where: { status: 'paused' } }),
      prisma.dataSource.count({ where: { status: 'error' } }),
      prisma.ingestionRun.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
      prisma.ingestionRun.count({
        where: {
          status: 'FAILED',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);
    return { total, active, paused, erroring, runsLast24h, failuresLast24h };
  }

  @Get('by-slug/:slug/stats')
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'internal', name: 'Ingestion Framework' }] })
  async slugStats(@Param('slug') slug: string) {
    const source = await prisma.dataSource.findUnique({ where: { slug } });
    if (!source) throw new NotFoundException();
    return this.computeStats(source.id, source);
  }

  @Get(':id/stats')
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'internal', name: 'Ingestion Framework' }] })
  async stats(@Param('id') id: string) {
    const source = await prisma.dataSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException();
    return this.computeStats(source.id, source);
  }

  private async computeStats(
    dataSourceId: string,
    source: { id: string; slug: string; name: string; status: string; lastSyncedAt: Date | null },
  ) {
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [last7d, last30d, lastSuccess, lastFailure, recent, successPer7d] = await Promise.all([
      prisma.ingestionRun.groupBy({
        by: ['status'],
        where: { dataSourceId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        _count: { _all: true },
      }),
      prisma.ingestionRun.groupBy({
        by: ['status'],
        where: { dataSourceId, createdAt: { gte: windowStart } },
        _count: { _all: true },
        _sum: { recordsFetched: true, recordsLoaded: true, recordsFailed: true, durationMs: true },
      }),
      prisma.ingestionRun.findFirst({
        where: { dataSourceId, status: 'SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, recordsLoaded: true, durationMs: true, attempt: true },
      }),
      prisma.ingestionRun.findFirst({
        where: { dataSourceId, status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, errorCode: true, errorMessage: true, attempt: true },
      }),
      prisma.ingestionRun.findMany({
        where: { dataSourceId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          createdAt: true,
          durationMs: true,
          recordsLoaded: true,
          recordsFailed: true,
          errorCode: true,
        },
      }),
      prisma.ingestionRun.findMany({
        where: {
          dataSourceId,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        select: { status: true, createdAt: true, durationMs: true },
      }),
    ]);

    const succeeded7d = last7d.find((r) => r.status === 'SUCCEEDED')?._count._all ?? 0;
    const failed7d = last7d.find((r) => r.status === 'FAILED')?._count._all ?? 0;
    const total7d = succeeded7d + failed7d;
    const successRate7d = total7d > 0 ? succeeded7d / total7d : null;

    const loaded30d = last30d.reduce((acc, r) => acc + (r._sum.recordsLoaded ?? 0), 0);
    const failedRecords30d = last30d.reduce((acc, r) => acc + (r._sum.recordsFailed ?? 0), 0);
    const durationMs30d = last30d.reduce((acc, r) => acc + (r._sum.durationMs ?? 0), 0);
    const totalRuns30d = last30d.reduce((acc, r) => acc + r._count._all, 0);
    const avgDurationMs = totalRuns30d > 0 ? Math.round(durationMs30d / totalRuns30d) : null;

    const sparkline = bucketByDay(successPer7d);

    return {
      id: source.id,
      slug: source.slug,
      name: source.name,
      status: source.status,
      lastSyncedAt: source.lastSyncedAt,
      window: {
        last7d: { succeeded: succeeded7d, failed: failed7d, successRate: successRate7d },
        last30d: {
          totalRuns: totalRuns30d,
          recordsLoaded: loaded30d,
          recordsFailed: failedRecords30d,
          avgDurationMs,
        },
      },
      lastSuccess,
      lastFailure,
      recent,
      sparkline,
    };
  }

  // Per-run connector log for the admin "Log" modal. The modal polls with
  // ?afterSeq=<last seq seen> while the run is QUEUED/RUNNING.
  //
  // Status is read BEFORE the lines: the runner stores every line before it
  // sets a terminal status, so a terminal status here means `lines` is
  // complete and the client can stop polling.
  @Get('runs/:runId/logs')
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'internal', name: 'Ingestion Framework' }] })
  async runLogs(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(RunLogQuerySchema)) query: RunLogQuery,
  ): Promise<RunLogResponse> {
    const run = await prisma.ingestionRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true, startedAt: true, completedAt: true },
    });
    if (!run) throw new NotFoundException();
    const rows = await prisma.ingestionRunLog.findMany({
      where: { ingestionRunId: runId, seq: { gt: query.afterSeq } },
      orderBy: { seq: 'asc' },
      take: RUN_LOG_PAGE_SIZE + 1,
      select: { seq: true, ts: true, level: true, message: true, meta: true },
    });
    const page = rows.slice(0, RUN_LOG_PAGE_SIZE);
    return RunLogResponseSchema.parse({
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      lines: page.map((r) => ({
        seq: r.seq,
        ts: r.ts.toISOString(),
        level: r.level,
        message: r.message,
        meta: r.meta ?? null,
      })),
      hasMore: rows.length > RUN_LOG_PAGE_SIZE,
    });
  }

  @Get(':id')
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'internal', name: 'Ingestion Framework' }] })
  async getOne(@Param('id') id: string) {
    const source = await prisma.dataSource.findUnique({
      where: { id },
      include: { _count: { select: { ingestionRuns: true } } },
    });
    if (!source) throw new NotFoundException();
    return source;
  }

  @Get(':id/runs')
  @Authorized('data_sources:read')
  @Provenance({ sources: [{ id: 'internal', name: 'Ingestion Framework' }] })
  async runs(@Param('id') id: string, @Query('limit') limitRaw?: string) {
    const limit = Math.min(Number(limitRaw ?? '50') || 50, 200);
    return prisma.ingestionRun.findMany({
      where: { dataSourceId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  @Post(':id/run')
  @Authorized('ingestion:trigger')
  @AuditLog({ action: 'ingestion.run_now', entityType: 'DataSource' })
  async runNow(@AuthSession() user: SessionUser, @Param('id') id: string) {
    const source = await prisma.dataSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException();
    const jobId = await this.queue.enqueueManual(source.slug, user.userId);
    return { jobId, dataSourceSlug: source.slug };
  }

  @Patch(':id')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'ingestion.source_patched', entityType: 'DataSource' })
  async patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchBodySchema)) body: PatchBody,
  ) {
    // Only assign fields the client actually sent. zod's safeParse leaves
    // un-sent optional keys as undefined, which Prisma correctly reads
    // as "no change" — but we spell it out for reviewability.
    const data: Prisma.DataSourceUpdateInput = {};
    if (body.cadenceCron !== undefined) data.cadenceCron = body.cadenceCron;
    if (body.scheduleEnabled !== undefined) data.scheduleEnabled = body.scheduleEnabled;
    if (body.status !== undefined) data.status = body.status;
    if (body.ownerContact !== undefined) data.ownerContact = body.ownerContact;
    if (body.notes !== undefined) data.notes = body.notes;
    return prisma.dataSource.update({ where: { id }, data });
  }

  @Patch('bulk/status')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'ingestion.bulk_status', entityType: 'DataSource' })
  async bulkStatus(@Body(new ZodValidationPipe(BulkStatusSchema)) body: BulkStatusBody) {
    const result = await prisma.dataSource.updateMany({
      where: { id: { in: body.ids } },
      data: { status: body.status },
    });
    return { updated: result.count, status: body.status };
  }
}
