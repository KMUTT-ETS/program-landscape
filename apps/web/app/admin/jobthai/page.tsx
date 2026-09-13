import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { PageHeader } from '@kku/ui';
import { JobThaiClient, type JobThaiBatchRow } from './client';
import { DataSourceMark } from '@/components/data-source-mark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'JobThai drops — Admin' };

export default async function AdminJobThaiPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  const initial = await apiFetchSafe<JobThaiBatchRow[]>('/admin/jobthai/batches?limit=100');

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="JobThai drops" />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <DataSourceMark source="jobthai" size={24} />
            JobThai drops
          </span>
        }
        subtitle="Upload the XLSX files JobThai sends. Each file becomes a batch: the postings are parsed, skills matched against the taxonomy, and occupations derived from the job categories. Uploading the same file twice is a no-op."
      />
      <JobThaiClient initial={initial.ok ? initial.data : []} />
    </AuthedAppShell>
  );
}
