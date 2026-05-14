import { redirect } from 'next/navigation';
import { canSeeFacultyDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import type { TuitionResponse } from '../types';
import { TuitionClient } from './client';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tuition fee incomes — Education' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function TuitionPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeFacultyDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const semester = arr(sp.semester);
  const facultyName = arr(sp.facultyName);

  const qs = new URLSearchParams();
  semester.forEach((v) => qs.append('semester', v));
  facultyName.forEach((v) => qs.append('facultyName', v));

  const dataRes = await apiFetchSafe<TuitionResponse>(
    `/education/tuition${qs.toString() ? `?${qs}` : ''}`,
  );

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Tuition fee incomes"
        subtitle="Tuition revenue by year, faculty, and semester."
      />
      {dataRes.ok ? (
        <TuitionClient
          data={dataRes.data}
          initialFilters={{ semester, facultyName }}
        />
      ) : (
        <DiagnosticEmptyState surface="tuition revenue" error={dataRes.error} />
      )}
    </AuthedAppShell>
  );
}
