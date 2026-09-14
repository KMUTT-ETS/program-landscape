import { Body, Controller, Get, HttpCode, Logger, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';

import { ApiError, type SessionUser } from '@kku/shared';
import { RAW_RETENTION_DAYS, USAGE_WINDOWS, type UsageWindowDays } from '@kku/db';

import { AuthSession, Authorized, Provenance, ZodValidationPipe } from '../common';
import { UsageService } from './usage.service';

// ─────────────────────────────────────────────────────────────────────────
// Platform usage.
//
// POST /usage/page-views  — the browser beacon, proxied by the web route
//                           handler apps/web/app/api/usage/page-views. Identity
//                           comes from the session, never the body. NOT
//                           @AuditLog: a view is not a mutation, and auditing
//                           it would write two rows per navigation and make
//                           the audit log's own action counts meaningless.
// GET  /usage/*           — aggregate (usage:read:aggregate) and detail
//                           (usage:read:detail) reads. Aggregate responses
//                           carry no user ids or names.
// ─────────────────────────────────────────────────────────────────────────

// Same limits as the web handler (apps/web/app/api/usage/page-views/route.ts);
// the api additionally requires a non-empty path and accepts explicit null
// for the optional ids. Unknown keys are stripped, never forwarded — the
// record() argument is built field by field from the session and the parsed
// body.
export const PageViewBody = z.object({
  path: z.string().min(1).max(512),
  scope: z.enum(['university', 'faculty', 'department', 'program']).optional(),
  scopeId: z.string().max(64).optional().nullable(),
  programId: z.string().max(64).optional().nullable(),
});

export const WindowQuery = z.object({
  days: z.coerce
    .number()
    .refine((d): d is UsageWindowDays => (USAGE_WINDOWS as readonly number[]).includes(d), {
      message: `days must be one of ${USAGE_WINDOWS.join(', ')}`,
    })
    .default(30),
  excludeAdmins: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  facultyId: z.string().max(64).optional(),
  q: z.string().max(80).optional(),
});
type WindowQueryT = z.infer<typeof WindowQuery>;

// The timeline and viewer endpoints read raw page_views, which is swept
// at RAW_RETENTION_DAYS. Offering a window wider than retention would
// render as a real gap rather than a missing one.
export const DetailWindowQuery = WindowQuery.refine((q) => q.days <= RAW_RETENTION_DAYS, {
  message: `days must be at most ${RAW_RETENTION_DAYS} for per-user detail (raw retention window)`,
});

const USAGE_SOURCES = [
  { id: 'page_views', name: 'Page views recorded in-app' },
  { id: 'audit_logs', name: 'Sign-ins and actions from the audit log' },
];
const USAGE_CAVEATS = [
  `Raw page views are kept ${RAW_RETENTION_DAYS} days, then rolled up to daily counts per user and page (Asia/Bangkok days).`,
  'A session is a run of views with no gap over 30 minutes; dwell is the time to the next view and excludes the last view of a session.',
  'Admin-grade accounts are excluded by default (excludeAdmins=true); impersonated sessions are never counted.',
];
const USAGE_PROVENANCE = { sources: USAGE_SOURCES, caveats: USAGE_CAVEATS };

/**
 * True when JwtAuthGuard actually substituted a role on this request —
 * not merely when an impersonation header or cookie was present. The
 * guard applies the override only when the real JWT role passes
 * canImpersonate() and the payload decodes, and it is the only place
 * that still knows the real role, so it publishes the decision rather
 * than having each handler guess from header presence.
 */
function isImpersonated(req: Request): boolean {
  return (req as unknown as { impersonated?: boolean }).impersonated === true;
}

@Controller('/usage')
export class UsageController {
  private readonly logger = new Logger(UsageController.name);

  constructor(private readonly service: UsageService) {}

  /**
   * Records one page view. Always 200, whether or not the write succeeded.
   *
   * A page view is telemetry: a failed write must never fail the request or
   * page ops. One warn line, no stack, and the client learns nothing it
   * would act on — the beacon discards the response.
   *
   * Throttled to 60/min per user on the always-on `default` bucket (which
   * the module configures at 240/min for everything else). One navigation
   * emits one beacon, so 60 is generous for a person and tight for a tab
   * stuck in a redirect loop.
   *
   * A write failure is always a 200 with { recorded: false } — never a
   * throw. (The throttler still answers 429 ahead of the handler; the
   * beacon discards either.)
   */
  @Post('page-views')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async recordPageView(
    @Body(new ZodValidationPipe(PageViewBody)) body: z.infer<typeof PageViewBody>,
    @AuthSession() user: SessionUser,
    @Req() req: Request,
  ): Promise<{ recorded: boolean }> {
    try {
      await this.service.record({
        userId: user.userId,
        // Already the effective role: JwtAuthGuard substitutes the
        // impersonated one before a handler sees req.user, which is what
        // the schema asks for — the role whose view was actually rendered.
        role: user.role,
        impersonated: isImpersonated(req),
        // Impersonated faculty when a role is substituted — deliberate,
        // and harmless only because every reader filters impersonated rows.
        viewerFacultyId: user.facultyId ?? null,
        rawPath: body.path,
        scope: body.scope,
        scopeId: body.scopeId ?? null,
        programId: body.programId ?? null,
      });
    } catch (e) {
      this.logger.warn(`page view not recorded: ${(e as Error).message}`);
      return { recorded: false };
    }
    return { recorded: true };
  }

  // ── Aggregate ──────────────────────────────────────────────────────────

  @Get('summary')
  @Authorized('usage:read:aggregate')
  @Provenance(USAGE_PROVENANCE)
  summary(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) {
    return this.service.summary(q.days, q.excludeAdmins);
  }

  @Get('modules')
  @Authorized('usage:read:aggregate')
  @Provenance(USAGE_PROVENANCE)
  modules(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) {
    return this.service.modules(q.days, q.excludeAdmins);
  }

  @Get('programs')
  @Authorized('usage:read:aggregate')
  @Provenance(USAGE_PROVENANCE)
  programs(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) {
    return this.service.programs(q.days, q.excludeAdmins, q.facultyId ?? null);
  }

  @Get('roles')
  @Authorized('usage:read:aggregate')
  @Provenance(USAGE_PROVENANCE)
  roles(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) {
    return this.service.roles(q.days, q.excludeAdmins);
  }

  @Get('faculties')
  @Authorized('usage:read:aggregate')
  @Provenance(USAGE_PROVENANCE)
  faculties(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) {
    return this.service.faculties(q.days, q.excludeAdmins);
  }

  @Get('actions')
  @Authorized('usage:read:aggregate')
  @Provenance(USAGE_PROVENANCE)
  actions(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) {
    return this.service.actions(q.days, q.excludeAdmins);
  }

  // ── Detail — named individuals, gated tighter. ─────────────────────────

  @Get('users')
  @Authorized('usage:read:detail')
  @Provenance(USAGE_PROVENANCE)
  users(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) {
    return this.service.users(q.days, q.excludeAdmins, q.q ?? null);
  }

  @Get('users/:id')
  @Authorized('usage:read:detail')
  @Provenance(USAGE_PROVENANCE)
  async userTimeline(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(DetailWindowQuery)) q: WindowQueryT,
  ) {
    const timeline = await this.service.userTimeline(id, q.days);
    if (!timeline) throw new ApiError('NOT_FOUND', `User ${id} not found.`);
    return timeline;
  }

  @Get('programs/:id/viewers')
  @Authorized('usage:read:detail')
  @Provenance(USAGE_PROVENANCE)
  programViewers(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(DetailWindowQuery)) q: WindowQueryT,
  ) {
    return this.service.programViewers(id, q.days);
  }
}
