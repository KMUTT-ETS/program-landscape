import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { Provider } from 'next-auth/providers';
import {
  prisma,
  getSignInLockoutStatus,
  recordSignInFailure,
  recordSignInSuccess,
} from '@kku/db';
import { SessionUserSchema, type SessionUser } from '@kku/shared';

import { decodeJwt, encodeJwt } from './auth/jwt-codec';
import { assertLocalAuthSafe, isLocalAuthEnabled } from './auth/env-guard';
import { verifyPassword } from './auth/password-hash';
import {
  IMPERSONATION_COOKIE,
  canImpersonate,
  tryDecodeImpersonation,
} from './auth/impersonation';

assertLocalAuthSafe();

const providers: Provider[] = [];

// ── KKU SSONext ───────────────────────────────────────────────────────────
// SSONext is a custom KKU protocol (not OIDC) and bypasses NextAuth's
// provider machinery entirely. The browser flow is:
//   /api/auth/kku-sso/start  →  KKU login page
//   /api/auth/callback/kku-sso?code=...  →  exchange + provision + cookie
// The callback route mints the session JWT via the custom codec below and
// writes the same cookie name NextAuth uses, so auth() sees the session
// transparently. See docs/auth/kku-sso.md.

// ── Credentials (dev only) ───────────────────────────────────────────────
if (isLocalAuthEnabled()) {
  providers.push(
    Credentials({
      id: 'dev-credentials',
      name: 'Developer Login',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (process.env.NODE_ENV === 'production') return null;
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // Don't lock on unknown emails — that would let an attacker
        // enumerate the user table by watching which emails trigger the
        // lockout signal.
        if (!user) return null;

        // Soft-lockout check before verification.
        const lockout = await getSignInLockoutStatus(user.id);
        if (lockout.locked) return null;

        const ok = user.passwordHash
          ? verifyPassword(password, user.passwordHash)
          : password === (process.env.DEV_AUTH_PASSWORD ?? 'kku-dev');
        if (!ok) {
          // Record the failure (audit-log row). The window-based query
          // above will pick this up on the next attempt.
          await recordSignInFailure({
            userId: user.id,
            reason: 'bad_password',
          }).catch(() => undefined);
          return null;
        }
        await recordSignInSuccess({ userId: user.id }).catch(() => undefined);
        return { id: user.id, email: user.email, name: user.name ?? user.email };
      },
    }),
  );
}

const useSecureCookies = process.env.NODE_ENV === 'production';

export const authConfig: NextAuthConfig = {
  providers,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  useSecureCookies,
  cookies: {
    sessionToken: {
      name: useSecureCookies
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: useSecureCookies
        ? '__Secure-authjs.callback-url'
        : 'authjs.callback-url',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: useSecureCookies
        ? '__Host-authjs.csrf-token'
        : 'authjs.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
  },
  jwt: {
    encode: ({ token, secret, maxAge }) =>
      encodeJwt({
        token: token as unknown,
        secret: secret as string | string[],
        maxAge,
      }),
    decode: ({ token, secret }) =>
      decodeJwt({
        token,
        secret: secret as string | string[],
      }) as Promise<SessionUser>,
  },
  pages: {
    signIn: '/signin',
  },
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      // Initial login — both 'kku-sso' and 'dev-credentials' come through
      // the Credentials path; authorize() has already provisioned + returned
      // the User id, so we just hydrate the session from DB.
      if (user && account) {
        const dbUser = await prisma.user.findUniqueOrThrow({
          where: { id: user.id as string },
        });
        const scopes = await prisma.userScope.findMany({
          where: { userId: dbUser.id },
          select: { role: true, facultyId: true, programId: true },
        });
        const eff = resolveHighestRole(dbUser, scopes);
        return {
          ...token,
          userId: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          role: eff.role,
          facultyId: eff.facultyId,
          departmentId: dbUser.departmentId,
          programId: eff.programId,
          themePreference: dbUser.themePreference,
        };
      }

      if (trigger === 'update' && token.userId) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.userId as string },
          select: {
            role: true,
            facultyId: true,
            departmentId: true,
            programId: true,
            themePreference: true,
          },
        });
        if (fresh) {
          const scopes = await prisma.userScope.findMany({
            where: { userId: token.userId as string },
            select: { role: true, facultyId: true, programId: true },
          });
          const eff = resolveHighestRole(fresh, scopes);
          return {
            ...token,
            role: eff.role,
            facultyId: eff.facultyId,
            departmentId: fresh.departmentId,
            programId: eff.programId,
            themePreference: fresh.themePreference,
          };
        }
      }

      return token;
    },

    async session({ session, token }) {
      const parsed = SessionUserSchema.safeParse(token);
      if (!parsed.success) return session;
      let user: SessionUser = parsed.data;

      // ── Impersonation override ─────────────────────────────────────
      // Super-grade users can preview the app as a different role+scope.
      // The cookie is consulted ONLY when the underlying JWT role is
      // super-grade — a regular user setting the cookie sees no effect.
      // The session's underlying identity (email, themePreference) is
      // preserved; only the access-control fields change.
      if (canImpersonate(user.role)) {
        try {
          const { cookies } = await import('next/headers');
          const store = await cookies();
          const raw = store.get(IMPERSONATION_COOKIE)?.value;
          const imp = tryDecodeImpersonation(raw);
          if (imp) {
            user = {
              ...user,
              role: imp.role,
              facultyId: imp.facultyId ?? null,
              departmentId: imp.departmentId ?? null,
              programId: imp.programId ?? null,
            };
          }
        } catch {
          // Cookies API only available in route/server-component context
          // — silently ignore in other contexts (tests, build-time).
        }
      }

      // effectiveRole mirrors user.role at this point — the JWT
      // callback already promoted the role to the highest grant
      // (resolveHighestRole). Impersonation override (above) may have
      // narrowed user.role for previewing; effectiveRole follows the
      // current acting role so consumers don't have to reason about
      // both. Kept as a separate field for any consumer that still
      // reads it.
      (session as unknown as { user: SessionUser }).user = {
        ...user,
        effectiveRole: user.role,
      };
      return session;
    },
  },
  trustHost: process.env.AUTH_TRUST_HOST === 'true',
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

// Promote the user's primary role to the HIGHEST grant across
// (users.role, UserScope rows). The DB row stays as the audit record;
// the JWT carries the runtime role so every consumer sees the most-
// permissive level. Scope fields (facultyId/programId) follow the
// promoted role:
//   - Admin / UNIVERSITY_USER  → null/null (unscoped)
//   - FACULTY_USER             → facultyId of the first FACULTY_USER
//                                grant; programId null
//   - PROGRAM_USER             → primary scope IDs preserved
//
// Multi-scope users with grants at the same tier (e.g. two
// FACULTY_USER grants) pick the FIRST one as the "primary" scope ID —
// the runtime server-side scope clamping (resolveEffectiveScope on
// the API side) still unions ALL grants when querying data.
type RoleRow = { role: SessionUser['role']; facultyId: string | null; programId: string | null };
const ROLE_RANK: Record<SessionUser['role'], number> = {
  SUPER_ADMIN: 5,
  SYSTEM_ADMIN: 4,
  UNIVERSITY_USER: 3,
  FACULTY_USER: 2,
  PROGRAM_USER: 1,
};

export function resolveHighestRole(
  primary: { role: SessionUser['role']; facultyId: string | null; programId: string | null },
  scopes: RoleRow[],
): { role: SessionUser['role']; facultyId: string | null; programId: string | null } {
  // 1. Find the highest rank across (primary, scopes).
  const candidates: RoleRow[] = [primary, ...scopes];
  let maxRank = ROLE_RANK[primary.role];
  for (const c of candidates) {
    if (ROLE_RANK[c.role] > maxRank) maxRank = ROLE_RANK[c.role];
  }
  // 2. Within the top tier, prefer the candidate with the most-specific
  //    scope IDs (programId > facultyId > none). Critical for SSO-auto-
  //    assigned PROGRAM_USERs where users.program_id is null but a
  //    UserScope row carries the actual program assignment.
  const topTier = candidates.filter((c) => ROLE_RANK[c.role] === maxRank);
  let best = topTier[0]!;
  let bestScore = (best.programId ? 2 : 0) + (best.facultyId ? 1 : 0);
  for (const c of topTier) {
    const score = (c.programId ? 2 : 0) + (c.facultyId ? 1 : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  // 3. Normalise scope IDs per role tier.
  if (best.role === 'SUPER_ADMIN' || best.role === 'SYSTEM_ADMIN' || best.role === 'UNIVERSITY_USER') {
    return { role: best.role, facultyId: null, programId: null };
  }
  if (best.role === 'FACULTY_USER') {
    return { role: best.role, facultyId: best.facultyId, programId: null };
  }
  // PROGRAM_USER
  return { role: best.role, facultyId: best.facultyId, programId: best.programId };
}
