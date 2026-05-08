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
// Role × scope authorisation matrix — KKU SSO v2 taxonomy.
// (Legacy VIEWER/COUNCIL/EXECUTIVE/DEAN/DEPT_HEAD/ANALYST/ADMIN removed
// 2026-05-09 per migration 20260509100000_remove_legacy_user_roles.)
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

  it('SUPER_ADMIN has every permission', () => {
    for (const p of PERMISSIONS) {
      expect(ROLE_PERMISSIONS.SUPER_ADMIN.has(p)).toBe(true);
    }
  });

  it('SYSTEM_ADMIN has every permission except queues:manage', () => {
    expect(ROLE_PERMISSIONS.SYSTEM_ADMIN.has('queues:manage')).toBe(false);
    // Spot-check: SYSTEM_ADMIN should still hold the everyday admin perms.
    expect(ROLE_PERMISSIONS.SYSTEM_ADMIN.has('users:manage')).toBe(true);
    expect(ROLE_PERMISSIONS.SYSTEM_ADMIN.has('decisions:approve')).toBe(true);
    expect(ROLE_PERMISSIONS.SYSTEM_ADMIN.has('ingestion:configure')).toBe(true);
  });

  it('UNIVERSITY_USER reads everything but cannot create scenarios', () => {
    expect(ROLE_PERMISSIONS.UNIVERSITY_USER.has('financials:read:all')).toBe(true);
    expect(ROLE_PERMISSIONS.UNIVERSITY_USER.has('scenarios:create:any')).toBe(false);
    // Inherited from legacy COUNCIL — measure-edit on risks stays.
    expect(ROLE_PERMISSIONS.UNIVERSITY_USER.has('risks:measures:edit')).toBe(true);
  });

  it('PROGRAM_USER is restricted to its own program', () => {
    expect(ROLE_PERMISSIONS.PROGRAM_USER.has('financials:read:own_program')).toBe(true);
    expect(ROLE_PERMISSIONS.PROGRAM_USER.has('financials:read:all')).toBe(false);
    expect(ROLE_PERMISSIONS.PROGRAM_USER.has('decisions:approve')).toBe(false);
  });
});

describe('can() — :all permissions', () => {
  it('grants when role has the permission, ignores scopeContext', () => {
    const u = userFor('UNIVERSITY_USER');
    expect(can(u, 'programs:read:all')).toBe(true);
    expect(
      can(u, 'programs:read:all', { level: 'department', id: DEPT_B1 }),
    ).toBe(true);
  });

  it('denies when role does not have the permission', () => {
    const u = userFor('PROGRAM_USER');
    expect(can(u, 'financials:read:all')).toBe(false);
  });
});

describe('can() — :own_faculty permissions', () => {
  const facultyUser = userFor('FACULTY_USER', { facultyId: FACULTY_A });

  it('grants when scope is the user\'s own faculty', () => {
    expect(
      can(facultyUser, 'financials:read:own_faculty', {
        level: 'faculty',
        id: FACULTY_A,
      }),
    ).toBe(true);
  });

  it('denies when scope is a different faculty', () => {
    expect(
      can(facultyUser, 'financials:read:own_faculty', {
        level: 'faculty',
        id: FACULTY_B,
      }),
    ).toBe(false);
  });

  it('denies when user has no faculty set', () => {
    const floating = userFor('FACULTY_USER', { facultyId: null });
    expect(
      can(floating, 'financials:read:own_faculty', {
        level: 'faculty',
        id: FACULTY_A,
      }),
    ).toBe(false);
  });

  it('denies when scopeContext is missing entirely', () => {
    expect(can(facultyUser, 'financials:read:own_faculty')).toBe(false);
  });

  it('denies at university scope (no faculty to match)', () => {
    expect(
      can(facultyUser, 'financials:read:own_faculty', { level: 'university' }),
    ).toBe(false);
  });
});

describe('can() — :own_program permissions', () => {
  const PROG_A = 'prog-a';
  const PROG_B = 'prog-b';
  const programUser = userFor('PROGRAM_USER', {
    facultyId: FACULTY_A,
    programId: PROG_A,
  });

  it("grants when scope is the user's own program", () => {
    expect(
      can(programUser, 'financials:read:own_program', {
        level: 'program',
        id: PROG_A,
      }),
    ).toBe(true);
  });

  it('denies for a different program', () => {
    expect(
      can(programUser, 'financials:read:own_program', {
        level: 'program',
        id: PROG_B,
      }),
    ).toBe(false);
  });

  it('denies at department scope (program user is narrower)', () => {
    expect(
      can(programUser, 'financials:read:own_program', {
        level: 'department',
        id: DEPT_A1,
      }),
    ).toBe(false);
  });

  it('denies at faculty scope (program user is narrower)', () => {
    expect(
      can(programUser, 'financials:read:own_program', {
        level: 'faculty',
        id: FACULTY_A,
      }),
    ).toBe(false);
  });

  it('denies when user has no programId set', () => {
    const floating = userFor('PROGRAM_USER', { facultyId: FACULTY_A, programId: null });
    expect(
      can(floating, 'financials:read:own_program', {
        level: 'program',
        id: PROG_A,
      }),
    ).toBe(false);
  });
});

describe('can() — non-spatial suffixes', () => {
  it('aggregated_only has no spatial constraint', () => {
    // PROGRAM_USER carries `financials:read:aggregated_only` for the
    // contextual coarse-roll-up read alongside the strict own_program check.
    const u = userFor('PROGRAM_USER');
    expect(can(u, 'financials:read:aggregated_only')).toBe(true);
    expect(
      can(u, 'financials:read:aggregated_only', {
        level: 'program',
        id: 'any',
      }),
    ).toBe(true);
  });

  it('decisions:approve is admin-grade', () => {
    const adminGrade = new Set<Role>(['SUPER_ADMIN', 'SYSTEM_ADMIN']);
    for (const role of ALL_ROLES) {
      const user = userFor(role);
      const expected = adminGrade.has(role);
      expect(can(user, 'decisions:approve')).toBe(expected);
    }
  });

  it('users:manage is admin-grade', () => {
    const adminGrade = new Set<Role>(['SUPER_ADMIN', 'SYSTEM_ADMIN']);
    for (const role of ALL_ROLES) {
      const expected = adminGrade.has(role);
      expect(can(userFor(role), 'users:manage')).toBe(expected);
    }
  });
});

describe('can() — scope drill-through safety', () => {
  const facultyUser = userFor('FACULTY_USER', { facultyId: FACULTY_A });

  it('at program/department level without resolved parent, trusts upstream', () => {
    // Per can.ts comments: if scope is narrower than the permission's unit,
    // upstream middleware must resolve parent IDs. We return true here so
    // that we never over-deny; the integration layer enforces the narrow
    // check.
    expect(
      can(facultyUser, 'financials:read:own_faculty', {
        level: 'department',
        id: 'unknown-dept',
      }),
    ).toBe(true);
  });
});
