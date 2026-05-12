import { redirect } from 'next/navigation';
import { isAdminGrade, type Role, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { PageHeader } from '@kku/ui';
import { prisma, type Prisma } from '@kku/db';
import { UsersClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users — Admin' };

const PAGE_SIZE = 25;

const ROLE_FILTER_VALUES: ReadonlyArray<Role> = [
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER',
] as const;

function parseRole(raw: string | undefined): Role | undefined {
  if (!raw) return undefined;
  return (ROLE_FILTER_VALUES as readonly string[]).includes(raw)
    ? (raw as Role)
    : undefined;
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

interface SearchParams {
  q?: string;
  role?: string;
  facultyId?: string;
  page?: string;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');
  const isSuper = user.role === 'SUPER_ADMIN';

  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const roleFilter = parseRole(params.role);
  const facultyFilter = (params.facultyId ?? '').trim() || undefined;
  const page = parsePage(params.page);
  const skip = (page - 1) * PAGE_SIZE;

  // Build the WHERE clause from URL params. Search matches BOTH email
  // and name (case-insensitive); the index on `email` covers email
  // lookups, name uses a sequential scan but it's bounded by the
  // role + facultyId filters above.
  const where: Prisma.UserWhereInput = {};
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (roleFilter) where.role = roleFilter;
  if (facultyFilter) {
    // Match either the User's primary facultyId OR any of their
    // UserScope rows targeting that faculty (a PROGRAM_USER assigned
    // to a program in faculty X should appear when filtering "X").
    where.AND = [
      ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
      {
        OR: [
          { facultyId: facultyFilter },
          { scopes: { some: { facultyId: facultyFilter } } },
        ],
      },
    ];
  }

  // Two queries in parallel: paginated rows + total count for the
  // current filter set.
  const [users, total, faculties, programs] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      skip,
      take: PAGE_SIZE,
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
        scopes: {
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            role: true,
            facultyId: true,
            programId: true,
            source: true,
            faculty: { select: { id: true, nameEn: true, nameTh: true } },
            program: { select: { id: true, code: true, nameEn: true } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
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
      <AdminBackNav current="Users & access" />
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
          scopes: u.scopes.map((s) => ({
            id: s.id,
            role: s.role,
            facultyId: s.facultyId,
            programId: s.programId,
            source: s.source,
            facultyLabel: s.faculty
              ? `${s.faculty.nameTh} · ${s.faculty.nameEn}`
              : null,
            programLabel: s.program
              ? `${s.program.code} ${s.program.nameEn}`
              : null,
          })),
        }))}
        faculties={faculties}
        programs={programs}
        actorIsSuper={isSuper}
        filters={{
          q,
          role: roleFilter ?? '',
          facultyId: facultyFilter ?? '',
          page,
          pageSize: PAGE_SIZE,
          total,
        }}
      />
    </AuthedAppShell>
  );
}
