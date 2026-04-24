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

function capForRole(role: SessionUser['role']): number {
  const envCap = (k: string) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  switch (role) {
    case 'ADMIN':
      return envCap('AI_QUOTA_ADMIN_USD') ?? 10;
    case 'ANALYST':
      return envCap('AI_QUOTA_ANALYST_USD') ?? 10;
    case 'EXECUTIVE':
      return envCap('AI_QUOTA_EXECUTIVE_USD') ?? 3;
    default:
      return envCap('AI_QUOTA_DEFAULT_USD') ?? 1;
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

    try {
      const agg = await prisma.aiInference.aggregate({
        where: {
          userId: user.userId,
          createdAt: { gte: since },
          ...(module ? { module } : {}),
        },
        _sum: { costEstimateUsd: true },
      });
      const spent = Number(agg._sum.costEstimateUsd ?? 0);
      if (spent >= cap) {
        throw new ApiError(
          'RATE_LIMITED',
          `Daily AI budget reached ($${spent.toFixed(4)} / $${cap} USD). ` +
            `Quota resets 24h after first call — see /admin/ai-cost.`,
          { spentUsd: spent, capUsd: cap, resetSeconds: 24 * 3600 },
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
