import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { decodeJwt } from '@/lib/auth/jwt-codec';

// Protects /app/* routes. We deliberately do NOT import the full
// `@/lib/auth` module here — it pulls in Prisma, which isn't Edge-safe.
// Instead we decode the session cookie via jose (HS256) and redirect if
// invalid or missing.

const PUBLIC_PATHS = [/^\/signin(\/|$)/, /^\/api\/auth(\/|$)/];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => p.test(pathname))) return NextResponse.next();

  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = req.cookies.get(cookieName)?.value;

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Fail closed in any environment rather than silently allowing.
    return redirectToSignIn(req);
  }
  const payload = await decodeJwt({ token, secret });
  if (!payload || !payload.userId) return redirectToSignIn(req);
  return NextResponse.next();
}

function redirectToSignIn(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/signin';
  url.searchParams.set('from', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // All paths except Next.js internals, static assets, and files with
    // an extension (/\..*/). Auth routes and sign-in handled above.
    '/((?!_next/|favicon.ico|.*\\..*).*)',
  ],
};
