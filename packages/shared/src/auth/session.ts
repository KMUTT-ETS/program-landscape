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
  departmentId: z.string().nullable(),
  themePreference: ThemePreferenceSchema,
});
export type SessionUser = z.infer<typeof SessionUserSchema>;
