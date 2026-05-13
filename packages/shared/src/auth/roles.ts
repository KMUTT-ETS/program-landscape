import { z } from 'zod';

// Mirrors the Prisma enum UserRole. Kept in sync by hand — if either side
// changes, both must change together.
//
// KKU SSO role taxonomy (legacy roles removed 2026-05-09):
//   SUPER_ADMIN     — full access, can promote SYSTEM_ADMINs
//   SYSTEM_ADMIN    — admin-grade; can assign roles up to SYSTEM_ADMIN
//                     but never SUPER_ADMIN
//   UNIVERSITY_USER — read-all at university scope
//   FACULTY_USER    — read access scoped to user's facultyId
//   PROGRAM_USER    — read access scoped to user's programId
export const RoleSchema = z.enum([
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER',
]);
export type Role = z.infer<typeof RoleSchema>;

export const ALL_ROLES: readonly Role[] = RoleSchema.options;

// Synonym preserved for callers that still import this name. Equivalent
// to ALL_ROLES — there are no non-SSO roles anymore.
export const SSO_ROLES: readonly Role[] = ALL_ROLES;

// Roles SYSTEM_ADMIN may assign to other users (cannot create another
// SUPER_ADMIN — that's reserved for SUPER_ADMIN). SUPER_ADMIN may assign
// any role.
export const SYSTEM_ADMIN_ASSIGNABLE_ROLES: readonly Role[] = [
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER',
] as const;

// Admin-grade roles — full or near-full mutation surface.
export const ADMIN_GRADE_ROLES: readonly Role[] = ['SUPER_ADMIN', 'SYSTEM_ADMIN'] as const;

export function isAdminGrade(role: Role | undefined | null): boolean {
  if (!role) return false;
  return (ADMIN_GRADE_ROLES as readonly string[]).includes(role);
}

// Super-grade roles — only SUPER_ADMIN. Used for queue management and
// other actions that SYSTEM_ADMIN should NOT have.
export const SUPER_GRADE_ROLES: readonly Role[] = ['SUPER_ADMIN'] as const;

export function isSuperGrade(role: Role | undefined | null): boolean {
  if (!role) return false;
  return (SUPER_GRADE_ROLES as readonly string[]).includes(role);
}

// University-wide roles — admin-grade plus UNIVERSITY_USER. These see
// data spanning every faculty (Education + Staff dashboards, Cockpit at
// university scope). FACULTY_USER and PROGRAM_USER are explicitly
// excluded — those users get bounced to /no-access.
export const UNIVERSITY_WIDE_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
] as const;

export function isUniversityWide(role: Role | undefined | null): boolean {
  if (!role) return false;
  return (UNIVERSITY_WIDE_ROLES as readonly string[]).includes(role);
}

// Roles that can see the Education + Staff dashboards. Adds FACULTY_USER
// to the university-wide set — the dashboards are the same UI, but the
// server clamps every filter to user.facultyId so the FACULTY_USER only
// ever sees their own faculty's numbers. PROGRAM_USER stays excluded —
// these dashboards have no per-program variant.
export const FACULTY_DASHBOARD_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
] as const;

export function canSeeFacultyDashboards(
  role: Role | undefined | null,
): boolean {
  if (!role) return false;
  return (FACULTY_DASHBOARD_ROLES as readonly string[]).includes(role);
}
