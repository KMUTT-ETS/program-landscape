import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader, Section } from '@kku/ui';
import { NewProgramClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New program — Admin' };

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

export default async function NewProgramPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');

  // Faculties is the canary — without it the form has no faculty dropdown
  // and is unusable. Departments stays best-effort (the form can ship
  // without a department selection).
  const facultiesRes = await apiFetchSafe<Faculty[]>('/faculties');
  const departmentsRes = await apiFetchSafe<Department[]>('/departments');

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Programs"
        title="New program"
        subtitle="Create a shell record. Upload the มคอ.2 PDF next to auto-fill degree, credits, plans, and approvals."
      />
      <Section>
        {!facultiesRes.ok ? (
          <DiagnosticEmptyState
            surface="the new-program form"
            error={facultiesRes.error}
          />
        ) : (
          <NewProgramClient
            faculties={facultiesRes.data}
            departments={departmentsRes.ok ? departmentsRes.data : []}
          />
        )}
      </Section>
    </AuthedAppShell>
  );
}
