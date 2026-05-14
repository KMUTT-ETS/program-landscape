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

// Effective scope for aggregate (non-per-program) endpoints. Folds the
// user's primary session scope with all their UserScope grants into one
// of three modes:
//
//   { mode: 'all' }                            — see everything
//   { mode: 'scoped', facultyIds, programIds } — UNION of granted scopes
//   { mode: 'none' }                           — no grants → 403
//
// 'all' fires when EITHER the session role OR any UserScope row is
// admin-grade or UNIVERSITY_USER. This is what lets a user whose
// primary role is PROGRAM_USER but who has a UserScope of
// UNIVERSITY_USER see the full portfolio — same per-row scope chain
// that `assertProgramAccessible` rule 3 already honours for per-program
// endpoints, lifted to the list-aggregate level.
//
// 'scoped' returns the UNION of the user's primary faculty/program
// (when applicable) plus every faculty/program named in their
// UserScope rows. Caller passes the arrays to the service's
// `facultyIds` / `programIds` WHERE-IN clamp. Empty in both means
// 'none'.
//
// `mode: 'none'` means the account has a faculty/program-scoped role
// but zero actual grants — caller should throw 403.
export interface EffectiveScope {
  mode: 'all' | 'scoped' | 'none';
  facultyIds: string[];
  programIds: string[];
}

export async function resolveEffectiveScope(
  user: SessionUser,
): Promise<EffectiveScope> {
  if (seesAllScopes(user.role)) {
    return { mode: 'all', facultyIds: [], programIds: [] };
  }
  const scopes = await prisma.userScope.findMany({
    where: { userId: user.userId },
    select: { role: true, facultyId: true, programId: true },
  });
  // Promote to 'all' if any UserScope is admin-grade or UNIVERSITY_USER.
  if (scopes.some((s) => seesAllScopes(s.role))) {
    return { mode: 'all', facultyIds: [], programIds: [] };
  }
  // Otherwise union faculty/program IDs from primary scope + UserScope rows.
  const facultyIds = new Set<string>();
  const programIds = new Set<string>();
  if (user.role === 'FACULTY_USER' && user.facultyId) facultyIds.add(user.facultyId);
  if (user.role === 'PROGRAM_USER' && user.programId) programIds.add(user.programId);
  for (const s of scopes) {
    if (s.role === 'FACULTY_USER' && s.facultyId) facultyIds.add(s.facultyId);
    if (s.role === 'PROGRAM_USER' && s.programId) programIds.add(s.programId);
  }
  if (facultyIds.size === 0 && programIds.size === 0) {
    return { mode: 'none', facultyIds: [], programIds: [] };
  }
  return {
    mode: 'scoped',
    facultyIds: [...facultyIds],
    programIds: [...programIds],
  };
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

// Dashboard guard for the faculty-scoped variant. Allows admin-grade +
// UNIVERSITY_USER (full view) AND FACULTY_USER (clamped to own faculty
// by the helpers below). PROGRAM_USER is still rejected — the dashboard
// has no per-program variant.
export function assertCanSeeFacultyDashboards(user: SessionUser): void {
  if (seesAllScopes(user.role)) return;
  if (user.role === 'FACULTY_USER') {
    if (!user.facultyId) {
      throw new ForbiddenException(
        'Your account has no faculty assignment. Contact an admin.',
      );
    }
    return;
  }
  throw new ForbiddenException(
    'This dashboard is restricted to university-wide and faculty-level roles.',
  );
}

// Refuse access to a per-program endpoint when the program is outside
// the caller's scope. Throws 403 (or 404 for unknown program) so the
// front-end can land on the polite no-access page instead of an empty
// shell.
//
// Allow rules (any one is sufficient):
//   1. Role is admin-grade (SUPER_ADMIN / SYSTEM_ADMIN / UNIVERSITY_USER).
//   2. Primary scope on SessionUser matches:
//      - FACULTY_USER + user.facultyId === program.facultyId
//      - PROGRAM_USER + user.programId === program.id
//   3. Any of the user's UserScope rows grants this program:
//      - UNIVERSITY_USER scope (rare but valid as additional grant)
//      - FACULTY_USER scope with facultyId === program.facultyId
//      - PROGRAM_USER scope with programId === program.id
//
// Rule 3 is what makes multi-scope work for users who get N programs via
// the academic-staff sync (UserScope rows with source=ACADEMIC_STAFF),
// or admin-assigned scopes beyond their primary. Without it, a user with
// 6 PROGRAM_USER UserScope rows but a FACULTY_USER primary role could
// see ALL programs in their faculty (rule 2 too permissive); a user with
// 6 PROGRAM_USER UserScope rows but PROGRAM_USER primary role would see
// only their primary (rule 2 too narrow). Verified prod 2026-05-10.
export async function assertProgramAccessible(
  programId: string,
  user: SessionUser,
): Promise<void> {
  if (seesAllScopes(user.role)) return;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { facultyId: true },
  });
  if (!program) throw new NotFoundException();

  // Rule 2 — primary scope on SessionUser.
  if (user.role === 'FACULTY_USER' && user.facultyId === program.facultyId) return;
  if (
    user.role === 'PROGRAM_USER' &&
    user.programId &&
    user.programId === programId
  ) {
    return;
  }

  // Rule 3 — multi-scope via UserScope rows. One DB hit per access
  // check. Cheap enough at deep-dive request rates; if this becomes
  // a hot path we can cache scopes in the JWT (Phase 2 work).
  const scopes = await prisma.userScope.findMany({
    where: { userId: user.userId },
    select: { role: true, facultyId: true, programId: true },
  });
  for (const s of scopes) {
    if (s.role === 'UNIVERSITY_USER') return;
    if (s.role === 'FACULTY_USER' && s.facultyId === program.facultyId) return;
    if (s.role === 'PROGRAM_USER' && s.programId === programId) return;
  }

  throw new ForbiddenException(
    'This program is outside the scopes assigned to your account.',
  );
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

// UUID variant — forces `facultyId` to the caller's own faculty when
// they're FACULTY_USER. Used by endpoints that join on Faculty.id
// directly (e.g., the TCAS recruitment dashboard). Admin-grade +
// UNIVERSITY_USER pass through untouched; a FACULTY_USER's supplied
// value is overridden so they can't peek at another faculty by URL.
export function clampFacultyIdFilter<
  F extends { facultyId: string | null | undefined },
>(filter: F, user: SessionUser): F {
  if (seesAllScopes(user.role)) return filter;
  if (user.role === 'FACULTY_USER' && user.facultyId) {
    return { ...filter, facultyId: user.facultyId };
  }
  // For roles that don't have a faculty assignment we can't safely
  // resolve a filter — caller has already been gated by
  // assertCanSeeFacultyDashboards, so this branch shouldn't fire in
  // practice. Returning the filter unchanged is the least surprising
  // fallback if it does.
  return filter;
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
