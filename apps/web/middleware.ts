import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { decodeJwt } from '@/lib/auth/jwt-codec';

// Two responsibilities:
//
// 1. **Auth gate** — protects every page outside the `/signin` and
//    `/api/auth/*` allow-list. We deliberately do NOT import the full
//    `@/lib/auth` module here — it pulls in Prisma, which isn't
//    Edge-safe. Instead we decode the session cookie via jose (HS256)
//    and redirect if invalid or missing.
//
// 2. **CSP nonce injection** — emits a per-request `script-src` nonce
//    so we can drop `'unsafe-inline'` from the CSP. Next 14 App Router
//    propagates the `x-nonce` request header to its inline-script
//    bootstrap automatically. Style-src keeps `'unsafe-inline'`
//    because the Next runtime + Tailwind JIT inject inline `<style>`
//    blocks; nonce-ing styles is a separate, more invasive change.
//
// The middleware now sets the CSP for HTML responses; the `headers()`
// block in next.config.mjs no longer carries a CSP entry.

const PUBLIC_PATHS = [
  /^\/signin(\/|$)/,
  /^\/api\/auth(\/|$)/,
  // Public profile pages (per-user opt-in). The page itself enforces
  // the "is this slug public?" check against the DB; the middleware
  // just needs to NOT bounce anonymous viewers to /signin.
  /^\/p\/[^/]+(\/|$)/,
];
const isProd = process.env.NODE_ENV === 'production';

// Build the CSP string for a given nonce. Kept inline so the Edge
// bundle stays small.
function buildCsp(nonce: string): string {
  // `'strict-dynamic'` lets scripts loaded by trusted scripts run
  // without each one needing a nonce — this is what makes the Next
  // dynamic-import boot path work without `unsafe-inline`.
  // We pair it with `'self'` for older browsers that ignore
  // strict-dynamic (which then fall back to source-list semantics).
  const apiOrigin = process.env.PUBLIC_API_ORIGIN ?? '';
  const directives = [
    `default-src 'self'`,
    // Drop 'unsafe-inline' on script-src in BOTH dev + prod.
    // 'unsafe-eval' is dev-only (HMR/source-maps); also pinned to nonce.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    // style-src keeps 'unsafe-inline' — see comment above.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${apiOrigin}`.trim(),
    `worker-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    // `upgrade-insecure-requests` only in production. In dev, the box
    // serves plain HTTP on :3000 — adding this directive forces the
    // browser to upgrade every CSS / font / script / API call to HTTPS,
    // which fails (no HTTPS listener), so the page renders with data
    // but no styles. Repro: load http://10.101.111.233:3000/cockpit
    // → HTML lands with all the data, every <link> + <script> 0-byte
    // / blocked. Fix: only emit the directive when the dev box is
    // actually behind TLS (= production via the KKU upstream proxy).
    ...(isProd ? [`upgrade-insecure-requests`] : []),
  ];
  return directives.join('; ');
}

// Per-request nonce — base64-encoded 128 random bits. crypto.getRandomValues
// is available on the Edge runtime.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa is Edge-safe; convert to a URL-safe base64.
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '');
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Build the CSP early so even unauthenticated bounces ship it.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Forward the nonce to the app via a request header — Next 14 picks
  // it up automatically and stamps inline bootstrap scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);

  // ── Public path: pass through with CSP applied ───────────────────
  if (PUBLIC_PATHS.some((p) => p.test(pathname))) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('Content-Security-Policy', csp);
    return res;
  }

  // ── Auth check ───────────────────────────────────────────────────
  const cookieName = isProd
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
  const token = req.cookies.get(cookieName)?.value;

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Fail closed + log loudly. Silent redirect loops when the secret
    // isn't loaded are the worst-class-of-bug to debug; the one-line
    // warning makes the cause obvious in the server log.
    // eslint-disable-next-line no-console
    console.warn(
      '[middleware] NEXTAUTH_SECRET is not set — every protected route will redirect to /signin. Check apps/web/.env and restart.',
    );
    return redirectToSignIn(req);
  }
  const payload = await decodeJwt({ token, secret });
  if (!payload || !payload.userId) return redirectToSignIn(req);

  // ── Authenticated: pass through with nonce-CSP ───────────────────
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
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
