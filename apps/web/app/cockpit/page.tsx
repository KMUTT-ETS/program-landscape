import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader, FreshnessBadge } from '@kku/ui';
import { CockpitClient } from './client';
import type { CockpitKpis, CockpitHeatmap, CockpitMatrix, CockpitRollup, SavedView } from './types';
import type { RecruitmentDashboardPayload } from '../education/recruitment/client';

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
  const [kpis, heatmap, matrix, rollup, recruitment, savedViews] = await Promise.all([
    apiFetch<CockpitKpis>(`/cockpit/kpis?${qs}`).catch(() => null),
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
      />
    </AuthedAppShell>
  );
}
