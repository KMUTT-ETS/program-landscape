import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import type { ActivePivotResponse } from '../types';
import { EducationBackLink } from '../back-link';
import { ActivePivotClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Active students by entry year — Education' };

export default async function ActivePivotPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const data = await apiFetch<ActivePivotResponse>(
    '/education/active-pivot',
  ).catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Active students by entry year"
        subtitle="Currently-enrolled students broken out by entry year (columns) and Faculty → Program Level → Program (rows)."
      />
      {data && data.rows.length > 0 ? (
        <ActivePivotClient data={data} />
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
