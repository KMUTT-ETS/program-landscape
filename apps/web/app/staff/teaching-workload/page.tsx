import { redirect } from 'next/navigation';
import { canSeeFacultyDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { TeachingWorkloadClient } from './client';
import type {
  ByFacultyResponse,
  FilterOptions,
  HistogramResponse,
  Summary,
  TeachersResponse,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching workload — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function TeachingWorkloadPage({
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
  const onlyUnresolved = sp.onlyUnresolved === 'true';

  const qs = new URLSearchParams();
  if (acadYearBE !== undefined) qs.set('acadYearBE', String(acadYearBE));
  if (semester !== undefined) qs.set('semester', String(semester));
  levelName.forEach((l) => qs.append('levelName', l));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const teacherQs = new URLSearchParams(qs);
  if (onlyUnresolved) teacherQs.set('onlyUnresolved', 'true');
  teacherQs.set('limit', '500');

  const [summaryRes, histRes, facRes, teachersRes, optionsRes] = await Promise.all([
    apiFetchSafe<Summary>(`/staff-dashboard/teaching-workload/summary${suffix}`),
    apiFetchSafe<HistogramResponse>(
      `/staff-dashboard/teaching-workload/histogram${suffix}`,
    ),
    apiFetchSafe<ByFacultyResponse>(
      `/staff-dashboard/teaching-workload/by-faculty${suffix}`,
    ),
    apiFetchSafe<TeachersResponse>(
      `/staff-dashboard/teaching-workload/teachers?${teacherQs.toString()}`,
    ),
    apiFetch<FilterOptions>(
      '/staff-dashboard/teaching-workload/filter-options',
    ).catch(() => null),
  ]);

  if (!summaryRes.ok && !histRes.ok && !facRes.ok && !teachersRes.ok) {
    return (
      <AuthedAppShell user={user}>
        <StaffBackLink />
        <PageHeader
          title="Teaching workload"
          subtitle="Subject contact hours per teacher. Source: POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER."
        />
        <DiagnosticEmptyState
          surface="teaching workload"
          error={summaryRes.ok ? null : summaryRes.error}
        />
      </AuthedAppShell>
    );
  }

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Teaching workload"
        subtitle="Subject contact hours per teacher, derived from COURSEUNIT lecture + lab hours/week × every section their KKUMAIL appears on. Defaults to the most recent fully-completed main semester."
      />
      <TeachingWorkloadClient
        summary={summaryRes.ok ? summaryRes.data : null}
        histogram={histRes.ok ? histRes.data : null}
        byFaculty={facRes.ok ? facRes.data : null}
        teachers={teachersRes.ok ? teachersRes.data : null}
        options={optionsRes}
        initialFilters={{ acadYearBE, semester, levelName, onlyUnresolved }}
      />
    </AuthedAppShell>
  );
}
