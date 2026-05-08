'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import {
  IMPERSONATION_COOKIE,
  ImpersonationPayloadSchema,
  canImpersonate,
  encodeImpersonation,
  type ImpersonationPayload,
} from '@/lib/auth/impersonation';

interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function setImpersonationAction(input: {
  role: string;
  facultyId?: string | null;
  departmentId?: string | null;
}): Promise<ActionResult> {
  const session = await auth();
  // The session may already be impersonated (if the operator switches
  // role-to-role without clearing first). We need the REAL underlying
  // role, which means re-reading from the DB by user id.
  const sessionUser = session?.user as SessionUser | undefined;
  if (!sessionUser?.userId) return { ok: false, error: 'Not signed in.' };
  const realUser = await prisma.user.findUnique({
    where: { id: sessionUser.userId },
    select: { id: true, role: true },
  });
  if (!realUser) return { ok: false, error: 'User not found.' };
  if (!canImpersonate(realUser.role)) {
    return { ok: false, error: 'Only super-grade users can impersonate.' };
  }

  const candidate: ImpersonationPayload = {
    role: input.role as ImpersonationPayload['role'],
    facultyId: input.facultyId ?? null,
    departmentId: input.departmentId ?? null,
    setBy: realUser.id,
    setAt: new Date().toISOString(),
  };
  const parsed = ImpersonationPayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid role or scope.' };
  }

  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, encodeImpersonation(parsed.data), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60, // 12 hours — auto-expire to keep test sessions tidy
  });

  // Audit-log the action — every impersonation is recorded against the
  // real user, so the timeline is reconstructable later.
  await prisma.auditLog
    .create({
      data: {
        userId: realUser.id,
        action: 'impersonation_start',
        entityType: 'session',
        entityId: realUser.id,
        payloadJson: {
          role: parsed.data.role,
          facultyId: parsed.data.facultyId,
          departmentId: parsed.data.departmentId,
        },
      },
    })
    .catch(() => {
      /* never block on audit log */
    });

  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function clearImpersonationAction(): Promise<ActionResult> {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;
  const userId = sessionUser?.userId;

  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);

  if (userId) {
    await prisma.auditLog
      .create({
        data: {
          userId,
          action: 'impersonation_stop',
          entityType: 'session',
          entityId: userId,
        },
      })
      .catch(() => {
        /* never block on audit log */
      });
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

// Server action used by the dropdown to fetch the lists of faculties +
// departments needed by the scope picker. Lightweight, runs once when
// the dropdown opens.
export async function listScopesForImpersonationAction(): Promise<{
  faculties: Array<{ id: string; nameEn: string; nameTh: string }>;
  departments: Array<{
    id: string;
    nameEn: string;
    nameTh: string;
    facultyId: string;
    facultyNameEn: string;
  }>;
}> {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;
  if (!sessionUser?.userId) return { faculties: [], departments: [] };
  const realUser = await prisma.user.findUnique({
    where: { id: sessionUser.userId },
    select: { role: true },
  });
  if (!realUser || !canImpersonate(realUser.role)) {
    return { faculties: [], departments: [] };
  }

  const [faculties, departments] = await Promise.all([
    prisma.faculty.findMany({
      select: { id: true, nameEn: true, nameTh: true },
      orderBy: { nameEn: 'asc' },
    }),
    prisma.department.findMany({
      select: {
        id: true,
        nameEn: true,
        nameTh: true,
        facultyId: true,
        faculty: { select: { nameEn: true } },
      },
      orderBy: [{ faculty: { nameEn: 'asc' } }, { nameEn: 'asc' }],
    }),
  ]);

  return {
    faculties,
    departments: departments.map((d) => ({
      id: d.id,
      nameEn: d.nameEn,
      nameTh: d.nameTh,
      facultyId: d.facultyId,
      facultyNameEn: d.faculty.nameEn,
    })),
  };
}
