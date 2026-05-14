import { redirect } from 'next/navigation';
import { canSeeFacultyDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { FacultyByProgramClient } from './client';
import type { FacultyByProgramResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Faculty composition by program — Staff' };

export default async function FacultyByProgramPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeFacultyDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const dataRes = await apiFetchSafe<FacultyByProgramResponse>(
    '/staff-dashboard/faculty-by-program',
  );

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Programs and their staff"
        subtitle={`Drill from each faculty into its programs to see who teaches there. Every program needs at least ${dataRes.ok ? dataRes.data.thresholds.responsibleMinimum : 5} อาจารย์ผู้รับผิดชอบหลักสูตร — programs falling short are flagged.`}
      />
      {dataRes.ok ? (
        <FacultyByProgramClient data={dataRes.data} />
      ) : (
        <DiagnosticEmptyState surface="faculty by program" error={dataRes.error} />
      )}
    </AuthedAppShell>
  );
}
