import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AcademicYearClient, type AcademicYearResponse } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Academic year — Admin' };

export default async function AdminAcademicYearPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  let data: AcademicYearResponse | null = null;
  let loadError: string | null = null;
  try {
    data = await apiFetch<AcademicYearResponse>('/admin/academic-year');
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <AuthedAppShell user={user}>
      <AcademicYearClient initial={data} loadError={loadError} />
    </AuthedAppShell>
  );
}
