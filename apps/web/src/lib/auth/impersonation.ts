// Impersonation — lets a super-grade admin preview the app from any
// other role + scope without logging out. Implementation is a single
// HTTP cookie (`kku-impersonate`) read in the auth.ts session callback.
//
// Security model:
//   1. The cookie is unsigned. Anyone CAN forge it.
//   2. But the override is ONLY applied when the JWT-derived role is
//      super-grade (ADMIN or SUPER_ADMIN). A regular user who forges
//      the cookie sees no effect because their JWT says they're a
//      VIEWER (or whatever) and the override gate refuses.
//   3. The original userId is preserved in the session as `impersonatorId`
//      so audit logs always identify the real human behind the action.
//
// This keeps the implementation simple — no extra signing key, no extra
// JWT — and the security relies on a single condition that's impossible
// for a non-super user to satisfy.

import { z } from 'zod';
import { RoleSchema } from '@kku/shared';

export const IMPERSONATION_COOKIE = 'kku-impersonate';

// Cookie payload — the alternate role + scope to apply.
export const ImpersonationPayloadSchema = z.object({
  role: RoleSchema,
  facultyId: z.string().nullable().optional().default(null),
  departmentId: z.string().nullable().optional().default(null),
  // The original user that started impersonating — for audit + banner.
  setBy: z.string().min(1),
  setAt: z.string().datetime(),
});

export type ImpersonationPayload = z.infer<typeof ImpersonationPayloadSchema>;

// Roles allowed to impersonate. SUPER_ADMIN + legacy ADMIN.
export function canImpersonate(role: string | undefined | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

// Roles that REQUIRE a faculty scope to be meaningful.
const FACULTY_SCOPED_ROLES = new Set(['DEAN', 'FACULTY_USER']);

// Roles that REQUIRE a department scope to be meaningful.
const DEPARTMENT_SCOPED_ROLES = new Set(['DEPT_HEAD', 'PROGRAM_USER']);

export function roleNeedsFaculty(role: string): boolean {
  return FACULTY_SCOPED_ROLES.has(role);
}

export function roleNeedsDepartment(role: string): boolean {
  return DEPARTMENT_SCOPED_ROLES.has(role);
}

export function tryDecodeImpersonation(raw: string | undefined): ImpersonationPayload | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(decodeURIComponent(raw)) as unknown;
    const parsed = ImpersonationPayloadSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeImpersonation(payload: ImpersonationPayload): string {
  return encodeURIComponent(JSON.stringify(payload));
}
