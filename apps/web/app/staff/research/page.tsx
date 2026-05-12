import { redirect } from 'next/navigation';
import { isUniversityWide, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { ResearchClient } from './client';
import type { FilterOptions, ResearchResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research and publications — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
function one(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isUniversityWide(user.role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const sources = arr(sp.sources);
  const yearFromRaw = one(sp.yearFrom);
  const yearFrom = yearFromRaw && /^\d+$/.test(yearFromRaw) ? Number(yearFromRaw) : undefined;

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  sources.forEach((v) => qs.append('sources', v));
  if (yearFrom) qs.set('yearFrom', String(yearFrom));

  const dataRes = await apiFetchSafe<ResearchResponse>(
    `/staff-dashboard/research${qs.toString() ? `?${qs}` : ''}`,
  );
  const options = await apiFetch<FilterOptions>('/staff-dashboard/filter-options').catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Research and publications"
        subtitle="All KKU staff publications (incl. retired) from the internal kku-publications mirror — Scopus + PubMed authorships, drilled by faculty / author / year / type / venue. This is historical-output measurement; program-scoring views (health score, lifecycle) use only active staff and live elsewhere."
      />
      {dataRes.ok && options ? (
        <ResearchClient
          data={dataRes.data}
          options={options}
          initialFilters={{ facultyName, sources, yearFrom }}
        />
      ) : (
        <DiagnosticEmptyState
          surface="research and publications"
          error={dataRes.ok ? null : dataRes.error}
        />
      )}
    </AuthedAppShell>
  );
}
