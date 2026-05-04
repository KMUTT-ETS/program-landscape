import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { FacultyByProgramClient } from './client';
import type { FacultyByProgramResponse } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Faculty composition by program — Staff' };

export default async function FacultyByProgramPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const data = await apiFetch<FacultyByProgramResponse>(
    '/staff-dashboard/faculty-by-program',
  ).catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Programs and their staff"
        subtitle={`Drill from each faculty into its programs to see who teaches there. Every program needs at least ${data?.thresholds.responsibleMinimum ?? 5} อาจารย์ผู้รับผิดชอบหลักสูตร — programs falling short are flagged.`}
      />
      {!data ? (
        <Card>
          <p className="text-sm text-text-secondary">No data yet.</p>
        </Card>
      ) : (
        <FacultyByProgramClient data={data} />
      )}
    </AuthedAppShell>
  );
}
