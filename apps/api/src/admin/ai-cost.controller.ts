import { Controller, Get, Query } from '@nestjs/common';
import { prisma } from '@kku/db';
import { Authorized, Provenance } from '../common';

// ─────────────────────────────────────────────────────────────────────────
// GET /admin/ai-cost — AI spend rollup. Filtered by day-window (default
// 30 days). Returns three cuts:
//   1. total: single-row summary for the window
//   2. byDay: stacked cost by module over the window
//   3. byUser: top-20 users by cost, bucketed by module
//
// Gated on `pdf:admin` (ADMIN only) since per-user spend is sensitive.
// ─────────────────────────────────────────────────────────────────────────

@Controller('/admin/ai-cost')
export class AiCostController {
  @Get()
  @Authorized('pdf:admin')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get(@Query('days') daysRaw?: string) {
    const days = clampDays(daysRaw);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Total + per-module + per-day + per-user. Three aggregations over the
    // same window; keep them parallel.
    const [total, byModule, byDay, byUser] = await Promise.all([
      prisma.aiInference.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { costEstimateUsd: true, tokensInput: true, tokensOutput: true },
        _count: { _all: true },
        _avg: { latencyMs: true, confidence: true },
      }),
      prisma.aiInference.groupBy({
        by: ['module'],
        where: { createdAt: { gte: since } },
        _sum: { costEstimateUsd: true },
        _count: { _all: true },
        orderBy: { _sum: { costEstimateUsd: 'desc' } },
      }),
      prisma.$queryRaw<
        Array<{ day: Date; module: string; cost_usd: number; calls: number }>
      >`
        SELECT
          DATE_TRUNC('day', created_at) AS day,
          module,
          SUM(cost_estimate_usd)::float AS cost_usd,
          COUNT(*)::int AS calls
        FROM ai_inferences
        WHERE created_at >= ${since}
        GROUP BY day, module
        ORDER BY day ASC
      `,
      prisma.$queryRaw<
        Array<{
          user_id: string;
          email: string;
          name: string | null;
          role: string;
          cost_usd: number;
          calls: number;
        }>
      >`
        SELECT
          u.id AS user_id,
          u.email,
          u.name,
          u.role::text AS role,
          SUM(ai.cost_estimate_usd)::float AS cost_usd,
          COUNT(*)::int AS calls
        FROM ai_inferences ai
        JOIN users u ON u.id = ai.user_id
        WHERE ai.created_at >= ${since}
        GROUP BY u.id, u.email, u.name, u.role
        ORDER BY cost_usd DESC
        LIMIT 20
      `,
    ]);

    return {
      windowDays: days,
      generatedAt: new Date().toISOString(),
      total: {
        calls: total._count._all,
        costUsd: Number(total._sum.costEstimateUsd ?? 0),
        inputTokens: Number(total._sum.tokensInput ?? 0),
        outputTokens: Number(total._sum.tokensOutput ?? 0),
        avgLatencyMs: total._avg.latencyMs,
        avgConfidence: total._avg.confidence,
      },
      byModule: byModule.map((row) => ({
        module: row.module,
        calls: row._count._all,
        costUsd: Number(row._sum.costEstimateUsd ?? 0),
      })),
      byDay: byDay.map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        module: row.module,
        costUsd: Number(row.cost_usd),
        calls: Number(row.calls),
      })),
      byUser: byUser.map((row) => ({
        userId: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        costUsd: Number(row.cost_usd),
        calls: Number(row.calls),
      })),
    };
  }
}

function clampDays(raw: string | undefined): number {
  if (!raw) return 30;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(n, 365);
}
