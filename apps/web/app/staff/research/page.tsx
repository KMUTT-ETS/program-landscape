import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { ResearchClient } from './client';
import type { FilterOptions, ResearchResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research output — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const academicStandingId = arr(sp.academicStandingId);

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  academicStandingId.forEach((v) => qs.append('academicStandingId', v));

  const [data, options] = await Promise.all([
    apiFetch<ResearchResponse>(`/staff-dashboard/research${qs.toString() ? `?${qs}` : ''}`).catch(
      () => null,
    ),
    apiFetch<FilterOptions>('/staff-dashboard/filter-options').catch(() => null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Research and publications"
        subtitle={`Papers and citations from the last ${data?.windowYears ?? 5} years, matched to KKU staff. Drill in to see each author's track record.`}
      />
      {data && options ? (
        <ResearchClient data={data} options={options} initialFilters={{ facultyName, academicStandingId }} />
      ) : (
        <Card>
          <p className="text-sm text-text-secondary">No data yet.</p>
        </Card>
      )}
    </AuthedAppShell>
  );
}
