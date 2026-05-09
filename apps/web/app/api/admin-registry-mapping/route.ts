import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// BFF proxy for the registry-mapping triage page. The browser-side fetch
// hits this Next.js route handler, which forwards to the NestJS API on
// port 4000 with the auth cookie translated into a Bearer token. Same
// pattern as /api/admin-programs/route.ts.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

async function forward(req: Request): Promise<NextResponse> {
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

  const incoming = new URL(req.url);
  const upstreamUrl = `${API_BASE}/api/v1/admin/registry-mapping${incoming.search}`;

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

export async function GET(req: Request) {
  return forward(req);
}
export async function POST(req: Request) {
  return forward(req);
}
