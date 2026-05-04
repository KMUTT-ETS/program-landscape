import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { WorkforceClient } from './client';
import type { FilterOptions, WorkforceResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workforce — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function WorkforcePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const track = arr(sp.track).filter((t): t is 'ACADEMIC' | 'SUPPORT' => t === 'ACADEMIC' || t === 'SUPPORT');

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  track.forEach((v) => qs.append('track', v));

  const [data, options] = await Promise.all([
    apiFetch<WorkforceResponse>(
      `/staff-dashboard/workforce${qs.toString() ? `?${qs}` : ''}`,
    ).catch(() => null),
    apiFetch<FilterOptions>('/staff-dashboard/filter-options').catch(() => null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Who works here"
        subtitle="Headcount, age, tenure, retirement timeline, and the past year's hires and departures."
      />
      {data && options ? (
        <WorkforceClient data={data} options={options} initialFilters={{ facultyName, track }} />
      ) : (
        <div className="rounded-md border border-border-subtle bg-surface-1 p-6 text-sm text-text-secondary">
          No data yet. Head to the{' '}
          <a className="underline" href="/staff">
            Staff dashboard
          </a>{' '}
          and click <strong>Refresh all</strong> to pull the first snapshot.
        </div>
      )}
    </AuthedAppShell>
  );
}
