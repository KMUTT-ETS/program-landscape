import { Controller, Get } from '@nestjs/common';
import { prisma } from '@kku/db';
import { Authorized, Provenance } from '../common';

// ─────────────────────────────────────────────────────────────────────────
// GET /admin/system-status — executive-facing operational dashboard.
//
// Returns a composite snapshot of the things an executive or analyst
// might want to confirm before a Council session:
//   - data freshness across the key metric tables
//   - ingestion pipeline health over the last 7 days
//   - AI usage in the last 24 hours (total spend, call count, top-module)
//   - pending AI extractions awaiting review
//   - recent decisions (last 5, for continuity)
//
// Gated on a broad ADMIN-or-reader permission — any role that can read
// data can see the summary. Sensitive per-user cost detail lives at
// /admin/ai-cost and is tighter.
// ─────────────────────────────────────────────────────────────────────────

@Controller('/admin/system-status')
export class SystemStatusController {
  @Get()
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async getStatus() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      enrollmentFreshness,
      financialFreshness,
      outcomeFreshness,
      trendSignalFreshness,
      ingestion7d,
      ai24hTotal,
      ai24hByModule,
      pendingExtractions,
      recentDecisions,
    ] = await Promise.all([
      maxOr(prisma.enrollmentMetric.aggregate({ _max: { updatedAt: true } })),
      maxOr(prisma.financialMetric.aggregate({ _max: { updatedAt: true } })),
      maxOr(prisma.graduateOutcome.aggregate({ _max: { updatedAt: true } })),
      maxOr(prisma.trendSignal.aggregate({ _max: { updatedAt: true } })),

      prisma.ingestionRun.groupBy({
        by: ['status'],
        where: { startedAt: { gte: last7d } },
        _count: { _all: true },
      }),

      prisma.aiInference.aggregate({
        where: { createdAt: { gte: last24h } },
        _sum: { costEstimateUsd: true, tokensInput: true, tokensOutput: true },
        _count: { _all: true },
        _avg: { latencyMs: true, confidence: true },
      }),
      prisma.aiInference.groupBy({
        by: ['module'],
        where: { createdAt: { gte: last24h } },
        _sum: { costEstimateUsd: true },
        _count: { _all: true },
        orderBy: { _sum: { costEstimateUsd: 'desc' } },
        take: 5,
      }),

      prisma.pdfExtraction.count({
        where: { reviewStatus: 'PENDING_REVIEW' },
      }),

      prisma.councilDecision.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          decisionType: true,
        },
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      dataFreshness: [
        { metric: 'Enrollment', lastUpdated: enrollmentFreshness, staleAfterDays: 90, stale: !isFresh(enrollmentFreshness, last90d) },
        { metric: 'Financial', lastUpdated: financialFreshness, staleAfterDays: 90, stale: !isFresh(financialFreshness, last90d) },
        { metric: 'GraduateOutcome', lastUpdated: outcomeFreshness, staleAfterDays: 180, stale: !isFresh(outcomeFreshness, new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)) },
        { metric: 'TrendSignal', lastUpdated: trendSignalFreshness, staleAfterDays: 14, stale: !isFresh(trendSignalFreshness, new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)) },
      ],
      ingestionRuns7d: ingestion7d.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
      ai24h: {
        calls: ai24hTotal._count._all,
        costUsd: Number(ai24hTotal._sum.costEstimateUsd ?? 0),
        inputTokens: Number(ai24hTotal._sum.tokensInput ?? 0),
        outputTokens: Number(ai24hTotal._sum.tokensOutput ?? 0),
        avgLatencyMs: ai24hTotal._avg.latencyMs,
        avgConfidence: ai24hTotal._avg.confidence,
        byModule: ai24hByModule.map((row) => ({
          module: row.module,
          calls: row._count._all,
          costUsd: Number(row._sum.costEstimateUsd ?? 0),
        })),
      },
      pendingExtractions,
      recentDecisions: recentDecisions.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        decisionType: d.decisionType,
        updatedAt: d.updatedAt.toISOString(),
      })),
    };
  }
}

async function maxOr<T extends { _max: { updatedAt?: Date | null } }>(
  p: Promise<T>,
): Promise<string | null> {
  const r = await p;
  const v = r._max.updatedAt ?? null;
  return v ? v.toISOString() : null;
}

function isFresh(iso: string | null, threshold: Date): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() >= threshold.getTime();
}
