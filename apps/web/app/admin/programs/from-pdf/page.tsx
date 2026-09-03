import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader, Section } from '@kku/ui';
import { FromPdfClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Submit curriculum file — Admin' };

interface Faculty {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
}
interface Department {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  facultyId: string;
}

export default async function NewFromPdfPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  const facultiesRes = await apiFetchSafe<Faculty[]>('/faculties');
  const departmentsRes = await apiFetchSafe<Department[]>('/departments');

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Submit curriculum file" group="Programs" groupHref="/admin/programs" />
      <PageHeader
        eyebrow="Admin · Programs"
        title="Submit curriculum file"
        subtitle="Tell us whether this มคอ.2 PDF is a new programme or a revision of an existing one, then upload it; extracted fields pre-fill the form. We check for duplicates by code, name, and degree before committing."
      />
      <Section>
        {!facultiesRes.ok ? (
          <DiagnosticEmptyState
            surface="the new-program-from-PDF form"
            error={facultiesRes.error}
          />
        ) : (
          <FromPdfClient
            faculties={facultiesRes.data}
            departments={departmentsRes.ok ? departmentsRes.data : []}
          />
        )}
      </Section>
    </AuthedAppShell>
  );
}
