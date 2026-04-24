import { redirect, notFound } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, PageHeader } from '@kku/ui';
import { ProgramEditClient, type ProgramDetail } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program — Admin' };

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

export default async function AdminProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (user.role !== 'ADMIN' && user.role !== 'ANALYST') redirect('/');

  const { id } = await params;
  const [program, faculties, departments] = await Promise.all([
    apiFetch<ProgramDetail>(`/admin/programs/${id}`).catch(() => null),
    apiFetch<Faculty[]>('/faculties').catch(() => [] as Faculty[]),
    apiFetch<Department[]>('/departments').catch(() => [] as Department[]),
  ]);
  if (!program) notFound();

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Programs"
        title={program.nameEn}
        subtitle={program.nameTh}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="neutral" className="font-tabular">
              {program.code}
            </Badge>
            <Badge
              tone={
                program.status === 'ACTIVE'
                  ? 'success'
                  : program.status === 'PAUSED'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {program.status.toLowerCase()}
            </Badge>
          </div>
        }
      />
      <ProgramEditClient
        program={program}
        faculties={faculties}
        departments={departments}
      />
    </AuthedAppShell>
  );
}
