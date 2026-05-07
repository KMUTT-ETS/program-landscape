import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { prisma } from '@kku/db';
import { UsersClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users — Admin' };

export default async function AdminUsersPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  // Admin gate — accept SUPER_ADMIN, SYSTEM_ADMIN, or legacy ADMIN.
  const isAdmin =
    user.role === 'SUPER_ADMIN' || user.role === 'SYSTEM_ADMIN' || user.role === 'ADMIN';
  if (!isAdmin) redirect('/');
  const isSuper = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

  // Fetch existing users + faculty/program lists for the role-scope dropdowns.
  const [users, faculties, programs] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        ssoSubject: true,
        facultyId: true,
        departmentId: true,
        programId: true,
        createdAt: true,
        faculty: { select: { id: true, nameEn: true, nameTh: true } },
        program: { select: { id: true, code: true, nameEn: true, nameTh: true } },
      },
    }),
    prisma.faculty.findMany({
      where: { kind: 'ACADEMIC' },
      select: { id: true, nameEn: true, nameTh: true, code: true },
      orderBy: { code: 'asc' },
    }),
    prisma.program.findMany({
      where: { sequenceNoFromSheet: { not: null }, status: 'ACTIVE' },
      select: { id: true, code: true, nameEn: true, nameTh: true, facultyId: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        eyebrow="Admin · Users"
        title="Users & access"
        subtitle="Pre-provision KKU staff (search by email) and assign roles + scope. Linked to KKU SSO on first login."
      />
      <UsersClient
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          linkedToSso: u.ssoSubject !== null,
          facultyId: u.facultyId,
          departmentId: u.departmentId,
          programId: u.programId,
          facultyLabel: u.faculty
            ? `${u.faculty.nameEn} · ${u.faculty.nameTh}`
            : null,
          programLabel: u.program
            ? `${u.program.code} ${u.program.nameEn}`
            : null,
          createdAtIso: u.createdAt.toISOString(),
        }))}
        faculties={faculties}
        programs={programs}
        actorIsSuper={isSuper}
      />
    </AuthedAppShell>
  );
}
