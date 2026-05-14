import { redirect } from 'next/navigation';
import { canSeeFacultyDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { CompensationClient } from './client';
import type { CompensationResponse, FilterOptions } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compensation & funding — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function CompensationPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeFacultyDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const track = arr(sp.track).filter((t): t is 'ACADEMIC' | 'SUPPORT' => t === 'ACADEMIC' || t === 'SUPPORT');
  const budgetId = arr(sp.budgetId);

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  track.forEach((v) => qs.append('track', v));
  budgetId.forEach((v) => qs.append('budgetId', v));

  const dataRes = await apiFetchSafe<CompensationResponse>(
    `/staff-dashboard/compensation${qs.toString() ? `?${qs}` : ''}`,
  );
  const options = await apiFetch<FilterOptions>('/staff-dashboard/filter-options').catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Salaries and funding"
        subtitle="Where each person's salary comes from, and the income mix per faculty. To protect privacy, individual salaries are never shown — only buckets of 5 or more people."
      />
      {dataRes.ok && options ? (
        <CompensationClient
          data={dataRes.data}
          options={options}
          initialFilters={{ facultyName, track, budgetId }}
        />
      ) : (
        <DiagnosticEmptyState
          surface="staff compensation"
          error={dataRes.ok ? null : dataRes.error}
        />
      )}
    </AuthedAppShell>
  );
}
