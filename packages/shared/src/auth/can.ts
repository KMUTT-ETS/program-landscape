import type { Permission } from './permissions';
import { ROLE_PERMISSIONS } from './permissions';
import type { SessionUser } from './session';
import type { ScopeLevel } from './scope-level';

// ──────────────────────────────────────────────────────────────────────────
// The authorisation entry point.
//
// Usage:
//   can(user, 'programs:read:all')
//   can(user, 'programs:read:own_faculty', { level: 'faculty', id: 'f-1' })
//
// Design:
//   - Any `:all` permission is scope-unrestricted — returns true if the
//     role owns the permission.
//   - `:own_faculty` and `:own_program` permissions require a
//     scopeContext AND require the target to be inside the user's own org.
//   - The caller chooses the permission carefully. This function does not
//     infer "intent" — the route's `@RequirePermission(...)` specifies
//     exactly which string to check.
//
// Guard-rail: we never throw on a user having "too many" permissions
// (e.g. ADMIN calling `:own_faculty` without a scope is fine; ADMIN has
// the `:all` version of the same permission).
// ──────────────────────────────────────────────────────────────────────────

export interface ScopeContext {
  level: ScopeLevel;
  id?: string;
  /**
   * When `level` is `department` or `program`, callers SHOULD resolve the
   * parent faculty id and pass it here. Without it, `can()` fails closed
   * for `:own_faculty` permissions — there is no way to verify the
   * department/program belongs to the user's own faculty.
   */
  resolvedFacultyId?: string;
}

/** Did the user explicitly receive the named permission? */
export function hasPermission(user: SessionUser, permission: Permission): boolean {
  return ROLE_PERMISSIONS[user.role].has(permission);
}

/**
 * Full decision: does this user have the permission, AND (if the permission
 * is scope-restricted) does the target scope lie inside the user's own org?
 *
 * - `:all` permissions → scopeContext is ignored.
 * - `:own_faculty` → target scope must be the user's own faculty or a
 *   program inside it (scopeContext.id must match or the caller is
 *   responsible for resolving program→faculty first).
 * - `:own_program` → target scope must be the user's own program (the
 *   single program assigned to them via User.programId).
 */
export function can(
  user: SessionUser,
  permission: Permission,
  scopeContext?: ScopeContext,
): boolean {
  if (!hasPermission(user, permission)) return false;

  if (permission.endsWith(':all')) return true;

  if (permission.endsWith(':own_faculty')) {
    if (!user.facultyId) return false;
    if (!scopeContext) return false;
    return scopeContextMatchesFaculty(scopeContext, user.facultyId);
  }

  if (permission.endsWith(':own_program')) {
    if (!user.programId) return false;
    if (!scopeContext) return false;
    return scopeContextMatchesProgram(scopeContext, user.programId);
  }

  // :aggregated_only and any other suffix aren't spatial — permission
  // presence alone is enough. Shape-of-response is the caller's concern.
  return true;
}

function scopeContextMatchesFaculty(
  scope: ScopeContext,
  userFacultyId: string,
): boolean {
  // At university level, no faculty match possible.
  if (scope.level === 'university') return false;
  // Faculty level: ids must match.
  if (scope.level === 'faculty') return scope.id === userFacultyId;
  // Department / program: caller MUST resolve to the parent faculty before
  // invoking can(). We keep `can` pure (DB-free), so the contract is:
  // pass `scope.resolvedFacultyId` when level is `department` or `program`.
  // If the parent faculty is missing, fail closed — silently returning
  // `true` here was the V1 (Prompt 04) critical scope-bypass.
  if (scope.level === 'department' || scope.level === 'program') {
    if (!scope.resolvedFacultyId) return false;
    return scope.resolvedFacultyId === userFacultyId;
  }
  return false;
}

function scopeContextMatchesProgram(
  scope: ScopeContext,
  userProgramId: string,
): boolean {
  // PROGRAM_USER scope is the narrowest — only matches an exact program.
  // Any wider scope (university / faculty / department) is refused; if a
  // caller wants to grant aggregate visibility on top, use the
  // `:aggregated_only` permission instead of `:own_program`.
  if (scope.level === 'program') return scope.id === userProgramId;
  return false;
}
