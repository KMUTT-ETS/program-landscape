import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import { AuditLog, AuthSession, Authorized, ZodValidationPipe } from '../common';
import { ScholarService } from './scholar.service';

// Google Scholar on-demand fetch.
//
//   POST /scholar/fetch/me       self-fetch                    (authenticated)
//   POST /scholar/bind/me        link own Scholar profile URL   (authenticated)
//   GET  /scholar/status/me      last run + next eligible date  (authenticated)
//   POST /scholar/fetch/bulk     enqueue many                   (scholar:admin)
//   POST /scholar/fetch/:userId  fetch someone else's record    (scholar:admin)
//   GET  /scholar/runs           the run ledger                 (scholar:admin)
//
// The self routes are deliberately NOT behind scholar:admin — they only ever
// act on the caller's own record, and gating them would make the feature
// admin-only, which is the opposite of the point.

const BindSchema = z.object({
  // Not z.string().url(): the shape check that matters is "is this a Scholar
  // profile URL with a user id in it", and parseScholarProfileUrl (inside
  // bindScholarProfile) is the one place that decides that. A second, looser
  // opinion here would only produce a differently-worded rejection for the
  // same input.
  url: z.string().min(4).max(2048),
});
type BindBody = z.infer<typeof BindSchema>;

const BulkSchema = z.object({
  // No .max() here — the cap is enforced in the service, AFTER duplicates are
  // collapsed. Capping the raw array would reject a 150-id request naming 40
  // distinct people, which is a request for 40 fetches.
  userIds: z.array(z.string().min(1)).min(1),
});
type BulkBody = z.infer<typeof BulkSchema>;

const RunsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  userId: z.string().min(1).optional(),
  status: z.enum(['SUCCEEDED', 'PARTIAL', 'FAILED', 'REFUSED']).optional(),
});
type RunsQuery = z.infer<typeof RunsQuerySchema>;

const UserIdParamSchema = z.object({ userId: z.string().min(1) });
type UserIdParam = z.infer<typeof UserIdParamSchema>;

@Controller('/scholar')
export class ScholarController {
  constructor(private readonly service: ScholarService) {}

  // `heavy` (10/min), not `ai_short`/`ai_hourly`: those buckets exist for LLM
  // spend and are paired with AiQuotaGuard's dollar cap, which knows nothing
  // about ScrapingBee. This is the same class of endpoint as PDF generation —
  // expensive, externally billed, and not something a person legitimately
  // triggers in a burst. 10/min is generous next to the real limit (one fetch
  // per person per 30 days, enforced in the runner's quota unit); the bucket
  // is here to stop a double-clicked button or a retry loop from queueing a
  // pile of jobs that each walk a profile at ~15 credits a page.
  @Post('fetch/me')
  @Throttle({ heavy: { limit: 10, ttl: 60_000 } })
  @AuditLog({ action: 'scholar.fetch.self', entityType: 'ScholarFetchRun' })
  async fetchMe(@AuthSession() user: SessionUser) {
    return this.service.enqueueSelfFetch(user.userId, user.role);
  }

  @Post('bind/me')
  @Throttle({ heavy: { limit: 10, ttl: 60_000 } })
  @AuditLog({ action: 'scholar.profile.bind.self', entityType: 'FacultyMember' })
  async bindMe(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(BindSchema)) body: BindBody,
  ) {
    // Synchronous on purpose: one page fetch, and the caller is waiting to
    // find out whether the URL they pasted was accepted.
    return this.service.bindOwnProfile(user.userId, body.url, user.role);
  }

  @Get('status/me')
  async statusMe(@AuthSession() user: SessionUser) {
    return this.service.selfStatus(user.userId, user.role);
  }

  // `fetch/bulk` MUST be declared before `fetch/:userId` — Nest matches
  // routes in declaration order, so with the parameterised route first a POST
  // to /scholar/fetch/bulk would be read as a fetch for a user whose id is
  // the literal string "bulk".
  @Post('fetch/bulk')
  @Authorized('scholar:admin')
  @Throttle({ heavy: { limit: 10, ttl: 60_000 } })
  @AuditLog({ action: 'scholar.fetch.bulk', entityType: 'ScholarFetchRun' })
  async fetchBulk(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(BulkSchema)) body: BulkBody,
  ) {
    return this.service.enqueueBulk(body.userIds, { userId: user.userId, role: user.role });
  }

  @Post('fetch/:userId')
  @Authorized('scholar:admin')
  @Throttle({ heavy: { limit: 10, ttl: 60_000 } })
  @AuditLog({ action: 'scholar.fetch.admin', entityType: 'ScholarFetchRun' })
  async fetchForUser(
    @AuthSession() user: SessionUser,
    @Param(new ZodValidationPipe(UserIdParamSchema)) params: UserIdParam,
  ) {
    return this.service.enqueueForUser(params.userId, { userId: user.userId, role: user.role });
  }

  @Get('runs')
  @Authorized('scholar:admin')
  async runs(@Query(new ZodValidationPipe(RunsQuerySchema)) query: RunsQuery) {
    return this.service.listRuns(query);
  }
}
