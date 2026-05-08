import { NextResponse } from 'next/server';

import { buildLoginUrl, readSsonextEnv } from '@/lib/auth/kku-sso-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/kku-sso/start  — bounces the browser to KKU's login page.
//
// The caller can pass ?from=/path so we can preserve their intended
// destination through the round trip; we stash it in a short-lived cookie
// for the callback route to read.
export async function GET(req: Request) {
  const env = readSsonextEnv();
  // `req.url` may use the dev server's wildcard bind (`0.0.0.0`) which the
  // browser can't follow. Pin internal redirects to NEXTAUTH_URL.
  const publicBase = (process.env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  if (!env) {
    return NextResponse.redirect(new URL('/signin?error=sso_not_configured', publicBase));
  }

  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? '/';

  const res = NextResponse.redirect(buildLoginUrl(env));
  // Cookie is read once by the callback route and discarded. Lax so it
  // survives the cross-site bounce back from KKU.
  res.cookies.set('kku-sso-from', from, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
  });
  return res;
}
