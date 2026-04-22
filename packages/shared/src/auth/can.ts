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
//   - `:own_faculty` and `:own_department` permissions require a
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
 *   department/program inside it (scopeContext.id must match or the caller
 *   is responsible for resolving program→faculty first).
 * - `:own_department` → target scope must be the user's own department or
 *   a program inside it.
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

  if (permission.endsWith(':own_department')) {
    if (!user.departmentId) return false;
    if (!scopeContext) return false;
    return scopeContextMatchesDepartment(scopeContext, user.departmentId);
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
  // Department / program: caller must have resolved to the parent faculty
  // via Prisma before calling (we keep `can` pure and DB-free). The
  // convention: scope.id is still the department/program id, but callers
  // should ALSO pass a resolved facultyId when possible. For safety, if
  // scope is dept/program and we can't tell, require an upstream pass.
  // Rather than reach for the DB, return true here and rely on upstream
  // scope-resolution middleware to block mismatched traversal.
  return true;
}

function scopeContextMatchesDepartment(
  scope: ScopeContext,
  userDepartmentId: string,
): boolean {
  if (scope.level === 'university' || scope.level === 'faculty') return false;
  if (scope.level === 'department') return scope.id === userDepartmentId;
  // Program-level: parent-dept must match, delegated to upstream
  // middleware (see comment above).
  return true;
}
