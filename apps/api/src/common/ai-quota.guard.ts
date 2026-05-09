import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { prisma } from '@kku/db';
import { ApiError, type SessionUser } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────
// AiQuotaGuard — per-user daily AI-cost cap.
//
// Mounted as a route-level guard on AI-consuming endpoints (analyst chat,
// extraction apply, briefs). Reads the user's cumulative cost over the
// last 24 hours from AiInference and rejects with 429 if the cap is
// exceeded. The short-window + hourly throttlers (ai_short, ai_hourly)
// protect the burst + sustained axes; this guard protects the dollar
// axis.
//
// Defaults:
//   VIEWER / COUNCIL / DEAN / DEPT_HEAD — $1 / day
//   EXECUTIVE                           — $3 / day
//   ANALYST / ADMIN                     — $10 / day (power users)
// Overridable per route via @AiQuota({ dailyUsdCap: 5 }) or globally via
// env: AI_QUOTA_DEFAULT_USD, AI_QUOTA_ANALYST_USD, AI_QUOTA_ADMIN_USD.
//
// The guard is fail-open on DB errors — AI quotas are a governance
// measure, not a security boundary. Rejecting a Council member because
// Postgres flickered would be worse than the rare over-quota call.
// ─────────────────────────────────────────────────────────────────────────

export const AI_QUOTA_META = Symbol('ai-quota');

export interface AiQuotaConfig {
  // Hard override for this route. When set, ignores the role-based
  // defaults.
  dailyUsdCap?: number;
  // Logical module name used when looking up cost (partition the 24h
  // rolling window by module so analyst spend doesn't eat into the
  // extraction budget and vice-versa). Default 'global'.
  module?: string;
}

export const AiQuota = (config: AiQuotaConfig = {}) => (
  _target: object,
  _propertyKey: string | symbol | undefined,
  descriptor: PropertyDescriptor,
): PropertyDescriptor => {
  Reflect.defineMetadata(AI_QUOTA_META, config, descriptor.value as object);
  return descriptor;
};

function envCap(k: string): number | undefined {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export function capForRole(role: SessionUser['role']): number {
  // v2 taxonomy (legacy roles removed 2026-05-09). Mapping rationale:
  //   SUPER_ADMIN  — highest cap; uses ADMIN env var for back-compat.
  //   SYSTEM_ADMIN — admin-grade; same cap as the legacy ANALYST tier.
  //   UNIVERSITY_USER — exec-readable; legacy EXECUTIVE-tier cap.
  //   FACULTY_USER / PROGRAM_USER — fall through to DEFAULT.
  switch (role) {
    case 'SUPER_ADMIN':
      return envCap('AI_QUOTA_ADMIN_USD') ?? 10;
    case 'SYSTEM_ADMIN':
      return envCap('AI_QUOTA_ANALYST_USD') ?? 10;
    case 'UNIVERSITY_USER':
      return envCap('AI_QUOTA_EXECUTIVE_USD') ?? 3;
    default:
      return envCap('AI_QUOTA_DEFAULT_USD') ?? 1;
  }
}

// Per-role aggregate cap — the second wall on top of the per-user cap.
// Stops a noisy role tier from sustaining the per-user cap × N users
// concurrently and overshooting what KKU IT budgeted.
//
// Defaults are 20× the per-user cap (rule of thumb: ~20 concurrent
// users per tier). Operator overrides via env:
//   AI_QUOTA_ROLE_AGG_DEFAULT_USD     — FACULTY_USER + PROGRAM_USER tier (~$20/day)
//   AI_QUOTA_ROLE_AGG_EXECUTIVE_USD   — UNIVERSITY_USER (~$60/day)
//   AI_QUOTA_ROLE_AGG_ANALYST_USD     — SYSTEM_ADMIN (~$200/day)
//   AI_QUOTA_ROLE_AGG_ADMIN_USD       — SUPER_ADMIN (~$200/day)
export function aggregateCapForRole(role: SessionUser['role']): number {
  switch (role) {
    case 'SUPER_ADMIN':
      return envCap('AI_QUOTA_ROLE_AGG_ADMIN_USD') ?? 200;
    case 'SYSTEM_ADMIN':
      return envCap('AI_QUOTA_ROLE_AGG_ANALYST_USD') ?? 200;
    case 'UNIVERSITY_USER':
      return envCap('AI_QUOTA_ROLE_AGG_EXECUTIVE_USD') ?? 60;
    default:
      return envCap('AI_QUOTA_ROLE_AGG_DEFAULT_USD') ?? 20;
  }
}

@Injectable()
export class AiQuotaGuard implements CanActivate {
  private readonly logger = new Logger(AiQuotaGuard.name);
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<AiQuotaConfig | undefined>(
      AI_QUOTA_META,
      context.getHandler(),
    );
    if (!config) return true; // Route isn't quota-gated.

    const req = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    const user = req.user;
    if (!user) return true; // JwtAuthGuard will reject if auth is required.

    const cap = config.dailyUsdCap ?? capForRole(user.role);
    const module = config.module;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const moduleClause = module ? { module } : {};

    try {
      // Two queries in parallel — per-user spend + per-role spend.
      // Both are 24h rolling windows. Postgres can answer either in
      // single-digit ms (AiInference is small + indexed on createdAt).
      const [userAgg, roleAgg] = await Promise.all([
        prisma.aiInference.aggregate({
          where: {
            userId: user.userId,
            createdAt: { gte: since },
            ...moduleClause,
          },
          _sum: { costEstimateUsd: true },
        }),
        prisma.aiInference.aggregate({
          where: {
            user: { role: user.role },
            createdAt: { gte: since },
            ...moduleClause,
          },
          _sum: { costEstimateUsd: true },
        }),
      ]);

      const userSpent = Number(userAgg._sum.costEstimateUsd ?? 0);
      const roleSpent = Number(roleAgg._sum.costEstimateUsd ?? 0);
      const roleCap = aggregateCapForRole(user.role);

      if (userSpent >= cap) {
        throw new ApiError(
          'RATE_LIMITED',
          `Daily AI budget reached ($${userSpent.toFixed(4)} / $${cap} USD). ` +
            `Quota resets 24h after first call — see /admin/ai-cost.`,
          { spentUsd: userSpent, capUsd: cap, scope: 'user', resetSeconds: 24 * 3600 },
        );
      }
      if (roleSpent >= roleCap) {
        // Role-tier exhausted — different from per-user. Tell the caller
        // the wall is collective so they don't think their own cap reset
        // would help.
        throw new ApiError(
          'RATE_LIMITED',
          `Role tier (${user.role}) daily AI budget reached ` +
            `($${roleSpent.toFixed(2)} / $${roleCap} USD). ` +
            `This is a tier-wide cap shared across every ${user.role} on the platform. ` +
            `Cap resets 24h after first call — contact an admin if a higher ceiling is justified.`,
          {
            spentUsd: roleSpent,
            capUsd: roleCap,
            scope: 'role',
            role: user.role,
            resetSeconds: 24 * 3600,
          },
        );
      }
      return true;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      this.logger.warn(
        `AiQuotaGuard fail-open for user ${user.userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return true;
    }
  }
}
