import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// Catch-all proxy for /admin/data-setup/raw/* on the NestJS API. Same
// pattern as /api/admin-programs/[...path] — forwards method + body +
// search params with the session bearer attached.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

async function forward(req: Request, pathSegments: string[]): Promise<NextResponse> {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;

  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const xff = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  if (xff) headers.set('x-forwarded-for', xff);

  const incoming = new URL(req.url);
  const subPath = pathSegments.map(encodeURIComponent).join('/');
  const upstreamUrl =
    `${API_BASE}/api/v1/admin/data-setup/raw${subPath ? '/' + subPath : ''}` + incoming.search;

  const upstream = await fetch(upstreamUrl, { method: req.method, headers });
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return forward(req, path);
}
