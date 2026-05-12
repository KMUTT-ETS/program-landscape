import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Badge, Card, PageHeader, Section, FreshnessBadge } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'System status — Admin' };

interface SystemStatus {
  generatedAt: string;
  dataFreshness: Array<{
    metric: string;
    lastUpdated: string | null;
    staleAfterDays: number;
    stale: boolean;
  }>;
  ingestionRuns7d: Array<{ status: string; count: number }>;
  ai24h: {
    calls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    avgLatencyMs: number | null;
    avgConfidence: number | null;
    byModule: Array<{ module: string; calls: number; costUsd: number }>;
  };
  pendingExtractions: number;
  recentDecisions: Array<{
    id: string;
    title: string;
    status: string;
    decisionType: string;
    updatedAt: string;
  }>;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  SUCCESS: 'success',
  FAILED: 'danger',
  RUNNING: 'info',
  QUEUED: 'neutral',
};

export default async function SystemStatusPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  // System status is exec-readable: admin-grade + UNIVERSITY_USER (which
  // absorbs the legacy COUNCIL/EXECUTIVE/VIEWER population).
  if (!isAdminGrade(user.role) && user.role !== 'UNIVERSITY_USER') {
    redirect('/no-access');
  }

  const statusRes = await apiFetchSafe<SystemStatus>('/admin/system-status');
  const status = statusRes.ok ? statusRes.data : null;

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="System status" />
      <PageHeader
        eyebrow="Admin · Runtime"
        title="System status"
        subtitle="Operational snapshot before a Council session — data freshness, ingestion health, AI spend, pending reviews, recent decisions."
      />
      {!status ? (
        <DiagnosticEmptyState surface="system status" error={statusRes.ok ? null : statusRes.error} />
      ) : (
        <div className="flex flex-col gap-6">
          <Section title="Data freshness">
            <Card padding="none">
              <table className="w-full text-sm">
                <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left">Metric</th>
                    <th className="px-4 py-2 text-left">Last updated</th>
                    <th className="px-4 py-2 text-left">Stale after</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {status.dataFreshness.map((row) => (
                    <tr key={row.metric}>
                      <td className="px-4 py-2 font-medium">{row.metric}</td>
                      <td className="px-4 py-2">
                        {row.lastUpdated ? (
                          <FreshnessBadge freshnessDate={row.lastUpdated} />
                        ) : (
                          <span className="text-text-tertiary">never</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-tabular text-text-secondary">
                        {row.staleAfterDays} days
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={row.stale ? 'warning' : 'success'}>
                          {row.stale ? 'stale' : 'fresh'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </Section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Ingestion — last 7 days">
              <Card padding="none">
                <ul className="divide-y divide-border-subtle text-sm">
                  {status.ingestionRuns7d.length === 0 ? (
                    <li className="px-4 py-2 text-text-tertiary">No runs.</li>
                  ) : (
                    status.ingestionRuns7d.map((r) => (
                      <li
                        key={r.status}
                        className="flex items-center justify-between px-4 py-2"
                      >
                        <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                          {r.status.toLowerCase()}
                        </Badge>
                        <span className="font-tabular">{r.count}</span>
                      </li>
                    ))
                  )}
                </ul>
              </Card>
            </Section>

            <Section
              title="AI usage — last 24 hours"
              actions={
                <Link
                  href="/admin/ai-cost"
                  className="inline-flex items-center gap-1 text-sm text-accent-default hover:underline"
                >
                  Full cost report
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </Link>
              }
            >
              <Card tone="glossy">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Stat label="Calls" value={status.ai24h.calls.toString()} />
                  <Stat
                    label="Cost"
                    value={`$${status.ai24h.costUsd.toFixed(4)}`}
                  />
                  <Stat
                    label="Avg latency"
                    value={
                      status.ai24h.avgLatencyMs != null
                        ? `${Math.round(status.ai24h.avgLatencyMs)} ms`
                        : '—'
                    }
                  />
                  <Stat
                    label="Avg confidence"
                    value={
                      status.ai24h.avgConfidence != null
                        ? `${Math.round(status.ai24h.avgConfidence * 100)}%`
                        : '—'
                    }
                  />
                </div>
                {status.ai24h.byModule.length > 0 && (
                  <div className="mt-4 border-t border-border-subtle pt-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
                      Top modules
                    </div>
                    <ul className="flex flex-col gap-1 text-sm">
                      {status.ai24h.byModule.map((m) => (
                        <li
                          key={m.module}
                          className="flex items-center justify-between"
                        >
                          <span className="font-medium">{m.module}</span>
                          <span className="font-tabular text-text-secondary">
                            {m.calls} calls · ${m.costUsd.toFixed(4)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Pending reviews">
              <Card>
                <div className="flex items-center justify-between text-sm">
                  <span>PDF extractions awaiting human review</span>
                  <span className="font-tabular text-2xl font-medium">
                    {status.pendingExtractions}
                  </span>
                </div>
              </Card>
            </Section>

            <Section title="Recent decisions">
              <Card padding="none">
                <ul className="divide-y divide-border-subtle text-sm">
                  {status.recentDecisions.length === 0 ? (
                    <li className="px-4 py-2 text-text-tertiary">
                      No decisions yet.
                    </li>
                  ) : (
                    status.recentDecisions.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between px-4 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <a
                            href={`/decisions/${d.id}`}
                            className="font-medium hover:underline"
                          >
                            {d.title || '(untitled)'}
                          </a>
                          <div className="text-xs text-text-tertiary">
                            {d.decisionType.toLowerCase()} ·{' '}
                            {new Date(d.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <Badge tone="neutral">{d.status.toLowerCase()}</Badge>
                      </li>
                    ))
                  )}
                </ul>
              </Card>
            </Section>
          </div>

          <div className="text-right text-xs text-text-tertiary">
            Generated {new Date(status.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </AuthedAppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <span className="font-tabular text-base font-medium">{value}</span>
    </div>
  );
}
