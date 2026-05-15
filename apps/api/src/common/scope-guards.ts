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
import { Prisma, prisma } from '@kku/db';
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
// 403'd UNLESS they hold an admin-grade or UNIVERSITY_USER UserScope
// grant (multi-scope). Front-end bounces 403'd users to /no-access.
export async function assertUniversityWide(user: SessionUser): Promise<void> {
  if (seesAllScopes(user.role)) return;
  const scopes = await prisma.userScope.findMany({
    where: { userId: user.userId },
    select: { role: true },
  });
  if (scopes.some((s) => seesAllScopes(s.role))) return;
  throw new ForbiddenException(
    'This dashboard is restricted to university-wide roles.',
  );
}

// Dashboard guard for surfaces that DO have a per-program variant —
// /education/class-offerings and /staff/teaching-workload. Same as
// assertCanSeeFacultyDashboards but ALSO admits PROGRAM_USER (clamped
// to their program's courses by `resolveOfferingScope` below).
export async function assertCanSeeProgramAwareDashboards(
  user: SessionUser,
): Promise<void> {
  if (seesAllScopes(user.role)) return;
  if (user.role === 'FACULTY_USER' && user.facultyId) return;
  if (user.role === 'PROGRAM_USER' && user.programId) return;
  const scopes = await prisma.userScope.findMany({
    where: { userId: user.userId },
    select: { role: true, facultyId: true, programId: true },
  });
  if (
    scopes.some(
      (s) =>
        seesAllScopes(s.role) ||
        (s.role === 'FACULTY_USER' && s.facultyId) ||
        (s.role === 'PROGRAM_USER' && s.programId),
    )
  ) {
    return;
  }
  if (user.role === 'FACULTY_USER' && !user.facultyId) {
    throw new ForbiddenException('Your account has no faculty assignment. Contact an admin.');
  }
  if (user.role === 'PROGRAM_USER' && !user.programId) {
    throw new ForbiddenException('Your account has no program assignment. Contact an admin.');
  }
  throw new ForbiddenException(
    'This dashboard is restricted to assigned scopes — contact an admin.',
  );
}

// Resolves the user's effective scope into the inputs both
// program-aware dashboards (class-offerings + teaching-workload)
// need:
//   - facultyNames : Thai names for matching `class_offerings.registry_faculty_name`
//   - facultyIds   : Faculty.id for matching `faculty_members.faculty_id`
//   - programCourseCodes : normalised codes the user's granted programs use
//
// PROGRAM_USER scope works two ways, with option 1 preferred:
//   1. Materialised PROGRAM_DIGEST → `program_courses` (course list extracted
//      from each program's curriculum PDF, INCLUDES general-education subjects).
//   2. Fallback for programs missing a digest: derive course codes from
//      class_offerings whose teachers are on the program's ProgramFaculty
//      roster (acceptable miss — GE courses are taught by GE Institute
//      teachers, not on any program's faculty list).
//
// Modes:
//   'all'    — admin / UNIVERSITY_USER, no clamp
//   'scoped' — restrict by (facultyNames OR facultyIds OR programCourseCodes),
//              caller picks which fields to apply for its WHERE clause
//   'none'   — caller should yield empty results (no readable rows)
export interface OfferingScope {
  mode: 'all' | 'scoped' | 'none';
  facultyNames: string[];
  facultyIds: string[];
  programCourseCodes: string[];
}

export async function resolveOfferingScope(
  user: SessionUser,
): Promise<OfferingScope> {
  const eff = await resolveEffectiveScope(user);
  if (eff.mode === 'all') {
    return { mode: 'all', facultyNames: [], facultyIds: [], programCourseCodes: [] };
  }
  if (eff.mode === 'none') {
    return { mode: 'none', facultyNames: [], facultyIds: [], programCourseCodes: [] };
  }

  // Resolve faculty grants (names + IDs in one query).
  let facultyNames: string[] = [];
  let facultyIds: string[] = [];
  if (eff.facultyIds.length > 0) {
    const faculties = await prisma.faculty.findMany({
      where: { id: { in: eff.facultyIds } },
      select: { id: true, nameTh: true },
    });
    facultyNames = faculties.map((f) => f.nameTh);
    facultyIds = faculties.map((f) => f.id);
  }

  // Resolve program grants → course-code list. NB: this is unioned
  // with the faculty clamp at the WHERE-clause level, so a mixed-grant
  // user sees both buckets of data.
  let programCourseCodes: string[] = [];
  if (eff.programIds.length > 0) {
    programCourseCodes = await resolveProgramCourseCodes(eff.programIds);
  }

  // If nothing resolved (e.g., program grants but program_courses is empty
  // for those programs AND the fallback found no teacher-derived courses
  // — likely a brand-new program with no teaching activity yet), degrade
  // to 'none' so the caller renders an empty state rather than passing
  // through with no clamp.
  if (facultyNames.length === 0 && programCourseCodes.length === 0) {
    return { mode: 'none', facultyNames: [], facultyIds: [], programCourseCodes: [] };
  }

  return { mode: 'scoped', facultyNames, facultyIds, programCourseCodes };
}

/**
 * Resolve a set of programIds to the union of course codes they use,
 * with the option-1 → option-2 fallback chain described above. Course
 * codes are returned in the normalised (whitespace-stripped, upper-
 * cased) form that both `class_offerings.course_code` and
 * `program_courses.course_code` are stored under.
 */
async function resolveProgramCourseCodes(programIds: string[]): Promise<string[]> {
  if (programIds.length === 0) return [];

  // Option 1 — extracted PROGRAM_DIGEST courses (preferred; includes GE).
  const direct = await prisma.programCourse.findMany({
    where: { programId: { in: programIds } },
    select: { programId: true, courseCode: true },
  });
  const codes = new Set<string>();
  const programsWithDirect = new Set<string>();
  for (const r of direct) {
    codes.add(r.courseCode);
    programsWithDirect.add(r.programId);
  }

  // Option 2 fallback — teacher-derived. For programs with no
  // materialised course list, take every course taught by any
  // FacultyMember on the program's ProgramFaculty roster. Misses GE
  // (GE Institute teachers aren't on any program's faculty list);
  // acceptable per the spec's "GE is acceptable to miss" note.
  const missing = programIds.filter((id) => !programsWithDirect.has(id));
  if (missing.length > 0) {
    const fallback = await prisma.$queryRaw<Array<{ course_code: string }>>`
      SELECT DISTINCT c.course_code
        FROM class_offerings c
        JOIN class_offering_teachers t ON t.class_offering_id = c.id
        JOIN program_faculties pf ON pf.faculty_member_id = t.faculty_member_id
       WHERE pf.program_id IN (${Prisma.join(missing)})
    `;
    for (const r of fallback) codes.add(r.course_code);
  }

  return [...codes];
}

// Dashboard guard for the Education + Staff faculty-grain endpoints.
// Admits anyone with a usable grant:
//   admin / UNIVERSITY_USER — full view (no clamp)
//   FACULTY_USER            — clamped to own faculty by clampFacultyNameFilter
//   PROGRAM_USER            — rolled up to their program's faculty by the
//                             same clamp helper, so they see their
//                             faculty's data on these surfaces (the
//                             two program-aware dashboards do further
//                             course-level clamping per their own helpers)
// Throws 403 only when the account has no faculty- or program-grant at all.
export async function assertCanSeeFacultyDashboards(
  user: SessionUser,
): Promise<void> {
  if (seesAllScopes(user.role)) return;
  if (user.role === 'FACULTY_USER' && user.facultyId) return;
  if (user.role === 'PROGRAM_USER' && user.programId) return;
  // Consult UserScope rows — any admin / UNIVERSITY / FACULTY / PROGRAM
  // grant elevates this user to dashboard access.
  const scopes = await prisma.userScope.findMany({
    where: { userId: user.userId },
    select: { role: true, facultyId: true, programId: true },
  });
  if (
    scopes.some(
      (s) =>
        seesAllScopes(s.role) ||
        (s.role === 'FACULTY_USER' && s.facultyId) ||
        (s.role === 'PROGRAM_USER' && s.programId),
    )
  ) {
    return;
  }
  if (user.role === 'FACULTY_USER' && !user.facultyId) {
    throw new ForbiddenException('Your account has no faculty assignment. Contact an admin.');
  }
  if (user.role === 'PROGRAM_USER' && !user.programId) {
    throw new ForbiddenException('Your account has no program assignment. Contact an admin.');
  }
  throw new ForbiddenException(
    'This dashboard is restricted to assigned scopes — contact an admin.',
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
// UNION of faculties the user is granted access to (primary scope +
// UserScope rows). Used by /staff-dashboard and /education endpoints
// where the data is keyed off the StaffMasterRecord's faculty Thai name.
//
// Returns the rewritten filter, OR the unfiltered filter when the
// effective scope is 'all', OR null when the user has no faculty
// grants at all (caller treats as "no rows").
export async function clampFacultyNameFilter<F extends { facultyName: string[] }>(
  filter: F,
  user: SessionUser,
): Promise<F | null> {
  const eff = await resolveEffectiveScope(user);
  if (eff.mode === 'all') return filter;
  if (eff.mode === 'none') return null;
  // Resolve granted facultyIds to nameTh. Programs granted directly
  // (via PROGRAM_USER UserScope) roll up to their faculty so the
  // dashboard still has rows — these dashboards are not per-program.
  const grantedFacultyIds = new Set<string>(eff.facultyIds);
  if (eff.programIds.length > 0) {
    const progs = await prisma.program.findMany({
      where: { id: { in: eff.programIds } },
      select: { facultyId: true },
    });
    for (const p of progs) grantedFacultyIds.add(p.facultyId);
  }
  if (grantedFacultyIds.size === 0) return null;
  const faculties = await prisma.faculty.findMany({
    where: { id: { in: [...grantedFacultyIds] } },
    select: { nameTh: true },
  });
  if (faculties.length === 0) return null;
  return { ...filter, facultyName: faculties.map((f) => f.nameTh) };
}

// UUID variant — clamps `facultyId` to the user's granted scope set.
// Used by endpoints that join on Faculty.id directly (e.g., the TCAS
// recruitment dashboard). Multi-scope-aware:
//   - effective 'all' → pass through (no clamp)
//   - effective 'scoped' → if the manual ?facultyId= matches a granted
//     faculty, keep it; else fall back to the FIRST granted faculty
//     (silent clamp, same posture as the original primary-only impl).
//   - effective 'none' → pass through (caller has already 403'd).
//
// Per-faculty dashboards are single-faculty by design; multi-scope
// users with grants in N faculties see one at a time and the UI
// surfaces a chooser to switch.
export async function clampFacultyIdFilter<
  F extends { facultyId: string | null | undefined },
>(filter: F, user: SessionUser): Promise<F> {
  const eff = await resolveEffectiveScope(user);
  if (eff.mode !== 'scoped') return filter;
  const grantedFacultyIds = new Set<string>(eff.facultyIds);
  if (eff.programIds.length > 0) {
    const progs = await prisma.program.findMany({
      where: { id: { in: eff.programIds } },
      select: { facultyId: true },
    });
    for (const p of progs) grantedFacultyIds.add(p.facultyId);
  }
  const granted = [...grantedFacultyIds];
  if (granted.length === 0) return filter;
  if (filter.facultyId && granted.includes(filter.facultyId)) return filter;
  return { ...filter, facultyId: granted[0] };
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
  const eff = await resolveEffectiveScope(user);
  if (eff.mode === 'all') return { scope, scopeId };
  if (eff.mode === 'none') {
    throw new ForbiddenException(
      'Your account has no faculty or program assignment. Contact an admin.',
    );
  }
  // 'scoped' — UNION of granted faculties + programs.
  //
  // CRITICAL distinction:
  //   - directFacultyIds: real FACULTY_USER grants — promote the user
  //     to faculty-tier view (can see ALL programs in those faculties).
  //   - directProgramSet:  real PROGRAM_USER grants — only those
  //     specific programs are visible; faculty-tier views must NOT
  //     show the program's faculty mates.
  //
  // Previously we derived a single `grantedFacultyIds` set by mixing
  // direct faculty grants with the implied faculty of each granted
  // program. That over-elevated a pure PROGRAM_USER to faculty view
  // (when asking for university scope the clamp returned faculty +
  // the implied faculty, exposing all programs in that faculty).
  const directFacultyIds = new Set<string>(eff.facultyIds);
  const directProgramSet = new Set<string>(eff.programIds);
  const onlyProgramGrants =
    directFacultyIds.size === 0 && directProgramSet.size > 0;

  // PROGRAM_USER-only — narrowest tier. Anything wider drops to the
  // FIRST granted program (multi-program-grant users get a chooser
  // upstream; this is the safe default).
  if (onlyProgramGrants) {
    const firstProgram = [...directProgramSet][0]!;
    if (scope !== 'program') {
      return { scope: 'program', scopeId: firstProgram };
    }
    if (scopeId && !directProgramSet.has(scopeId)) {
      throw new ForbiddenException('This program is outside the scopes assigned to your account.');
    }
    return { scope, scopeId: scopeId ?? firstProgram };
  }

  // FACULTY-tier (with optional direct program grants in OTHER faculties).
  const firstFaculty = [...directFacultyIds][0]!;
  if (scope === 'university') {
    return { scope: 'faculty', scopeId: firstFaculty };
  }
  if (scope === 'faculty') {
    if (scopeId && !directFacultyIds.has(scopeId)) {
      throw new ForbiddenException("You can only view faculties assigned to your account.");
    }
    return { scope, scopeId: scopeId ?? firstFaculty };
  }
  if (scope === 'department') {
    if (!scopeId) throw new ForbiddenException('scopeId required for department scope.');
    const dept = await prisma.department.findUnique({
      where: { id: scopeId },
      select: { facultyId: true },
    });
    if (!dept) throw new ForbiddenException('Department not found.');
    if (!directFacultyIds.has(dept.facultyId)) {
      throw new ForbiddenException('Department is outside your assigned faculties.');
    }
    return { scope, scopeId };
  }
  // scope === 'program' — allow if directly granted OR within a direct
  // faculty grant.
  if (!scopeId) throw new ForbiddenException('scopeId required for program scope.');
  if (directProgramSet.has(scopeId)) return { scope, scopeId };
  const prog = await prisma.program.findUnique({
    where: { id: scopeId },
    select: { facultyId: true },
  });
  if (!prog) throw new ForbiddenException('Program not found.');
  if (!directFacultyIds.has(prog.facultyId)) {
    throw new ForbiddenException('Program is outside your assigned scopes.');
  }
  return { scope, scopeId };
}
