import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { JobType } from 'bullmq';
import { ApiError } from '@kku/shared';
import { AuditLog, Authorized } from '../common';
import {
  QUEUE_JOB_STATES,
  QueuesService,
  type QueueName,
} from './queues.service';

const ALLOWED_STATES: JobType[] = QUEUE_JOB_STATES;

function parseState(state: string | undefined, fallback: JobType = 'waiting'): JobType {
  if (!state) return fallback;
  if ((ALLOWED_STATES as string[]).includes(state)) return state as JobType;
  throw new ApiError(
    'VALIDATION_FAILED',
    `invalid state '${state}'; valid: ${ALLOWED_STATES.join(', ')}`,
  );
}

// Read + manage the four BullMQ queues from /admin/queues.
//
// Read paths (Authorized: admin:read for ANALYST + ADMIN visibility).
// Mutation paths (admin:manage — ADMIN only): retry / remove / clean /
// pause / resume. Every mutation is @AuditLog'd.

@Controller('/admin/queues')
export class QueuesController {
  constructor(private readonly svc: QueuesService) {}

  @Get()
  @Authorized('queues:read')
  async summaries() {
    return this.svc.listSummaries();
  }

  // ── Phase 6 realtime additions ────────────────────────────────────

  @Get('review-counts')
  @Authorized('queues:read')
  async reviewCounts() {
    return this.svc.reviewCounts();
  }

  @Get('activity')
  @Authorized('queues:read')
  async activity(@Query('limit') limitRaw?: string) {
    const n = limitRaw ? Math.min(Math.max(Number(limitRaw) || 30, 5), 100) : 30;
    return this.svc.recentActivity(n);
  }

  // Combined feed of every job across every queue, ordered by job
  // start time desc. Phase 7 — operators no longer have to drill into
  // one queue tile at a time to see "what's happening right now."
  @Get('all-jobs')
  @Authorized('queues:read')
  async allJobs(@Query('limit') limitRaw?: string) {
    const n = limitRaw ? Math.min(Math.max(Number(limitRaw) || 100, 10), 500) : 100;
    return this.svc.allQueuesJobs({ limit: n });
  }

  @Get('throughput')
  @Authorized('queues:read')
  async throughput() {
    return this.svc.throughput();
  }

  @Get(':queue/jobs')
  @Authorized('queues:read')
  async jobs(
    @Param('queue') queue: string,
    @Query('state') stateRaw?: string,
    @Query('offset') offsetRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const state = parseState(stateRaw);
    const offset = offsetRaw ? Number(offsetRaw) : undefined;
    const limit = limitRaw ? Number(limitRaw) : undefined;
    return this.svc.listJobs(queue as QueueName, state, { offset, limit });
  }

  @Get(':queue/jobs/:id')
  @Authorized('queues:read')
  async job(@Param('queue') queue: string, @Param('id') id: string) {
    return this.svc.getJob(queue as QueueName, id);
  }

  @Post(':queue/jobs/:id/retry')
  @HttpCode(200)
  @Authorized('queues:manage')
  @AuditLog({ action: 'queue.job.retry', entityType: 'BullMQJob' })
  async retry(@Param('queue') queue: string, @Param('id') id: string) {
    return this.svc.retry(queue as QueueName, id);
  }

  @Post(':queue/jobs/:id/remove')
  @HttpCode(200)
  @Authorized('queues:manage')
  @AuditLog({ action: 'queue.job.remove', entityType: 'BullMQJob' })
  async remove(@Param('queue') queue: string, @Param('id') id: string) {
    return this.svc.remove(queue as QueueName, id);
  }

  @Post(':queue/clean')
  @HttpCode(200)
  @Authorized('queues:manage')
  @AuditLog({ action: 'queue.clean', entityType: 'BullMQQueue' })
  async clean(
    @Param('queue') queue: string,
    @Body()
    body: {
      state: 'completed' | 'failed' | 'wait' | 'active' | 'delayed' | 'paused';
      graceMs?: number;
      limit?: number;
    },
  ) {
    if (!body?.state) {
      throw new ApiError('VALIDATION_FAILED', 'state is required (completed | failed | …)');
    }
    return this.svc.clean(queue as QueueName, body.state, {
      graceMs: body.graceMs,
      limit: body.limit,
    });
  }

  @Post(':queue/pause')
  @HttpCode(200)
  @Authorized('queues:manage')
  @AuditLog({ action: 'queue.pause', entityType: 'BullMQQueue' })
  async pause(@Param('queue') queue: string) {
    return this.svc.pause(queue as QueueName);
  }

  @Post(':queue/resume')
  @HttpCode(200)
  @Authorized('queues:manage')
  @AuditLog({ action: 'queue.resume', entityType: 'BullMQQueue' })
  async resume(@Param('queue') queue: string) {
    return this.svc.resume(queue as QueueName);
  }
}
