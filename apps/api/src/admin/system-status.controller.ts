import { Controller, Get } from '@nestjs/common';
import { prisma, aiModelHealth } from '@kku/db';
import { Authorized, Provenance, gotenbergSemaphore } from '../common';
import { aggregateCapForRole } from '../common/ai-quota.guard';
import type { Role } from '@kku/shared';
import { BackupVerificationService } from './backup-verification.service';

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
  constructor(private readonly backupVerification: BackupVerificationService) {}

  @Get()
  @Authorized('institution:read:university')
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
      ai24hByRole,
      pendingExtractions,
      recentDecisions,
      backupTile,
      health,
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

      // Per-role 24h spend rollup. Joins via the User table so the
      // role tier is current (not the role at time of inference). The
      // role-aggregate cap (apps/api/src/common/ai-quota.guard.ts)
      // enforces these numbers; this surface lets ops see how close
      // each tier is to its ceiling.
      prisma.aiInference.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: last24h } },
        _sum: { costEstimateUsd: true },
        _count: { _all: true },
      }).then(async (rows) => {
        const userIds = rows.map((r) => r.userId).filter((u): u is string => !!u);
        if (userIds.length === 0) return [] as { role: Role; calls: number; spentUsd: number; capUsd: number; pctUsed: number }[];
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, role: true },
        });
        const roleByUser = new Map(users.map((u) => [u.id, u.role]));
        const byRole = new Map<Role, { calls: number; spentUsd: number }>();
        for (const r of rows) {
          if (!r.userId) continue;
          const role = roleByUser.get(r.userId);
          if (!role) continue;
          const cell = byRole.get(role) ?? { calls: 0, spentUsd: 0 };
          cell.calls += r._count._all;
          cell.spentUsd += Number(r._sum.costEstimateUsd ?? 0);
          byRole.set(role, cell);
        }
        return Array.from(byRole.entries()).map(([role, c]) => {
          const capUsd = aggregateCapForRole(role);
          return {
            role,
            calls: c.calls,
            spentUsd: c.spentUsd,
            capUsd,
            pctUsed: capUsd > 0 ? Math.round((c.spentUsd / capUsd) * 1000) / 10 : 0,
          };
        }).sort((a, b) => b.pctUsed - a.pctUsed);
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

      // Backup-verification tile — reads /var/lib/program-landscape/
      // verdict files written by scripts/dr/{verify-backup, verify-minio,
      // check-mirror, retention-check}.sh. See
      // docs/hardening/19-backup-dr.report.md.
      this.backupVerification.getTile(),

      // The ONE model-health resolver, also read by /admin/ai-settings
      // and the daily notifier — see packages/db/src/ai-model-health.ts.
      aiModelHealth(),
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
        // Per-role 24h burn vs the role-aggregate cap. `pctUsed` ≥ 80
        // is the ops red-flag signal — past 100 the AiQuotaGuard starts
        // 429-ing role-tier requests.
        byRole: ai24hByRole,
      },
      // Live PDF-rendering queue depth — Council Pack export + per-
      // program detail PDFs are FIFO-queued by the in-process semaphore
      // so a single ops pane shows whether the rendering tier is keeping
      // up.
      gotenbergQueue: gotenbergSemaphore().stats(),
      pendingExtractions,
      recentDecisions: recentDecisions.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        decisionType: d.decisionType,
        updatedAt: d.updatedAt.toISOString(),
      })),
      // Backup posture — surface the four verifier verdicts at the
      // top level so the admin UI can render the red/amber/green tile
      // without traversing nested objects.
      backup: backupTile,
      // Per-method model-pin verdict — same shape, same source function,
      // as /admin/ai-settings's `health` field. Rendered via the shared
      // <ModelHealthBanner> so the two pages can never disagree.
      health,
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
