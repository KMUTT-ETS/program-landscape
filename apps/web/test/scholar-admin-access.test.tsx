import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@kku/shared';

// ────────────────────────────────────────────────────────────────────────────
// Who may open the admin Scholar console.
//
// This page is the one surface in the product where a click spends money, and
// unlike every other route in the feature it does NOT sit behind the NestJS
// guard: the roster it lists is read straight from Prisma in the server
// component (there is no staff-roster endpoint — see
// packages/db/src/scholar-console.ts). Its own `can(user, 'scholar:admin')`
// check is therefore the entire access control, so it is asserted rather than
// assumed.
//
// The permission, not the role, is what is checked — `isAdminGrade()` covers
// the same two roles today, and asking the permission directly means the page
// stays correct if that ever stops being true.
// ────────────────────────────────────────────────────────────────────────────

const REDIRECT = Symbol('redirect');

const mocks = vi.hoisted(() => ({
  session: null as { user: SessionUser } | null,
  redirects: [] as string[],
  rosterLoaded: 0,
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    mocks.redirects.push(to);
    // The real `redirect()` throws to unwind the render. Mirroring that is
    // what proves the page STOPS, rather than merely calling redirect and
    // carrying on to load the roster anyway.
    throw REDIRECT;
  },
}));

vi.mock('@/lib/auth', () => ({
  auth: async () => mocks.session,
}));

// Prisma at import time otherwise. The roster loader is counted so a redirect
// that failed to stop the render would be visible as a load.
vi.mock('@kku/db', () => ({
  SCHOLAR_NEEDS_BINDING: 'needs-binding',
  loadScholarConsoleRoster: async () => {
    mocks.rosterLoaded += 1;
    return {
      rows: [],
      faculties: [],
      departments: [],
      totals: { accounts: 0, resolved: 0, bound: 0, unbound: 0, unresolved: 0 },
    };
  },
}));

vi.mock('@/lib/actions/scholar-admin', () => ({
  listScholarRunsAction: async () => ({ ok: false, message: 'not called in this test' }),
}));

vi.mock('../app/admin/scholar/client', () => ({
  ScholarConsoleClient: () => null,
}));

vi.mock('@/components/shell/app-shell-server', () => ({
  AuthedAppShell: ({ children }: { children?: unknown }) => children ?? null,
}));

import AdminScholarPage from '../app/admin/scholar/page';

function user(role: SessionUser['role']): { user: SessionUser } {
  return {
    user: {
      userId: 'u1',
      email: 'someone@kku.ac.th',
      name: 'Someone',
      role,
      effectiveRole: role,
      facultyId: null,
      departmentId: null,
      programId: null,
      theme: 'system',
    } as unknown as SessionUser,
  };
}

afterEach(() => {
  mocks.session = null;
  mocks.redirects = [];
  mocks.rosterLoaded = 0;
});

async function open(): Promise<'rendered' | 'redirected'> {
  try {
    await AdminScholarPage();
    return 'rendered';
  } catch (err) {
    if (err === REDIRECT) return 'redirected';
    throw err;
  }
}

describe('the admin Scholar console is gated on scholar:admin', () => {
  it('sends an anonymous visitor to sign in, and loads no roster', async () => {
    mocks.session = null;
    expect(await open()).toBe('redirected');
    expect(mocks.redirects).toEqual(['/signin']);
    expect(mocks.rosterLoaded).toBe(0);
  });

  it.each(['UNIVERSITY_USER', 'FACULTY_USER', 'PROGRAM_USER'] as const)(
    'refuses %s — no staff roster is read at all',
    async (role) => {
      mocks.session = user(role);
      expect(await open()).toBe('redirected');
      expect(mocks.redirects).toEqual(['/no-access']);
      // The roster is personal data about every account on the platform. A
      // redirect that let the page keep rendering would have read it before
      // the response was discarded.
      expect(mocks.rosterLoaded).toBe(0);
    },
  );

  it.each(['SUPER_ADMIN', 'SYSTEM_ADMIN'] as const)('admits %s', async (role) => {
    mocks.session = user(role);
    expect(await open()).toBe('rendered');
    expect(mocks.redirects).toEqual([]);
    expect(mocks.rosterLoaded).toBe(1);
  });
});
