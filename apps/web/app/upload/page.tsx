import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { PageHeader, Section } from '@kku/ui';
import { UploadClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload PDFs' };

export default async function UploadPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  // pdf:upload — admin-grade + FACULTY_USER (absorbs the legacy
  // DEAN/DEPT_HEAD population that owned faculty-scope upload rights).
  const allowed = isAdminGrade(user.effectiveRole ?? user.role) || user.role === 'FACULTY_USER';
  if (!allowed) redirect('/no-access');

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Upload PDF" group="PDF library" groupHref="/admin/pdf-review" />
      <PageHeader
        title="Upload PDFs"
        subtitle="Policy documents, reports, research papers, curriculum specs (มคอ.2), peer brochures, surveys, minutes. Dedup is by content hash — the same PDF won't land twice."
      />
      <Section title="Drag & drop">
        <UploadClient />
      </Section>
    </AuthedAppShell>
  );
}
