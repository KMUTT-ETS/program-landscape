import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader, Section } from '@kku/ui';
import { UploadClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload PDFs' };

export default async function UploadPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  // pdf:upload is held by DEAN / DEPT_HEAD / ANALYST / admin-grade.
  const allowed =
    isAdminGrade(user.role) ||
    user.role === 'ANALYST' ||
    user.role === 'DEAN' ||
    user.role === 'DEPT_HEAD';
  if (!allowed) redirect('/');

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Upload PDFs"
        subtitle="Policy documents, reports, curriculum specs (มคอ.2), peer brochures, surveys, minutes. Dedup is by content hash — the same PDF won't land twice."
      />
      <Section title="Drag & drop">
        <UploadClient />
      </Section>
    </AuthedAppShell>
  );
}
