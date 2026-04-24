import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { Provider } from 'next-auth/providers';
import { prisma } from '@kku/db';
import { SessionUserSchema, type SessionUser } from '@kku/shared';

import { decodeJwt, encodeJwt } from './auth/jwt-codec';
import { assertLocalAuthSafe, isLocalAuthEnabled } from './auth/env-guard';
import { provisionFromOidcClaims } from './auth/provisioning';

assertLocalAuthSafe();

const providers: Provider[] = [];

// ── KKU SSO (OIDC) ────────────────────────────────────────────────────────
// Structured so we can swap to SAML/CAS later by replacing the object below.
if (process.env.KKU_SSO_ISSUER && process.env.KKU_SSO_CLIENT_ID) {
  providers.push({
    id: 'kku-sso',
    name: 'KKU SSO',
    type: 'oidc',
    issuer: process.env.KKU_SSO_ISSUER,
    clientId: process.env.KKU_SSO_CLIENT_ID,
    clientSecret: process.env.KKU_SSO_CLIENT_SECRET,
    authorization: {
      params: { scope: process.env.KKU_SSO_SCOPES ?? 'openid profile email' },
    },
    // client.token_endpoint_auth_method falls back to 'client_secret_basic'
    // which is the default for most OIDC servers. Override via config file
    // if KKU's IdP requires 'client_secret_post'.
  });
}

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
        // Defense in depth — authorize() is never invoked if the provider
        // didn't load, but check again.
        if (process.env.NODE_ENV === 'production') return null;
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') return null;

        if (password !== (process.env.DEV_AUTH_PASSWORD ?? 'kku-dev')) {
          return null;
        }
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name ?? user.email };
      },
    }),
  );
}

// Prod: honour secure-cookie defaults even when the terminating TLS is
// at KKU's reverse proxy. next-auth's heuristic looks at NEXTAUTH_URL
// so this is usually fine, but we set it explicitly to avoid surprise
// if someone runs the app behind a different proxy that strips the
// X-Forwarded-Proto header.
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
    async jwt({ token, user, account, profile, trigger }) {
      // Initial login — bridge provider user to our DB.
      if (user && account) {
        let dbUser;
        if (account.provider === 'dev-credentials') {
          dbUser = await prisma.user.findUniqueOrThrow({
            where: { id: user.id as string },
          });
        } else {
          // OIDC (KKU SSO).
          dbUser = await provisionFromOidcClaims({
            sub: account.providerAccountId,
            email: (profile?.email as string | undefined) ?? (user.email ?? undefined),
            name: (profile?.name as string | undefined) ?? (user.name ?? undefined),
            employee_id: profile?.employee_id as string | undefined,
            faculty_code: profile?.faculty_code as string | undefined,
            department_code: profile?.department_code as string | undefined,
          });
        }
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

      // Session.update() triggered — refresh mutable fields from DB so a
      // theme change (or role promotion) reflects without sign-out.
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
      if (parsed.success) {
        (session as unknown as { user: SessionUser }).user = parsed.data;
      }
      return session;
    },
  },
  trustHost: process.env.AUTH_TRUST_HOST === 'true',
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
