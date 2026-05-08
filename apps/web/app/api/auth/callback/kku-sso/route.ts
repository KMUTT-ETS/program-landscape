import { NextResponse } from 'next/server';

import { encodeJwt } from '@/lib/auth/jwt-codec';
import {
  exchangeCodeForToken,
  fetchProfile,
  readSsonextEnv,
  SsonextProtocolError,
} from '@/lib/auth/kku-sso-client';
import {
  provisionFromSsonext,
  ssonextClaimsFromProfile,
  syncAcademicStaffScopes,
} from '@/lib/auth/provisioning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/callback/kku-sso?code=<uuid>
//
// KKU SSONext redirects here after a successful login. We exchange the code
// for an access token, fetch the user profile, provision the User row, then
// mint a NextAuth-compatible session JWT and set it as the session cookie.
// The custom JWT codec in @/lib/auth/jwt-codec is shared with the NestJS
// API, so the same cookie value is verifiable on both sides.
//
// This is a deliberate static-route override of the [...nextauth] catch-all:
// the SSONext flow doesn't use NextAuth's OAuth machinery, so we handle the
// callback ourselves rather than going through Credentials.signIn().

// `req.url` reflects whatever host Next.js binds (often `0.0.0.0`, which is
// not browser-routable). Use NEXTAUTH_URL — the canonical public origin for
// this deployment — as the base for any redirect we emit.
function publicBase(req: Request): string {
  const fromEnv = process.env.NEXTAUTH_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // Fallback: keep the protocol + host from the incoming request, but
  // reject the unroutable wildcard.
  try {
    const u = new URL(req.url);
    if (u.hostname === '0.0.0.0') {
      // Best-effort substitution — localhost is at least browser-reachable.
      u.hostname = 'localhost';
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'http://localhost:3000';
  }
}

function redirectError(req: Request, error: string): NextResponse {
  const u = new URL(`/signin?error=${encodeURIComponent(error)}`, publicBase(req));
  const res = NextResponse.redirect(u);
  res.cookies.delete('kku-sso-from');
  return res;
}

export async function GET(req: Request) {
  const env = readSsonextEnv();
  if (!env) return redirectError(req, 'sso_not_configured');

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return redirectError(req, 'no_code');

  // Recover the originally intended destination if /start stashed it.
  const fromCookie = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('kku-sso-from='));
  const from = fromCookie ? decodeURIComponent(fromCookie.slice('kku-sso-from='.length)) : '/';
  // Defence: only honour same-origin paths.
  const safeFrom = from.startsWith('/') && !from.startsWith('//') ? from : '/';

  try {
    const token = await exchangeCodeForToken(env, code);
    let profile = null;
    try {
      profile = await fetchProfile(env, token.accessToken);
    } catch (err) {
      console.warn(
        'KKU SSO /user.profile failed during callback, provisioning with token payload only:',
        (err as Error).message,
      );
    }
    const claims = ssonextClaimsFromProfile(token, profile);
    const user = await provisionFromSsonext(claims);

    // Sync auto-managed PROGRAM_USER scopes from the FacultyMember
    // ↔ ProgramFaculty join. One academic staffer can sit on multiple
    // programs across faculties; we add scopes for each, prune ones
    // that no longer apply. Failures are logged but never block login —
    // the user's primary role still stands without auto-scopes.
    if (claims.employeeId) {
      try {
        const sync = await syncAcademicStaffScopes(user.id, claims.employeeId);
        if (sync.added || sync.removed) {
          console.log(
            `[sso] academic-staff scopes synced for ${user.email}: +${sync.added} -${sync.removed} (${sync.unchanged} unchanged)`,
          );
        }
      } catch (err) {
        console.warn(
          'syncAcademicStaffScopes failed (non-blocking):',
          (err as Error).message,
        );
      }
    }

    // Build the SessionUser shape that next-auth's session callback expects.
    // MUST include every field declared in SessionUserSchema or the JWT
    // verify on the next request will reject the cookie and auth() will
    // return null — no session, no login.
    const sessionUser = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      facultyId: user.facultyId,
      departmentId: user.departmentId,
      programId: user.programId,
      themePreference: user.themePreference,
    };

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      console.error('NEXTAUTH_SECRET unset — cannot mint session');
      return redirectError(req, 'server_misconfigured');
    }
    const maxAge = 30 * 24 * 60 * 60;
    const jwt = await encodeJwt({ token: sessionUser, secret, maxAge });

    const useSecureCookies = process.env.NODE_ENV === 'production';
    const cookieName = useSecureCookies
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';

    const target = new URL(safeFrom, publicBase(req));
    const res = NextResponse.redirect(target);
    res.cookies.set(cookieName, jwt, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: useSecureCookies,
      maxAge,
    });
    res.cookies.delete('kku-sso-from');
    return res;
  } catch (err) {
    if (err instanceof SsonextProtocolError) {
      console.error('SSO callback rejected by KKU:', err.code, err.message);
      return redirectError(req, `sso_${err.code.toLowerCase()}`);
    }
    console.error('SSO callback failed:', err);
    return redirectError(req, 'sso_failed');
  }
}
