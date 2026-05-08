import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
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

  const [faculties, departments] = await Promise.all([
    apiFetch<Faculty[]>('/faculties').catch(() => [] as Faculty[]),
    apiFetch<Department[]>('/departments').catch(() => [] as Department[]),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Programs"
        title="New program"
        subtitle="Create a shell record. Upload the มคอ.2 PDF next to auto-fill degree, credits, plans, and approvals."
      />
      <Section>
        <NewProgramClient faculties={faculties} departments={departments} />
      </Section>
    </AuthedAppShell>
  );
}
