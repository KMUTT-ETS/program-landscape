import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { DataSourceMark, acknowledgementHref } from '@/components/data-source-mark';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { JobFieldsReview, type JobFieldRowDto, type ProgramJobFieldRowDto } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job fields — Admin' };

export default async function AdminJobFieldsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  const [fields, assignments] = await Promise.all([
    apiFetchSafe<JobFieldRowDto[]>('/admin/job-fields'),
    apiFetchSafe<ProgramJobFieldRowDto[]>('/admin/job-fields/assignments'),
  ]);

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Job fields" />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <DataSourceMark source="jobthai" size={24} href={acknowledgementHref('jobthai')} />
            Job fields
          </span>
        }
        subtitle="The fields of study JobThai employers ask for, clustered from the free-text strings on postings, and the programmes assigned to each. Proposed rows already appear on the Gap Analyzer, labelled unreviewed; approving one makes it Council-grade. Rebuilt after every JobThai upload (pnpm jobthai:fields for a dry run)."
      />
      {fields.ok && assignments.ok ? (
        <JobFieldsReview fields={fields.data} assignments={assignments.data} />
      ) : (
        <DiagnosticEmptyState surface="job fields" error={!fields.ok ? fields.error : assignments.ok ? null : assignments.error} />
      )}
    </AuthedAppShell>
  );
}
