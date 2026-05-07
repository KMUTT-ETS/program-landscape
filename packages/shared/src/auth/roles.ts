import { z } from 'zod';

// Mirrors the Prisma enum UserRole. Kept in sync by hand — if either side
// changes, the TypeScript union below must change too. The unit tests import
// both sides and assert equivalence (see packages/shared/test/roles.test.ts).
//
// Role taxonomy (2026-05-07) — KKU SSO:
//   SUPER_ADMIN     — full access, can promote SYSTEM_ADMINs
//   SYSTEM_ADMIN    — admin-grade; can assign roles up to SYSTEM_ADMIN
//                     but never SUPER_ADMIN
//   UNIVERSITY_USER — read-all at university scope
//   FACULTY_USER    — read access scoped to user's facultyId
//   PROGRAM_USER    — read access scoped to user's programId
//
// Legacy roles (VIEWER..ADMIN) retained for back-compat with existing
// seed data + scenarios/decisions referencing them. New SSO provisioning
// uses the v2 taxonomy.
export const RoleSchema = z.enum([
  // Legacy
  'VIEWER',
  'COUNCIL',
  'EXECUTIVE',
  'DEAN',
  'DEPT_HEAD',
  'ANALYST',
  'ADMIN',
  // KKU SSO v2
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER',
]);
export type Role = z.infer<typeof RoleSchema>;

export const ALL_ROLES: readonly Role[] = RoleSchema.options;

// New-taxonomy convenience set — useful for admin UIs that should only
// offer the canonical 5 roles, not the deprecated legacy ones.
export const SSO_ROLES: readonly Role[] = [
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER',
] as const;

// Roles SYSTEM_ADMIN may assign to other users (cannot create another
// SUPER_ADMIN — that's reserved for SUPER_ADMIN). SUPER_ADMIN may assign
// any role.
export const SYSTEM_ADMIN_ASSIGNABLE_ROLES: readonly Role[] = [
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER',
] as const;
