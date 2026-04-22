import { z } from 'zod';

// Four analytical scopes — also mirrored in @kku/db/src/scope.ts. Duplicated
// here because RBAC must not depend on @kku/db (which pulls in Prisma).
export const ScopeLevelSchema = z.enum([
  'university',
  'faculty',
  'department',
  'program',
]);
export type ScopeLevel = z.infer<typeof ScopeLevelSchema>;
