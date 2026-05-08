import { redirect } from 'next/navigation';
import { isUniversityWide, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import type { InternationalResponse } from '../types';
import { InternationalClient } from './client';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'International students — Education' };

export default async function InternationalPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isUniversityWide(user.role)) redirect('/no-access');

  const data = await apiFetch<InternationalResponse>(
    '/education/international',
  ).catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="International students"
        subtitle="Currently-enrolled non-Thai students by country of origin and program."
      />
      {data ? (
        <InternationalClient data={data} />
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
