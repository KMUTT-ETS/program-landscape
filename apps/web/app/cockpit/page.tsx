import { orgShortNamesForRequest } from '@/lib/branding';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader, FreshnessBadge } from '@kku/ui';
import { prisma } from '@kku/db';
import { CockpitClient } from './client';
import type {
  CockpitKpis,
  CockpitHeatmap,
  CockpitMatrix,
  CockpitRollup,
  SavedView,
  ScopeBreadcrumbCrumb,
} from './types';
import type { RecruitmentDashboardPayload } from './recruitment-payload';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Portfolio Cockpit' };

export default async function CockpitPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; scopeId?: string; view?: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const org = await orgShortNamesForRequest();

  const sp = await searchParams;
  const scope = sp.scope ?? 'university';
  const scopeId = sp.scopeId ?? '';

  // Program scope → Deep-Dive (prompt 06 stub for now). Keep the
  // redirect here so the cockpit never fights the top-bar selector
  // when a user picks a program from the tree.
  if (scope === 'program' && scopeId) {
    redirect(`/programs/${scopeId}`);
  }

  const qs = new URLSearchParams({ scope, ...(scopeId ? { scopeId } : {}) });
  // KPIs is the canary — if it fails on auth/permission/server we
  // surface the diagnostic instead of rendering empty sub-sections.
  // The other fetches stay best-effort (each section can be null).
  const kpisRes = await apiFetchSafe<CockpitKpis>(`/cockpit/kpis?${qs}`);
  const kpis = kpisRes.ok ? kpisRes.data : null;
  const kpisError = kpisRes.ok ? null : kpisRes.error;
  const [heatmap, matrix, rollup, recruitment, savedViews] = await Promise.all([
    apiFetch<CockpitHeatmap>(`/cockpit/heatmap?${qs}`).catch(() => null),
    apiFetch<CockpitMatrix>(`/cockpit/matrix?${qs}`).catch(() => null),
    apiFetch<CockpitRollup>(`/cockpit/rollup?${qs}`).catch(() => null),
    apiFetch<RecruitmentDashboardPayload>(`/cockpit/recruitment?${qs}`).catch(() => null),
    apiFetch<SavedView[]>(`/cockpit/saved-views`).catch(() => [] as SavedView[]),
  ]);

  const initialView = (
    sp.view === 'matrix' || sp.view === 'rollup' || sp.view === 'recruitment'
      ? sp.view
      : 'heatmap'
  ) as 'heatmap' | 'matrix' | 'rollup' | 'recruitment';

  // Breadcrumb path — root is always present; faculty/department add
  // themselves with names looked up from Prisma so the breadcrumb shows
  // Thai-primary labels with EN below.
  const breadcrumb: ScopeBreadcrumbCrumb[] = [
    { scope: 'university', scopeId: null, labelTh: `${org.th} (ภาพรวม)`, labelEn: `${org.en} University` },
  ];
  if (scope === 'faculty' && scopeId) {
    const fac = await prisma.faculty.findUnique({
      where: { id: scopeId },
      select: { id: true, nameEn: true, nameTh: true },
    });
    if (fac) breadcrumb.push({ scope: 'faculty', scopeId: fac.id, labelTh: fac.nameTh, labelEn: fac.nameEn });
  } else if (scope === 'department' && scopeId) {
    const dept = await prisma.department.findUnique({
      where: { id: scopeId },
      select: {
        id: true, nameEn: true, nameTh: true,
        faculty: { select: { id: true, nameEn: true, nameTh: true } },
      },
    });
    if (dept?.faculty) {
      breadcrumb.push({ scope: 'faculty', scopeId: dept.faculty.id, labelTh: dept.faculty.nameTh, labelEn: dept.faculty.nameEn });
      breadcrumb.push({ scope: 'department', scopeId: dept.id, labelTh: dept.nameTh, labelEn: dept.nameEn });
    }
  }

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        moduleKey="cockpit"
        eyebrow="Module 01 · Portfolio Cockpit"
        title="Portfolio Overview"
        subtitle="Health heatmap, strategic matrix, and rollup tree for every program at the selected scope."
        actions={
          kpis?.latestFreshness ? (
            <FreshnessBadge freshnessDate={kpis.latestFreshness} />
          ) : undefined
        }
      />
      {kpisError ? (
        <DiagnosticEmptyState surface="cockpit" error={kpisError} />
      ) : (
        <CockpitClient
          user={user}
          scope={scope}
          scopeId={scopeId}
          initialView={initialView}
          kpis={kpis}
          heatmap={heatmap}
          matrix={matrix}
          rollup={rollup}
          recruitment={recruitment}
          savedViews={savedViews}
          breadcrumb={breadcrumb}
        />
      )}
    </AuthedAppShell>
  );
}
