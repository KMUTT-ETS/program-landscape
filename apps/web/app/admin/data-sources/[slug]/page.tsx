import { redirect } from 'next/navigation';
import Link from 'next/link';
import { can, isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader, Section, Badge, FreshnessBadge } from '@kku/ui';
import { ImdUploadWidget } from './imd-upload';
import { RunNowButton } from './run-now-button';
import { DataSourceMark, acknowledgementHref, isMarkedSource } from '@/components/data-source-mark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data Source — Stats' };

interface SourceStats {
  id: string;
  slug: string;
  name: string;
  status: string;
  lastSyncedAt: string | null;
  window: {
    last7d: { succeeded: number; failed: number; successRate: number | null };
    last30d: {
      totalRuns: number;
      recordsLoaded: number;
      recordsFailed: number;
      avgDurationMs: number | null;
    };
  };
  lastSuccess: {
    id: string;
    createdAt: string;
    recordsLoaded: number;
    durationMs: number | null;
    attempt: number;
  } | null;
  lastFailure: {
    id: string;
    createdAt: string;
    errorCode: string | null;
    errorMessage: string | null;
    attempt: number;
  } | null;
  recent: Array<{
    id: string;
    status: string;
    createdAt: string;
    durationMs: number | null;
    recordsLoaded: number;
    recordsFailed: number;
    errorCode: string | null;
  }>;
  sparkline: Array<{ day: string; succeeded: number; failed: number }>;
}

export default async function DataSourceStatsPage({ params }: { params: { slug: string } }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  const statsRes = await apiFetchSafe<SourceStats>(
    `/data-sources/by-slug/${encodeURIComponent(params.slug)}/stats`,
  );

  if (!statsRes.ok) {
    return (
      <AuthedAppShell user={user}>
        <AdminBackNav current={params.slug} group="Data sources" groupHref="/admin/data-sources" />
        <PageHeader title="Data source" subtitle={params.slug} />
        <DiagnosticEmptyState surface="this data source" error={statsRes.error} />
      </AuthedAppShell>
    );
  }
  const stats = statsRes.data;

  const sr = stats.window.last7d.successRate;
  const healthTone: 'danger' | 'warning' | 'success' | 'neutral' =
    sr === null ? 'neutral' : sr >= 0.9 ? 'success' : sr >= 0.7 ? 'warning' : 'danger';

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current={stats.name} group="Data sources" groupHref="/admin/data-sources" />
      <PageHeader
        title={
          isMarkedSource(stats.slug) ? (
            <span className="inline-flex items-center gap-2">
              <DataSourceMark source={stats.slug} size={24} href={acknowledgementHref(stats.slug)} />
              {stats.name}
            </span>
          ) : (
            stats.name
          )
        }
        actions={
          can(user, 'ingestion:trigger') ? (
            <RunNowButton dataSourceId={stats.id} name={stats.name} />
          ) : undefined
        }
        subtitle={
          <span className="inline-flex items-center gap-3">
            <span className="font-mono text-xs">{stats.slug}</span>
            <Badge tone={stats.status === 'active' ? 'success' : stats.status === 'error' ? 'danger' : 'neutral'}>
              {stats.status}
            </Badge>
            {stats.lastSyncedAt && <FreshnessBadge freshnessDate={stats.lastSyncedAt} label="last sync" />}
            <Link href="/admin/data-sources" className="text-xs text-text-secondary hover:underline">
              ← back to all sources
            </Link>
          </span>
        }
      />

      {stats.slug === 'imd-rankings' && <ImdUploadWidget />}

      <Section title="Health (7d)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Success rate"
            value={sr === null ? '—' : `${(sr * 100).toFixed(0)}%`}
            tone={healthTone}
          />
          <StatCard label="Succeeded" value={stats.window.last7d.succeeded} />
          <StatCard
            label="Failed"
            value={stats.window.last7d.failed}
            tone={stats.window.last7d.failed > 0 ? 'danger' : 'neutral'}
          />
          <StatCard
            label="Avg duration (30d)"
            value={
              stats.window.last30d.avgDurationMs === null
                ? '—'
                : `${(stats.window.last30d.avgDurationMs / 1000).toFixed(1)}s`
            }
          />
        </div>
      </Section>

      <Section title="Volume (30d)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="Total runs" value={stats.window.last30d.totalRuns} />
          <StatCard label="Records loaded" value={stats.window.last30d.recordsLoaded.toLocaleString()} />
          <StatCard
            label="Records failed"
            value={stats.window.last30d.recordsFailed.toLocaleString()}
            tone={stats.window.last30d.recordsFailed > 0 ? 'warning' : 'neutral'}
          />
        </div>
      </Section>

      <Section title="Daily run history (7d)">
        <div className="rounded-lg border border-border-default bg-surface-1 p-4">
          <div className="flex items-end gap-2">
            {stats.sparkline.map((d) => {
              const total = d.succeeded + d.failed;
              const max = Math.max(...stats.sparkline.map((x) => x.succeeded + x.failed), 1);
              const h = total === 0 ? 4 : Math.round((total / max) * 64) + 4;
              const failFrac = total === 0 ? 0 : d.failed / total;
              return (
                <div key={d.day} className="flex flex-col items-center gap-1">
                  <div
                    className="w-8 overflow-hidden rounded-t-sm border border-border-subtle"
                    style={{ height: h }}
                    title={`${d.day}: ${d.succeeded} ok / ${d.failed} failed`}
                  >
                    <div
                      className="bg-danger"
                      style={{ height: `${failFrac * 100}%` }}
                    />
                    <div className="bg-success" style={{ height: `${(1 - failFrac) * 100}%` }} />
                  </div>
                  <div className="font-mono text-[10px] text-text-tertiary">
                    {d.day.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Recent runs">
        <div className="overflow-hidden rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Status</th>
                <th className="p-3">Loaded</th>
                <th className="p-3">Failed</th>
                <th className="p-3">Duration</th>
                <th className="p-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-text-tertiary">
                    No runs recorded.
                  </td>
                </tr>
              ) : (
                stats.recent.map((r) => (
                  <tr key={r.id} className="border-t border-border-subtle">
                    <td className="p-3 font-mono text-xs">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <Badge tone={r.status === 'SUCCEEDED' ? 'success' : r.status === 'FAILED' ? 'danger' : 'neutral'}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="p-3 font-tabular">{r.recordsLoaded}</td>
                    <td className="p-3 font-tabular">{r.recordsFailed}</td>
                    <td className="p-3 font-tabular">
                      {r.durationMs === null ? '—' : `${(r.durationMs / 1000).toFixed(1)}s`}
                    </td>
                    <td className="p-3 text-xs text-text-tertiary">
                      {r.errorCode ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {stats.lastFailure && (
        <Section title="Last failure detail">
          <div className="rounded-lg border border-danger bg-danger/10 p-4">
            <div className="text-xs text-text-tertiary">
              {new Date(stats.lastFailure.createdAt).toLocaleString()} · attempt{' '}
              {stats.lastFailure.attempt}
            </div>
            <div className="mt-1 font-mono text-sm text-danger">
              {stats.lastFailure.errorCode ?? 'UNKNOWN'}
            </div>
            {stats.lastFailure.errorMessage && (
              <pre className="mt-2 whitespace-pre-wrap text-xs text-text-secondary">
                {stats.lastFailure.errorMessage}
              </pre>
            )}
          </div>
        </Section>
      )}
    </AuthedAppShell>
  );
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneCls =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
      ? 'text-warning'
      : tone === 'danger'
      ? 'text-danger'
      : 'text-text-primary';
  return (
    <div className="rounded-lg border border-border-default bg-surface-1 p-4">
      <div className="text-xs uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className={`mt-1 font-tabular text-2xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}
