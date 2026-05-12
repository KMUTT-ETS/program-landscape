import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader, Section } from '@kku/ui';
import { FromPdfClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New program from PDF — Admin' };

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
  if (!isAdminGrade(user.role)) redirect('/no-access');

  const facultiesRes = await apiFetchSafe<Faculty[]>('/faculties');
  const departmentsRes = await apiFetchSafe<Department[]>('/departments');

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Programs"
        title="New program from PDF"
        subtitle="Upload the มคอ.2 PDF first; extracted fields pre-fill the form. We check for duplicates by code, name, and degree before committing."
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
