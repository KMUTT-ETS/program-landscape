import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { PageHeader, Section } from '@kku/ui';
import { TopologyGraph, type LiveStatusMap } from './topology-graph';
import { TOPOLOGY_COUNTS } from './topology-data';

// ──────────────────────────────────────────────────────────────────────────
// /admin/application-topology — whole-application data topology
//
// Operator-facing map of how data flows from external systems through
// connectors + scripts into Postgres tables and out into every dashboard.
// Doubles as a quick ops view — connector nodes carry their live
// `DataSource.status` + last-sync timestamp.
//
// Was scoped to Education + Staff in v1; expanded 2026-05-16 to cover
// every active connector in /admin/data-sources, every AI task, and
// every consumer module (Education + Staff + Cockpit + Deep-Dive +
// Risk + Trends + Gap + Benchmarking + Scenarios + Decisions + Analyst).
// ──────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Application topology — Admin' };

interface DataSourceListRow {
  slug: string;
  status: string;
  mocked: boolean;
  lastSyncedAt: string | null;
  _count: { ingestionRuns: number };
}

export default async function ApplicationTopologyPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  // Live enrichment — DataSource.status + lastSyncedAt per slug. Connector
  // nodes that match a slug render a LIVE/MOCK pill in the canvas and the
  // full status panel on click. Best-effort: a failed call just hides the
  // pills (the topology still reads correctly).
  const rows = await apiFetch<DataSourceListRow[]>('/data-sources').catch(
    () => null as DataSourceListRow[] | null,
  );

  const liveStatus: LiveStatusMap = {};
  for (const r of rows ?? []) {
    liveStatus[r.slug] = {
      mocked: r.mocked,
      status: r.status,
      lastSyncedAt: r.lastSyncedAt,
      runsTotal: r._count?.ingestionRuns ?? 0,
    };
  }

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Application topology" />
      <PageHeader
        title="Application topology"
        subtitle="Whole-application data flow — every active connector → its Postgres tables → every consuming module + dashboard. Connector nodes carry live status from /admin/data-sources. Hover to trace a path; click any node for details."
      />

      <CountStrip />

      <Section title="External systems → connectors → tables → dashboards">
        <TopologyGraph liveStatus={liveStatus} />
      </Section>
    </AuthedAppShell>
  );
}

function CountStrip() {
  const cards: Array<{ label: string; value: number }> = [
    { label: 'External systems', value: TOPOLOGY_COUNTS.external },
    { label: 'Connectors + scripts', value: TOPOLOGY_COUNTS.connectors },
    { label: 'Postgres tables', value: TOPOLOGY_COUNTS.tables },
    { label: 'AI tasks', value: TOPOLOGY_COUNTS.ai },
    { label: 'Dashboards', value: TOPOLOGY_COUNTS.dashboards },
    { label: 'Edges', value: TOPOLOGY_COUNTS.edges },
  ];
  return (
    <Section title="At a glance">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-border-default bg-surface-1 p-4"
          >
            <div className="text-xs uppercase tracking-wide text-text-tertiary">
              {c.label}
            </div>
            <div className="mt-1 font-tabular text-2xl font-semibold text-text-primary">
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
