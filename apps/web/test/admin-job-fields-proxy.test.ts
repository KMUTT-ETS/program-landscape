import { describe, expect, it, vi } from 'vitest';

// Importing the route module pulls in `@/lib/auth`, which at module scope
// wires up NextAuth + Prisma (`@kku/db`) — heavy and environment-sensitive,
// and irrelevant to what this file tests (the ALLOWED path allowlist).
// Mocking it out avoids that entirely, mirroring the pattern already used in
// test/scholar-admin-access.test.tsx.
vi.mock('@/lib/auth', () => ({ auth: async () => null }));

import { ALLOWED } from '../app/api/admin-job-fields/[...path]/route';

describe('admin-job-fields proxy path allowlist', () => {
  it.each([
    'x/approve',
    'x/reject',
    'x/merge',
    'assignments',
    'assignments/x/approve',
    'assignments/x/reject',
    'x',
  ])('accepts %s', (path) => {
    expect(ALLOWED.test(path)).toBe(true);
  });

  it.each([
    'x/delete',
    'assignments/x/merge',
    'x/approve/y',
    '../x',
  ])('rejects %s', (path) => {
    expect(ALLOWED.test(path)).toBe(false);
  });
});
