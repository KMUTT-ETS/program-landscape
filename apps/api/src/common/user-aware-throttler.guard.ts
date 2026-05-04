import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Throttler tracker that prefers user ID over IP when the request is
 * authenticated.
 *
 * Why: in dev (and behind some prod topologies) every request to NestJS
 * arrives from the same source IP — the Next.js BFF proxy at localhost.
 * The default IP-based tracker collapses every user into one bucket, so
 * a moderately busy admin page can blow the global 120/min limit and
 * trip 429 for everyone.
 *
 * Resolution order:
 *   1. JwtAuthGuard sets `req.user.userId` — use that.
 *   2. Fallback to `X-Forwarded-For` (first hop) when behind a proxy.
 *   3. Fallback to `req.ip` (Express resolves with `trust proxy`).
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const user = (req as unknown as { user?: { userId?: string } }).user;
    if (user?.userId) return `user:${user.userId}`;

    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      const first = xff.split(',')[0]?.trim();
      if (first) return `ip:${first}`;
    }

    return `ip:${req.ip ?? 'unknown'}`;
  }
}
