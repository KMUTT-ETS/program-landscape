import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
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
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const dataRes = await apiFetchSafe<ActivePivotResponse>('/education/active-pivot');

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Active students by entry year"
        subtitle="Currently-enrolled students broken out by entry year (columns) and Faculty → Program Level → Program (rows)."
      />
      {dataRes.ok && dataRes.data.rows.length > 0 ? (
        <ActivePivotClient data={dataRes.data} />
      ) : (
        <DiagnosticEmptyState
          surface="active-students pivot"
          error={dataRes.ok ? null : dataRes.error}
          emptyMessage="No data yet — go back to Education hub and click Refresh from registry first."
        />
      )}
    </AuthedAppShell>
  );
}
