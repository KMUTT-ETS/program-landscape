import { z } from 'zod';
import { RoleSchema } from './roles';

// The authenticated user shape carried in NextAuth JWT + propagated to the
// API. Must stay small — JWTs are re-encoded on every request.
export const ThemePreferenceSchema = z.enum(['LIGHT', 'DARK', 'SYSTEM']);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const SessionUserSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: RoleSchema,
  facultyId: z.string().nullable(),
  // departmentId is retained on the session for back-compat with audit
  // logs but is NOT used for access decisions anymore. PROGRAM_USER
  // scope is keyed off programId directly (decision 2026-05-09 — drop
  // department as a scope axis since the data model wasn't carrying it
  // consistently and the canonical "program lives in a faculty" link
  // is the only one we can rely on).
  //
  // `.optional().default(null)` for both so older JWT cookies minted
  // before either field landed still parse — the schema gracefully
  // upgrades the missing key to null instead of failing the whole
  // session verify.
  departmentId: z.string().nullable().optional().default(null),
  programId: z.string().nullable().optional().default(null),
  themePreference: ThemePreferenceSchema,
});
export type SessionUser = z.infer<typeof SessionUserSchema>;
