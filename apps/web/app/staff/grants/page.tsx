import { orgShortNamesForRequest } from '@/lib/branding';
import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type ApiMeta, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchEnvelope, type ApiFetchError } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { GrantsClient, type GrantsFilters } from './client';
import type { FilterOptions, GrantsResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research and academic service grants — Staff' };

type SP = Record<string, string | string[] | undefined>;
const arr = (v: string | string[] | undefined): string[] => (!v ? [] : Array.isArray(v) ? v : [v]);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const int = (v: string | string[] | undefined) => {
  const raw = one(v);
  return raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
};
const SORTS = ['year', 'budget', 'title'] as const;
const TYPES = new Set(['RESEARCH', 'ACADEMIC_SERVICE', 'CONSULTING', 'OTHER']);
// The API rejects a year outside this Buddhist-era window with a 400, which
// would blank the page over a mistyped URL — drop such a value instead.
const beYear = (v: string | string[] | undefined) => {
  const n = int(v);
  return n !== undefined && n >= 2500 && n <= 2700 ? n : undefined;
};

// apiFetchEnvelope throws a plain Error carrying only the envelope's error
// code; DiagnosticEmptyState wants the categorised ApiFetchError that
// apiFetchSafe produces. We need `meta` (provenance + freshness), so we use
// the envelope fetch and map the code to a category here.
function toFetchError(err: unknown): ApiFetchError {
  const code = (err as { code?: string }).code ?? null;
  const e = new Error((err as Error).message) as ApiFetchError;
  e.status = null;
  e.code = code;
  e.category =
    code === 'UNAUTHORIZED'
      ? 'auth'
      : code === 'FORBIDDEN'
        ? 'permission'
        : code === 'NOT_FOUND'
          ? 'notFound'
          : err instanceof TypeError
            ? 'network'
            : 'unknown';
  return e;
}

export default async function GrantsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const org = await orgShortNamesForRequest();
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const sortRaw = one(sp.sort);
  const filters: GrantsFilters = {
    facultyName: arr(sp.facultyName),
    type: arr(sp.type).filter((t) => TYPES.has(t)),
    funder: arr(sp.funder),
    yearFrom: beYear(sp.yearFrom),
    yearTo: beYear(sp.yearTo),
    page: int(sp.page) ?? 1,
    sort: SORTS.find((s) => s === sortRaw) ?? 'year',
    project: one(sp.project) ?? null,
  };
  const qs = new URLSearchParams();
  filters.facultyName.forEach((v) => qs.append('facultyName', v));
  filters.type.forEach((v) => qs.append('type', v));
  filters.funder.forEach((v) => qs.append('funder', v));
  if (filters.yearFrom !== undefined) qs.set('yearFrom', String(filters.yearFrom));
  if (filters.yearTo !== undefined) qs.set('yearTo', String(filters.yearTo));
  qs.set('page', String(filters.page));
  qs.set('sort', filters.sort);

  let data: GrantsResponse | null = null;
  let meta: ApiMeta | null = null;
  let error: ApiFetchError | null = null;
  try {
    const env = await apiFetchEnvelope<GrantsResponse>(`/staff-dashboard/grants?${qs}`);
    data = env.data;
    meta = env.meta;
  } catch (e) {
    error = toFetchError(e);
  }
  // The grants data is the essential part; without filter options the
  // dashboard still renders, just with an empty faculty picker.
  const options = await apiFetch<FilterOptions>('/staff-dashboard/filter-options').catch(
    (): FilterOptions => ({
      faculties: [],
      staffTypes: [],
      tracks: [],
      academicStandings: [],
      positionLevels: [],
      budgets: [],
      nationalities: [],
    }),
  );

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Research and academic service grants"
        subtitle={`Externally funded research and academic-service projects recorded by ${org.en} Research Administration, synced daily. A project counts for every faculty on its team; budgets are whole-project figures, never split between people.`}
      />
      {data && meta ? (
        <GrantsClient data={data} meta={meta} options={options} initialFilters={filters} />
      ) : (
        <DiagnosticEmptyState surface="research and academic service grants" error={error} />
      )}
    </AuthedAppShell>
  );
}
