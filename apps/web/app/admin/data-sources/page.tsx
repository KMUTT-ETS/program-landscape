import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader, Section } from '@kku/ui';
import { DataSourcesClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data Sources — Admin' };

// Row shape the NestJS /data-sources endpoint returns after prompt 03.
// Mirrors the DataSource model + _count.ingestionRuns and the new fields.
export interface DataSourceRow {
  id: string;
  slug: string;
  name: string;
  kind: 'API' | 'PDF' | 'CSV' | 'SCRAPE';
  inputFormat: 'JSON' | 'CSV' | 'XML' | 'HTML' | 'PDF' | 'XLSX' | 'MIXED';
  baseUrl: string | null;
  cadenceCron: string | null;
  scheduleEnabled: boolean;
  lastSyncedAt: string | null;
  status: string;
  ownerContact: string | null;
  notes: string | null;
  _count: { ingestionRuns: number };
}

export interface OverviewStats {
  total: number;
  active: number;
  paused: number;
  erroring: number;
  runsLast24h: number;
  failuresLast24h: number;
}

export default async function AdminDataSourcesPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  // ANALYST + admin-grade have data_sources:read; everyone else redirected.
  if (!isAdminGrade(user.role)) redirect('/no-access');

  // sources is the canary — if the listing fails the page can't render
  // meaningfully. overview is best-effort (the strip just hides).
  const sourcesRes = await apiFetchSafe<DataSourceRow[]>('/data-sources');
  const overview = await apiFetch<OverviewStats>('/data-sources/admin/overview').catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Data sources"
        subtitle="Every external feed powering this app — from KKU Registry to WEF Future of Jobs. Real wiring in prompt 14; mocked sources are marked."
      />
      {overview && <OverviewStrip overview={overview} />}
      <Section title="Connectors">
        {sourcesRes.ok ? (
          <DataSourcesClient rows={sourcesRes.data} canConfigure={isAdminGrade(user.role)} />
        ) : (
          <DiagnosticEmptyState surface="data sources" error={sourcesRes.error} />
        )}
      </Section>
    </AuthedAppShell>
  );
}

function OverviewStrip({ overview }: { overview: OverviewStats }) {
  const cards: Array<{ label: string; value: string | number; tone?: 'danger' }> = [
    { label: 'Total sources', value: overview.total },
    { label: 'Active', value: overview.active },
    { label: 'Paused', value: overview.paused },
    { label: 'Erroring', value: overview.erroring, tone: overview.erroring > 0 ? 'danger' : undefined },
    { label: 'Runs (24h)', value: overview.runsLast24h },
    { label: 'Failures (24h)', value: overview.failuresLast24h, tone: overview.failuresLast24h > 0 ? 'danger' : undefined },
  ];
  return (
    <Section title="Overview">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-border-default bg-surface-1 p-4"
          >
            <div className="text-xs uppercase tracking-wide text-text-tertiary">
              {c.label}
            </div>
            <div
              className={`mt-1 font-tabular text-2xl font-semibold ${
                c.tone === 'danger' ? 'text-danger' : 'text-text-primary'
              }`}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
