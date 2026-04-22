import { describe, expect, it } from 'vitest';
import {
  ALL_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  type Role,
  type SessionUser,
} from '../src';

// ──────────────────────────────────────────────────────────────────────────
// Role × scope authorisation matrix — kept close to English in the test
// names so regressions are obvious.
// ──────────────────────────────────────────────────────────────────────────

const FACULTY_A = 'fac-a';
const FACULTY_B = 'fac-b';
const DEPT_A1 = 'dept-a1';
const DEPT_A2 = 'dept-a2';
const DEPT_B1 = 'dept-b1';

function userFor(role: Role, overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: `u-${role}`,
    email: `${role.toLowerCase()}@kku.ac.th`,
    name: role,
    role,
    facultyId: overrides.facultyId ?? null,
    departmentId: overrides.departmentId ?? null,
    themePreference: 'SYSTEM',
    ...overrides,
  };
}

describe('ROLE_PERMISSIONS matrix', () => {
  it('covers every role', () => {
    for (const r of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[r]).toBeDefined();
    }
  });

  it('only references permissions that exist in the catalog', () => {
    const catalog = new Set<string>(PERMISSIONS);
    for (const r of ALL_ROLES) {
      for (const p of ROLE_PERMISSIONS[r]) {
        expect(catalog.has(p)).toBe(true);
      }
    }
  });

  it('ADMIN has every permission', () => {
    for (const p of PERMISSIONS) {
      expect(ROLE_PERMISSIONS.ADMIN.has(p)).toBe(true);
    }
  });

  it('VIEWER cannot see detailed financials or make scenarios', () => {
    expect(ROLE_PERMISSIONS.VIEWER.has('financials:read:all')).toBe(false);
    expect(ROLE_PERMISSIONS.VIEWER.has('scenarios:create:any')).toBe(false);
    expect(ROLE_PERMISSIONS.VIEWER.has('financials:read:aggregated_only')).toBe(
      true,
    );
  });

  it('COUNCIL cannot edit or make decisions (read-only at rollups)', () => {
    expect(ROLE_PERMISSIONS.COUNCIL.has('scenarios:create:any')).toBe(false);
    expect(ROLE_PERMISSIONS.COUNCIL.has('decisions:approve')).toBe(false);
    expect(ROLE_PERMISSIONS.COUNCIL.has('financials:read:all')).toBe(true);
  });

  it('ANALYST cannot approve decisions', () => {
    expect(ROLE_PERMISSIONS.ANALYST.has('decisions:approve')).toBe(false);
    expect(ROLE_PERMISSIONS.ANALYST.has('scenarios:create:any')).toBe(true);
    expect(ROLE_PERMISSIONS.ANALYST.has('ingestion:configure')).toBe(true);
  });
});

describe('can() — :all permissions', () => {
  it('grants when role has the permission, ignores scopeContext', () => {
    const u = userFor('COUNCIL');
    expect(can(u, 'programs:read:all')).toBe(true);
    expect(
      can(u, 'programs:read:all', { level: 'department', id: DEPT_B1 }),
    ).toBe(true);
  });

  it('denies when role does not have the permission', () => {
    const u = userFor('VIEWER');
    expect(can(u, 'financials:read:all')).toBe(false);
  });
});

describe('can() — :own_faculty permissions', () => {
  const dean = userFor('DEAN', { facultyId: FACULTY_A });

  it('grants when scope is the dean\'s own faculty', () => {
    expect(
      can(dean, 'financials:read:own_faculty', {
        level: 'faculty',
        id: FACULTY_A,
      }),
    ).toBe(true);
  });

  it('denies when scope is a different faculty', () => {
    expect(
      can(dean, 'financials:read:own_faculty', {
        level: 'faculty',
        id: FACULTY_B,
      }),
    ).toBe(false);
  });

  it('denies when user has no faculty set', () => {
    const floatingDean = userFor('DEAN', { facultyId: null });
    expect(
      can(floatingDean, 'financials:read:own_faculty', {
        level: 'faculty',
        id: FACULTY_A,
      }),
    ).toBe(false);
  });

  it('denies when scopeContext is missing entirely', () => {
    expect(can(dean, 'financials:read:own_faculty')).toBe(false);
  });

  it('denies at university scope (no faculty to match)', () => {
    expect(
      can(dean, 'financials:read:own_faculty', { level: 'university' }),
    ).toBe(false);
  });
});

describe('can() — :own_department permissions', () => {
  const dh = userFor('DEPT_HEAD', {
    facultyId: FACULTY_A,
    departmentId: DEPT_A1,
  });

  it('grants when scope is the head\'s own department', () => {
    expect(
      can(dh, 'financials:read:own_department', {
        level: 'department',
        id: DEPT_A1,
      }),
    ).toBe(true);
  });

  it('denies for a sibling department in the same faculty', () => {
    expect(
      can(dh, 'financials:read:own_department', {
        level: 'department',
        id: DEPT_A2,
      }),
    ).toBe(false);
  });

  it('denies for a department in another faculty', () => {
    expect(
      can(dh, 'financials:read:own_department', {
        level: 'department',
        id: DEPT_B1,
      }),
    ).toBe(false);
  });

  it('denies at faculty scope (department head is narrower)', () => {
    expect(
      can(dh, 'financials:read:own_department', {
        level: 'faculty',
        id: FACULTY_A,
      }),
    ).toBe(false);
  });
});

describe('can() — non-spatial suffixes', () => {
  it('aggregated_only has no spatial constraint', () => {
    const u = userFor('VIEWER');
    expect(can(u, 'financials:read:aggregated_only')).toBe(true);
    expect(
      can(u, 'financials:read:aggregated_only', {
        level: 'program',
        id: 'any',
      }),
    ).toBe(true);
  });

  it('decisions:approve is admin-only', () => {
    for (const role of ALL_ROLES) {
      const user = userFor(role);
      const expected = role === 'ADMIN';
      expect(can(user, 'decisions:approve')).toBe(expected);
    }
  });

  it('users:manage is admin-only', () => {
    for (const role of ALL_ROLES) {
      const expected = role === 'ADMIN';
      expect(can(userFor(role), 'users:manage')).toBe(expected);
    }
  });
});

describe('can() — scope drill-through safety', () => {
  const dean = userFor('DEAN', { facultyId: FACULTY_A });

  it('at program/department level without resolved parent, trusts upstream', () => {
    // Per can.ts comments: if scope is narrower than the permission's unit,
    // upstream middleware must resolve parent IDs. We return true here so
    // that we never over-deny; the integration layer enforces the narrow
    // check.
    expect(
      can(dean, 'financials:read:own_faculty', {
        level: 'department',
        id: 'unknown-dept',
      }),
    ).toBe(true);
  });
});
