import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// Proxy for the spreadsheet-import endpoints.
//
// WHY THIS EXISTS, since /admin/jobthai posts straight to /api/v1 and looks
// like a precedent for not having it: in PRODUCTION nginx routes /api/v1/ to
// NestJS, so a direct call works. In local development there is no nginx and
// no Next rewrite, so /api/v1/... is served by Next itself and 404s with an
// HTML page. The direct-call pattern is therefore production-only; this route
// works in both, which is what an adopter setting the product up for the
// first time actually runs.
//
// The session cookie is HttpOnly, so the browser cannot mint the bearer
// itself — another reason the hop has to happen server-side.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

function bearerFromSession(token: string | undefined): Headers {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function sessionToken(): Promise<string | undefined> {
  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  return (await cookies()).get(cookieName)?.value;
}

function upstreamUrl(path: string[], req: Request): string {
  const search = new URL(req.url).search;
  return `${API_BASE}/api/v1/admin/imports/${path.map(encodeURIComponent).join('/')}${search}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;

  const { path } = await params;
  const upstream = await fetch(upstreamUrl(path, req), {
    headers: bearerFromSession(await sessionToken()),
    cache: 'no-store',
  });

  // A template download is a binary body with a filename, so pass the bytes
  // and the disposition through rather than reading it as text.
  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  const disposition = upstream.headers.get('content-disposition');
  const headers: Record<string, string> = { 'content-type': contentType };
  if (disposition) headers['content-disposition'] = disposition;

  return new NextResponse(await upstream.arrayBuffer(), { status: upstream.status, headers });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;

  const { path } = await params;
  const headers = bearerFromSession(await sessionToken());
  // Pass the original content-type through: for an upload it carries the
  // multipart boundary, without which the file cannot be parsed.
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const upstream = await fetch(upstreamUrl(path, req), {
    method: 'POST',
    headers,
    body: req.body,
    // Node's fetch requires this when streaming a request body.
    // @ts-expect-error — undici-specific, not in stock fetch typings.
    duplex: 'half',
  });

  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
