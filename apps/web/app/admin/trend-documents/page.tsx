import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { PageHeader } from '@kku/ui';
import { TrendDocumentsClient, type TrendDocumentRow } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add signal from document — Admin' };

export default async function AdminTrendDocumentsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  // ANALYST + admin-grade can upload (pdf:upload); everyone else redirected.
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  const initial = await apiFetchSafe<TrendDocumentRow[]>('/admin/trend-documents?limit=100');

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Add signal from document" />
      <PageHeader
        title="Add signal from document"
        subtitle="Upload a PDF (e.g. a manpower-demand or job-posting report) or paste a URL. AI reads it, drafts a trend signal, and publishes it to the Trends Radar — then tags the KKU programs and skills it affects and the actions it implies."
      />
      <TrendDocumentsClient initial={initial.ok ? initial.data : []} />
    </AuthedAppShell>
  );
}
