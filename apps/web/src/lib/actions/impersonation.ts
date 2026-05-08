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
  /** PROGRAM_USER scope — the program the impersonator wants to be
   * scoped to. Resolves Program.facultyId server-side so the cookie
   * carries a self-consistent (faculty + program) tuple. */
  programId?: string | null;
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

  // For PROGRAM_USER scope, derive facultyId from the chosen program so
  // the (faculty + program) tuple stays consistent regardless of what
  // the picker passed in.
  let facultyId = input.facultyId ?? null;
  if (input.programId) {
    const prog = await prisma.program.findUnique({
      where: { id: input.programId },
      select: { facultyId: true },
    });
    if (!prog) return { ok: false, error: 'Program not found.' };
    facultyId = prog.facultyId;
  }

  const candidate: ImpersonationPayload = {
    role: input.role as ImpersonationPayload['role'],
    facultyId,
    departmentId: null,
    programId: input.programId ?? null,
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
          programId: parsed.data.programId,
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

// Server action: list the impersonator's OWN UserScope rows. The role-
// switcher uses this so a SUPER_ADMIN whose UserScope already binds them
// to "FACULTY_USER · Faculty of Engineering" can switch with one click —
// no second-step picker.
export async function getOwnScopesForImpersonationAction(): Promise<
  Array<{
    id: string;
    role: string;
    facultyId: string | null;
    programId: string | null;
    facultyLabel: string | null;
    programLabel: string | null;
  }>
> {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;
  if (!sessionUser?.userId) return [];
  const realUser = await prisma.user.findUnique({
    where: { id: sessionUser.userId },
    select: { id: true, role: true },
  });
  if (!realUser || !canImpersonate(realUser.role)) return [];

  const scopes = await prisma.userScope.findMany({
    where: { userId: realUser.id },
    select: {
      id: true,
      role: true,
      facultyId: true,
      programId: true,
      faculty: { select: { nameEn: true, nameTh: true } },
      program: { select: { code: true, nameEn: true } },
    },
    orderBy: [{ role: 'asc' }, { id: 'asc' }],
  });

  return scopes.map((s) => ({
    id: s.id,
    role: s.role,
    facultyId: s.facultyId,
    programId: s.programId,
    facultyLabel: s.faculty ? `${s.faculty.nameTh} · ${s.faculty.nameEn}` : null,
    programLabel: s.program ? `${s.program.code} · ${s.program.nameEn}` : null,
  }));
}

// Server action used by the dropdown to fetch the lists of faculties +
// programs needed by the scope picker. Lightweight, runs once when
// the dropdown opens. Department list dropped 2026-05-09 — PROGRAM_USER
// scope is keyed off programId directly now.
export async function listScopesForImpersonationAction(): Promise<{
  faculties: Array<{ id: string; nameEn: string; nameTh: string }>;
  programs: Array<{
    id: string;
    code: string;
    nameEn: string;
    nameTh: string;
    facultyId: string;
    facultyNameEn: string;
  }>;
}> {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;
  if (!sessionUser?.userId) return { faculties: [], programs: [] };
  const realUser = await prisma.user.findUnique({
    where: { id: sessionUser.userId },
    select: { role: true },
  });
  if (!realUser || !canImpersonate(realUser.role)) {
    return { faculties: [], programs: [] };
  }

  const [faculties, programs] = await Promise.all([
    prisma.faculty.findMany({
      select: { id: true, nameEn: true, nameTh: true },
      orderBy: { nameEn: 'asc' },
    }),
    prisma.program.findMany({
      where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameTh: true,
        facultyId: true,
        faculty: { select: { nameEn: true } },
      },
      orderBy: [{ faculty: { nameEn: 'asc' } }, { code: 'asc' }],
    }),
  ]);

  return {
    faculties,
    programs: programs.map((p) => ({
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameTh: p.nameTh,
      facultyId: p.facultyId,
      facultyNameEn: p.faculty.nameEn,
    })),
  };
}
