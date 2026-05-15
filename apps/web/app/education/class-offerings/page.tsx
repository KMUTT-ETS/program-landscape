import { redirect } from 'next/navigation';
import { canSeeFacultyDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { EducationBackLink } from '../back-link';
import { ClassOfferingsClient } from './client';
import type {
  DeepDiveResponse,
  DistributionResponse,
  FilterOptions,
  GeResponse,
  HeatmapResponse,
  Summary,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subject offerings & fulfilment — Education' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function ClassOfferingsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeFacultyDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const acadYearBE = sp.acadYearBE
    ? Number(Array.isArray(sp.acadYearBE) ? sp.acadYearBE[0] : sp.acadYearBE)
    : undefined;
  const semester = sp.semester
    ? Number(Array.isArray(sp.semester) ? sp.semester[0] : sp.semester)
    : undefined;
  const levelName = arr(sp.levelName);
  const geOnly = sp.geOnly === 'true' || sp.geOnly === '1';

  const qs = new URLSearchParams();
  if (acadYearBE !== undefined) qs.set('acadYearBE', String(acadYearBE));
  if (semester !== undefined) qs.set('semester', String(semester));
  levelName.forEach((l) => qs.append('levelName', l));
  if (geOnly) qs.set('geOnly', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  // Five parallel fetches — keeps cold-load time tight when the cube has
  // 122k rows. apiFetchSafe lets each panel render its own empty state.
  const [summaryRes, heatmapRes, distRes, geRes, deepRes, optionsRes] =
    await Promise.all([
      apiFetchSafe<Summary>(`/education/class-offerings/summary${suffix}`),
      apiFetchSafe<HeatmapResponse>(`/education/class-offerings/heatmap${suffix}`),
      apiFetchSafe<DistributionResponse>(
        `/education/class-offerings/distribution${suffix}`,
      ),
      apiFetchSafe<GeResponse>(`/education/class-offerings/ge`),
      apiFetchSafe<DeepDiveResponse>(
        `/education/class-offerings/deep-dive${suffix}${suffix ? '&' : '?'}limit=500`,
      ),
      apiFetch<FilterOptions>(
        '/education/class-offerings/filter-options',
      ).catch(() => null),
    ]);

  // If everything failed (e.g., scope = none), surface a single empty state.
  if (!summaryRes.ok && !heatmapRes.ok && !distRes.ok && !geRes.ok && !deepRes.ok) {
    return (
      <AuthedAppShell user={user}>
        <EducationBackLink />
        <PageHeader
          title="Subject offerings & fulfilment"
          subtitle="One row per CLASSID — every section opened. Source: POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER."
        />
        <DiagnosticEmptyState
          surface="class offerings"
          error={summaryRes.ok ? null : summaryRes.error}
        />
      </AuthedAppShell>
    );
  }

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Subject offerings & fulfilment"
        subtitle="Every course-section the registrar opened, with seat fulfilment, credit load, and a dedicated General-Education view. Defaults to the most recent fully-completed main semester."
      />
      <ClassOfferingsClient
        summary={summaryRes.ok ? summaryRes.data : null}
        heatmap={heatmapRes.ok ? heatmapRes.data : null}
        distribution={distRes.ok ? distRes.data : null}
        ge={geRes.ok ? geRes.data : null}
        deepDive={deepRes.ok ? deepRes.data : null}
        options={optionsRes}
        initialFilters={{ acadYearBE, semester, levelName, geOnly }}
      />
    </AuthedAppShell>
  );
}
