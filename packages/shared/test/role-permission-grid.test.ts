import { describe, expect, it } from 'vitest';
import { hasPermission } from '../src/auth/can';
import {
  ALL_ROLES,
  isAdminGrade,
  isSuperGrade,
  isUniversityWide,
  SYSTEM_ADMIN_ASSIGNABLE_ROLES,
} from '../src/auth/roles';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/auth/permissions';
import type { SessionUser } from '../src/auth/session';

// Exhaustive role × permission grid. Catches the silent regression where
// a refactor accidentally adds or removes a permission from a role's set.
//
// Strategy: snapshot the canonical matrix, then assert each cell. The
// matrix below MUST be updated in lockstep with packages/shared/src/auth/
// permissions.ts — that's the point. A drift between the two files means
// either:
//   (a) someone added a new permission and didn't think about which roles
//       should have it (test fails with "extra permission"),
//   (b) someone removed a permission a role used to have (test fails with
//       "missing permission").
//
// Both cases warrant a code review, not a quiet test-update.

function user(role: SessionUser['role'], extra: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u1',
    email: 'test@kku.ac.th',
    role,
    name: 'T',
    facultyId: null,
    departmentId: null,
    programId: null,
    ...extra,
  };
}

describe('Role → permission grid (canonical matrix)', () => {
  // Sanity: every permission referenced from a role's set actually exists in
  // the PERMISSIONS catalog. Catches typos in the role definition.
  it('every role-assigned permission is a member of the PERMISSIONS catalog', () => {
    for (const role of ALL_ROLES) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS as readonly string[]).toContain(perm);
      }
    }
  });

  // Every permission in the catalog is held by AT LEAST one role. Catches
  // dead permissions that linger after a refactor.
  it('every permission is assigned to at least one role', () => {
    const allAssigned = new Set<string>();
    for (const role of ALL_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) allAssigned.add(p);
    }
    for (const p of PERMISSIONS) {
      expect(allAssigned.has(p)).toBe(true);
    }
  });

  describe('SUPER_ADMIN — owns everything (no exclusions)', () => {
    const u = user('SUPER_ADMIN');
    for (const p of PERMISSIONS) {
      it(`has ${p}`, () => {
        expect(hasPermission(u, p)).toBe(true);
      });
    }
  });

  describe('SYSTEM_ADMIN — everything EXCEPT super-only perms', () => {
    const u = user('SYSTEM_ADMIN');
    it('does NOT have queues:manage', () => {
      expect(hasPermission(u, 'queues:manage')).toBe(false);
    });
    it('does NOT have ai_models:configure', () => {
      expect(hasPermission(u, 'ai_models:configure')).toBe(false);
    });
    for (const p of PERMISSIONS) {
      if (p === 'queues:manage' || p === 'ai_models:configure') continue;
      it(`has ${p}`, () => {
        expect(hasPermission(u, p)).toBe(true);
      });
    }
  });

  describe('UNIVERSITY_USER — read-all at university scope', () => {
    const u = user('UNIVERSITY_USER');
    const expected = new Set([
      'faculties:read:all',
      'departments:read:all',
      'programs:read:all',
      'financials:read:all',
      'faculty_members:read:all',
      'outcomes:read:all',
      'scenarios:read:all',
      'decisions:read:all',
      'pdf:generate',
      'risks:read:all',
      'risks:measures:edit',
      'institution:read:university',
    ]);

    for (const p of PERMISSIONS) {
      const expects = expected.has(p);
      it(`${expects ? 'has' : 'does NOT have'} ${p}`, () => {
        expect(hasPermission(u, p)).toBe(expects);
      });
    }

    it('CANNOT manage users / approve decisions / configure ingestion', () => {
      expect(hasPermission(u, 'users:manage')).toBe(false);
      expect(hasPermission(u, 'decisions:approve')).toBe(false);
      expect(hasPermission(u, 'ingestion:configure')).toBe(false);
    });
  });

  describe('FACULTY_USER — own-faculty read', () => {
    const u = user('FACULTY_USER');
    const expected = new Set([
      'faculties:read:all',
      'departments:read:all',
      'programs:read:all',
      'programs:read:own_faculty',
      'financials:read:own_faculty',
      'financials:read:aggregated_only',
      'faculty_members:read:own_faculty',
      'outcomes:read:own_faculty',
      'outcomes:read:all',
      'scenarios:read:all',
      'decisions:read:all',
      'pdf:generate',
      'risks:read:all',
    ]);

    for (const p of PERMISSIONS) {
      const expects = expected.has(p);
      it(`${expects ? 'has' : 'does NOT have'} ${p}`, () => {
        expect(hasPermission(u, p)).toBe(expects);
      });
    }

    it('does NOT have :all variants of own-scope permissions', () => {
      expect(hasPermission(u, 'financials:read:all')).toBe(false);
      expect(hasPermission(u, 'faculty_members:read:all')).toBe(false);
    });
  });

  describe('PROGRAM_USER — own-program read only', () => {
    const u = user('PROGRAM_USER');
    const expected = new Set([
      'faculties:read:all',
      'departments:read:all',
      'programs:read:all',
      'programs:read:own_program',
      'financials:read:own_program',
      'financials:read:aggregated_only',
      'faculty_members:read:own_program',
      'outcomes:read:own_program',
      'outcomes:read:all',
      'scenarios:read:all',
      'decisions:read:all',
      'pdf:generate',
      'risks:read:all',
    ]);

    for (const p of PERMISSIONS) {
      const expects = expected.has(p);
      it(`${expects ? 'has' : 'does NOT have'} ${p}`, () => {
        expect(hasPermission(u, p)).toBe(expects);
      });
    }

    it('CANNOT see own_faculty data (only own_program)', () => {
      expect(hasPermission(u, 'financials:read:own_faculty')).toBe(false);
      expect(hasPermission(u, 'faculty_members:read:own_faculty')).toBe(false);
      expect(hasPermission(u, 'outcomes:read:own_faculty')).toBe(false);
    });
  });

  describe('Role-grade helpers (load-bearing for /admin gates)', () => {
    it('isAdminGrade: only SUPER_ADMIN + SYSTEM_ADMIN', () => {
      expect(isAdminGrade('SUPER_ADMIN')).toBe(true);
      expect(isAdminGrade('SYSTEM_ADMIN')).toBe(true);
      expect(isAdminGrade('UNIVERSITY_USER')).toBe(false);
      expect(isAdminGrade('FACULTY_USER')).toBe(false);
      expect(isAdminGrade('PROGRAM_USER')).toBe(false);
      expect(isAdminGrade(null)).toBe(false);
      expect(isAdminGrade(undefined)).toBe(false);
    });

    it('isSuperGrade: ONLY SUPER_ADMIN', () => {
      expect(isSuperGrade('SUPER_ADMIN')).toBe(true);
      expect(isSuperGrade('SYSTEM_ADMIN')).toBe(false);
      expect(isSuperGrade('UNIVERSITY_USER')).toBe(false);
      expect(isSuperGrade('FACULTY_USER')).toBe(false);
      expect(isSuperGrade('PROGRAM_USER')).toBe(false);
      expect(isSuperGrade(null)).toBe(false);
    });

    it('isUniversityWide: SUPER + SYSTEM + UNIVERSITY_USER', () => {
      expect(isUniversityWide('SUPER_ADMIN')).toBe(true);
      expect(isUniversityWide('SYSTEM_ADMIN')).toBe(true);
      expect(isUniversityWide('UNIVERSITY_USER')).toBe(true);
      expect(isUniversityWide('FACULTY_USER')).toBe(false);
      expect(isUniversityWide('PROGRAM_USER')).toBe(false);
      expect(isUniversityWide(null)).toBe(false);
    });

    it('SYSTEM_ADMIN_ASSIGNABLE_ROLES does NOT include SUPER_ADMIN', () => {
      // Critical for the role-promotion service: SYSTEM_ADMIN must never
      // be able to mint a SUPER_ADMIN.
      expect(SYSTEM_ADMIN_ASSIGNABLE_ROLES).not.toContain('SUPER_ADMIN');
      expect(SYSTEM_ADMIN_ASSIGNABLE_ROLES).toContain('SYSTEM_ADMIN');
      expect(SYSTEM_ADMIN_ASSIGNABLE_ROLES).toContain('UNIVERSITY_USER');
      expect(SYSTEM_ADMIN_ASSIGNABLE_ROLES).toContain('FACULTY_USER');
      expect(SYSTEM_ADMIN_ASSIGNABLE_ROLES).toContain('PROGRAM_USER');
    });
  });
});
