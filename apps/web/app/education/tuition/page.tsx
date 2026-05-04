import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
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

  const sp = await searchParams;
  const semester = arr(sp.semester);
  const facultyName = arr(sp.facultyName);

  const qs = new URLSearchParams();
  semester.forEach((v) => qs.append('semester', v));
  facultyName.forEach((v) => qs.append('facultyName', v));

  const data = await apiFetch<TuitionResponse>(
    `/education/tuition${qs.toString() ? `?${qs}` : ''}`,
  ).catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Tuition fee incomes"
        subtitle="Tuition revenue by year, faculty, and semester."
      />
      {data ? (
        <TuitionClient
          data={data}
          initialFilters={{ semester, facultyName }}
        />
      ) : (
        <div className="rounded-md border border-border-subtle bg-surface-1 p-6 text-sm text-text-secondary">
          No data yet — go back to{' '}
          <a className="underline" href="/education">
            Education hub
          </a>{' '}
          and click <strong>Refresh from registry</strong> first.
        </div>
      )}
    </AuthedAppShell>
  );
}
