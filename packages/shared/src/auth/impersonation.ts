// Impersonation cookie schema + decoder. Shared between the web's
// NextAuth session callback and the NestJS JWT auth guard so both
// surfaces apply the SAME role/scope override on every request.
//
// Security model lives unchanged from the original implementation:
//   - The cookie is unsigned. Anyone CAN forge it.
//   - But the override is ONLY applied when the JWT-derived role is
//     super-grade. A regular user forging the cookie sees no effect
//     because the gate (`canImpersonate(jwt.role)`) refuses.
//
// See `apps/web/src/lib/actions/impersonation.ts` for the set/clear
// server actions that mint this cookie.

import { z } from 'zod';
import { RoleSchema } from './roles';

export const IMPERSONATION_COOKIE = 'kku-impersonate';

export const ImpersonationPayloadSchema = z.object({
  role: RoleSchema,
  facultyId: z.string().nullable().optional().default(null),
  // departmentId kept on the schema for back-compat with cookies set
  // before 2026-05-09; no longer used for any access decision.
  departmentId: z.string().nullable().optional().default(null),
  // Canonical narrow scope for PROGRAM_USER. The picker (and the
  // FacultyMember auto-sync) always set this when the role is
  // PROGRAM_USER.
  programId: z.string().nullable().optional().default(null),
  setBy: z.string().min(1),
  setAt: z.string().datetime(),
});

export type ImpersonationPayload = z.infer<typeof ImpersonationPayloadSchema>;

// Roles allowed to impersonate. Post-legacy-removal: SUPER_ADMIN only.
export function canImpersonate(role: string | undefined | null): boolean {
  return role === 'SUPER_ADMIN';
}

// Spatial-scope axis per role. Used by the role-switcher UI to decide
// whether to ask for a faculty/program in step 2.
const FACULTY_SCOPED_ROLES = new Set(['FACULTY_USER']);
const PROGRAM_SCOPED_ROLES = new Set(['PROGRAM_USER']);

export function roleNeedsFaculty(role: string): boolean {
  return FACULTY_SCOPED_ROLES.has(role);
}

export function roleNeedsProgram(role: string): boolean {
  return PROGRAM_SCOPED_ROLES.has(role);
}

// Deprecated alias kept for any consumer that still calls
// roleNeedsDepartment — the answer is "no" since department isn't a
// scope axis anymore. Returns false for everything.
export function roleNeedsDepartment(_role: string): boolean {
  return false;
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
