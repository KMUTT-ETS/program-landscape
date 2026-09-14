import { describe, expect, it } from 'vitest';
import { ALL_ROLES, can } from '../src/auth';
import type { Role, SessionUser } from '../src/auth';

// Pins that can() grants these WITHOUT a scopeContext (they are non-spatial
// qualifiers, not :own_faculty-style scope suffixes) and that every role in
// the enum is checked — a role added later fails closed here rather than
// going untested on a PDPA-sensitive permission.

const user = (role: Role): SessionUser => ({
  userId: `u-${role}`,
  email: 'u@kku.ac.th',
  name: null,
  role,
  facultyId: null,
  departmentId: null,
  programId: null,
  themePreference: 'SYSTEM',
});

function expectGrant(permission: 'usage:read:aggregate' | 'usage:read:detail', granted: Role[]) {
  for (const r of ALL_ROLES) {
    expect(can(user(r), permission), `${r} → ${permission}`).toBe(granted.includes(r));
  }
}

describe('usage permissions', () => {
  it('aggregate: admin-grade and University users', () => {
    expectGrant('usage:read:aggregate', ['SUPER_ADMIN', 'SYSTEM_ADMIN', 'UNIVERSITY_USER']);
  });

  it('detail: admin-grade only — per-person browsing is sensitive', () => {
    expectGrant('usage:read:detail', ['SUPER_ADMIN', 'SYSTEM_ADMIN']);
  });
});
