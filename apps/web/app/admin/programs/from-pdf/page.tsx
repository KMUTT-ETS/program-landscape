import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
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
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const [faculties, departments] = await Promise.all([
    apiFetch<Faculty[]>('/faculties').catch(() => [] as Faculty[]),
    apiFetch<Department[]>('/departments').catch(() => [] as Department[]),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Programs"
        title="New program from PDF"
        subtitle="Upload the มคอ.2 PDF first; extracted fields pre-fill the form. We check for duplicates by code, name, and degree before committing."
      />
      <Section>
        <FromPdfClient faculties={faculties} departments={departments} />
      </Section>
    </AuthedAppShell>
  );
}
