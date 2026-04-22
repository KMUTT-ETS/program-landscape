import { z } from 'zod';

// Mirrors the Prisma enum UserRole. Kept in sync by hand — if either side
// changes, the TypeScript union below must change too. The unit tests import
// both sides and assert equivalence (see packages/shared/test/roles.test.ts).
export const RoleSchema = z.enum([
  'VIEWER',
  'COUNCIL',
  'EXECUTIVE',
  'DEAN',
  'DEPT_HEAD',
  'ANALYST',
  'ADMIN',
]);
export type Role = z.infer<typeof RoleSchema>;

export const ALL_ROLES: readonly Role[] = RoleSchema.options;
