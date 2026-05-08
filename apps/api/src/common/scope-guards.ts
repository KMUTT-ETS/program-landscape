// Shared scope-guard helpers for module controllers.
//
// Pattern, post v2 role taxonomy + impersonation propagation:
//
//   admin-grade (SUPER_ADMIN / SYSTEM_ADMIN) + UNIVERSITY_USER
//        → see everything, pass through
//   FACULTY_USER
//        → only their own faculty (user.facultyId)
//        → cross-faculty programs / departments → 403
//   PROGRAM_USER
//        → only their single assigned program (user.programId)
//        → anything else (incl. own faculty's other programs) → 403
//
// Each module previously inlined its own copy of these checks. This
// module is the single source of truth so future schema bumps (or
// new scope axes) only have to land in one place.

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';

// Roles that see every faculty's data without a clamp.
export function seesAllScopes(role: SessionUser['role']): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SYSTEM_ADMIN' ||
    role === 'UNIVERSITY_USER'
  );
}

// Refuse access to dashboards that are intentionally university-wide
// only (Education + Staff modules). FACULTY_USER and PROGRAM_USER get
// 403'd; the front-end then bounces them to /no-access.
export function assertUniversityWide(user: SessionUser): void {
  if (!seesAllScopes(user.role)) {
    throw new ForbiddenException(
      'This dashboard is restricted to university-wide roles.',
    );
  }
}

// Refuse access to a per-program endpoint when the program is outside
// the caller's scope. Throws 403 (or 404 for unknown program) so the
// front-end can land on the polite no-access page instead of an empty
// shell.
export async function assertProgramAccessible(
  programId: string,
  user: SessionUser,
): Promise<void> {
  if (seesAllScopes(user.role)) return;
  if (user.role !== 'FACULTY_USER' && user.role !== 'PROGRAM_USER') {
    throw new ForbiddenException('Your role cannot view per-program data.');
  }
  if (user.role === 'PROGRAM_USER') {
    if (!user.programId) {
      throw new ForbiddenException(
        'Your account has no program assignment. Contact an admin.',
      );
    }
    if (user.programId !== programId) {
      throw new ForbiddenException(
        'This is not the program assigned to your account.',
      );
    }
    return;
  }
  // FACULTY_USER
  if (!user.facultyId) {
    throw new ForbiddenException(
      'Your account has no faculty assignment. Contact an admin.',
    );
  }
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { facultyId: true },
  });
  if (!program) throw new NotFoundException();
  if (program.facultyId !== user.facultyId) {
    throw new ForbiddenException(
      'This program is outside the faculty assigned to your account.',
    );
  }
}

// Clamp a `?facultyName=...` filter array (Thai faculty name) to the
// user's own faculty. Used by /staff-dashboard and /education endpoints
// where the data is keyed off the StaffMasterRecord's faculty Thai name.
//
// Returns the rewritten filter — or null if the user has no faculty
// assignment (caller should treat as "no rows").
export async function clampFacultyNameFilter<F extends { facultyName: string[] }>(
  filter: F,
  user: SessionUser,
): Promise<F | null> {
  if (seesAllScopes(user.role)) return filter;
  if (!user.facultyId) return null;
  const faculty = await prisma.faculty.findUnique({
    where: { id: user.facultyId },
    select: { nameTh: true },
  });
  if (!faculty) return null;
  return { ...filter, facultyName: [faculty.nameTh] };
}

// Generic scope clamp for endpoints that accept a `scope` +
// `scopeId` query/body pair (e.g. cockpit, gap analyzer, skills
// explorer). Mirrors clampCockpitScope but lives here so any module
// can adopt the pattern without duplicating the verification SQL.
export type GenericScope = 'university' | 'faculty' | 'department' | 'program';

export async function clampScopeForUser(
  scope: GenericScope,
  scopeId: string | null,
  user: SessionUser,
): Promise<{ scope: GenericScope; scopeId: string | null }> {
  if (seesAllScopes(user.role)) return { scope, scopeId };

  // PROGRAM_USER — narrowest tier. Anything wider than program drops
  // to the user's own program.
  if (user.role === 'PROGRAM_USER') {
    if (!user.programId) {
      throw new ForbiddenException(
        'Your account has no program assignment. Contact an admin.',
      );
    }
    if (scope !== 'program') {
      return { scope: 'program', scopeId: user.programId };
    }
    if (scopeId !== user.programId) {
      throw new ForbiddenException(
        'This is not the program assigned to your account.',
      );
    }
    return { scope, scopeId };
  }

  // FACULTY_USER — faculty-wide.
  if (user.role !== 'FACULTY_USER') {
    throw new ForbiddenException('Your role cannot view scoped data.');
  }
  if (!user.facultyId) {
    throw new ForbiddenException(
      'Your account has no faculty assignment. Contact an admin.',
    );
  }
  if (scope === 'university') {
    return { scope: 'faculty', scopeId: user.facultyId };
  }
  if (scope === 'faculty') {
    if (scopeId !== user.facultyId) {
      throw new ForbiddenException(
        "You can only view your own faculty's data.",
      );
    }
    return { scope, scopeId };
  }
  if (scope === 'department') {
    if (!scopeId) throw new ForbiddenException('scopeId required for department scope.');
    const dept = await prisma.department.findUnique({
      where: { id: scopeId },
      select: { facultyId: true },
    });
    if (!dept) throw new ForbiddenException('Department not found.');
    if (dept.facultyId !== user.facultyId) {
      throw new ForbiddenException('Department is outside your faculty.');
    }
    return { scope, scopeId };
  }
  // scope === 'program'
  if (!scopeId) throw new ForbiddenException('scopeId required for program scope.');
  const prog = await prisma.program.findUnique({
    where: { id: scopeId },
    select: { facultyId: true },
  });
  if (!prog) throw new ForbiddenException('Program not found.');
  if (prog.facultyId !== user.facultyId) {
    throw new ForbiddenException('Program is outside your faculty.');
  }
  return { scope, scopeId };
}
