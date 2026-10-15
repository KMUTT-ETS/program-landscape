import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { OrganizationClient, type AdminOrganizationResponse } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Organisation — Admin' };

export default async function AdminOrganizationPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  let data: AdminOrganizationResponse | null = null;
  let loadError: string | null = null;
  try {
    data = await apiFetch<AdminOrganizationResponse>('/admin/organization');
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <AuthedAppShell user={user}>
      <OrganizationClient initial={data} loadError={loadError} />
    </AuthedAppShell>
  );
}
