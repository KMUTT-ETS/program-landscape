import { redirect } from 'next/navigation';
import type { SessionUser, ApiSuccess } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Button, EdgeGlow, KPI, PageHeader, Section } from '@kku/ui';
import Link from 'next/link';
import { FileUp, Plus } from 'lucide-react';
import { ProgramsListClient, type ProgramListRow } from './list-client';
import { PipelineClient, type PipelineStats } from './pipeline/client';

// 2026-05-02: merged the previous /admin/programs (CRUD list) and
// /admin/programs/pipeline (digest workflow) into one page with two
// top-level tabs. The KPI strip is always visible — it provides
// context for both views (operational state of the curriculum
// pipeline as a whole). View state lives in the URL: ?view=list
// (default) or ?view=pipeline.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Programs — Admin' };

type PaginatedEnvelope = ApiSuccess<ProgramListRow[]> & {
  meta: { pagination?: { page: number; pageSize: number; total: number } };
};

const EMPTY_STATS: PipelineStats = {
  programsTotal: 0,
  withPdf: 0,
  missingPdf: 0,
  digested: 0,
  needDigest: 0,
  pendingReview: 0,
  approved: 0,
};

export default async function AdminProgramsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const params = await searchParams;
  const view = params.view === 'pipeline' ? 'pipeline' : 'list';

  // List filters from URL.
  const query = new URLSearchParams();
  const q = typeof params.q === 'string' ? params.q : undefined;
  const facultyId =
    typeof params.facultyId === 'string' ? params.facultyId : undefined;
  const level = typeof params.level === 'string' ? params.level : undefined;
  const status = typeof params.status === 'string' ? params.status : undefined;
  if (q) query.set('q', q);
  if (facultyId) query.set('facultyId', facultyId);
  if (level) query.set('level', level);
  if (status) query.set('status', status);
  // Admin program management is a workbench, not a paginated public
  // list — show every canonical program on one page so analysts can
  // Ctrl-F across the whole portfolio. Schema cap is 1000, well above
  // the 297 canonical rows.
  query.set('pageSize', '1000');

  // Always fetch pipeline stats (drives the always-visible KPI strip).
  // Only fetch the program list when on that view — saves a round-trip
  // when the user is on the pipeline tab.
  const [stats, listResult, faculties] = await Promise.all([
    apiFetch<PipelineStats>('/admin/programs/pipeline/stats').catch(() => EMPTY_STATS),
    view === 'list'
      ? apiFetchEnvelope<ProgramListRow[]>(
          `/admin/programs?${query.toString()}`,
        ).catch(
          () =>
            ({
              data: [] as ProgramListRow[],
              meta: {
                freshnessDate: null,
                sources: [],
                pagination: { page: 1, pageSize: 200, total: 0 },
              },
              error: null,
            }) satisfies PaginatedEnvelope,
        )
      : null,
    apiFetch<Array<{ id: string; code: string; nameEn: string; nameTh: string }>>(
      '/faculties',
    ).catch(() => []),
  ]);
  const rowsEnvelope = listResult as PaginatedEnvelope | null;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Programs"
        title="Program management"
        subtitle="Curate the 297 KKU programs and run the analyse-the-landscape pipeline. Switch between the full list (CRUD + per-program detail) and the operational pipeline view (bulk digest + approve)."
        actions={
          <div className="flex items-center gap-2">
            <EdgeGlow inline>
              <Button variant="primary" asChild>
                <Link href="/admin/programs/from-pdf">
                  <FileUp className="h-4 w-4" aria-hidden />
                  New from PDF
                </Link>
              </Button>
            </EdgeGlow>
            <Button variant="outline" asChild>
              <Link href="/admin/programs/new">
                <Plus className="h-4 w-4" aria-hidden />
                New blank
              </Link>
            </Button>
          </div>
        }
      />

      {/* Always-visible KPI strip — applies to both views, gives
          operational context regardless of which tab the user is on. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KPI tone="glossy" label="Programs" value={stats.programsTotal.toLocaleString()} />
        <KPI tone="glossy" label="With PDF" value={stats.withPdf.toLocaleString()} />
        <KPI tone="glossy" label="Missing PDF" value={stats.missingPdf.toLocaleString()} />
        <KPI tone="glossy" label="Digested" value={stats.digested.toLocaleString()} />
        <KPI tone="glossy" label="Need digest" value={stats.needDigest.toLocaleString()} />
        <KPI tone="glossy" label="Pending review" value={stats.pendingReview.toLocaleString()} />
      </div>

      {/* View tabs — URL-driven (server-render-only navigation, no
          client state). Each link preserves the list filters when
          switching tabs. */}
      <div className="mt-2 flex items-center gap-2 border-b border-border-subtle">
        <ViewTab
          label="All programs"
          active={view === 'list'}
          href={`/admin/programs?${new URLSearchParams({ ...Object.fromEntries(query.entries()), view: 'list' }).toString()}`}
        />
        <ViewTab
          label="Pipeline"
          active={view === 'pipeline'}
          href="/admin/programs?view=pipeline"
          badge={stats.needDigest + stats.pendingReview > 0
            ? (stats.needDigest + stats.pendingReview).toString()
            : undefined}
        />
      </div>

      <Section>
        {view === 'list' && rowsEnvelope ? (
          <ProgramsListClient
            rows={rowsEnvelope.data ?? []}
            total={rowsEnvelope.meta.pagination?.total ?? (rowsEnvelope.data?.length ?? 0)}
            faculties={faculties}
            initialFilters={{ q, facultyId, level, status }}
          />
        ) : (
          <PipelineClient initialStats={stats} />
        )}
      </Section>
    </AuthedAppShell>
  );
}

function ViewTab({
  label,
  href,
  active,
  badge,
}: {
  label: string;
  href: string;
  active: boolean;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'inline-flex items-center gap-2 border-b-2 border-accent px-3 py-2 text-sm font-semibold text-accent-default'
          : 'inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary'
      }
    >
      {label}
      {badge && (
        <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-warning">
          {badge}
        </span>
      )}
    </Link>
  );
}
