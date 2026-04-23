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
import type { SessionUser } from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
} from '../common';
import { IngestionQueueService } from './ingestion-queue.service';

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
