import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { Provider } from 'next-auth/providers';
import { prisma } from '@kku/db';
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
        if (!user) return null;
        const ok = user.passwordHash
          ? verifyPassword(password, user.passwordHash)
          : password === (process.env.DEV_AUTH_PASSWORD ?? 'kku-dev');
        if (!ok) return null;
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
        return {
          ...token,
          userId: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          role: dbUser.role,
          facultyId: dbUser.facultyId,
          departmentId: dbUser.departmentId,
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
            themePreference: true,
          },
        });
        if (fresh) {
          return {
            ...token,
            role: fresh.role,
            facultyId: fresh.facultyId,
            departmentId: fresh.departmentId,
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
            };
          }
        } catch {
          // Cookies API only available in route/server-component context
          // — silently ignore in other contexts (tests, build-time).
        }
      }

      (session as unknown as { user: SessionUser }).user = user;
      return session;
    },
  },
  trustHost: process.env.AUTH_TRUST_HOST === 'true',
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
