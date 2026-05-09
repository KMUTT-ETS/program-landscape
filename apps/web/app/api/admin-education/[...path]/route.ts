import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// Proxy for /education/* on the NestJS API. The browser hits
// /api/admin-education/<anything>; we forward with the session bearer.
// /education/* is gated server-side on `institution:read:university` —
// university-wide roles only (admin-grade + UNIVERSITY_USER).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

async function forward(
  req: Request,
  pathSegments: string[],
): Promise<NextResponse> {
  const guard = await requireSession({ minRole: 'university' });
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
  const xff =
    req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null;
  if (xff) headers.set('x-forwarded-for', xff);

  const incoming = new URL(req.url);
  const subPath = pathSegments.map(encodeURIComponent).join('/');
  const upstreamUrl =
    `${API_BASE}/api/v1/education${subPath ? '/' + subPath : ''}` +
    incoming.search;

  const method = req.method;
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'DELETE' && req.body) {
    init.body = req.body;
    // @ts-expect-error — duplex is undici-only; needed to stream req.body.
    init.duplex = 'half';
  }

  const upstream = await fetch(upstreamUrl, init);
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return forward(req, path);
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return forward(req, path);
}
