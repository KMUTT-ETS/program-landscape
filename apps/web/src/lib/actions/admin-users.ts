'use server';

// Admin server actions for user provisioning + role assignment.
//
// Auth model:
//   - All actions require SUPER_ADMIN or SYSTEM_ADMIN (or legacy ADMIN).
//   - SUPER_ADMIN can assign any role.
//   - SYSTEM_ADMIN can assign roles up to SYSTEM_ADMIN — never SUPER_ADMIN.
//
// Pre-provisioning flow:
//   1. Admin types an email → searchKkuEmployeeAction looks the staffer
//      up in the KKU Employee API.
//   2. Form pre-fills name + faculty + department from the lookup.
//   3. Admin picks the role + scope and submits → provisionUserAction
//      creates a User row with ssoSubject=null. On their first SSO login,
//      the existing provisionFromOidcClaims() finds the email match and
//      links the subject.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@kku/db';
import {
  RoleSchema,
  SSO_ROLES,
  SYSTEM_ADMIN_ASSIGNABLE_ROLES,
  type Role,
  type SessionUser,
} from '@kku/shared';
import { auth } from '@/lib/auth';
import { findEmployeeByEmail, type KkuEmployee, KkuApiError } from '@/lib/kku/employee-api';
import { hashPassword } from '@/lib/auth/password-hash';

async function requireAdmin(): Promise<{ user: SessionUser; isSuper: boolean }> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) throw new Error('Not authenticated');
  const isSuper = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN'; // legacy ADMIN = super
  const isSystem = user.role === 'SYSTEM_ADMIN';
  if (!isSuper && !isSystem) throw new Error('Forbidden — admin role required');
  return { user, isSuper };
}

function assertCanAssignRole(actor: { isSuper: boolean }, target: Role): void {
  if (actor.isSuper) return; // any role
  if ((SYSTEM_ADMIN_ASSIGNABLE_ROLES as readonly Role[]).includes(target)) return;
  throw new Error(`SYSTEM_ADMIN cannot assign role ${target}`);
}

export async function searchKkuEmployeeAction(email: string): Promise<
  | { ok: true; employee: KkuEmployee | null; existingUser: { id: string; role: Role; name: string | null } | null }
  | { ok: false; message: string }
> {
  await requireAdmin();
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return { ok: false, message: 'Provide a valid email' };
  try {
    const [employee, existing] = await Promise.all([
      findEmployeeByEmail(trimmed).catch((err) => {
        if (err instanceof KkuApiError) return null; // surface as "not found" path
        throw err;
      }),
      prisma.user.findUnique({
        where: { email: trimmed },
        select: { id: true, role: true, name: true },
      }),
    ]);
    return {
      ok: true,
      employee,
      existingUser: existing
        ? { id: existing.id, role: existing.role as Role, name: existing.name }
        : null,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

interface ProvisionInput {
  email: string;
  name: string | null;
  role: Role;
  facultyId: string | null;
  departmentId: string | null;
  programId: string | null;
  // Optional dev-credentials password. When supplied, hashed with
  // scrypt and stored on User.passwordHash so the user can log in via
  // the dev-credentials provider before SSO is wired. NULL = falls
  // back to the shared DEV_AUTH_PASSWORD env (default 'kku-dev').
  password?: string | null;
}

const ProvisionInputSchema = z.object({
  email: z.string().email().transform((s: string) => s.trim().toLowerCase()),
  name: z.string().nullable(),
  role: RoleSchema.refine((r: Role) => (SSO_ROLES as readonly Role[]).includes(r), {
    message: 'role must be one of the SSO_ROLES',
  }),
  facultyId: z.string().nullable(),
  departmentId: z.string().nullable(),
  programId: z.string().nullable(),
  password: z
    .string()
    .min(4, 'password must be at least 4 characters')
    .max(128)
    .nullable()
    .optional(),
});

function validateScope(input: ProvisionInput): string | null {
  if (input.role === 'FACULTY_USER' && !input.facultyId) return 'FACULTY_USER requires facultyId';
  if (input.role === 'PROGRAM_USER' && !input.programId) return 'PROGRAM_USER requires programId';
  if (input.role === 'UNIVERSITY_USER' || input.role === 'SUPER_ADMIN' || input.role === 'SYSTEM_ADMIN') {
    return null;
  }
  return null;
}

export async function provisionUserAction(
  raw: ProvisionInput,
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  try {
    const actor = await requireAdmin();
    const parsed = ProvisionInputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: parsed.error.message };
    const input = parsed.data as ProvisionInput;
    assertCanAssignRole(actor, input.role);
    const scopeErr = validateScope(input);
    if (scopeErr) return { ok: false, message: scopeErr };

    // Prevent re-provisioning an existing email — admin should use
    // updateUserRoleAction for that case.
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      return { ok: false, message: 'A user with this email already exists. Use Update Role instead.' };
    }

    // Create the User row + matching primary UserScope in a transaction
    // so a new user always starts with ≥1 scope assignment in the multi-
    // scope table (admins can add additional scopes via addUserScopeAction
    // afterwards).
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          role: input.role,
          facultyId: input.facultyId,
          departmentId: input.departmentId,
          programId: input.programId,
          passwordHash: input.password ? hashPassword(input.password) : null,
          // ssoSubject left null — set automatically on first SSO login
          // by provisionFromOidcClaims when it sees the matching email.
        },
      });
      await tx.userScope.create({
        data: {
          userId: user.id,
          role: input.role,
          facultyId: input.role === 'FACULTY_USER' ? input.facultyId : null,
          programId: input.role === 'PROGRAM_USER' ? input.programId : null,
        },
      });
      return user;
    });
    revalidatePath('/admin/users');
    return { ok: true, userId: created.id };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function updateUserRoleAction(input: {
  userId: string;
  role: Role;
  facultyId: string | null;
  departmentId: string | null;
  programId: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const actor = await requireAdmin();
    const role = RoleSchema.parse(input.role);
    if (!(SSO_ROLES as readonly Role[]).includes(role)) {
      return { ok: false, message: 'role must be one of the SSO_ROLES' };
    }
    assertCanAssignRole(actor, role);
    const scopeErr = validateScope({ ...input, name: null, email: '' } as ProvisionInput);
    if (scopeErr) return { ok: false, message: scopeErr };

    // Don't allow demoting the last SUPER_ADMIN.
    const target = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!target) return { ok: false, message: 'User not found' };
    if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
      const otherSupers = await prisma.user.count({
        where: { role: 'SUPER_ADMIN', NOT: { id: input.userId } },
      });
      if (otherSupers === 0) return { ok: false, message: 'Cannot demote the last SUPER_ADMIN' };
    }

    await prisma.user.update({
      where: { id: input.userId },
      data: {
        role,
        facultyId: input.facultyId,
        departmentId: input.departmentId,
        programId: input.programId,
      },
    });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ── Multi-scope assignments ───────────────────────────────────────────
//
// A user can hold multiple (role, scope) tuples — e.g. FACULTY_USER for
// two faculties + PROGRAM_USER for three programs across other faculties.
// These actions manage UserScope rows independently of the User's primary
// role/facultyId/programId columns. Phase 2 will fold the primary into
// the scope list; for now both coexist.

interface AddScopeInput {
  userId: string;
  role: Role;
  facultyId: string | null;
  programId: string | null;
}

function validateScopeAssignment(input: { role: Role; facultyId: string | null; programId: string | null }): string | null {
  switch (input.role) {
    case 'FACULTY_USER':
      if (!input.facultyId) return 'FACULTY_USER requires facultyId';
      if (input.programId) return 'FACULTY_USER must not carry a programId';
      return null;
    case 'PROGRAM_USER':
      if (!input.programId) return 'PROGRAM_USER requires programId';
      return null;
    case 'SUPER_ADMIN':
    case 'SYSTEM_ADMIN':
    case 'UNIVERSITY_USER':
      if (input.facultyId || input.programId) {
        return `${input.role} is non-spatial; do not pass facultyId or programId`;
      }
      return null;
    default:
      return 'role is not in the SSO_ROLES set';
  }
}

export async function addUserScopeAction(
  input: AddScopeInput,
): Promise<{ ok: true; scopeId: string } | { ok: false; message: string }> {
  try {
    const actor = await requireAdmin();
    const target = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!target) return { ok: false, message: 'User not found' };
    if (!(SSO_ROLES as readonly Role[]).includes(input.role)) {
      return { ok: false, message: 'role must be one of the SSO_ROLES' };
    }
    assertCanAssignRole(actor, input.role);
    const err = validateScopeAssignment(input);
    if (err) return { ok: false, message: err };

    // PROGRAM_USER: derive faculty from program for cross-table consistency.
    let facultyId = input.facultyId;
    if (input.role === 'PROGRAM_USER' && input.programId) {
      const prog = await prisma.program.findUnique({
        where: { id: input.programId },
        select: { facultyId: true },
      });
      if (!prog) return { ok: false, message: 'Program not found' };
      facultyId = prog.facultyId;
    }

    try {
      const created = await prisma.userScope.create({
        data: {
          userId: input.userId,
          role: input.role,
          facultyId: facultyId,
          programId: input.programId,
        },
      });
      revalidatePath('/admin/users');
      return { ok: true, scopeId: created.id };
    } catch (dbErr) {
      // Unique constraint violation = duplicate scope assignment.
      const msg = (dbErr as { code?: string; message?: string }).code === 'P2002'
        ? 'This scope is already assigned to the user'
        : (dbErr as Error).message;
      return { ok: false, message: msg };
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function removeUserScopeAction(
  scopeId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireAdmin();
    const scope = await prisma.userScope.findUnique({ where: { id: scopeId } });
    if (!scope) return { ok: false, message: 'Scope not found' };
    // Refuse to remove the last scope — every user must hold at least one
    // assignment so they have a defined permission posture.
    const count = await prisma.userScope.count({ where: { userId: scope.userId } });
    if (count <= 1) {
      return {
        ok: false,
        message: 'Cannot remove the last scope. Add another scope first, or delete the user instead.',
      };
    }
    await prisma.userScope.delete({ where: { id: scopeId } });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function setUserPasswordAction(input: {
  userId: string;
  password: string | null; // null clears the per-user password (falls back to shared)
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await requireAdmin();
    if (input.password !== null && input.password.length < 4) {
      return { ok: false, message: 'password must be at least 4 characters' };
    }
    const target = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!target) return { ok: false, message: 'User not found' };
    await prisma.user.update({
      where: { id: input.userId },
      data: { passwordHash: input.password ? hashPassword(input.password) : null },
    });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function deleteUserAction(userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const actor = await requireAdmin();
    if (!actor.isSuper) return { ok: false, message: 'Only SUPER_ADMIN can delete users' };
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, message: 'User not found' };
    if (target.role === 'SUPER_ADMIN') {
      const otherSupers = await prisma.user.count({
        where: { role: 'SUPER_ADMIN', NOT: { id: userId } },
      });
      if (otherSupers === 0) return { ok: false, message: 'Cannot delete the last SUPER_ADMIN' };
    }
    await prisma.user.delete({ where: { id: userId } });
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// (Re-exports removed — Next.js requires `'use server'` modules to
// export ONLY async functions. Any non-async helper a client wants
// goes either inline in the client or in a separate non-server file.)
