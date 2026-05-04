import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Catch-all proxy for /admin/programs/* on the NestJS API. Browser calls
// /api/admin-programs/<anything>; we forward body + method + search params
// with the session bearer attached. Handles GET / POST / PATCH / DELETE.
// Kept generic on purpose — client code stays small.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

async function forward(
  req: Request,
  pathSegments: string[],
): Promise<NextResponse> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
      { status: 401 },
    );
  }

  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  // Propagate the caller's IP so NestJS's throttler can key per-user/IP
  // rather than collapsing every proxied request onto the Next.js host.
  const xff =
    req.headers.get('x-forwarded-for') ??
    req.headers.get('x-real-ip') ??
    null;
  if (xff) headers.set('x-forwarded-for', xff);

  const incoming = new URL(req.url);
  const subPath = pathSegments.map(encodeURIComponent).join('/');
  const upstreamUrl =
    `${API_BASE}/api/v1/admin/programs${subPath ? '/' + subPath : ''}` +
    incoming.search;

  // Body handling: skip on GET/DELETE for ergonomic match with upstream.
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
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return forward(req, path);
}
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return forward(req, path);
}
