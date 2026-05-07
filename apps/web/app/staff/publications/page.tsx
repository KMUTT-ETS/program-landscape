import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { PublicationsClient } from './client';
import type { FilterOptions, PublicationsResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Publications — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
function one(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const sources = arr(sp.sources);
  const activeOnly = one(sp.activeOnly) === 'true';
  const yearFromRaw = one(sp.yearFrom);
  const yearFrom = yearFromRaw && /^\d+$/.test(yearFromRaw) ? Number(yearFromRaw) : undefined;

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  sources.forEach((v) => qs.append('sources', v));
  if (activeOnly) qs.set('activeOnly', 'true');
  if (yearFrom) qs.set('yearFrom', String(yearFrom));

  const [data, options] = await Promise.all([
    apiFetch<PublicationsResponse>(`/staff-dashboard/publications${qs.toString() ? `?${qs}` : ''}`).catch(
      () => null,
    ),
    apiFetch<FilterOptions>('/staff-dashboard/filter-options').catch(() => null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Publications"
        subtitle="The full KKU publications corpus from the internal kku-publications mirror — Scopus + PubMed authorships, drilled by faculty / department / author / year / type / venue."
      />
      {data && options ? (
        <PublicationsClient
          data={data}
          options={options}
          initialFilters={{ facultyName, sources, activeOnly, yearFrom }}
        />
      ) : (
        <Card>
          <p className="text-sm text-text-secondary">No data yet.</p>
        </Card>
      )}
    </AuthedAppShell>
  );
}
