import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import type { InternationalResponse } from '../types';
import { InternationalClient } from './client';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'International students — Education' };

export default async function InternationalPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const dataRes = await apiFetchSafe<InternationalResponse>('/education/international');

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="International students"
        subtitle="Currently-enrolled non-Thai students by country of origin and program."
      />
      {dataRes.ok ? (
        <InternationalClient data={dataRes.data} />
      ) : (
        <DiagnosticEmptyState surface="international students" error={dataRes.error} />
      )}
    </AuthedAppShell>
  );
}
